import { Router } from 'express';
import PDFDocument from 'pdfkit';
import { PrismaClient } from '@prisma/client';
import { ApiError, asyncHandler } from '../errors.js';
import { optionalBoolean, optionalDate, optionalInteger, optionalText, requiredText } from '../validation.js';

const inspectionSelect = {
  id: true, customerId: true, claimId: true, jobId: true, scheduledFor: true, inspectorName: true, inspectorPhone: true, insuranceRep: true, status: true, notes: true,
  customer: { select: { id: true, firstName: true, lastName: true, phone: true } },
  claim: { select: { id: true, claimNumber: true, insuranceCompany: true, vehicle: true } },
  job: { select: { id: true, jobNumber: true, status: true, vehicle: true } },
} as const;

export function createWorkflowsRouter(prisma: PrismaClient) {
  const workflowsRouter = Router();

  workflowsRouter.get('/vin/:vin', asyncHandler(async (req, res) => {
    const vinParam = req.params.vin;
    if (typeof vinParam !== 'string' || !vinParam) throw new ApiError(400, 'vin is required');
    const vin = vinParam.trim().toUpperCase();
    if (!/^[A-HJ-NPR-Z0-9]{11,17}$/.test(vin)) throw new ApiError(400, 'VIN must be 11 to 17 valid characters');
    const response = await fetch(`https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValuesExtended/${encodeURIComponent(vin)}?format=json`);
    if (!response.ok) throw new ApiError(502, 'NHTSA VIN service is unavailable');
    const payload = await response.json() as { Results?: Array<Record<string, string>> };
    const result = payload.Results?.[0];
    if (!result || result.ErrorCode === '1' || !result.Make) throw new ApiError(404, 'VIN could not be decoded');
    res.json({ vin, year: result.ModelYear || '', make: result.Make || '', model: result.Model || '', trim: result.Trim || '', bodyClass: result.BodyClass || '', series: result.Series || '' });
  }));

  workflowsRouter.get('/dashboard', asyncHandler(async (_req, res) => {
    const [openJobs, inspections, customers, revenue, expenses, recentJobs, upcomingSchedule] = await Promise.all([
      prisma.job.count({ where: { status: { notIn: ['completed', 'cancelled'] } } }),
      prisma.inspection.count({ where: { status: 'scheduled' } }),
      prisma.customer.count(),
      prisma.job.aggregate({ _sum: { totalRevenue: true } }),
      prisma.jobExpense.aggregate({ _sum: { amount: true } }),
      prisma.job.findMany({ take: 8, orderBy: { updatedAt: 'desc' }, include: { customer: true, vehicle: true } }),
      getUpcomingInspections(prisma),
    ]);
    res.json({
      metrics: { openJobs, inspections, customers, revenue: revenue._sum.totalRevenue || 0, expenses: expenses._sum.amount || 0 },
      recentJobs,
      upcomingSchedule,
    });
  }));

  workflowsRouter.get('/inspections/upcoming', asyncHandler(async (_req, res) => {
    res.json(await getUpcomingInspections(prisma));
  }));

  workflowsRouter.post('/inspections', asyncHandler(async (req, res) => {
    const customerId = requiredText(req.body.customerId, 'customerId');
    const scheduledFor = requiredDate(req.body.scheduledFor, 'scheduledFor');
    const claimId = optionalText(req.body.claimId, 'claimId') || null;
    const jobId = optionalText(req.body.jobId, 'jobId') || null;
    await ensureInspectionLinks(prisma, customerId, claimId, jobId);
    const inspection = await prisma.inspection.create({
      data: {
        customerId,
        claimId,
        jobId,
        scheduledFor,
        inspectorName: optionalText(req.body.inspectorName, 'inspectorName'),
        inspectorPhone: optionalText(req.body.inspectorPhone, 'inspectorPhone'),
        insuranceRep: optionalText(req.body.insuranceRep, 'insuranceRep'),
        status: optionalInspectionStatus(req.body.status),
        notes: optionalText(req.body.notes, 'notes'),
      },
      select: inspectionSelect,
    });
    res.status(201).json(inspection);
  }));

  workflowsRouter.patch('/inspections/:inspectionId', asyncHandler(async (req, res) => {
    const inspectionId = routeParam(req, 'inspectionId');
    const existing = await prisma.inspection.findUnique({ where: { id: inspectionId }, include: { job: true } });
    if (!existing) throw new ApiError(404, 'Inspection not found');
    const customerId = req.body.customerId === undefined
      ? existing.customerId || existing.job?.customerId
      : requiredText(req.body.customerId, 'customerId');
    if (!customerId) throw new ApiError(400, 'customerId is required');
    const claimId = req.body.claimId === undefined ? existing.claimId : optionalText(req.body.claimId, 'claimId') || null;
    const jobId = req.body.jobId === undefined ? existing.jobId : optionalText(req.body.jobId, 'jobId') || null;
    await ensureInspectionLinks(prisma, customerId, claimId, jobId);
    const inspection = await prisma.inspection.update({
      where: { id: inspectionId },
      data: {
        customerId,
        claimId,
        jobId,
        scheduledFor: req.body.scheduledFor === undefined ? undefined : requiredDate(req.body.scheduledFor, 'scheduledFor'),
        inspectorName: req.body.inspectorName === undefined ? undefined : optionalText(req.body.inspectorName, 'inspectorName'),
        inspectorPhone: req.body.inspectorPhone === undefined ? undefined : optionalText(req.body.inspectorPhone, 'inspectorPhone'),
        insuranceRep: req.body.insuranceRep === undefined ? undefined : optionalText(req.body.insuranceRep, 'insuranceRep'),
        status: req.body.status === undefined ? undefined : optionalInspectionStatus(req.body.status),
        notes: req.body.notes === undefined ? undefined : optionalText(req.body.notes, 'notes'),
      },
      select: inspectionSelect,
    });
    res.json(inspection);
  }));

  workflowsRouter.get('/vehicles', asyncHandler(async (req, res) => {
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const vehicles = await prisma.vehicle.findMany({
      where: search ? { OR: [
        { vin: { contains: search, mode: 'insensitive' } },
        { make: { contains: search, mode: 'insensitive' } },
        { model: { contains: search, mode: 'insensitive' } },
        { customer: { firstName: { contains: search, mode: 'insensitive' } } },
        { customer: { lastName: { contains: search, mode: 'insensitive' } } },
      ] } : undefined,
      include: { customer: true }, orderBy: { updatedAt: 'desc' },
    });
    res.json(vehicles);
  }));

  workflowsRouter.post('/vehicles', asyncHandler(async (req, res) => {
    const customerId = requiredText(req.body.customerId, 'customerId');
    await ensureCustomer(prisma, customerId);
    const vehicle = await prisma.vehicle.create({
      data: {
        customerId,
        year: optionalInteger(req.body.year, 'year'),
        make: optionalText(req.body.make, 'make'), model: optionalText(req.body.model, 'model'), trim: optionalText(req.body.trim, 'trim'), bodyClass: optionalText(req.body.bodyClass, 'bodyClass'),
        vin: optionalText(req.body.vin, 'vin')?.toUpperCase(),
        licensePlate: optionalText(req.body.licensePlate, 'licensePlate')?.toUpperCase(),
        licenseState: optionalText(req.body.licenseState, 'licenseState')?.toUpperCase(),
        color: optionalText(req.body.color, 'color'),
      }, include: { customer: true },
    });
    res.status(201).json(vehicle);
  }));

  workflowsRouter.patch('/vehicles/:vehicleId', asyncHandler(async (req, res) => {
    const vehicleId = routeParam(req, 'vehicleId');
    const existing = await prisma.vehicle.findUnique({ where: { id: vehicleId } });
    if (!existing) throw new ApiError(404, 'Vehicle not found');
    const customerId = req.body.customerId === undefined ? existing.customerId : requiredText(req.body.customerId, 'customerId');
    await ensureCustomer(prisma, customerId);
    const vehicle = await prisma.vehicle.update({ where: { id: vehicleId }, data: { customerId, year: req.body.year === undefined || req.body.year === '' ? undefined : optionalInteger(req.body.year, 'year'), make: req.body.make === undefined ? undefined : optionalText(req.body.make, 'make'), model: req.body.model === undefined ? undefined : optionalText(req.body.model, 'model'), trim: req.body.trim === undefined ? undefined : optionalText(req.body.trim, 'trim'), bodyClass: req.body.bodyClass === undefined ? undefined : optionalText(req.body.bodyClass, 'bodyClass'), vin: req.body.vin === undefined ? undefined : optionalText(req.body.vin, 'vin')?.toUpperCase(), licensePlate: req.body.licensePlate === undefined ? undefined : optionalText(req.body.licensePlate, 'licensePlate')?.toUpperCase(), licenseState: req.body.licenseState === undefined ? undefined : optionalText(req.body.licenseState, 'licenseState')?.toUpperCase(), color: req.body.color === undefined ? undefined : optionalText(req.body.color, 'color') }, include: { customer: true } });
    res.json(vehicle);
  }));

  workflowsRouter.delete('/vehicles/:vehicleId', asyncHandler(async (req, res) => {
    const vehicleId = routeParam(req, 'vehicleId');
    const vehicle = await prisma.vehicle.findUnique({
      where: { id: vehicleId },
      select: { id: true, _count: { select: { jobs: true, claims: true } } },
    });
    if (!vehicle) throw new ApiError(404, 'Vehicle not found');

    const linked = Object.entries(vehicle._count).filter(([, count]) => count > 0);
    if (linked.length) {
      throw new ApiError(409, `Vehicle cannot be deleted while linked records exist: ${linked.map(([name, count]) => `${name} (${count})`).join(', ')}`);
    }

    await prisma.vehicle.delete({ where: { id: vehicleId } });
    res.status(204).send();
  }));

  workflowsRouter.get('/claims', asyncHandler(async (_req, res) => {
    const claims = await prisma.claim.findMany({ orderBy: { updatedAt: 'desc' }, include: { customer: true, vehicle: true, jobs: { select: { jobNumber: true, status: true } } } });
    res.json(claims);
  }));

  workflowsRouter.post('/claims', asyncHandler(async (req, res) => {
    const customerId = requiredText(req.body.customerId, 'customerId');
    const vehicleId = optionalText(req.body.vehicleId, 'vehicleId');
    const jobId = optionalText(req.body.jobId, 'jobId');
    await ensureCustomer(prisma, customerId);
    if (vehicleId) await ensureVehicleBelongsToCustomer(prisma, vehicleId, customerId);
    if (jobId) await ensureJobBelongsToCustomer(prisma, jobId, customerId, vehicleId);
    const claim = await prisma.$transaction(async (tx) => {
      const created = await tx.claim.create({ data: buildClaimData(req.body, customerId, vehicleId) });
      if (jobId) await tx.job.update({ where: { id: jobId }, data: { claimId: created.id } });
      return tx.claim.findUniqueOrThrow({ where: { id: created.id }, include: claimInclude });
    });
    res.status(201).json(claim);
  }));

  workflowsRouter.get('/claims/:claimId', asyncHandler(async (req, res) => {
    const claim = await prisma.claim.findUnique({ where: { id: routeParam(req, 'claimId') }, include: claimInclude });
    if (!claim) throw new ApiError(404, 'Claim not found');
    res.json(claim);
  }));

  workflowsRouter.get('/claims/:claimId/hub', asyncHandler(async (req, res) => {
    const claim = await prisma.claim.findUnique({ where: { id: routeParam(req, 'claimId') }, include: claimInclude });
    if (!claim) throw new ApiError(404, 'Claim not found');
    res.json(claim);
  }));

  workflowsRouter.put('/claims/:claimId', asyncHandler(async (req, res) => {
    const claimId = routeParam(req, 'claimId');
    const existing = await prisma.claim.findUnique({ where: { id: claimId, }, select: { customerId: true, vehicleId: true } });
    if (!existing) throw new ApiError(404, 'Claim not found');
    const customerId = req.body.customerId === undefined ? existing.customerId : requiredText(req.body.customerId, 'customerId');
    const vehicleId = req.body.vehicleId === undefined ? existing.vehicleId : optionalText(req.body.vehicleId, 'vehicleId');
    const currentJob = req.body.jobId === undefined ? await prisma.job.findFirst({ where: { claimId }, select: { id: true } }) : null;
    const jobId = req.body.jobId === undefined ? currentJob?.id : optionalText(req.body.jobId, 'jobId');
    await ensureCustomer(prisma, customerId);
    if (vehicleId) await ensureVehicleBelongsToCustomer(prisma, vehicleId, customerId);
    if (jobId) await ensureJobBelongsToCustomer(prisma, jobId, customerId, vehicleId);
    const claim = await prisma.$transaction(async (tx) => {
      await tx.claim.update({ where: { id: claimId }, data: buildClaimData(req.body, customerId, vehicleId) });
      await tx.job.updateMany({ where: { claimId: claimId }, data: { claimId: null } });
      if (jobId) await tx.job.update({ where: { id: jobId }, data: { claimId } });
      return tx.claim.findUniqueOrThrow({ where: { id: claimId }, include: claimInclude });
    });
    res.json(claim);
  }));

  workflowsRouter.delete('/claims/:claimId', asyncHandler(async (req, res) => {
    const claimId = routeParam(req, 'claimId');
    const claim = await prisma.claim.findUnique({
      where: { id: claimId },
      select: { id: true, _count: { select: { jobs: true, invoices: true, inspections: true } } },
    });
    if (!claim) throw new ApiError(404, 'Claim not found');

    const linked = Object.entries(claim._count).filter(([, count]) => count > 0);
    if (linked.length) {
      throw new ApiError(409, `Claim cannot be deleted while linked records exist: ${linked.map(([name, count]) => `${name} (${count})`).join(', ')}`);
    }

    await prisma.$transaction(async (tx) => {
      await tx.claimDocument.deleteMany({ where: { claimId } });
      await tx.claim.delete({ where: { id: claimId } });
    });
    res.status(204).send();
  }));

  workflowsRouter.get('/jobs', asyncHandler(async (_req, res) => {
    const jobs = await prisma.job.findMany({ orderBy: { updatedAt: 'desc' }, include: { customer: true, vehicle: true, claim: true, inspections: true } });
    res.json(jobs);
  }));

  workflowsRouter.get('/estimates', asyncHandler(async (_req, res) => {
    const estimates = await prisma.estimate.findMany({
      orderBy: { updatedAt: 'desc' },
      include: {
        job: { include: { customer: true, vehicle: true } },
        lineItems: true,
      },
    });
    res.json(estimates);
  }));

  workflowsRouter.post('/estimates/:estimateId/pdf', asyncHandler(async (req, res) => {
    const estimate = await prisma.estimate.findUnique({ where: { id: routeParam(req, 'estimateId') }, include: { job: { include: { customer: true, vehicle: true, claim: true } }, lineItems: { orderBy: { createdAt: 'asc' } } } });
    if (!estimate) throw new ApiError(404, 'Estimate not found');
    const fileName = `estimate-${(estimate.estimateNumber || estimate.id).replace(/[^a-zA-Z0-9_-]+/g, '_')}.pdf`;
    res.type('application/pdf').set('Content-Disposition', `attachment; filename="${fileName}"`);
    const doc = new PDFDocument({ size: 'LETTER', margin: 36 });
    doc.pipe(res);
    const width = 540;
    const money = (value: number) => `$${value.toFixed(2)}`;
    const text = (value: string, x: number, y: number, options: { size?: number; bold?: boolean; color?: string; width?: number; align?: 'left' | 'right' | 'center' } = {}) => doc.font(options.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(options.size || 9).fillColor(options.color || '#171717').text(value, x, y, { width: options.width, align: options.align || 'left' });
    doc.rect(36, 36, width, 76).fill('#292929'); text('MASTERCRAFT AUTO REPAIR & COLLISION', 50, 51, { size: 17, bold: true, color: '#ffffff' }); text('38-21 23rd Street, Long Island City, NY 11101', 50, 76, { size: 8.5, color: '#eeeeee' }); text('Tel: 718-578-4563 | 718-603-0412 | shop@mastercraftautony.com', 50, 90, { size: 8.5, color: '#eeeeee' }); text('www.mastercraftautony.com | Recognized By All Insurance Companies', 50, 104, { size: 8, color: '#f1c232' });
    doc.rect(36, 126, width, 34).fill('#c90000'); text('ESTIMATE OF RECORD', 36, 136, { size: 15, bold: true, color: '#ffffff', width, align: 'center' });
    doc.rect(36, 174, width, 25).lineWidth(.6).stroke('#bdbdbd'); text(`Estimate No: ${estimate.estimateNumber || 'DRAFT'}`, 45, 182, { size: 8.5, bold: true }); text(`Date Issued: ${estimate.createdAt.toLocaleDateString('en-US')}`, 350, 182, { size: 8.5, bold: true, width: 215, align: 'right' });
    doc.rect(36, 216, width, 78).lineWidth(.6).stroke('#bdbdbd'); doc.moveTo(306, 216).lineTo(306, 294).stroke('#bdbdbd'); const customer = estimate.job.customer; const vehicle = estimate.job.vehicle; text('CUSTOMER', 45, 226, { size: 10, bold: true }); text(`${customer.firstName} ${customer.lastName}`, 45, 243, { size: 10 }); text(`Address: ${customer.address || 'N/A'}`, 45, 260, { size: 8.5 }); text(`Phone: ${customer.phone || 'N/A'}    Email: ${customer.email || 'N/A'}`, 45, 275, { size: 8.5 }); text('VEHICLE', 315, 226, { size: 10, bold: true }); text(vehicle ? [vehicle.year, vehicle.make, vehicle.model, vehicle.trim].filter(Boolean).join(' ') : 'Not specified', 315, 243, { size: 9 }); text(`VIN: ${vehicle?.vin || 'N/A'}`, 315, 260, { size: 8.5 }); text(`License: ${vehicle?.licensePlate || 'N/A'}${vehicle?.licenseState ? ` (${vehicle.licenseState})` : ''}`, 315, 275, { size: 8.5 }); text(`Job: ${estimate.job.jobNumber}   Claim: ${estimate.job.claim?.claimNumber || 'N/A'}`, 315, 287, { size: 7.5 });
    text('REPAIR OPERATIONS', 36, 316, { size: 10, bold: true, color: '#ffffff', width }); doc.rect(36, 312, width, 20).fill('#292929'); text('REPAIR OPERATIONS', 45, 318, { size: 10, bold: true, color: '#ffffff' }); let y = 332; const columns = [36, 345, 400, 476, 576]; doc.rect(36, y, width, 22).fill('#c90000'); ['Description', 'Qty', 'Price $', 'Amount'].forEach((label, index) => text(label, columns[index] + 5, y + 7, { size: 8, bold: true, color: '#ffffff', width: columns[index + 1] - columns[index] - 10, align: index ? 'right' : 'left' })); y += 22;
    for (const [index, item] of estimate.lineItems.entries()) { if (y > 700) { doc.addPage(); y = 45; } if (index % 2 === 0) doc.rect(36, y, width, 24).fill('#eeeeee'); text([item.section, item.operation, item.description].filter(Boolean).join(' · '), 42, y + 7, { size: 8, width: 298 }); text(String(item.quantity), 350, y + 7, { size: 8, width: 45, align: 'right' }); text(money(item.unitPrice), 405, y + 7, { size: 8, width: 66, align: 'right' }); text(money(item.quantity * item.unitPrice), 481, y + 7, { size: 8, width: 86, align: 'right' }); doc.rect(36, y, width, 24).lineWidth(.3).stroke('#cccccc'); y += 24; }
    y += 12; const totals = (label: string, value: number, bold = false) => { text(label, 350, y, { size: bold ? 10 : 9, bold, width: 135, align: 'right' }); text(money(value), 490, y, { size: bold ? 10 : 9, bold, width: 86, align: 'right' }); y += bold ? 24 : 18; }; totals('SUBTOTAL', estimate.totalAmount, true); totals('SALES TAX', 0); totals('TOTAL COST OF REPAIRS', estimate.totalAmount, true); y += 14; text('This is an estimate only. Final charges may vary based on additional damage found during teardown, parts availability, or supplemental findings. This estimate is valid for 30 days from the date above.', 36, y, { size: 8, color: '#555555', width }); y += 42; text('Customer Signature: ______________________________    Date: ______________', 36, y, { size: 8.5 }); y += 24; doc.moveTo(36, y).lineTo(576, y).stroke('#222222'); y += 10; text('MASTERCRAFT AUTO REPAIR & COLLISION  •  38-21 23rd Street, Long Island City, NY 11101  •  718-578-4563  •  www.mastercraftautony.com', 36, y, { size: 7, color: '#666666', width, align: 'center' }); doc.end();
  }));

  workflowsRouter.post('/estimates', asyncHandler(async (req, res) => {
    const jobId = requiredText(req.body.jobId, 'jobId');
    const job = await prisma.job.findUnique({ where: { id: jobId }, select: { id: true } });
    if (!job) throw new ApiError(404, 'Job not found');
    const lineItems = Array.isArray(req.body.lineItems) ? req.body.lineItems : [];
    if (!lineItems.length) throw new ApiError(400, 'At least one line item is required');
    const taxRate = req.body.taxRate === undefined ? 8.875 : Number(req.body.taxRate);
    if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 100) throw new ApiError(400, 'taxRate must be between 0 and 100');
    const bodyRate = Number(req.body.bodyRate ?? 65);
    const paintRate = Number(req.body.paintRate ?? 65);
    const supplyRate = Number(req.body.supplyRate ?? 38);
    if (![bodyRate, paintRate, supplyRate].every((rate) => Number.isFinite(rate) && rate >= 0)) throw new ApiError(400, 'labor rates must be non-negative numbers');
    const estimate = await prisma.$transaction(async (tx) => {
      const created = await tx.estimate.create({ data: { jobId, estimateNumber: optionalText(req.body.estimateNumber, 'estimateNumber'), taxRate, damageSummary: optionalText(req.body.damageSummary, 'damageSummary'), notes: optionalText(req.body.notes, 'notes') } });
      await tx.estimateLineItem.createMany({ data: lineItems.map((item: Record<string, unknown>) => ({ estimateId: created.id, section: optionalText(item.section, 'section'), operation: optionalText(item.operation, 'operation'), description: requiredText(item.description, 'description'), partNumber: optionalText(item.partNumber, 'partNumber'), quantity: Number(item.quantity ?? 1), unitPrice: Number(item.unitPrice ?? 0), laborHours: Number(item.laborHours ?? 0), paintHours: Number(item.paintHours ?? 0) })) });
      const savedLines = await tx.estimateLineItem.findMany({ where: { estimateId: created.id } });
      const subtotal = savedLines.reduce((sum, line) => sum + line.quantity * line.unitPrice + line.laborHours * bodyRate + line.paintHours * (paintRate + supplyRate), 0);
      return tx.estimate.update({ where: { id: created.id }, data: { totalAmount: subtotal * (1 + taxRate / 100) }, include: { job: { include: { customer: true, vehicle: true } }, lineItems: true } });
    });
    res.status(201).json(estimate);
  }));

  workflowsRouter.delete('/estimates/:estimateId', asyncHandler(async (req, res) => {
    const estimateId = routeParam(req, 'estimateId');
    const estimate = await prisma.estimate.findUnique({ where: { id: estimateId }, select: { id: true } });
    if (!estimate) throw new ApiError(404, 'Estimate not found');

    await prisma.$transaction(async (tx) => {
      await tx.estimateLineItem.deleteMany({ where: { estimateId } });
      await tx.estimate.delete({ where: { id: estimateId } });
    });
    res.status(204).send();
  }));

  workflowsRouter.get('/documents', asyncHandler(async (_req, res) => {
    const [claimDocuments, jobDocuments] = await Promise.all([
      prisma.claimDocument.findMany({ orderBy: { createdAt: 'desc' }, include: { claim: { include: { customer: true, vehicle: true } } } }),
      prisma.jobDocument.findMany({ orderBy: { createdAt: 'desc' }, include: { job: { include: { customer: true, vehicle: true } } } }),
    ]);
    res.json({ claimDocuments, jobDocuments });
  }));

  workflowsRouter.get('/reports', asyncHandler(async (_req, res) => {
    const [dashboard, jobsByStatus, estimateTotals, documentCounts] = await Promise.all([
      getDashboardData(prisma),
      prisma.job.groupBy({ by: ['status'], _count: { _all: true }, orderBy: { status: 'asc' } }),
      prisma.estimate.aggregate({ _count: { _all: true }, _sum: { totalAmount: true } }),
      Promise.all([prisma.claimDocument.count(), prisma.jobDocument.count()]),
    ]);
    res.json({
      ...dashboard,
      jobsByStatus: jobsByStatus.map((entry) => ({ status: entry.status, count: entry._count._all })),
      estimateTotals: { count: estimateTotals._count._all, total: estimateTotals._sum.totalAmount || 0 },
      documentCount: documentCounts[0] + documentCounts[1],
    });
  }));

  workflowsRouter.post('/jobs', asyncHandler(async (req, res) => {
    const customerId = requiredText(req.body.customerId, 'customerId');
    const jobNumber = requiredText(req.body.jobNumber, 'jobNumber');
    const vehicleId = optionalText(req.body.vehicleId, 'vehicleId');
    const claimId = optionalText(req.body.claimId, 'claimId');
    await ensureCustomer(prisma, customerId);
    if (vehicleId) await ensureVehicleBelongsToCustomer(prisma, vehicleId, customerId);
    if (claimId) await ensureClaimBelongsToCustomer(prisma, claimId, customerId);
    if (claimId && vehicleId) {
      const claim = await prisma.claim.findUnique({ where: { id: claimId }, select: { vehicleId: true } });
      if (claim?.vehicleId && claim.vehicleId !== vehicleId) throw new ApiError(400, 'vehicleId must match the vehicle on claimId');
    }
    const job = await prisma.job.create({
      data: { customerId, jobNumber, vehicleId, claimId, status: optionalText(req.body.status, 'status') || 'new', notes: optionalText(req.body.notes, 'notes') },
      include: { customer: true, vehicle: true, claim: true },
    });
    res.status(201).json(job);
  }));

  return workflowsRouter;
}

async function getDashboardData(prisma: PrismaClient) {
  const [openJobs, inspections, customers, revenue, expenses, recentJobs, upcomingSchedule] = await Promise.all([
    prisma.job.count({ where: { status: { notIn: ['completed', 'cancelled'] } } }),
    prisma.inspection.count({ where: { status: 'scheduled' } }),
    prisma.customer.count(),
    prisma.job.aggregate({ _sum: { totalRevenue: true } }),
    prisma.jobExpense.aggregate({ _sum: { amount: true } }),
    prisma.job.findMany({ take: 8, orderBy: { updatedAt: 'desc' }, include: { customer: true, vehicle: true } }),
    getUpcomingInspections(prisma),
  ]);
  return { metrics: { openJobs, inspections, customers, revenue: revenue._sum.totalRevenue || 0, expenses: expenses._sum.amount || 0 }, recentJobs, upcomingSchedule };
}

async function getUpcomingInspections(prisma: PrismaClient) {
  return prisma.inspection.findMany({
    where: { status: 'scheduled', scheduledFor: { gte: new Date() } },
    orderBy: { scheduledFor: 'asc' },
    select: {
      id: true, scheduledFor: true, inspectorName: true, inspectorPhone: true, insuranceRep: true, status: true, notes: true,
      customer: { select: { id: true, firstName: true, lastName: true, phone: true } },
      claim: { select: { id: true, claimNumber: true, insuranceCompany: true, vehicle: true } },
      job: { select: { id: true, jobNumber: true, status: true, vehicle: true } },
    },
  });
}

async function ensureInspectionLinks(prisma: PrismaClient, customerId: string, claimId: string | null, jobId: string | null) {
  await ensureCustomer(prisma, customerId);
  const claim = claimId ? await prisma.claim.findUnique({ where: { id: claimId }, select: { customerId: true, vehicleId: true } }) : null;
  if (claimId && !claim) throw new ApiError(404, 'Claim not found');
  if (claim && claim.customerId !== customerId) throw new ApiError(400, 'Claim does not belong to customer');
  const job = jobId ? await prisma.job.findUnique({ where: { id: jobId }, select: { customerId: true, vehicleId: true, claimId: true } }) : null;
  if (jobId && !job) throw new ApiError(404, 'Job not found');
  if (job && job.customerId !== customerId) throw new ApiError(400, 'Job does not belong to customer');
  if (job && claimId && job.claimId && job.claimId !== claimId) throw new ApiError(400, 'claimId must match the claim on jobId');
  if (job && claim?.vehicleId && job.vehicleId && claim.vehicleId !== job.vehicleId) throw new ApiError(400, 'jobId must use the vehicle on claimId');
}

function requiredDate(value: unknown, field: string) {
  const date = optionalDate(value, field);
  if (!date) throw new ApiError(400, `${field} is required`);
  return date;
}

function optionalInspectionStatus(value: unknown) {
  const status = optionalText(value, 'status') || 'scheduled';
  if (!['scheduled', 'completed', 'cancelled', 'rescheduled'].includes(status)) throw new ApiError(400, 'Unsupported inspection status');
  return status;
}

async function ensureCustomer(prisma: PrismaClient, customerId: string) {
  const customer = await prisma.customer.findUnique({ where: { id: customerId }, select: { id: true } });
  if (!customer) throw new ApiError(404, 'Customer not found');
}

async function ensureVehicleBelongsToCustomer(prisma: PrismaClient, vehicleId: string, customerId: string) {
  const vehicle = await prisma.vehicle.findUnique({ where: { id: vehicleId }, select: { customerId: true } });
  if (!vehicle) throw new ApiError(404, 'Vehicle not found');
  if (vehicle.customerId !== customerId) throw new ApiError(400, 'Vehicle does not belong to customer');
}

async function ensureClaimBelongsToCustomer(prisma: PrismaClient, claimId: string, customerId: string) {
  const claim = await prisma.claim.findUnique({ where: { id: claimId }, select: { customerId: true } });
  if (!claim) throw new ApiError(404, 'Claim not found');
  if (claim.customerId !== customerId) throw new ApiError(400, 'Claim does not belong to customer');
}

const claimInclude = {
  customer: true,
  vehicle: true,
  documents: { orderBy: { createdAt: 'desc' } },
  jobs: {
    orderBy: { updatedAt: 'desc' },
    include: {
      vehicle: true,
      documents: { orderBy: { createdAt: 'desc' } },
      estimates: { orderBy: { updatedAt: 'desc' }, include: { lineItems: true } },
      expenses: { orderBy: { expenseDate: 'desc' } },
      statusHistory: { orderBy: { createdAt: 'desc' } },
      authorizations: { orderBy: { generatedAt: 'desc' } },
    },
  },
} as const;

function buildClaimData(body: Record<string, unknown>, customerId: string, vehicleId: string | null | undefined) {
  return {
    customerId, vehicleId,
    claimNumber: optionalText(body.claimNumber, 'claimNumber'),
    customerName: optionalText(body.customerName, 'customerName'), customerPhone: optionalText(body.customerPhone, 'customerPhone'),
    customerInsurance: optionalText(body.customerInsurance, 'customerInsurance'), customerPolicyNumber: optionalText(body.customerPolicyNumber, 'customerPolicyNumber'),
    customerClaimNumber: optionalText(body.customerClaimNumber, 'customerClaimNumber'), customerAddress: optionalText(body.customerAddress, 'customerAddress'),
    driverLicense: optionalText(body.driverLicense, 'driverLicense'), vehicleYear: optionalInteger(body.vehicleYear, 'vehicleYear'),
    vehicleMake: optionalText(body.vehicleMake, 'vehicleMake'), vehicleModel: optionalText(body.vehicleModel, 'vehicleModel'),
    vehicleVin: optionalText(body.vehicleVin, 'vehicleVin')?.toUpperCase(), vehicleTrim: optionalText(body.vehicleTrim, 'vehicleTrim'),
    vehicleBodyClass: optionalText(body.vehicleBodyClass, 'vehicleBodyClass'), vehicleColor: optionalText(body.vehicleColor, 'vehicleColor'),
    vehicleLicensePlate: optionalText(body.vehicleLicensePlate, 'vehicleLicensePlate')?.toUpperCase(), vehiclePlateState: optionalText(body.vehiclePlateState, 'vehiclePlateState')?.toUpperCase(),
    atFaultDriverName: optionalText(body.atFaultDriverName, 'atFaultDriverName'), atFaultDriverPhone: optionalText(body.atFaultDriverPhone, 'atFaultDriverPhone'),
    atFaultDriverLicense: optionalText(body.atFaultDriverLicense, 'atFaultDriverLicense'), atFaultDriverDlState: optionalText(body.atFaultDriverDlState, 'atFaultDriverDlState')?.toUpperCase(),
    atFaultPlate: optionalText(body.atFaultPlate, 'atFaultPlate')?.toUpperCase(), atFaultPlateState: optionalText(body.atFaultPlateState, 'atFaultPlateState')?.toUpperCase(),
    atFaultVehicleVin: optionalText(body.atFaultVehicleVin, 'atFaultVehicleVin')?.toUpperCase(), atFaultVehicleYear: optionalInteger(body.atFaultVehicleYear, 'atFaultVehicleYear'),
    atFaultVehicleMake: optionalText(body.atFaultVehicleMake, 'atFaultVehicleMake'), atFaultVehicleModel: optionalText(body.atFaultVehicleModel, 'atFaultVehicleModel'),
    atFaultVehicleTrim: optionalText(body.atFaultVehicleTrim, 'atFaultVehicleTrim'), atFaultVehicleBodyClass: optionalText(body.atFaultVehicleBodyClass, 'atFaultVehicleBodyClass'),
    atFaultVehicleColor: optionalText(body.atFaultVehicleColor, 'atFaultVehicleColor'),
    atFaultInsurance: optionalText(body.atFaultInsurance, 'atFaultInsurance'), atFaultPolicyNumber: optionalText(body.atFaultPolicyNumber, 'atFaultPolicyNumber'),
    atFaultClaimNumber: optionalText(body.atFaultClaimNumber, 'atFaultClaimNumber'), atFaultInsurancePhone: optionalText(body.atFaultInsurancePhone, 'atFaultInsurancePhone'),
    incidentDate: optionalDate(body.incidentDate, 'incidentDate'), policeReportNumber: optionalText(body.policeReportNumber, 'policeReportNumber'),
    policeDepartment: optionalText(body.policeDepartment, 'policeDepartment'), witnessName: optionalText(body.witnessName, 'witnessName'), witnessPhone: optionalText(body.witnessPhone, 'witnessPhone'),
    damagePhotos: optionalBoolean(body.damagePhotos, 'damagePhotos'), platePhotos: optionalBoolean(body.platePhotos, 'platePhotos'), atFaultDlPhotos: optionalBoolean(body.atFaultDlPhotos, 'atFaultDlPhotos'),
    insuranceCardPhotos: optionalBoolean(body.insuranceCardPhotos, 'insuranceCardPhotos'), policeReportFiled: optionalBoolean(body.policeReportFiled, 'policeReportFiled'), witnessStatement: optionalBoolean(body.witnessStatement, 'witnessStatement'),
    estimateAttached: optionalBoolean(body.estimateAttached, 'estimateAttached'), readyToSubmit: optionalBoolean(body.readyToSubmit, 'readyToSubmit'), photoFolderLink: optionalText(body.photoFolderLink, 'photoFolderLink'),
    insuranceCompany: optionalText(body.insuranceCompany, 'insuranceCompany'), adjusterName: optionalText(body.adjusterName, 'adjusterName'), adjusterPhone: optionalText(body.adjusterPhone, 'adjusterPhone'),
    adjusterEmail: optionalText(body.adjusterEmail, 'adjusterEmail'), claimStatus: optionalText(body.status ?? body.claimStatus, 'status') || undefined, dateSubmitted: optionalDate(body.dateSubmitted, 'dateSubmitted'), notes: optionalText(body.notes, 'notes'),
    adjusterVisitAt: optionalDate(body.adjusterVisitAt, 'adjusterVisitAt'),
  };
}

function routeParam(req: { params: Record<string, string | string[]> }, name: string) {
  const value = req.params[name];
  if (typeof value !== 'string' || !value) throw new ApiError(400, `${name} is required`);
  return value;
}

async function ensureJobBelongsToCustomer(prisma: PrismaClient, jobId: string, customerId: string, vehicleId: string | null | undefined) {
  const job = await prisma.job.findUnique({ where: { id: jobId }, select: { customerId: true, vehicleId: true } });
  if (!job) throw new ApiError(404, 'Job not found');
  if (job.customerId !== customerId) throw new ApiError(400, 'Job does not belong to customer');
  if (vehicleId && job.vehicleId && job.vehicleId !== vehicleId) throw new ApiError(400, 'vehicleId must match the vehicle on jobId');
}
/* import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { ApiError, asyncHandler } from '../errors.js';
import { optionalInteger, optionalText, requiredText } from '../validation.js';

export function createWorkflowsRouter(prisma: PrismaClient) {
  const workflowsRouter = Router();

  workflowsRouter.get('/dashboard', asyncHandler(async (_req, res) => {
    const [openJobs, inspections, customers, revenue, expenses, recentJobs] = await Promise.all([
      prisma.job.count({ where: { status: { notIn: ['completed', 'cancelled'] } } }),
      prisma.inspection.count({ where: { status: 'scheduled' } }),
      prisma.customer.count(),
      prisma.job.aggregate({ _sum: { totalRevenue: true } }),
      prisma.jobExpense.aggregate({ _sum: { amount: true } }),
      prisma.job.findMany({
        take: 8,
        orderBy: { updatedAt: 'desc' },
        include: { customer: true, vehicle: true },
      }),
    ]);

    res.json({
      metrics: {
        openJobs,
        inspections,
        customers,
        revenue: revenue._sum.totalRevenue || 0,
        expenses: expenses._sum.amount || 0,
      },
      recentJobs,
    });
  }));

  workflowsRouter.get('/vehicles', asyncHandler(async (req, res) => {
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const vehicles = await prisma.vehicle.findMany({
      where: search ? {
        OR: [
          { vin: { contains: search, mode: 'insensitive' } },
          { make: { contains: search, mode: 'insensitive' } },
          { model: { contains: search, mode: 'insensitive' } },
          { customer: { firstName: { contains: search, mode: 'insensitive' } } },
          { customer: { lastName: { contains: search, mode: 'insensitive' } } },
        ],
      } : undefined,
      include: { customer: true },
      orderBy: { updatedAt: 'desc' },
    });
    res.json(vehicles);
  }));

  workflowsRouter.post('/vehicles', asyncHandler(async (req, res) => {
    const customerId = requiredText(req.body.customerId, 'customerId');
    await ensureCustomer(prisma, customerId);
    const vehicle = await prisma.vehicle.create({
      data: {
        customerId,
        year: optionalInteger(req.body.year, 'year'),
        make: optionalText(req.body.make, 'make'),
        model: optionalText(req.body.model, 'model'),
        vin: optionalText(req.body.vin, 'vin')?.toUpperCase(),
        licensePlate: optionalText(req.body.licensePlate, 'licensePlate')?.toUpperCase(),
        color: optionalText(req.body.color, 'color'),
      },
      include: { customer: true },
    });
    res.status(201).json(vehicle);
  }));

  workflowsRouter.get('/claims', asyncHandler(async (_req, res) => {
    const claims = await prisma.claim.findMany({
      orderBy: { updatedAt: 'desc' },
      include: { customer: true, vehicle: true, jobs: { select: { jobNumber: true, status: true } } },
    });
    res.json(claims);
  }));

  workflowsRouter.post('/claims', asyncHandler(async (req, res) => {
    const customerId = requiredText(req.body.customerId, 'customerId');
    const vehicleId = optionalText(req.body.vehicleId, 'vehicleId');
    await ensureCustomer(prisma, customerId);
    if (vehicleId) await ensureVehicleBelongsToCustomer(prisma, vehicleId, customerId);

    const claim = await prisma.claim.create({
      data: {
        customerId,
        vehicleId,
        claimNumber: optionalText(req.body.claimNumber, 'claimNumber'),
        insuranceCompany: optionalText(req.body.insuranceCompany, 'insuranceCompany'),
        adjusterName: optionalText(req.body.adjusterName, 'adjusterName'),
        adjusterPhone: optionalText(req.body.adjusterPhone, 'adjusterPhone'),
        notes: optionalText(req.body.notes, 'notes'),
      },
      include: { customer: true, vehicle: true },
    });
    res.status(201).json(claim);
  }));

  workflowsRouter.get('/jobs', asyncHandler(async (_req, res) => {
    const jobs = await prisma.job.findMany({
      orderBy: { updatedAt: 'desc' },
      include: { customer: true, vehicle: true, claim: true, inspections: true },
    });
    res.json(jobs);
  }));

  workflowsRouter.post('/jobs', asyncHandler(async (req, res) => {
    const customerId = requiredText(req.body.customerId, 'customerId');
    const jobNumber = requiredText(req.body.jobNumber, 'jobNumber');
    const vehicleId = optionalText(req.body.vehicleId, 'vehicleId');
    const claimId = optionalText(req.body.claimId, 'claimId');
    await ensureCustomer(prisma, customerId);
    if (vehicleId) await ensureVehicleBelongsToCustomer(prisma, vehicleId, customerId);
    if (claimId) await ensureClaimBelongsToCustomer(prisma, claimId, customerId);

    if (claimId && vehicleId) {
      const claim = await prisma.claim.findUnique({ where: { id: claimId }, select: { vehicleId: true } });
      if (claim?.vehicleId && claim.vehicleId !== vehicleId) {
        throw new ApiError(400, 'vehicleId must match the vehicle on claimId');
      }
    }

    const job = await prisma.job.create({
      data: {
        customerId,
        jobNumber,
        vehicleId,
        claimId,
        status: optionalText(req.body.status, 'status') || 'new',
        notes: optionalText(req.body.notes, 'notes'),
      },
      include: { customer: true, vehicle: true, claim: true },
    });
    res.status(201).json(job);
  }));

  return workflowsRouter;
}
*/
/*
async function ensureCustomer(prisma: PrismaClient, customerId: string) {
  const customer = await prisma.customer.findUnique({ where: { id: customerId }, select: { id: true } });
  if (!customer) throw new ApiError(404, 'Customer not found');
}

async function ensureVehicleBelongsToCustomer(prisma: PrismaClient, vehicleId: string, customerId: string) {
  const vehicle = await prisma.vehicle.findUnique({ where: { id: vehicleId }, select: { customerId: true } });
  if (!vehicle) throw new ApiError(404, 'Vehicle not found');
  if (vehicle.customerId !== customerId) throw new ApiError(400, 'Vehicle does not belong to customer');
}

async function ensureClaimBelongsToCustomer(prisma: PrismaClient, claimId: string, customerId: string) {
  const claim = await prisma.claim.findUnique({ where: { id: claimId }, select: { customerId: true } });
  if (!claim) throw new ApiError(404, 'Claim not found');
  if (claim.customerId !== customerId) throw new ApiError(400, 'Claim does not belong to customer');
}
  workflowsRouter.get('/dashboard', async (_req, res) => {
    try {
      const [openJobs, inspections, customers, revenue, expenses, recentJobs] = await Promise.all([
        prisma.job.count({ where: { status: { notIn: ['completed', 'cancelled'] } } }),
        prisma.inspection.count({ where: { status: 'scheduled' } }),
        prisma.customer.count(),
        prisma.job.aggregate({ _sum: { totalRevenue: true } }),
        prisma.jobExpense.aggregate({ _sum: { amount: true } }),
        prisma.job.findMany({
          take: 8,
          orderBy: { updatedAt: 'desc' },
          include: { customer: true, vehicle: true },
        }),
      ]);

      res.json({
        metrics: {
          openJobs,
          inspections,
          customers,
          revenue: revenue._sum.totalRevenue || 0,
          expenses: expenses._sum.amount || 0,
        },
        recentJobs,
      });
    } catch (error) {
      console.error('Failed to load dashboard', error);
      res.status(500).json({ error: 'Unable to load dashboard' });
    }
  });

  workflowsRouter.get('/vehicles', async (req, res) => {
    try {
      const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
      const vehicles = await prisma.vehicle.findMany({
        where: search ? {
          OR: [
            { vin: { contains: search, mode: 'insensitive' } },
            { make: { contains: search, mode: 'insensitive' } },
            { model: { contains: search, mode: 'insensitive' } },
            { customer: { firstName: { contains: search, mode: 'insensitive' } } },
            { customer: { lastName: { contains: search, mode: 'insensitive' } } },
          ],
        } : undefined,
        include: { customer: true },
        orderBy: { updatedAt: 'desc' },
      });
      res.json(vehicles);
    } catch (error) {
      console.error('Failed to list vehicles', error);
      res.status(500).json({ error: 'Unable to load vehicles' });
    }
  });

  workflowsRouter.post('/vehicles', async (req, res) => {
    const customerId = requiredText(req.body.customerId);
    if (!customerId) {
      res.status(400).json({ error: 'customerId is required' });
      return;
    }
    try {
      const vehicle = await prisma.vehicle.create({
        data: {
          customerId,
          year: typeof req.body.year === 'number' ? req.body.year : undefined,
          make: optionalText(req.body.make),
          model: optionalText(req.body.model),
          vin: optionalText(req.body.vin)?.toUpperCase(),
          licensePlate: optionalText(req.body.licensePlate)?.toUpperCase(),
          color: optionalText(req.body.color),
        },
        include: { customer: true },
      });
      res.status(201).json(vehicle);
    } catch (error) {
      console.error('Failed to create vehicle', error);
      res.status(500).json({ error: 'Unable to create vehicle' });
    }
  });

  workflowsRouter.get('/claims', async (_req, res) => {
    try {
      const claims = await prisma.claim.findMany({
        orderBy: { updatedAt: 'desc' },
        include: { customer: true, vehicle: true, jobs: { select: { jobNumber: true, status: true } } },
      });
      res.json(claims);
    } catch (error) {
      console.error('Failed to list claims', error);
      res.status(500).json({ error: 'Unable to load claims' });
    }
  });

  workflowsRouter.post('/claims', async (req, res) => {
    const customerId = requiredText(req.body.customerId);
    if (!customerId) {
      res.status(400).json({ error: 'customerId is required' });
      return;
    }
    try {
      const claim = await prisma.claim.create({
        data: {
          customerId,
          vehicleId: optionalText(req.body.vehicleId),
          claimNumber: optionalText(req.body.claimNumber),
          insuranceCompany: optionalText(req.body.insuranceCompany),
          adjusterName: optionalText(req.body.adjusterName),
          adjusterPhone: optionalText(req.body.adjusterPhone),
          notes: optionalText(req.body.notes),
        },
        include: { customer: true, vehicle: true },
      });
      res.status(201).json(claim);
    } catch (error) {
      console.error('Failed to create claim', error);
      res.status(500).json({ error: 'Unable to create claim' });
    }
  });

  workflowsRouter.get('/jobs', async (_req, res) => {
    try {
      const jobs = await prisma.job.findMany({
        orderBy: { updatedAt: 'desc' },
        include: { customer: true, vehicle: true, claim: true, inspections: true },
      });
      res.json(jobs);
    } catch (error) {
      console.error('Failed to list jobs', error);
      res.status(500).json({ error: 'Unable to load jobs' });
    }
  });

  workflowsRouter.post('/jobs', async (req, res) => {
    const customerId = requiredText(req.body.customerId);
    const jobNumber = requiredText(req.body.jobNumber);
    if (!customerId || !jobNumber) {
      res.status(400).json({ error: 'customerId and jobNumber are required' });
      return;
    }
    try {
      const job = await prisma.job.create({
        data: {
          customerId,
          jobNumber,
          vehicleId: optionalText(req.body.vehicleId),
          claimId: optionalText(req.body.claimId),
          status: optionalText(req.body.status) || 'new',
          notes: optionalText(req.body.notes),
        },
        include: { customer: true, vehicle: true, claim: true },
      });
      res.status(201).json(job);
    } catch (error) {
      console.error('Failed to create job', error);
      res.status(500).json({ error: 'Unable to create job' });
    }
  });

  return workflowsRouter;
}
*/