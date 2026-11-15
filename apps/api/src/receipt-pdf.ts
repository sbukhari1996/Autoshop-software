import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { ApiError } from './errors.js';

// Phone photos are wrapped in a PDF so every receipt is the same kind of file.
export async function receiptPdf(file: { originalname: string; mimetype: string; buffer: Buffer }) {
  const name = path.basename(file.originalname).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'receipt';
  if (file.mimetype === 'application/pdf') return { bytes: file.buffer, name };
  if (file.mimetype !== 'image/jpeg' && file.mimetype !== 'image/png') throw new ApiError(400, 'Receipts must be a PDF, JPEG or PNG');
  const pdf = await PDFDocument.create();
  const image = file.mimetype === 'image/png' ? await pdf.embedPng(file.buffer) : await pdf.embedJpg(file.buffer);
  const page = pdf.addPage([612, 792]);
  const scale = Math.min(540 / image.width, 720 / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  page.drawImage(image, { x: (612 - width) / 2, y: (792 - height) / 2, width, height });
  return { bytes: Buffer.from(await pdf.save()), name: `${name.replace(/\.[^.]*$/, '')}.pdf` };
}
