import { Router } from 'express';
import type { Prisma, PrismaClient } from '@prisma/client';
import { requireAuth } from '../auth.js';
import { asyncHandler } from '../errors.js';

const RESULT_LIMIT = 6;
const MAX_TERMS = 6;

type SearchResult = { id: string; title: string; subtitle: string };

// Every word typed must match somewhere on the record; each word can match any of the listed fields.
function termsFrom(query: string) {
  return query.trim().split(/\s+/).filter(Boolean).slice(0, MAX_TERMS);
}

function matchEvery<W>(terms: string[], clause: (term: string) => W[]): W {
  return { AND: terms.map((term) => ({ OR: clause(term) })) } as unknown as W;
}

function contains(term: string) {
  return { contains: term, mode: 'insensitive' as const };
}

function ownerName(owner: { firstName: string; lastName: string } | null | undefined) {
  return owner ? `${owner.firstName} ${owner.lastName}` : '';
}

export function createSearchRouter(prisma: PrismaClient) {
  const router = Router();

  router.get('/', requireAuth, asyncHandler(async (req, res) => {
    const query = typeof req.query.q === 'string' ? req.query.q : '';
    const terms = termsFrom(query);
    if (!terms.length) {
      res.json({ customers: [], vehicles: [], claims: [], jobs: [], invoices: [] });
      return;
    }

    const [customers, vehicles, claims, jobs, invoices] = await Promise.all([
      prisma.customer.findMany({
        take: RESULT_LIMIT,
        orderBy: { lastName: 'asc' },
        where: matchEvery<Prisma.CustomerWhereInput>(terms, (t) => [
          { firstName: contains(t) }, { lastName: contains(t) }, { phone: contains(t) },
          { email: contains(t) }, { address: contains(t) }, { city: contains(t) }, { zipCode: contains(t) },
        ]),
      }),
      prisma.vehicle.findMany({
        take: RESULT_LIMIT,
        orderBy: { updatedAt: 'desc' },
        include: { customer: true },
        where: matchEvery<Prisma.VehicleWhereInput>(terms, (t) => [
          { make: contains(t) }, { model: contains(t) }, { trim: contains(t) }, { color: contains(t) },
          { vin: contains(t) }, { licensePlate: contains(t) },
          { customer: { OR: [{ firstName: contains(t) }, { lastName: contains(t) }, { phone: contains(t) }] } },
        ]),
      }),
      prisma.claim.findMany({
        take: RESULT_LIMIT,
        orderBy: { updatedAt: 'desc' },
        include: { customer: true },
        where: matchEvery<Prisma.ClaimWhereInput>(terms, (t) => [
          { claimNumber: contains(t) }, { customerClaimNumber: contains(t) }, { customerName: contains(t) },
          { customerPhone: contains(t) }, { insuranceCompany: contains(t) }, { claimStatus: contains(t) },
          { vehicleMake: contains(t) }, { vehicleModel: contains(t) }, { vehicleVin: contains(t) }, { vehicleLicensePlate: contains(t) },
          { jobs: { some: { jobNumber: contains(t) } } },
        ]),
      }),
      prisma.job.findMany({
        take: RESULT_LIMIT,
        orderBy: { updatedAt: 'desc' },
        include: { customer: true, vehicle: true },
        where: matchEvery<Prisma.JobWhereInput>(terms, (t) => [
          { jobNumber: contains(t) }, { status: contains(t) },
          { customer: { OR: [{ firstName: contains(t) }, { lastName: contains(t) }, { phone: contains(t) }] } },
          { vehicle: { OR: [{ make: contains(t) }, { model: contains(t) }, { vin: contains(t) }, { licensePlate: contains(t) }] } },
        ]),
      }),
      prisma.invoice.findMany({
        take: RESULT_LIMIT,
        orderBy: { issueDate: 'desc' },
        include: { customer: true },
        where: matchEvery<Prisma.InvoiceWhereInput>(terms, (t) => [
          { invoiceNumber: contains(t) }, { status: contains(t) }, { customerName: contains(t) },
          { walkInCustomerName: contains(t) }, { walkInCustomerPhone: contains(t) },
          { customer: { OR: [{ firstName: contains(t) }, { lastName: contains(t) }, { phone: contains(t) }] } },
        ]),
      }),
    ]);

    const result = {
      customers: customers.map((customer): SearchResult => ({
        id: customer.id,
        title: ownerName(customer),
        subtitle: [customer.phone, customer.email, customer.address].filter(Boolean).join(' · '),
      })),
      vehicles: vehicles.map((vehicle): SearchResult => ({
        id: vehicle.id,
        title: [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ') || 'Vehicle',
        subtitle: [ownerName(vehicle.customer), vehicle.licensePlate, vehicle.vin ? `VIN …${vehicle.vin.slice(-6)}` : ''].filter(Boolean).join(' · '),
      })),
      claims: claims.map((claim): SearchResult => ({
        id: claim.id,
        title: claim.claimNumber || claim.customerClaimNumber || 'Unnumbered claim',
        subtitle: [ownerName(claim.customer), claim.insuranceCompany, claim.claimStatus].filter(Boolean).join(' · '),
      })),
      jobs: jobs.map((job): SearchResult => ({
        id: job.id,
        title: job.jobNumber,
        subtitle: [ownerName(job.customer), job.vehicle ? [job.vehicle.year, job.vehicle.make, job.vehicle.model].filter(Boolean).join(' ') : '', job.status].filter(Boolean).join(' · '),
      })),
      invoices: invoices.map((invoice): SearchResult => ({
        id: invoice.id,
        title: invoice.invoiceNumber,
        subtitle: [invoice.customer ? ownerName(invoice.customer) : invoice.customerName || invoice.walkInCustomerName, invoice.status].filter(Boolean).join(' · '),
      })),
    };
    res.json(result);
  }));

  return router;
}
