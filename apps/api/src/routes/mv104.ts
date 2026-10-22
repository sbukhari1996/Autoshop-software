import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import { ApiError, asyncHandler } from '../errors.js';
import { mv104Codes } from '../mv104/mv104Codes.js';
import { fillMv104, type Mv104Input, type Mv104Party, type Mv104Person } from '../mv104/mv104Form.js';
import { buildMv104Defaults, missingRequiredFields, type Mv104ClaimSource } from '../mv104/mv104Prefill.js';

// Reserved id for a standalone MV-104 (not tied to a claim). Claim ids are never this value.
export const STANDALONE_MV104 = 'standalone';
const blankClaim: Mv104ClaimSource = {
  claimNumber: null, incidentDate: null, driverLicense: null, customerName: null, customerInsurance: null,
  customerPolicyNumber: null, vehicleYear: null, vehicleMake: null, vehicleModel: null, vehicleVin: null,
  vehicleLicensePlate: null, vehiclePlateState: null, policeReportNumber: null, policeDepartment: null,
  policeReportFiled: false, atFaultDriverName: null, atFaultDriverLicense: null, atFaultDriverDlState: null,
  atFaultPlate: null, atFaultPlateState: null, atFaultVehicleYear: null, atFaultVehicleMake: null,
  atFaultVehicleModel: null, atFaultVehicleVin: null, atFaultInsurance: null, atFaultPolicyNumber: null, customer: null,
};

const blankPerson: Mv104Person = { name: '', unit: '', position: '', safety: '', age: '', sex: '', injury: '', seriousInjuries: '', deathDate: '' };
const compassPoints = ['N', 'E', 'S', 'W'] as const;
const otherPartyKinds = ['OTHER DRIVER', 'PEDESTRIAN', 'BICYCLIST', 'E-BIKE/E-SCOOTER'] as const;

/** Keeps the template's shape and types; anything the client sends with the wrong type falls back to the default. */
function coerce<T>(template: T, value: unknown): T {
  if (typeof template === 'string') return (typeof value === 'string' ? value.trim() : template) as T;
  if (typeof template === 'boolean') return (typeof value === 'boolean' ? value : template) as T;
  if (template && typeof template === 'object' && !Array.isArray(template)) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(template)) {
      out[key] = coerce((template as Record<string, unknown>)[key], (value as Record<string, unknown> | undefined)?.[key]);
    }
    return out as T;
  }
  return template;
}

export function mergeInput(defaults: Mv104Input, body: unknown): Mv104Input {
  const source = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  const merged = coerce(defaults, source) as Mv104Input;
  merged.location.compass = Array.isArray(source.location && (source.location as Record<string, unknown>).compass)
    ? ((source.location as Record<string, unknown>).compass as unknown[]).filter((v): v is 'N' | 'E' | 'S' | 'W' => compassPoints.includes(v as 'N'))
    : defaults.location.compass;
  merged.otherPartyTypes = Array.isArray(source.otherPartyTypes)
    ? (source.otherPartyTypes as unknown[]).filter((v): v is (typeof otherPartyKinds)[number] => otherPartyKinds.includes(v as (typeof otherPartyKinds)[number]))
    : defaults.otherPartyTypes;
  merged.persons = Array.isArray(source.persons)
    ? (source.persons as unknown[]).slice(0, 5).map((person) => coerce(blankPerson, person))
    : defaults.persons;
  merged.partA = coerce<Mv104Party>(defaults.partA, source.partA);
  merged.partB = coerce<Mv104Party>(defaults.partB, source.partB);
  return merged;
}

function routeParam(req: { params: Record<string, string | string[]> }, name: string) {
  const value = req.params[name];
  if (typeof value !== 'string' || !value) throw new ApiError(400, `${name} is required`);
  return value;
}

// The claim (or a blank source for standalone forms) that prefills an MV-104.
export async function loadMv104Source(prisma: PrismaClient, claimId: string | null): Promise<Mv104ClaimSource & { id: string }> {
  if (!claimId || claimId === STANDALONE_MV104) return { ...blankClaim, id: STANDALONE_MV104 };
  const claim = await prisma.claim.findUnique({ where: { id: claimId }, include: { customer: true } });
  if (!claim) throw new ApiError(404, 'Claim not found');
  return claim;
}

export function createMv104Router(prisma: PrismaClient) {
  const router = Router();

  const loadClaim = async (claimId: string): Promise<Mv104ClaimSource & { id: string }> => {
    if (claimId === STANDALONE_MV104) return { ...blankClaim, id: STANDALONE_MV104 };
    const claim = await prisma.claim.findUnique({ where: { id: claimId }, include: { customer: true } });
    if (!claim) throw new ApiError(404, 'Claim not found');
    return claim;
  };

  // Prefilled values from the claim, plus the code legends the form editor needs.
  router.get('/claims/:claimId/mv104/defaults', asyncHandler(async (req, res) => {
    const claim = await loadClaim(routeParam(req, 'claimId'));
    res.json({ input: buildMv104Defaults(claim), codes: mv104Codes });
  }));

  // Generates the official MV-104 PDF from the submitted form values.
  router.post('/claims/:claimId/mv104.pdf', asyncHandler(async (req, res) => {
    const claim = await loadClaim(routeParam(req, 'claimId'));
    const input = mergeInput(buildMv104Defaults(claim), req.body);
    const missing = missingRequiredFields(input);
    if (missing.length > 0) throw new ApiError(422, `Complete these before generating the MV-104: ${missing.join('; ')}`);
    const pdf = await fillMv104(input);
    const reference = (claim.claimNumber || claim.id).replace(/[^A-Za-z0-9_-]/g, '');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="MV-104-${reference}.pdf"`);
    res.send(Buffer.from(pdf));
  }));

  return router;
}
