import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import express from 'express';
import PDFDocument from 'pdfkit';
import { buildDocuSealSubmissionPayload, getDocuSealSendConfig } from '../src/docuseal.js';

const uploadDirectory = await mkdtemp(path.join(os.tmpdir(), 'autoshop-auth-pdf-layout-'));
process.env.UPLOAD_DIR = uploadDirectory;
const { createOperationsRouter } = await import('../src/routes/operations.js');

test('generated authorization PDF has one page and DocuSeal fields fit its printed signature/date cells', async () => {
  const pageNumbers = new WeakMap<object, number>();
  let pagesCreated = 0;
  let pageDimensions: { width: number; height: number } | undefined;
  let signatureRow: { page: number; x: number; y: number; w: number; h: number } | undefined;
  const verticalLines: Array<{ page: number; fromX: number; fromY: number; toX: number; toY: number }> = [];
  const labels: Array<{ page: number; text: string; x: number; y: number }> = [];
  const textCalls: string[] = [];
  const initialLines: Array<{ page: number; x: number; y: number; blankX: number; blankWidth: number }> = [];
  const paymentBlanks: Array<{ page: number; text: string; x: number; y: number; width: number }> = [];
  let printNamePosition: { x: number; y: number } | undefined;
  const originalAddPage = PDFDocument.prototype.addPage;
  const originalRect = PDFDocument.prototype.rect;
  const originalMoveTo = PDFDocument.prototype.moveTo;
  const originalLineTo = PDFDocument.prototype.lineTo;
  const originalText = PDFDocument.prototype.text;
  let pendingLineStart: { page: number; x: number; y: number } | undefined;

  PDFDocument.prototype.addPage = function (...args) {
    const result = originalAddPage.apply(this, args);
    pagesCreated += 1;
    pageNumbers.set(this.page, pagesCreated);
    pageDimensions = { width: this.page.width, height: this.page.height };
    return result;
  };
  PDFDocument.prototype.rect = function (x, y, w, h, ...args) {
    if (x === 34 && w === 544 && h === 24) {
      signatureRow = { page: pageNumbers.get(this.page) || 1, x, y, w, h };
    }
    return originalRect.call(this, x, y, w, h, ...args);
  };
  PDFDocument.prototype.moveTo = function (x, y) {
    pendingLineStart = { page: pageNumbers.get(this.page) || 1, x, y };
    return originalMoveTo.call(this, x, y);
  };
  PDFDocument.prototype.lineTo = function (x, y) {
    if (pendingLineStart && pendingLineStart.x === x && pendingLineStart.y !== y) {
      verticalLines.push({
        page: pendingLineStart.page,
        fromX: pendingLineStart.x,
        fromY: pendingLineStart.y,
        toX: x,
        toY: y,
      });
    }
    pendingLineStart = undefined;
    return originalLineTo.call(this, x, y);
  };
  PDFDocument.prototype.text = function (text, x, y, options) {
    if (typeof text === 'string') textCalls.push(text);
    if (text === 'Initial here: x ____________________' && typeof x === 'number' && typeof y === 'number') {
      initialLines.push({
        page: pageNumbers.get(this.page) || 1,
        x,
        y,
        blankX: x + 188 - this.widthOfString(text) + this.widthOfString('Initial here: x '),
        blankWidth: this.widthOfString('____________________'),
      });
    }
    if (text === '______________________________' && typeof x === 'number' && typeof y === 'number') {
      paymentBlanks.push({
        page: pageNumbers.get(this.page) || 1,
        text,
        x,
        y,
        width: this.widthOfString(text),
      });
    }
    if (text === 'Casey Customer' && typeof x === 'number' && typeof y === 'number') {
      printNamePosition = { x, y };
    }
    if ((text === 'Signature' && x === 223) || (text === 'Date' && x === 407)) {
      labels.push({ page: pageNumbers.get(this.page) || 1, text, x, y });
    }
    return originalText.call(this, text, x, y, options);
  };

  const job = {
    id: 'job-layout',
    claimId: null,
    jobNumber: 'JOB-LAYOUT',
    customer: {
      firstName: 'Casey',
      lastName: 'Customer',
      phone: '555-0100',
      address: '1 Main St, Wood Bridge, NJ, 07095',
      city: 'Wood Bridge',
      state: 'NJ',
      zipCode: '07095',
    },
    vehicle: { year: 2020, make: 'Honda', model: 'Civic', bodyClass: 'Sedan', vin: 'VIN123', licensePlate: 'ABC123', color: 'Blue' },
    claim: {
      claimNumber: 'CL-1',
      customerAddress: '1 Main St, Wood Bridge, NJ, 07095',
      customerPhone: '555-0100',
      customerInsurance: 'Test Insurance',
      driverLicense: 'D123',
      vehicleYear: 2020,
      vehicleMake: 'Honda',
      vehicleModel: 'Civic',
      vehicleBodyClass: 'Sedan',
      vehicleVin: 'VIN123',
      vehicleLicensePlate: 'ABC123',
      vehicleColor: 'Blue',
      incidentDate: new Date('2026-10-01T00:00:00Z'),
    },
  };
  const claim = {
    ...job.claim,
    id: 'claim-layout',
    customerId: 'customer-layout',
    customer: job.customer,
    vehicle: job.vehicle,
  };
  const prisma = {
    job: { findUnique: async () => job },
    claim: { findUnique: async () => claim },
    repairAuthorization: {
      create: async ({ data }: { data: Record<string, unknown> }) => data,
    },
  };
  const app = express();
  app.use('/api', createOperationsRouter(prisma as never));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');

  try {
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const response = await fetch(`http://127.0.0.1:${address.port}/api/jobs/${job.id}/authorization.pdf`, { method: 'POST' });
    assert.equal(response.status, 201);
    const authorization = await response.json() as { filePath: string; fileName: string; docusealFields: string };
    const pdf = await readFile(path.resolve(process.cwd(), authorization.filePath));
    const pdfText = pdf.toString('latin1');
    const pageCount = [...pdfText.matchAll(/\/Type\s*\/Page\b/g)].length;
    const fieldPlacements = JSON.parse(authorization.docusealFields) as Array<{
      name: string; type: string; required: boolean; x: number; y: number; w: number; h: number; page: number;
    }>;

    assert.equal(pageCount, 1, 'the generated authorization must remain a single-page Letter PDF');
    assert.deepEqual(pageDimensions, { width: 612, height: 792 }, 'the authorization must use full Letter page dimensions');
    for (const value of [
      ' 1 Main St',
      ' Wood Bridge',
      ' NJ',
      ' 07095',
      'Casey Customer',
      ' 38-21 23rd St',
      ' Long Island City',
      ' NY 11101',
    ]) {
      assert.ok(textCalls.includes(value), `the authorization PDF should prefill "${value.trim()}"`);
    }
    assert.ok(signatureRow, 'the generated PDF must contain the signature/date table');
    assert.equal(initialLines.length, 5);
    assert.equal(paymentBlanks.length, 2);
    assert.equal(fieldPlacements.length, 9);
    assert.deepEqual(fieldPlacements.map(({ type }) => type).sort(), [
      'date', 'initials', 'initials', 'initials', 'initials', 'initials', 'signature', 'text', 'text',
    ]);
    assert.ok(initialLines.every((line) => line.page === 1));
    assert.ok(paymentBlanks.every((line) => line.page === 1));
    const initials = fieldPlacements.filter(({ type }) => type === 'initials');
    for (const [index, line] of initialLines.entries()) {
      const placement = initials[index];
      assert.ok(placement);
      assert.equal(placement.x, line.blankX);
      assert.equal(placement.w, line.blankWidth);
      assert.equal(placement.y, line.y + 1);
      assert.equal(placement.page, 1);
    }
    const insuranceField = fieldPlacements.find(({ name }) => name === 'Insurance Company');
    const claimNumberField = fieldPlacements.find(({ name }) => name === 'Claim Number');
    assert.ok(insuranceField && claimNumberField);
    assert.deepEqual(paymentBlanks.map(({ x }) => x), [insuranceField.x, claimNumberField.x]);
    assert.deepEqual(paymentBlanks.map(({ y }) => y + 1), [insuranceField.y, claimNumberField.y]);
    assert.ok(insuranceField.required && claimNumberField.required);
    assert.equal(signatureRow.page, 1);
    assert.equal(signatureRow.x, 34);
    assert.equal(signatureRow.w, 544);
    assert.equal(signatureRow.h, 24);
    assert.deepEqual(printNamePosition, { x: 39, y: signatureRow.y + 15 });
    assert.ok(verticalLines.some((line) => line.page === 1 && line.fromX === 218 && line.fromY === signatureRow!.y && line.toY === signatureRow!.y + 24));
    assert.ok(verticalLines.some((line) => line.page === 1 && line.fromX === 402 && line.fromY === signatureRow!.y && line.toY === signatureRow!.y + 24));
    assert.deepEqual(labels, [
      { page: 1, text: 'Signature', x: 223, y: signatureRow.y + 5 },
      { page: 1, text: 'Date', x: 407, y: signatureRow.y + 5 },
    ]);

    const claimResponse = await fetch(`http://127.0.0.1:${address.port}/api/claims/${claim.id}/authorization.pdf`, { method: 'POST' });
    assert.equal(claimResponse.status, 201);
    const claimAuthorization = await claimResponse.json() as { jobId: string | null; claimId: string; filePath: string };
    assert.equal(claimAuthorization.jobId, null);
    assert.equal(claimAuthorization.claimId, claim.id);
    const claimPdf = await readFile(path.resolve(process.cwd(), claimAuthorization.filePath));
    assert.equal([...claimPdf.toString('latin1').matchAll(/\/Type\s*\/Page\b/g)].length, 1);

    const payload = buildDocuSealSubmissionPayload(getDocuSealSendConfig({ DOCUSEAL_API_KEY: 'test-key' }), {
      authorizationId: 'authorization-layout',
      jobId: job.id,
      jobNumber: job.jobNumber,
      fileName: authorization.fileName,
      pdf,
      signerEmail: 'customer@example.test',
      signerName: 'Casey Customer',
      fieldPlacements,
    });
    assert.deepEqual(Buffer.from(payload.documents[0].file, 'base64'), pdf);
    assert.equal(payload.documents[0].fields.length, 9);
    assert.deepEqual(payload.documents[0].fields.map(({ name, type }) => [name, type]), [
      ['Designated Representative Authorization initials', 'initials'],
      ['Authorization To Repair initials', 'initials'],
      ['Authorization To Dismantle initials', 'initials'],
      ['Insurance Company', 'text'],
      ['Claim Number', 'text'],
      ['Direction of Payment initials', 'initials'],
      ['Department of Motor Vehicles Notification initials', 'initials'],
      ['Signature', 'signature'],
      ['Date', 'date'],
    ]);
    const signature = payload.documents[0].fields.find(({ name }) => name === 'Signature');
    const date = payload.documents[0].fields.find(({ name }) => name === 'Date');
    assert.ok(signature && date);
    assert.equal(signature.areas[0].page, 1);
    assert.equal(date.areas[0].page, 1);
    const pixelsToPoints = 72 / 96;
    const signatureLeft = signature.areas[0].x * pixelsToPoints;
    const signatureTop = signature.areas[0].y * pixelsToPoints;
    const signatureWidth = signature.areas[0].w * pixelsToPoints;
    const signatureHeight = signature.areas[0].h * pixelsToPoints;
    const dateLeft = date.areas[0].x * pixelsToPoints;
    const dateTop = date.areas[0].y * pixelsToPoints;
    const dateWidth = date.areas[0].w * pixelsToPoints;
    const dateHeight = date.areas[0].h * pixelsToPoints;

    assert.ok(signatureLeft >= 223 && signatureLeft + signatureWidth <= 397);
    assert.ok(dateLeft >= 407 && dateLeft + dateWidth <= 573);
    assert.ok(signatureTop >= labels[0].y + 9.5);
    assert.ok(dateTop >= labels[1].y + 9.5);
    assert.ok(signatureTop + signatureHeight <= signatureRow.y + signatureRow.h);
    assert.ok(dateTop + dateHeight <= signatureRow.y + signatureRow.h);
    for (const [index, placement] of fieldPlacements.entries()) {
      const field = payload.documents[0].fields[index];
      assert.equal(field.areas[0].page, placement.page);
      assert.equal(field.required, true);
      assert.ok(field.areas[0].x >= 0 && field.areas[0].y >= 0);
    }
  } finally {
    PDFDocument.prototype.addPage = originalAddPage;
    PDFDocument.prototype.rect = originalRect;
    PDFDocument.prototype.moveTo = originalMoveTo;
    PDFDocument.prototype.lineTo = originalLineTo;
    PDFDocument.prototype.text = originalText;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    await rm(uploadDirectory, { recursive: true, force: true });
  }
});
