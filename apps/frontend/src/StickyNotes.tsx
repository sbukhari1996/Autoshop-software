import React from "react";
import "./StickyNotes.css";

type Request = <T>(path: string, options?: RequestInit) => Promise<T>;
type Note = { id: string; text: string; color: string };
type Draft = { text: string; color: string };

const COLORS: Record<string, { label: string; background: string }> = {
  yellow: { label: "Yellow", background: "#fff3a3" },
  pink: { label: "Pink", background: "#ffd7e5" },
  blue: { label: "Blue", background: "#d4ebff" },
  green: { label: "Green", background: "#d7f5dc" },
};
const JSON_HEADERS = { "Content-Type": "application/json" };
const message = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback);

// Sticky notes on the dashboard. Each note is saved to the database, so every signed-in user sees the same notes.
export function StickyNotes({ request }: { request: Request }) {
  const [notes, setNotes] = React.useState<Note[]>([]);
  const [drafts, setDrafts] = React.useState<Record<string, Draft>>({});
  const [adding, setAdding] = React.useState<Draft | null>(null);
  const [busy, setBusy] = React.useState("");
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    request<Note[]>("/notes").then(setNotes).catch((loadError) => setError(message(loadError, "Unable to load notes")));
  }, [request]);

  const valueOf = (note: Note): Draft => drafts[note.id] ?? { text: note.text, color: note.color };
  const isChanged = (note: Note) => {
    const draft = drafts[note.id];
    return Boolean(draft && (draft.text !== note.text || draft.color !== note.color));
  };
  const setDraft = (note: Note, change: Partial<Draft>) => setDrafts((current) => ({ ...current, [note.id]: { ...valueOf(note), ...change } }));

  async function saveNote(note: Note) {
    setBusy(note.id);
    setError("");
    try {
      const saved = await request<Note>(`/notes/${note.id}`, { method: "PUT", headers: JSON_HEADERS, body: JSON.stringify(valueOf(note)) });
      setNotes((current) => current.map((item) => (item.id === note.id ? saved : item)));
      setDrafts((current) => {
        const next = { ...current };
        delete next[note.id];
        return next;
      });
    } catch (saveError) {
      setError(message(saveError, "Unable to save the note"));
    } finally {
      setBusy("");
    }
  }

  async function addNote() {
    if (!adding) return;
    setBusy("new");
    setError("");
    try {
      const saved = await request<Note>("/notes", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(adding) });
      setNotes((current) => [saved, ...current]);
      setAdding(null);
    } catch (addError) {
      setError(message(addError, "Unable to add the note"));
    } finally {
      setBusy("");
    }
  }

  async function deleteNote(note: Note) {
    if (!window.confirm("Delete this note? This cannot be undone.")) return;
    setBusy(note.id);
    setError("");
    try {
      await request(`/notes/${note.id}`, { method: "DELETE" });
      setNotes((current) => current.filter((item) => item.id !== note.id));
    } catch (deleteError) {
      setError(message(deleteError, "Unable to delete the note"));
    } finally {
      setBusy("");
    }
  }

  const swatches = (value: Draft, onPick: (color: string) => void, name: string) => (
    <div className="sticky-swatches" role="group" aria-label={`${name} color`}>
      {Object.entries(COLORS).map(([key, color]) => (
        <button key={key} type="button" aria-label={color.label} aria-pressed={value.color === key} onClick={() => onPick(key)}>
          <span style={{ background: color.background }} />
        </button>
      ))}
    </div>
  );

  return (
    <div className="sticky-panel">
      <div className="sticky-heading">
        <div>
          <p className="eyebrow">Notes</p>
          <h3>Sticky notes</h3>
        </div>
        <button type="button" className="orange-button" disabled={Boolean(adding)} onClick={() => setAdding({ text: "", color: "yellow" })}>
          New note
        </button>
      </div>
      {error && <div className="sr-banner sr-warn" role="alert">{error}</div>}
      <div className="sticky-grid">
        {adding && (
          <article className="sticky-note" style={{ background: COLORS[adding.color].background }}>
            <textarea aria-label="New note text" placeholder="Write a note" value={adding.text} onChange={(event) => setAdding({ ...adding, text: event.target.value })} autoFocus />
            {swatches(adding, (color) => setAdding({ ...adding, color }), "New note")}
            <div className="sticky-actions">
              <button type="button" className="secondary-button" onClick={() => setAdding(null)}>Cancel</button>
              <button type="button" className="orange-button" disabled={busy === "new" || !adding.text.trim()} onClick={() => void addNote()}>
                {busy === "new" ? "Saving..." : "Save note"}
              </button>
            </div>
          </article>
        )}
        {notes.map((note) => {
          const value = valueOf(note);
          const changed = isChanged(note);
          return (
            <article key={note.id} className="sticky-note" style={{ background: COLORS[value.color]?.background ?? COLORS.yellow.background }}>
              <textarea aria-label="Note text" value={value.text} onChange={(event) => setDraft(note, { text: event.target.value })} />
              {swatches(value, (color) => setDraft(note, { color }), "Note")}
              <div className="sticky-actions">
                <button type="button" className="danger-button" disabled={busy === note.id} onClick={() => void deleteNote(note)}>Delete</button>
                <button type="button" className="orange-button" disabled={!changed || !value.text.trim() || busy === note.id} onClick={() => void saveNote(note)}>
                  {busy === note.id ? "Saving..." : changed ? "Save changes" : "Saved"}
                </button>
              </div>
            </article>
          );
        })}
      </div>
      {!notes.length && !adding && <p className="records-muted">No notes yet. Choose New note to add one.</p>}
    </div>
  );
}
