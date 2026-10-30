import towingTemplate from "./assets/towing-receipt.html?raw";
import storageTemplate from "./assets/storage-receipt.html?raw";
import logoUrl from "./assets/mastercraft-logo.png";

export type ReceiptKind = "towing" | "storage";
export type ReceiptValues = Record<string, string | boolean>;

export const RECEIPT_LABELS: Record<ReceiptKind, string> = { towing: "Towing", storage: "Storage" };

// The receipt page as it is loaded in the app's iframe. Storage receipts carry the Mastercraft logo.
export function receiptTemplate(kind: ReceiptKind) {
  return kind === "towing" ? towingTemplate : storageTemplate.replace("__LOGO_SRC__", logoUrl);
}

// Sends a message to the receipt frame and resolves with its reply.
function askFrame<T>(frame: HTMLIFrameElement, message: Record<string, unknown>, replyType: string, timeoutMs = 5000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      window.removeEventListener("message", onReply);
      reject(new Error("The receipt did not respond. Try again."));
    }, timeoutMs);
    function onReply(event: MessageEvent) {
      if (event.source !== frame.contentWindow) return;
      const data = event.data || {};
      if (data.type !== replyType) return;
      window.clearTimeout(timer);
      window.removeEventListener("message", onReply);
      resolve(data as T);
    }
    window.addEventListener("message", onReply);
    frame.contentWindow?.postMessage(message, "*");
  });
}

export async function collectValues(frame: HTMLIFrameElement): Promise<ReceiptValues> {
  return (await askFrame<{ values: ReceiptValues }>(frame, { type: "receipt-collect" }, "receipt-state")).values;
}

export async function snapshotHtml(frame: HTMLIFrameElement, kind: ReceiptKind): Promise<string> {
  const { html } = await askFrame<{ html: string }>(frame, { type: "receipt-html" }, "receipt-snapshot");
  return kind === "storage" ? embedLogo(html) : html;
}

// Renders a saved receipt off-screen with its values filled in, so it can be downloaded without opening it.
export async function renderSavedReceipt(kind: ReceiptKind, values: ReceiptValues): Promise<string> {
  const frame = document.createElement("iframe");
  frame.style.display = "none";
  frame.setAttribute("sandbox", "allow-scripts");
  frame.srcdoc = receiptTemplate(kind);
  document.body.appendChild(frame);
  try {
    await new Promise<void>((resolve) => { frame.onload = () => resolve(); });
    frame.contentWindow?.postMessage({ type: "receipt-restore", values }, "*");
    return await snapshotHtml(frame, kind);
  } finally {
    frame.remove();
  }
}

// Downloads and inlines the logo so the saved file still shows it when opened offline.
async function embedLogo(html: string) {
  if (!html.includes(`src="${logoUrl}"`)) return html;
  const blob = await fetch(new URL(logoUrl, window.location.href)).then((response) => response.blob());
  const dataUrl = await new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(blob);
  });
  return html.split(`src="${logoUrl}"`).join(`src="${dataUrl}"`);
}

export function downloadHtml(html: string, fileName: string) {
  const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${fileName.replace(/[^A-Za-z0-9 _-]+/g, "").trim().replace(/\s+/g, "-") || "receipt"}.html`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function sendToFrame(frame: HTMLIFrameElement | null, message: Record<string, unknown>) {
  frame?.contentWindow?.postMessage(message, "*");
}
