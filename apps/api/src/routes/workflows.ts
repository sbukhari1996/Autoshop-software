import { Router } from 'express';
import PDFDocument from 'pdfkit';
import { Prisma, PrismaClient } from '@prisma/client';
import { ApiError, asyncHandler } from '../errors.js';
import { optionalBoolean, optionalDate, optionalInteger, optionalText, requiredText } from '../validation.js';

const inspectionSelect = {
  id: true, customerId: true, claimId: true, jobId: true, scheduledFor: true, inspectorName: true, inspectorPhone: true, insuranceRep: true, status: true, notes: true,
  customer: { select: { id: true, firstName: true, lastName: true, phone: true } },
  claim: { select: { id: true, claimNumber: true, insuranceCompany: true, vehicle: true } },
  job: { select: { id: true, jobNumber: true, status: true, vehicle: true } },
} as const;

const isMiscellaneousEstimateLine = (section: string | null | undefined) =>
  ['shop & misc', 'miscellaneous'].includes((section || '').trim().toLowerCase());
const roundCurrency = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const displayEstimateDate = (value: string | null | undefined) =>
  value ? new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString('en-US') : '—';
const estimateFeatureGroups = [
  ['TRANSMISSION', ['Automatic transmission', 'Manual transmission', 'Overdrive', 'Intermittent wipers']],
  ['POWER', ['Power steering', 'Power brakes', 'Power windows', 'Power locks', 'Power mirrors', 'Power driver seat', 'Power passenger seat', 'Heated mirrors']],
  ['CONVENIENCE & DECOR', ['Air conditioning', 'Cruise control', 'Keyless entry', 'Alarm', 'Tilt wheel', 'Telescopic wheel', 'Dual mirrors', 'Tinted glass', 'Remote start', 'Backup camera', 'Parking sensors', 'Navigation system']],
  ['SAFETY', ['Driver air bag', 'Passenger air bag', 'Side impact air bags', 'Anti-lock brakes', 'Traction control', 'Stability control', 'Blind spot detection', 'Lane departure warning', 'Adaptive cruise control']],
  ['WHEELS', ['Steel wheels', 'Aluminum/alloy wheels', 'Four-wheel disc brakes']],
  ['PAINT & ROOF', ['Clear coat paint', 'Pearl/tri-coat paint', 'Sunroof', 'Panoramic roof']],
  ['AUDIO & SEATING', ['AM/FM radio', 'Premium radio', 'Bluetooth/audio connection', 'Leather seats', 'Heated seats', 'Ventilated seats', 'Rear heated seats']],
] as const;
const mastercraftFacilityName = 'Mastercraft Auto Repair & Collision LLC';
const mastercraftFacilityDetails = [
  mastercraftFacilityName,
  '(646) 203-1122 Business',
  '38-21 23rd St',
  'LONG ISLAND CITY, NY 11101-0000',
  '(718) 578-4563',
];

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

  workflowsRouter.delete('/inspections/:inspectionId', asyncHandler(async (req, res) => {
    const inspectionId = routeParam(req, 'inspectionId');
    const existing = await prisma.inspection.findUnique({ where: { id: inspectionId }, select: { id: true } });
    if (!existing) throw new ApiError(404, 'Inspection not found');
    await prisma.inspection.delete({ where: { id: inspectionId } });
    res.status(204).send();
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
        lineItems: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] },
      },
    });
    res.json(estimates);
  }));

  workflowsRouter.get('/estimates/:estimateId', asyncHandler(async (req, res) => {
    const estimate = await prisma.estimate.findUnique({
      where: { id: routeParam(req, 'estimateId') },
      include: {
        job: { include: { customer: true, vehicle: true, claim: true } },
        lineItems: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] },
      },
    });
    if (!estimate) throw new ApiError(404, 'Estimate not found');
    res.json(estimate);
  }));

  workflowsRouter.post('/estimates/:estimateId/pdf', asyncHandler(async (req, res) => {
    const estimate = await prisma.estimate.findUnique({ where: { id: routeParam(req, 'estimateId') }, include: { job: { include: { customer: true, vehicle: true, claim: true } }, lineItems: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] } } });
    if (!estimate) throw new ApiError(404, 'Estimate not found');
    const fileName = `estimate-${(estimate.estimateNumber || estimate.id).replace(/[^a-zA-Z0-9_-]+/g, '_')}.pdf`;
    res.type('application/pdf').set('Content-Disposition', `attachment; filename="${fileName}"`);
    const doc = new PDFDocument({ size: 'LETTER', margin: 36, bufferPages: true });
    doc.pipe(res);
    const width = 540;
    const money = (value: number) => `$${value.toFixed(2)}`;
    const text = (value: string, x: number, y: number, options: { size?: number; bold?: boolean; color?: string; width?: number; align?: 'left' | 'right' | 'center' } = {}) => doc.font(options.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(options.size || 9).fillColor(options.color || '#171717').text(value, x, y, { width: options.width, align: options.align || 'left' });
    const summaryText = (value: string, x: number, y: number, maxWidth: number) => {
      doc.font('Helvetica').fontSize(7.5);
      let fitted = value;
      while (fitted.length && doc.widthOfString(`${fitted.trimEnd()}...`) > maxWidth) {
        fitted = fitted.slice(0, -1);
      }
      if (fitted !== value) fitted = `${fitted.trimEnd()}...`;
      text(fitted, x, y, { size: 7.5, width: maxWidth });
    };
    const customer = estimate.job?.customer;
    const vehicle = estimate.job?.vehicle;
    const claim = estimate.job?.claim;
    const customerName = customer
      ? `${customer.firstName} ${customer.lastName}`
      : estimate.walkInCustomerName || estimate.ownerName || 'Walk-in customer';
    const claimNumber = estimate.claimNumber || claim?.claimNumber || '';
    const vehicleName = [
      vehicle?.year ?? estimate.walkInVehicleYear,
      vehicle?.make ?? estimate.walkInVehicleMake,
      vehicle?.model ?? estimate.walkInVehicleModel,
      vehicle?.trim ?? estimate.walkInVehicleTrim,
      estimate.engine,
    ].filter(Boolean).join(' ') || 'Vehicle not specified';
    const jobNumber = estimate.job?.jobNumber || 'WALK-IN';
    const dateOfLoss = estimate.dateOfLoss
      ? displayEstimateDate(estimate.dateOfLoss)
      : claim?.incidentDate?.toLocaleDateString('en-US') || '—';
    const bodyLabor = estimate.lineItems.reduce((sum, item) => sum + item.laborHours * estimate.bodyRate, 0);
    const mechanicLabor = estimate.lineItems.reduce((sum, item) => sum + item.mechanicHours * estimate.mechanicRate, 0);
    const paintLabor = estimate.lineItems.reduce((sum, item) => sum + item.paintHours * estimate.paintRate, 0);
    const paintSupplies = estimate.lineItems.reduce((sum, item) => sum + item.paintHours * estimate.supplyRate, 0);
    const partsTotal = estimate.lineItems.reduce((sum, item) => sum + (isMiscellaneousEstimateLine(item.section) ? 0 : item.quantity * item.unitPrice), 0);
    const miscellaneous = estimate.lineItems.reduce((sum, item) => sum + (isMiscellaneousEstimateLine(item.section) ? item.quantity * item.unitPrice : 0), 0);
    const taxableSubtotal = partsTotal + bodyLabor + mechanicLabor + paintLabor + paintSupplies;
    const subtotal = taxableSubtotal + miscellaneous;
    const tax = roundCurrency(taxableSubtotal * estimate.taxRate / 100);
    const total = roundCurrency(subtotal + tax);
    const columns = [
      { title: '#', width: 24, align: 'right' as const },
      { title: 'Oper', width: 34, align: 'left' as const },
      { title: 'Description', width: 280, align: 'left' as const },
      { title: 'Qty', width: 34, align: 'right' as const },
      { title: 'Parts $', width: 58, align: 'right' as const },
      { title: 'Labor', width: 56, align: 'right' as const },
      { title: 'Paint', width: 54, align: 'right' as const },
    ];
    const drawTableHeading = (y: number) => {
      doc.moveTo(36, y).lineTo(576, y).lineWidth(.7).stroke('#555555');
      let x = 36;
      for (const column of columns) {
        text(column.title, x + 3, y + 3, { size: 9, bold: true, color: '#171717', width: column.width - 6, align: column.align });
        x += column.width;
      }
      doc.moveTo(36, y + 18).lineTo(576, y + 18).lineWidth(.8).stroke('#555555');
      return y + 18;
    };
    const drawPageHeader = (continued: boolean) => {
      text('Mastercraft Auto Repair & Collision', 36, 36, { size: 14, bold: true, width: 340 });
      text('ESTIMATE OF RECORD', 376, 38, { size: 12, bold: true, width: 200, align: 'right' });
      text('38-21 23rd Street, Long Island City, NY 11101  |  (718) 578-4563', 36, 54, { size: 8, width: 340 });
      if (estimate.estimateNumber) {
        text(estimate.estimateNumber, 376, 55, { size: 8, width: 200, align: 'right' });
      }
      doc.moveTo(36, 70).lineTo(576, 70).lineWidth(.6).stroke('#555555');
      summaryText(`Owner: ${estimate.ownerName || customerName}`, 36, 76, 154);
      summaryText(`Job: ${jobNumber}`, 194, 76, 78);
      summaryText(`Vehicle: ${vehicleName}`, 276, 76, 205);
      summaryText(`Date of loss: ${dateOfLoss}`, 485, 76, 91);
      if (continued) {
        return drawTableHeading(94);
      }
      const cell = (label: string, value: string, x: number, y: number, w: number, h = 20) => {
        text(`${label}: ${value || '—'}`, x + 4, y + 3, { size: 6.8, width: w - 8 });
        doc.rect(x, y, w, h).lineWidth(.35).stroke('#999999');
      };
      const detailsY = 100;
      const writtenBy = [estimate.writtenBy, estimate.nyAdjusterLicense].filter(Boolean).join(', ') || '—';
      const adjuster = [estimate.insuranceAdjuster || claim?.adjusterName || '', estimate.insuranceAdjusterPhone || claim?.adjusterPhone || ''].filter(Boolean).join(' · ') || '—';
      text(`Written By: ${writtenBy}`, 36, detailsY + 17, { size: 7, width, align: 'center' });
      text(`Adjuster: ${adjuster}`, 36, detailsY + 28, { size: 7, width, align: 'center' });
      const leftInfo: Array<[string, string]> = [
        ['Insured', estimate.insuredName || claim?.customerName || customerName],
        ['Type of Loss', estimate.lossType || '—'],
        ['Point of Impact', estimate.pointOfImpact || '—'],
      ];
      const rightInfo: Array<[string, string]> = [
        ['Policy #', estimate.policyNumber || claim?.customerPolicyNumber || '—'],
        ['Date of Loss', dateOfLoss],
        ['Days to Repair', estimate.daysToRepair || '—'],
      ];
      const claimInfo: Array<[string, string]> = [
        ['Claim #', claimNumber || '—'],
        ['Workfile ID', estimate.workfileId || '—'],
      ];
      const infoTop = detailsY + 43;
      const infoRowHeight = 14;
      const columnWidth = width / 3;
      for (let index = 0; index < Math.max(leftInfo.length, rightInfo.length, claimInfo.length); index += 1) {
        const rowY = infoTop + index * infoRowHeight;
        if (leftInfo[index]) text(`${leftInfo[index][0]}: ${leftInfo[index][1]}`, 36, rowY, { size: 8, width: columnWidth - 8 });
        if (rightInfo[index]) text(`${rightInfo[index][0]}: ${rightInfo[index][1]}`, 36 + columnWidth, rowY, { size: 8, width: columnWidth - 8 });
        if (claimInfo[index]) text(`${claimInfo[index][0]}: ${claimInfo[index][1]}`, 36 + columnWidth * 2, rowY, { size: 8, width: columnWidth - 8 });
      };
      const facilityTop = infoTop + Math.max(leftInfo.length, rightInfo.length, claimInfo.length) * infoRowHeight + 7;
      const facilityColumns = [
        {
          heading: 'Owner:',
          lines: [
            estimate.ownerName || customerName,
            customer?.address || estimate.walkInCustomerAddress || '',
            customer?.phone || estimate.walkInCustomerPhone || '',
          ].filter(Boolean),
        },
        {
          heading: 'Inspection Location:',
          lines: estimate.inspectionLocation === mastercraftFacilityName
            ? mastercraftFacilityDetails.slice(0, 4)
            : (estimate.inspectionLocation || '').split('\n').filter(Boolean),
        },
        {
          heading: 'Repair Facility:',
          lines: estimate.repairFacility === mastercraftFacilityName ? mastercraftFacilityDetails : [],
        },
      ];
      facilityColumns.forEach((column, index) => {
        if (!column.lines.length) return;
        const x = 36 + index * columnWidth;
        text(column.heading, x, facilityTop, { size: 7, bold: true, width: columnWidth - 8 });
        column.lines.forEach((line, lineIndex) => text(line, x, facilityTop + 12 + lineIndex * 11, { size: 6.8, width: columnWidth - 8 }));
      });
      const facilityLineCount = Math.max(...facilityColumns.map((column) => column.lines.length));
      const vehicleTop = facilityTop + 20 + facilityLineCount * 11;
      doc.moveTo(36, vehicleTop).lineTo(576, vehicleTop).lineWidth(.6).stroke('#666666');
      text('VEHICLE', 36, vehicleTop + 8, { size: 10, bold: true, width, align: 'center' });
      text([vehicleName, estimate.engine].filter(Boolean).join(' · '), 36, vehicleTop + 26, { size: 9, width });
      const vehicleGridTop = vehicleTop + 44;
      const vehicleFacts: Array<[string, string]> = [
        ['VIN', vehicle?.vin || estimate.walkInVehicleVin || '—'],
        ['License', vehicle?.licensePlate || estimate.walkInVehicleLicense || '—'],
        ['State', vehicle?.licenseState || estimate.walkInVehicleState || '—'],
        ['Production Date', estimate.productionDate || '—'],
        ['Odometer', estimate.odometer || '—'],
        ['Condition', estimate.vehicleCondition || '—'],
        ['Interior Color', estimate.interiorColor || '—'],
        ['Exterior Color', estimate.exteriorColor || vehicle?.color || '—'],
      ];
      const factWidth = width / 3;
      vehicleFacts.forEach(([label, value], index) => {
        const row = Math.floor(index / 3);
        const column = index % 3;
        const x = 36 + column * factWidth;
        const y = vehicleGridTop + row * 13;
        text(`${label}:`, x, y, { size: 8, width: 65 });
        text(value, x + 67, y, { size: 8, width: factWidth - 72 });
      });
      const featureTop = vehicleGridTop + 48;
      const featureColumnWidth = width / 3;
      const checkedFeatures = estimateFeatureGroups.flatMap(([category, groupFeatures]) =>
        groupFeatures.filter((feature) => estimate.vehicleFeatures.includes(feature)),
      );
      if (checkedFeatures.length) {
        text('VEHICLE OPTIONS', 36, featureTop, { size: 8, bold: true, width });
      }
      checkedFeatures.forEach((feature, index) => {
        const column = index % 3;
        const x = 36 + column * featureColumnWidth;
        const row = Math.floor(index / 3);
        const itemY = featureTop + 10 + row * 11;
        doc.moveTo(x + 4, itemY + 5).lineTo(x + 7, itemY + 8).lineTo(x + 12, itemY + 1).lineWidth(1).stroke('#171717');
        text(feature, x + 15, itemY, { size: 8, width: featureColumnWidth - 18 });
      });
      const damageTop = featureTop + (checkedFeatures.length ? 10 + Math.ceil(checkedFeatures.length / 3) * 11 : 12);
      if (estimate.damageSummary) {
        cell('Damage Summary', estimate.damageSummary, 36, damageTop, width, 24);
      }
      text('REPAIR OPERATIONS', 36, damageTop + 18, { size: 10, bold: true });
      return drawTableHeading(damageTop + 30);
    };
    let y = drawPageHeader(false);
    let previousSection = '';
    for (const [index, item] of estimate.lineItems.entries()) {
      const operation = item.description || '';
      const description = item.partNumber ? `${operation} · Part ${item.partNumber}` : operation;
      doc.font('Helvetica').fontSize(9);
      const operationHeight = doc.heightOfString(description, { width: columns[2].width - 10 });
      const noteHeight = item.note ? doc.heightOfString(`Note: ${item.note}`, { width: width - 34 }) + 5 : 0;
      const operationRowHeight = Math.max(11, operationHeight);
      const rowHeight = operationRowHeight + noteHeight;
      const section = item.section || 'REPAIR OPERATIONS';
      const sectionChanged = !item.parentLineId && section !== previousSection;
      const sectionHeight = sectionChanged ? 15 : 0;
      if (y + rowHeight + sectionHeight > 720) {
        doc.addPage();
        y = drawPageHeader(true);
        previousSection = '';
      }
      if (!item.parentLineId && section !== previousSection) {
        doc.rect(36, y, width, 14).fill('#d0d0d0');
        text(section.toUpperCase(), 41, y + 2, { size: 10, bold: true });
        y += 16;
        previousSection = section;
      }
      const labor = [
        item.laborHours ? `${item.laborHours.toFixed(1)} B` : '',
        item.mechanicHours ? `${item.mechanicHours.toFixed(1)} M` : '',
      ].filter(Boolean).join(' / ') || '—';
      const values = [
        { value: String(index + 1), align: 'right' as const },
        { value: item.operation || (item.parentLineId ? '' : '—'), align: 'left' as const },
        { value: description, align: 'left' as const },
        { value: item.parentLineId ? '' : String(item.quantity), align: 'right' as const },
        { value: item.parentLineId && !item.unitPrice ? '' : money(item.quantity * item.unitPrice), align: 'right' as const },
        { value: labor, align: 'right' as const },
        { value: item.paintHours ? item.paintHours.toFixed(1) : '—', align: 'right' as const },
      ];
      let x = 36;
      for (const [columnIndex, column] of columns.entries()) {
        const descriptionIndent = columnIndex === 2 && item.parentLineId ? 14 : 4;
        text(values[columnIndex].value, x + descriptionIndent, y, { size: 9, width: column.width - descriptionIndent - 4, align: values[columnIndex].align });
        x += column.width;
      }
      if (item.note) {
        text(`Note: ${item.note}`, 52, y + operationRowHeight, { size: 8, color: '#555555', width: width - 24 });
        doc.moveTo(36, y + rowHeight).lineTo(576, y + rowHeight).lineWidth(.3).stroke('#d5dadd');
      }
      y += rowHeight;
    }
    y += 10;
    const totalsAndClosingHeight = 335;
    if (y + totalsAndClosingHeight > 720) {
      doc.addPage();
      y = drawPageHeader(true);
    }
    const totals = [
      ['Parts', 'Parts', '—', partsTotal, false],
      ['Body Labor', `${estimate.lineItems.reduce((sum, item) => sum + item.laborHours, 0).toFixed(1)} hrs`, `${money(estimate.bodyRate)} / hr`, bodyLabor, false],
      ['Paint Labor', `${estimate.lineItems.reduce((sum, item) => sum + item.paintHours, 0).toFixed(1)} hrs`, `${money(estimate.paintRate)} / hr`, paintLabor, false],
      ['Mechanical Labor', `${estimate.lineItems.reduce((sum, item) => sum + item.mechanicHours, 0).toFixed(1)} hrs`, `${money(estimate.mechanicRate)} / hr`, mechanicLabor, false],
      ['Paint Supplies', `${estimate.lineItems.reduce((sum, item) => sum + item.paintHours, 0).toFixed(1)} hrs`, `${money(estimate.supplyRate)} / hr`, paintSupplies, false],
      ['Miscellaneous', 'Charges', '—', miscellaneous, false],
      ['Subtotal', '', '', subtotal, true],
      ['Sales Tax', money(taxableSubtotal), `${estimate.taxRate}%`, tax, false],
      ['TOTAL COST OF REPAIRS', '', '', total, true],
    ] as const;
    const totalsX = 267;
    const totalWidths = [120, 64, 67, 58];
    const totalHeadings = ['Category', 'Basis', 'Rate', 'Cost $'];
    const totalsWidth = totalWidths.reduce((sum, item) => sum + item, 0);
    text('ESTIMATE TOTALS', totalsX, y, { size: 10, bold: true, width: totalsWidth, align: 'right' });
    y += 22;
    doc.rect(totalsX, y, totalsWidth, 20).fill('#e5e5e5');
    doc.rect(totalsX, y, totalsWidth, 20).lineWidth(.5).stroke('#777777');
    let totalX = totalsX;
    totalHeadings.forEach((heading, index) => {
      text(heading, totalX + 3, y + 5, { size: 8, bold: true, width: totalWidths[index] - 6, align: index ? 'right' : 'left' });
      totalX += totalWidths[index];
    });
    y += 20;
    for (const [label, basis, rate, amount, emphasized] of totals) {
      if (label === 'TOTAL COST OF REPAIRS') {
        doc.moveTo(totalsX, y - 4).lineTo(totalsX + totalsWidth, y - 4).lineWidth(1).stroke('#444444');
      }
      totalX = totalsX;
      [label, basis, rate, money(amount)].forEach((value, index) => {
        text(value, totalX + 3, y + 4, { size: emphasized ? 9 : 8.5, bold: emphasized, width: totalWidths[index] - 6, align: index ? 'right' : 'left' });
        doc.rect(totalX, y, totalWidths[index], 20).lineWidth(.3).stroke('#aaaaaa');
        totalX += totalWidths[index];
      });
      y += 20;
    }
    y += 16;
    text('Labor key: B = Body labor hours   M = Mechanical labor hours   P = Paint hours', 36, y, { size: 8 });
    y += 14;
    text('This is an estimate only. Final charges may vary based on additional damage found during teardown, parts availability, or supplemental findings. This estimate is valid for 30 days from the date above.', 36, y, { size: 7, color: '#555555', width });
    y += 34;
    if (y > 735) {
      doc.addPage();
      y = drawPageHeader(true);
    }
    text('Customer Signature: ______________________________    Date: ______________', 36, y, { size: 8 });
    const pageRange = doc.bufferedPageRange();
    for (let pageIndex = pageRange.start; pageIndex < pageRange.start + pageRange.count; pageIndex += 1) {
      doc.switchToPage(pageIndex);
      doc.moveTo(36, 738).lineTo(576, 738).lineWidth(.4).stroke('#777777');
      text('Estimate valid 30 days from the date above.', 36, 744, { size: 8, width: 270 });
      text(`Page ${pageIndex + 1} of ${pageRange.count}`, 306, 744, { size: 8, width: 270, align: 'right' });
    }
    doc.end();
  }));

  workflowsRouter.post('/estimates', asyncHandler(async (req, res) => {
    const jobId = optionalText(req.body.jobId, 'jobId');
    const walkIn = req.body.walkIn;
    if (walkIn !== undefined && walkIn !== null &&
      (typeof walkIn !== 'object' || Array.isArray(walkIn))) {
      throw new ApiError(400, 'walkIn must be an object');
    }
    if (jobId && walkIn) throw new ApiError(400, 'Choose either a repair job or walk-in details');
    if (!jobId && !walkIn) throw new ApiError(400, 'Select a repair job or provide walk-in details');
    if (jobId) {
      const job = await prisma.job.findUnique({ where: { id: jobId }, select: { id: true } });
      if (!job) throw new ApiError(404, 'Job not found');
    }
    const walkInYearValue = walkIn?.vehicleYear;
    const walkInVehicleYear = walkInYearValue === undefined || walkInYearValue === null || walkInYearValue === ''
      ? null
      : Number(walkInYearValue);
    if (walkInVehicleYear !== null && !Number.isInteger(walkInVehicleYear)) {
      throw new ApiError(400, 'walkIn.vehicleYear must be an integer');
    }
    const walkInCustomerName = walkIn ? requiredText(walkIn.customerName, 'walkIn.customerName') : undefined;
    const lineItems = Array.isArray(req.body.lineItems) ? req.body.lineItems : [];
    if (!lineItems.length) throw new ApiError(400, 'At least one line item is required');
    const taxRate = req.body.taxRate === undefined ? 8.875 : Number(req.body.taxRate);
    if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 100) throw new ApiError(400, 'taxRate must be between 0 and 100');
    const bodyRate = Number(req.body.bodyRate ?? 63);
    const paintRate = Number(req.body.paintRate ?? 63);
    const supplyRate = Number(req.body.supplyRate ?? 41);
    const mechanicRate = Number(req.body.mechanicRate ?? 80);
    if (![bodyRate, paintRate, supplyRate, mechanicRate].every((rate) => Number.isFinite(rate) && rate >= 0)) throw new ApiError(400, 'labor rates must be non-negative numbers');
    const vehicleFeatures = req.body.vehicleFeatures ?? [];
    if (!Array.isArray(vehicleFeatures) || vehicleFeatures.some((feature: unknown) => typeof feature !== 'string')) {
      throw new ApiError(400, 'vehicleFeatures must be an array of strings');
    }
    const estimate = await prisma.$transaction(async (tx) => {
      const estimateNumber = await nextEstimateIdentifier(tx, 'estimateNumber');
      const workfileId = await nextEstimateIdentifier(tx, 'workfileId');
      const created = await tx.estimate.create({
        data: {
          jobId,
          estimateNumber,
          workfileId,
          walkInCustomerName: walkIn ? walkInCustomerName : null,
          walkInCustomerAddress: walkIn ? optionalText(walkIn.address, 'walkIn.address') : null,
          walkInCustomerPhone: walkIn ? optionalText(walkIn.phone, 'walkIn.phone') : null,
          walkInVehicleYear: walkIn ? walkInVehicleYear : null,
          walkInVehicleMake: walkIn ? optionalText(walkIn.vehicleMake, 'walkIn.vehicleMake') : null,
          walkInVehicleModel: walkIn ? optionalText(walkIn.vehicleModel, 'walkIn.vehicleModel') : null,
          walkInVehicleTrim: walkIn ? optionalText(walkIn.vehicleTrim, 'walkIn.vehicleTrim') : null,
          walkInVehicleBodyClass: walkIn ? optionalText(walkIn.vehicleBodyClass, 'walkIn.vehicleBodyClass') : null,
          walkInVehicleVin: walkIn ? optionalText(walkIn.vin, 'walkIn.vin') : null,
          walkInVehicleLicense: walkIn ? optionalText(walkIn.license, 'walkIn.license') : null,
          walkInVehicleState: walkIn ? optionalText(walkIn.vehicleState, 'walkIn.vehicleState') : null,
          taxRate, bodyRate, paintRate, supplyRate, mechanicRate,
          damageSummary: optionalText(req.body.damageSummary, 'damageSummary'),
          carrier: optionalText(req.body.carrier, 'carrier'),
          appraisalCompanyName: optionalText(req.body.appraisalCompanyName, 'appraisalCompanyName'),
          ownerName: optionalText(req.body.ownerName, 'ownerName'),
          insuredName: optionalText(req.body.insuredName, 'insuredName'),
          policyNumber: optionalText(req.body.policyNumber, 'policyNumber'),
          claimNumber: optionalText(req.body.claimNumber, 'claimNumber'),
          lossType: optionalText(req.body.lossType, 'lossType'),
          dateOfLoss: optionalText(req.body.dateOfLoss, 'dateOfLoss'),
          pointOfImpact: optionalText(req.body.pointOfImpact, 'pointOfImpact'),
          daysToRepair: optionalText(req.body.daysToRepair, 'daysToRepair'),
          writtenBy: optionalText(req.body.writtenBy, 'writtenBy'),
          nyAdjusterLicense: optionalText(req.body.nyAdjusterLicense, 'nyAdjusterLicense'),
          writtenByPhone: optionalText(req.body.writtenByPhone, 'writtenByPhone'),
          insuranceAdjuster: optionalText(req.body.insuranceAdjuster, 'insuranceAdjuster'),
          insuranceAdjusterPhone: optionalText(req.body.insuranceAdjusterPhone, 'insuranceAdjusterPhone'),
          inspectionLocation: optionalText(req.body.inspectionLocation, 'inspectionLocation'),
          repairFacility: optionalText(req.body.repairFacility, 'repairFacility'),
          odometer: optionalText(req.body.odometer, 'odometer'),
          exteriorColor: optionalText(req.body.exteriorColor, 'exteriorColor'),
          interiorColor: optionalText(req.body.interiorColor, 'interiorColor'),
          engine: optionalText(req.body.engine, 'engine'),
          productionDate: optionalText(req.body.productionDate, 'productionDate'),
          vehicleCondition: optionalText(req.body.vehicleCondition, 'vehicleCondition'),
          vehicleFeatures,
          notes: optionalText(req.body.notes, 'notes'),
        },
      });
      const createdLineIds: string[] = [];
      for (const [index, item] of lineItems.entries()) {
        const parentIndex = item.parentIndex;
        if (parentIndex !== undefined && parentIndex !== null &&
          (typeof parentIndex !== 'number' || !Number.isInteger(parentIndex) || parentIndex < 0 || parentIndex >= index ||
            lineItems[parentIndex]?.parentIndex !== undefined && lineItems[parentIndex]?.parentIndex !== null)) {
          throw new ApiError(400, 'Each sub-line item must reference an earlier main line item');
        }
        const line = await tx.estimateLineItem.create({
          data: {
            estimateId: created.id,
            parentLineId: typeof parentIndex === 'number' ? createdLineIds[parentIndex] : null,
            sortOrder: index,
            section: optionalText(item.section, 'section'),
            operation: optionalText(item.operation, 'operation'),
            description: requiredText(item.description, 'description'),
            partNumber: optionalText(item.partNumber, 'partNumber'),
            quantity: Number(item.quantity ?? 1),
            unitPrice: Number(item.unitPrice ?? 0),
            laborHours: Number(item.laborHours ?? 0),
            mechanicHours: Number(item.mechanicHours ?? 0),
            paintHours: Number(item.paintHours ?? 0),
            note: optionalText(item.note, 'note'),
          },
        });
        createdLineIds.push(line.id);
      }
      const savedLines = await tx.estimateLineItem.findMany({ where: { estimateId: created.id }, orderBy: { sortOrder: 'asc' } });
      const partsTotal = savedLines.reduce((sum, line) => sum + (isMiscellaneousEstimateLine(line.section) ? 0 : line.quantity * line.unitPrice), 0);
      const miscellaneous = savedLines.reduce((sum, line) => sum + (isMiscellaneousEstimateLine(line.section) ? line.quantity * line.unitPrice : 0), 0);
      const taxableSubtotal = savedLines.reduce((sum, line) => sum + line.laborHours * bodyRate + line.mechanicHours * mechanicRate + line.paintHours * (paintRate + supplyRate), partsTotal);
      const totalAmount = roundCurrency(taxableSubtotal + roundCurrency(taxableSubtotal * taxRate / 100) + miscellaneous);
      return tx.estimate.update({ where: { id: created.id }, data: { totalAmount }, include: { job: { include: { customer: true, vehicle: true } }, lineItems: { orderBy: { sortOrder: 'asc' } } } });
    });
    res.status(201).json(estimate);
  }));

  workflowsRouter.put('/estimates/:estimateId', asyncHandler(async (req, res) => {
    const estimateId = routeParam(req, 'estimateId');
    const existingEstimate = await prisma.estimate.findUnique({
      where: { id: estimateId },
      select: { id: true, estimateNumber: true, workfileId: true },
    });
    if (!existingEstimate) throw new ApiError(404, 'Estimate not found');

    const jobId = optionalText(req.body.jobId, 'jobId');
    const walkIn = req.body.walkIn;
    if (walkIn !== undefined && walkIn !== null &&
      (typeof walkIn !== 'object' || Array.isArray(walkIn))) {
      throw new ApiError(400, 'walkIn must be an object');
    }
    if (jobId && walkIn) throw new ApiError(400, 'Choose either a repair job or walk-in details');
    if (!jobId && !walkIn) throw new ApiError(400, 'Select a repair job or provide walk-in details');
    if (jobId) {
      const job = await prisma.job.findUnique({ where: { id: jobId }, select: { id: true } });
      if (!job) throw new ApiError(404, 'Job not found');
    }
    const walkInYearValue = walkIn?.vehicleYear;
    const walkInVehicleYear = walkInYearValue === undefined || walkInYearValue === null || walkInYearValue === ''
      ? null
      : Number(walkInYearValue);
    if (walkInVehicleYear !== null && !Number.isInteger(walkInVehicleYear)) {
      throw new ApiError(400, 'walkIn.vehicleYear must be an integer');
    }
    const walkInCustomerName = walkIn ? requiredText(walkIn.customerName, 'walkIn.customerName') : undefined;
    const lineItems = Array.isArray(req.body.lineItems) ? req.body.lineItems : [];
    if (!lineItems.length) throw new ApiError(400, 'At least one line item is required');
    const taxRate = req.body.taxRate === undefined ? 8.875 : Number(req.body.taxRate);
    if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 100) throw new ApiError(400, 'taxRate must be between 0 and 100');
    const bodyRate = Number(req.body.bodyRate ?? 63);
    const paintRate = Number(req.body.paintRate ?? 63);
    const supplyRate = Number(req.body.supplyRate ?? 41);
    const mechanicRate = Number(req.body.mechanicRate ?? 80);
    if (![bodyRate, paintRate, supplyRate, mechanicRate].every((rate) => Number.isFinite(rate) && rate >= 0)) throw new ApiError(400, 'labor rates must be non-negative numbers');
    const vehicleFeatures = req.body.vehicleFeatures ?? [];
    if (!Array.isArray(vehicleFeatures) || vehicleFeatures.some((feature: unknown) => typeof feature !== 'string')) {
      throw new ApiError(400, 'vehicleFeatures must be an array of strings');
    }

    const estimate = await prisma.$transaction(async (tx) => {
      await tx.estimate.update({
        where: { id: estimateId },
        data: {
          jobId,
          estimateNumber: existingEstimate.estimateNumber || await nextEstimateIdentifier(tx, 'estimateNumber'),
          workfileId: existingEstimate.workfileId || await nextEstimateIdentifier(tx, 'workfileId'),
          walkInCustomerName: walkIn ? walkInCustomerName : null,
          walkInCustomerAddress: walkIn ? optionalText(walkIn.address, 'walkIn.address') : null,
          walkInCustomerPhone: walkIn ? optionalText(walkIn.phone, 'walkIn.phone') : null,
          walkInVehicleYear: walkIn ? walkInVehicleYear : null,
          walkInVehicleMake: walkIn ? optionalText(walkIn.vehicleMake, 'walkIn.vehicleMake') : null,
          walkInVehicleModel: walkIn ? optionalText(walkIn.vehicleModel, 'walkIn.vehicleModel') : null,
          walkInVehicleTrim: walkIn ? optionalText(walkIn.vehicleTrim, 'walkIn.vehicleTrim') : null,
          walkInVehicleBodyClass: walkIn ? optionalText(walkIn.vehicleBodyClass, 'walkIn.vehicleBodyClass') : null,
          walkInVehicleVin: walkIn ? optionalText(walkIn.vin, 'walkIn.vin') : null,
          walkInVehicleLicense: walkIn ? optionalText(walkIn.license, 'walkIn.license') : null,
          walkInVehicleState: walkIn ? optionalText(walkIn.vehicleState, 'walkIn.vehicleState') : null,
          taxRate, bodyRate, paintRate, supplyRate, mechanicRate,
          damageSummary: optionalText(req.body.damageSummary, 'damageSummary'),
          carrier: optionalText(req.body.carrier, 'carrier'),
          appraisalCompanyName: optionalText(req.body.appraisalCompanyName, 'appraisalCompanyName'),
          ownerName: optionalText(req.body.ownerName, 'ownerName'),
          insuredName: optionalText(req.body.insuredName, 'insuredName'),
          policyNumber: optionalText(req.body.policyNumber, 'policyNumber'),
          claimNumber: optionalText(req.body.claimNumber, 'claimNumber'),
          lossType: optionalText(req.body.lossType, 'lossType'),
          dateOfLoss: optionalText(req.body.dateOfLoss, 'dateOfLoss'),
          pointOfImpact: optionalText(req.body.pointOfImpact, 'pointOfImpact'),
          daysToRepair: optionalText(req.body.daysToRepair, 'daysToRepair'),
          writtenBy: optionalText(req.body.writtenBy, 'writtenBy'),
          nyAdjusterLicense: optionalText(req.body.nyAdjusterLicense, 'nyAdjusterLicense'),
          writtenByPhone: optionalText(req.body.writtenByPhone, 'writtenByPhone'),
          insuranceAdjuster: optionalText(req.body.insuranceAdjuster, 'insuranceAdjuster'),
          insuranceAdjusterPhone: optionalText(req.body.insuranceAdjusterPhone, 'insuranceAdjusterPhone'),
          inspectionLocation: optionalText(req.body.inspectionLocation, 'inspectionLocation'),
          repairFacility: optionalText(req.body.repairFacility, 'repairFacility'),
          odometer: optionalText(req.body.odometer, 'odometer'),
          exteriorColor: optionalText(req.body.exteriorColor, 'exteriorColor'),
          interiorColor: optionalText(req.body.interiorColor, 'interiorColor'),
          engine: optionalText(req.body.engine, 'engine'),
          productionDate: optionalText(req.body.productionDate, 'productionDate'),
          vehicleCondition: optionalText(req.body.vehicleCondition, 'vehicleCondition'),
          vehicleFeatures,
          notes: optionalText(req.body.notes, 'notes'),
        },
      });
      await tx.estimateLineItem.deleteMany({ where: { estimateId } });
      const lineIds: string[] = [];
      for (const [index, item] of lineItems.entries()) {
        const parentIndex = item.parentIndex;
        if (parentIndex !== undefined && parentIndex !== null &&
          (typeof parentIndex !== 'number' || !Number.isInteger(parentIndex) || parentIndex < 0 || parentIndex >= index ||
            lineItems[parentIndex]?.parentIndex !== undefined && lineItems[parentIndex]?.parentIndex !== null)) {
          throw new ApiError(400, 'Each sub-line item must reference an earlier main line item');
        }
        const line = await tx.estimateLineItem.create({
          data: {
            estimateId,
            parentLineId: typeof parentIndex === 'number' ? lineIds[parentIndex] : null,
            sortOrder: index,
            section: optionalText(item.section, 'section'),
            operation: optionalText(item.operation, 'operation'),
            description: requiredText(item.description, 'description'),
            partNumber: optionalText(item.partNumber, 'partNumber'),
            quantity: Number(item.quantity ?? 1),
            unitPrice: Number(item.unitPrice ?? 0),
            laborHours: Number(item.laborHours ?? 0),
            mechanicHours: Number(item.mechanicHours ?? 0),
            paintHours: Number(item.paintHours ?? 0),
            note: optionalText(item.note, 'note'),
          },
        });
        lineIds.push(line.id);
      }
      const savedLines = await tx.estimateLineItem.findMany({
        where: { estimateId },
        orderBy: { sortOrder: 'asc' },
      });
      const partsTotal = savedLines.reduce((sum, line) =>
        sum + (isMiscellaneousEstimateLine(line.section) ? 0 : line.quantity * line.unitPrice), 0);
      const miscellaneous = savedLines.reduce((sum, line) =>
        sum + (isMiscellaneousEstimateLine(line.section) ? line.quantity * line.unitPrice : 0), 0);
      const taxableSubtotal = savedLines.reduce((sum, line) =>
        sum + line.laborHours * bodyRate + line.mechanicHours * mechanicRate +
          line.paintHours * (paintRate + supplyRate), partsTotal);
      const totalAmount = roundCurrency(
        taxableSubtotal + roundCurrency(taxableSubtotal * taxRate / 100) + miscellaneous,
      );
      return tx.estimate.update({
        where: { id: estimateId },
        data: { totalAmount },
        include: {
          job: { include: { customer: true, vehicle: true, claim: true } },
          lineItems: { orderBy: { sortOrder: 'asc' } },
        },
      });
    });
    res.json(estimate);
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
    const [claimDocuments, jobDocuments, customerDocuments] = await Promise.all([
      prisma.claimDocument.findMany({ orderBy: { createdAt: 'desc' }, include: { claim: { include: { customer: true, vehicle: true } } } }),
      prisma.jobDocument.findMany({ orderBy: { createdAt: 'desc' }, include: { job: { include: { customer: true, vehicle: true } } } }),
      prisma.customerDocument.findMany({ orderBy: { createdAt: 'desc' }, include: { customer: true } }),
    ]);
    res.json({ claimDocuments, jobDocuments, customerDocuments });
  }));

  workflowsRouter.get('/reports', asyncHandler(async (_req, res) => {
    const [dashboard, jobsByStatus, estimateTotals, documentCounts] = await Promise.all([
      getDashboardData(prisma),
      prisma.job.groupBy({ by: ['status'], _count: { _all: true }, orderBy: { status: 'asc' } }),
      prisma.estimate.aggregate({ _count: { _all: true }, _sum: { totalAmount: true } }),
      Promise.all([prisma.claimDocument.count(), prisma.jobDocument.count(), prisma.customerDocument.count()]),
    ]);
    res.json({
      ...dashboard,
      jobsByStatus: jobsByStatus.map((entry) => ({ status: entry.status, count: entry._count._all })),
      estimateTotals: { count: estimateTotals._count._all, total: estimateTotals._sum.totalAmount || 0 },
      documentCount: documentCounts[0] + documentCounts[1] + documentCounts[2],
    });
  }));

  workflowsRouter.post('/jobs', asyncHandler(async (req, res) => {
    const customerId = requiredText(req.body.customerId, 'customerId');
    const requestedJobNumber = optionalText(req.body.jobNumber, 'jobNumber');
    const vehicleId = optionalText(req.body.vehicleId, 'vehicleId');
    const claimId = optionalText(req.body.claimId, 'claimId');
    await ensureCustomer(prisma, customerId);
    if (vehicleId) await ensureVehicleBelongsToCustomer(prisma, vehicleId, customerId);
    if (claimId) await ensureClaimBelongsToCustomer(prisma, claimId, customerId);
    if (claimId && vehicleId) {
      const claim = await prisma.claim.findUnique({ where: { id: claimId }, select: { vehicleId: true } });
      if (claim?.vehicleId && claim.vehicleId !== vehicleId) throw new ApiError(400, 'vehicleId must match the vehicle on claimId');
    }
    const job = await prisma.$transaction(async (tx) => {
      const jobNumber = requestedJobNumber || `JOB-${String((await tx.$queryRaw<Array<{ number: bigint }>>`SELECT nextval('job_number_seq') AS number`)[0].number).padStart(3, '0')}`;
      return tx.job.create({
        data: { customerId, jobNumber, vehicleId, claimId, status: optionalText(req.body.status, 'status') || 'new', notes: optionalText(req.body.notes, 'notes') },
        include: { customer: true, vehicle: true, claim: true },
      });
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

async function nextEstimateIdentifier(tx: Prisma.TransactionClient, field: 'estimateNumber' | 'workfileId') {
  const sequenceValue = field === 'estimateNumber'
    ? (await tx.$queryRaw<Array<{ number: bigint }>>`SELECT nextval('estimate_number_seq') AS number`)[0].number
    : (await tx.$queryRaw<Array<{ number: bigint }>>`SELECT nextval('workfile_id_seq') AS number`)[0].number;
  return `${field === 'estimateNumber' ? 'EST' : 'WF'}-${String(sequenceValue).padStart(6, '0')}`;
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