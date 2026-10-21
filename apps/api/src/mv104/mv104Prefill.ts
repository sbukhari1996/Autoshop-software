import type { Mv104Input, Mv104Party, Mv104Person } from './mv104Form.js';

// Only the claim fields the MV-104 needs. Fields the shop does not record (date of birth, sex,
// injuries, crash time, location, signature status) are left blank so a person confirms them.
export interface Mv104ClaimSource {
  claimNumber: string | null;
  incidentDate: Date | null;
  driverLicense: string | null;
  customerName: string | null;
  customerInsurance: string | null;
  customerPolicyNumber: string | null;
  vehicleYear: number | null;
  vehicleMake: string | null;
  vehicleModel: string | null;
  vehicleVin: string | null;
  vehicleLicensePlate: string | null;
  vehiclePlateState: string | null;
  policeReportNumber: string | null;
  policeDepartment: string | null;
  policeReportFiled: boolean;
  atFaultDriverName: string | null;
  atFaultDriverLicense: string | null;
  atFaultDlState: string | null;
  atFaultPlate: string | null;
  atFaultPlateState: string | null;
  atFaultVehicleYear: number | null;
  atFaultVehicleMake: string | null;
  atFaultVehicleModel: string | null;
  atFaultVehicleVin: string | null;
  atFaultInsurance: string | null;
  atFaultPolicyNumber: string | null;
  customer: { firstName: string; lastName: string; address: string | null; city: string | null; state: string | null; zipCode: string | null } | null;
}

const usStates = new Set(['NY', 'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VA', 'VT', 'WA', 'WV', 'WI', 'WY']);

const clean = (value: string | null | undefined) => (value ?? '').trim();
const upper = (value: string | null | undefined) => clean(value).toUpperCase();
const stateCode = (value: string | null | undefined) => {
  const code = upper(value);
  return usStates.has(code) ? code : '';
};
const yearMakeModel = (year: number | null, make: string | null, model: string | null) =>
  upper([year ?? '', make, model].filter(Boolean).join(' '));

function emptyParty(): Mv104Party {
  return {
    driverName: '', dlNumber: '', dlState: '', dobMonth: '', dobDay: '', dobYear: '', sex: '', address: '', city: '', state: '',
    zip: '', peopleInVehicle: '', registrantName: '', regDobMonth: '', regDobDay: '', regDobYear: '', regSex: '', regAddress: '',
    regCity: '', regState: '', regZip: '', plate: '', plateState: '', yearMakeModel: '', vehicleType: '', vin: '',
    insuranceCode: '', insuranceCompany: '', policyNumber: '',
  };
}

function monthDayYear(date: Date | null) {
  if (!date) return { month: '', day: '', year: '' };
  const iso = date.toISOString().slice(0, 10);
  const [year, month, day] = iso.split('-');
  return { month, day, year };
}

function todayMmDdYyyy(now = new Date()) {
  const iso = now.toISOString().slice(0, 10).split('-');
  return `${iso[1]}/${iso[2]}/${iso[0]}`;
}

export function buildMv104Defaults(claim: Mv104ClaimSource, now = new Date()): Mv104Input {
  const customerName = claim.customer
    ? `${upper(claim.customer.lastName)}, ${upper(claim.customer.firstName)}`
    : upper(claim.customerName);
  const address = upper(claim.customer?.address);
  const city = upper(claim.customer?.city);
  const state = stateCode(claim.customer?.state);
  const zip = clean(claim.customer?.zipCode);
  const date = monthDayYear(claim.incidentDate);
  const hasOtherParty = Boolean(clean(claim.atFaultDriverName) || clean(claim.atFaultPlate));

  const partA: Mv104Party = {
    ...emptyParty(),
    driverName: customerName,
    dlNumber: upper(claim.driverLicense),
    dlState: state,
    address,
    city,
    state,
    zip,
    registrantName: customerName,
    regAddress: address,
    regCity: city,
    regState: state,
    regZip: zip,
    plate: upper(claim.vehicleLicensePlate),
    plateState: stateCode(claim.vehiclePlateState),
    yearMakeModel: yearMakeModel(claim.vehicleYear, claim.vehicleMake, claim.vehicleModel),
    vin: upper(claim.vehicleVin),
    insuranceCompany: upper(claim.customerInsurance),
    policyNumber: upper(claim.customerPolicyNumber),
  };

  const partB: Mv104Party = {
    ...emptyParty(),
    driverName: upper(claim.atFaultDriverName),
    dlNumber: upper(claim.atFaultDriverLicense),
    dlState: stateCode(claim.atFaultDlState),
    state: '',
    registrantName: upper(claim.atFaultDriverName),
    plate: upper(claim.atFaultPlate),
    plateState: stateCode(claim.atFaultPlateState),
    yearMakeModel: yearMakeModel(claim.atFaultVehicleYear, claim.atFaultVehicleMake, claim.atFaultVehicleModel),
    vin: upper(claim.atFaultVehicleVin),
    insuranceCompany: upper(claim.atFaultInsurance),
    policyNumber: upper(claim.atFaultPolicyNumber),
  };

  const persons: Mv104Person[] = [
    { name: customerName, unit: '1.', position: '1.', safety: '', age: '', sex: '', injury: '', seriousInjuries: '', deathDate: '' },
  ];
  if (hasOtherParty) {
    persons.push({ name: upper(claim.atFaultDriverName), unit: '2.', position: '1.', safety: '', age: '', sex: '', injury: '', seriousInjuries: '', deathDate: '' });
  }

  const policeAgencyNumber = [clean(claim.policeDepartment), clean(claim.policeReportNumber)].filter(Boolean).join(' ').toUpperCase();

  return {
    crash: {
      month: date.month,
      day: date.day,
      year: date.year,
      time: '',
      ampm: '',
      vehicleCount: hasOtherParty ? '2' : '1',
      injured: '',
      fatalities: '',
      policeResponded: false,
      policeFiledReport: claim.policeReportFiled,
      policeAgencyNumber,
      vandalized: '',
      inNewYork: '',
      injuredOrOver1000: '',
      ebikeInjury: '',
      damageOver1000: false,
      diagramCode: '',
      description: '',
      trafficControl: '',
      roadwaySurface: '',
      directionUnit1: '',
      directionUnit2: '',
      preCrashUnit1: '',
      preCrashUnit2: '',
      typeOfCrash: '',
      typeOfCrashUnit1: '',
      typeOfCrashUnit2: '',
    },
    location: {
      county: '',
      cityType: '',
      cityName: '',
      road: '',
      houseNumber: '',
      landmark: '',
      intersectionType: '',
      crossStreet: '',
      feet: '',
      miles: '',
      compass: [],
      distanceRouteOf: '',
      atIntersection: false,
      parkingLot: false,
    },
    partA,
    partB,
    otherPartyTypes: hasOtherParty ? ['OTHER DRIVER'] : [],
    persons,
    signing: {
      printName: customerName,
      date: todayMmDdYyyy(now),
      onBehalfOf: false,
      onBehalfUnit: '',
      reason: '',
      firefighter: false,
    },
  };
}

/** Fields a person must complete before the MV-104 can be submitted to the DMV. */
export function missingRequiredFields(input: Mv104Input): string[] {
  const missing: string[] = [];
  if (!input.crash.month || !input.crash.day || !/^\d{4}$/.test(input.crash.year)) missing.push('Crash date');
  if (!input.crash.time || !input.crash.ampm) missing.push('Crash time (with AM/PM)');
  if (!input.location.county) missing.push('County');
  if (!input.location.road) missing.push('Road where the crash occurred');
  if (!input.crash.description) missing.push('Crash description');
  if (!input.partA.driverName) missing.push('Your driver name');
  if (!input.partA.dlNumber) missing.push('Your driver license number');
  if (!input.partA.plate) missing.push('Your plate number');
  if (!input.signing.printName) missing.push('Printed name of driver');
  return missing;
}
