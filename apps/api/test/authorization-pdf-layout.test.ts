import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import express from 'express';
import PDFDocument from 'pdfkit';
import { buildDocumensoPayload } from '../src/documenso.js';

const uploadDirectory = await mkdtemp(path.join(os.tmpdir(), 'autoshop-auth-pdf-layout-'));
process.env.UPLOAD_DIR = uploadDirectory;
const { createOperationsRouter } = await import('../src/routes/operations.js');

test('generated authorization PDF has one Letter page and Documenso fields match its signature/date cells', async () => {
  const pageNumbers = new WeakMap<object, number>();
  let pagesCreated = 0;
  let pageDimensions: { width: number; height: number } | undefined;
  let signatureRow: { page: number; x: number; y: number; w: number; h: number } | undefined;
  const verticalLines: Array<{ page: number; fromX: number; fromY: number; toX: number; toY: number }> = [];
  const labels: Array<{ page: number; text: string; x: number; y: number }> = [];
  const textCalls: string[] = [];
  let contentBottom = 0;
  const initialLines: Array<{ page: number; x: number; y: number; blankX: number; blankWidth: number }> = [];
  const longVehicleTypeBounds: Array<{ right: number; end: number; text: string }> = [];
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
    if (typeof text === 'string' && text.includes('Sport Utility')) {
      longVehicleTypeBounds.push({
        right: 490,
        end: this.x + this.widthOfString(text),
        text,
      });
    }
    if (typeof y === 'number') contentBottom = Math.max(contentBottom, y + this._fontSize);
    if (text === 'Initial here: x ____________________' && typeof x === 'number' && typeof y === 'number') {
      initialLines.push({
        page: pageNumbers.get(this.page) || 1,
        x,
        y,
        blankX: x + 188 - this.widthOfString(text) + this.widthOfString('Initial here: x '),
        blankWidth: this.widthOfString('____________________'),
      });
    }
    if (text === 'Casey Customer' && typeof x === 'number' && typeof y === 'number') {
      printNamePosition = { x, y };
    }
    if ((text === 'Signature' && x === 223) || (text === 'Date' && x === 407)) {
      labels.push({ page: pageNumbers.get(this.page) || 1, text, x, y });
    }
    const result = originalText.call(this, text, x, y, options);
    contentBottom = Math.max(contentBottom, this.y);
    return result;
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
    vehicle: { year: 2020, make: 'Honda', model: 'Civic', bodyClass: 'Sport Utility Vehicle [SUV] Multi-Purpose Vehicle', vin: 'VIN123', licensePlate: 'ABC123', color: 'Blue' },
    claim: {
      claimNumber: 'CL-1',
      customerAddress: '1 Main St, Wood Bridge, NJ, 07095',
      customerPhone: '555-0100',
      customerInsurance: 'Test Insurance',
      atFaultInsurance: 'GEICO',
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
  const staleFilePath = path.join(uploadDirectory, 'stale-repair-authorization.pdf');
  const staleAuthorization = {
    id: 'authorization-stale',
    fileName: 'repair-authorization-stale.pdf',
    filePath: path.relative(process.cwd(), staleFilePath),
    authorizationFields: null as string | null,
    legacyDocuSealSubmissionId: null,
    documensoEnvelopeId: null,
    documensoCompletedAt: null,
    job,
    claim: null,
  };
  const prisma = {
    job: { findUnique: async () => job },
    claim: { findUnique: async () => claim },
    repairAuthorization: {
      create: async ({ data }: { data: Record<string, unknown> }) => data,
      findUnique: async ({ where }: { where: { id: string } }) => where.id === staleAuthorization.id ? staleAuthorization : null,
      update: async ({ data }: { data: { authorizationFields: string } }) => Object.assign(staleAuthorization, data),
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
    const authorization = await response.json() as { filePath: string; fileName: string; authorizationFields: string };
    const pdf = await readFile(path.resolve(process.cwd(), authorization.filePath));
    const pdfText = pdf.toString('latin1');
    const pageCount = [...pdfText.matchAll(/\/Type\s*\/Page\b/g)].length;
    const fieldPlacements = JSON.parse(authorization.authorizationFields) as Array<{
      name: string; type: string; required: boolean; x: number; y: number; w: number; h: number; page: number;
    }>;

    assert.equal(pageCount, 1, 'the generated authorization must remain a single-page Letter PDF');
    assert.deepEqual(pageDimensions, { width: 612, height: 792 }, 'the authorization must use full Letter page dimensions');
    assert.ok(contentBottom >= 720, `authorization text should fill most of the page (last text at ${contentBottom}pt)`);
    assert.ok(contentBottom <= 758, `authorization text must remain within the printable Letter page (last text at ${contentBottom}pt)`);
    assert.equal(longVehicleTypeBounds.length, 1);
    assert.ok(longVehicleTypeBounds[0].text.endsWith('...'), 'long vehicle types should be visibly shortened');
    assert.ok(longVehicleTypeBounds[0].end <= longVehicleTypeBounds[0].right, 'the vehicle type must not run into the license field');

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
    assert.ok(textCalls.some((text) => text.includes('GEICO on my claim# CL-1')), 'the payment direction should prefill the at-fault insurer and claim number');
    assert.equal(fieldPlacements.length, 7);
    assert.deepEqual(fieldPlacements.map(({ type }) => type).sort(), [
      'date', 'initials', 'initials', 'initials', 'initials', 'initials', 'signature',
    ]);
    assert.ok(initialLines.every((line) => line.page === 1));
    const initials = fieldPlacements.filter(({ type }) => type === 'initials');
    for (const [index, line] of initialLines.entries()) {
      const placement = initials[index];
      assert.ok(placement);
      assert.equal(placement.x, line.blankX);
      assert.equal(placement.w, line.blankWidth);
      assert.equal(placement.y, line.y + 1);
      assert.equal(placement.page, 1);
    }
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

    const payload = buildDocumensoPayload({
      authorizationId: 'authorization-layout',
      jobId: job.id,
      jobNumber: job.jobNumber,
      fileName: authorization.fileName,
      pdf,
      signerEmail: 'customer@example.test',
      signerName: 'Casey Customer',
      fieldPlacements,
    });
    assert.equal(payload.type, 'DOCUMENT');
    assert.equal(payload.externalId, 'authorization-layout');
    assert.equal(payload.recipients.length, 1);
    assert.equal(payload.recipients[0].email, 'customer@example.test');
    assert.equal(payload.recipients[0].fields.length, 7);
    assert.deepEqual(payload.recipients[0].fields.map(({ type }) => type), [
      'INITIALS', 'INITIALS', 'INITIALS', 'INITIALS', 'INITIALS', 'SIGNATURE', 'DATE',
    ]);
    assert.equal(payload.recipients[0].fields[0].fieldMeta.required, true);
    const signature = payload.recipients[0].fields.find(({ type }) => type === 'SIGNATURE');
    const date = payload.recipients[0].fields.find(({ type }) => type === 'DATE');
    assert.ok(signature && date);
    assert.equal(signature.page, 1);
    assert.equal(date.page, 1);
    assert.equal(signature.positionX, Number(((fieldPlacements.find(({ type }) => type === 'signature')!.x / 612) * 100).toFixed(5)));
    assert.equal(date.positionX, Number(((fieldPlacements.find(({ type }) => type === 'date')!.x / 612) * 100).toFixed(5)));
    for (const [index, placement] of fieldPlacements.entries()) {
      const field = payload.recipients[0].fields[index];
      assert.equal(field.page, placement.page);
      assert.equal(field.fieldMeta.required, true);
      assert.ok(field.positionX >= 0 && field.positionY >= 0);
      assert.ok(field.positionX + field.width <= 100);
      assert.ok(field.positionY + field.height <= 100);
    }

    await writeFile(staleFilePath, Buffer.from('%PDF-1.4 stale overlapping authorization'));
    const staleDownload = await fetch(`http://127.0.0.1:${address.port}/api/repair-authorizations/${staleAuthorization.id}/download`);
    assert.equal(staleDownload.status, 200);
    assert.equal(staleDownload.headers.get('content-disposition'), 'attachment; filename="repair-authorization-stale.pdf"');
    const regeneratedPdf = await readFile(staleFilePath);
    assert.ok(regeneratedPdf.length > 1000, 'downloading an old unsigned authorization should regenerate its PDF');
    assert.equal(longVehicleTypeBounds.length, 3);
    assert.ok(longVehicleTypeBounds[2].text.endsWith('...'), 'regenerated old authorizations should truncate long vehicle types');
    assert.ok(staleAuthorization.authorizationFields, 'regeneration should refresh the Documenso field positions');
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
