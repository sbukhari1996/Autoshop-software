import type { Mv104Input, Mv104Party } from '../src/mv104/mv104Form.js';

const blankParty = (): Mv104Party => ({
  driverName: '', dlNumber: '', dlState: '', dobMonth: '', dobDay: '', dobYear: '', sex: '', address: '', city: '', state: '',
  zip: '', peopleInVehicle: '', registrantName: '', regDobMonth: '', regDobDay: '', regDobYear: '', regSex: '', regAddress: '',
  regCity: '', regState: '', regZip: '', plate: '', plateState: '', yearMakeModel: '', vehicleType: '', vin: '',
  insuranceCode: '', insuranceCompany: '', policyNumber: '',
});

export function sampleInput(): Mv104Input {
  const partA: Mv104Party = {
    ...blankParty(),
    driverName: 'DOE, JANE A', dlNumber: '123456789', dlState: 'NY', dobMonth: '04', dobDay: '09', dobYear: '1985', sex: 'F',
    address: '38-21 23RD STREET APT 4B', city: 'LONG ISLAND CITY', state: 'NY', zip: '11101', peopleInVehicle: '1',
    registrantName: 'DOE, JANE A', regDobMonth: '04', regDobDay: '09', regDobYear: '1985', regSex: 'F',
    regAddress: '38-21 23RD STREET APT 4B', regCity: 'LONG ISLAND CITY', regState: 'NY', regZip: '11101',
    plate: 'ABC1234', plateState: 'NY', yearMakeModel: '2019 HONDA CIVIC', vehicleType: 'PAS', vin: '2HGFC2F59KH500001',
    insuranceCode: 'GEICO', insuranceCompany: 'GEICO GENERAL INSURANCE CO', policyNumber: 'POL-99887766',
  };
  const partB: Mv104Party = {
    ...blankParty(),
    driverName: 'SMITH, JOHN R', dlNumber: 'S9876543210', dlState: 'NY', dobMonth: '11', dobDay: '30', dobYear: '1979', sex: 'M',
    address: '100 MAIN ST', city: 'QUEENS', state: 'NY', zip: '11373', peopleInVehicle: '1',
    registrantName: 'SMITH, JOHN R', regDobMonth: '11', regDobDay: '30', regDobYear: '1979', regSex: 'M',
    regAddress: '100 MAIN ST', regCity: 'QUEENS', regState: 'NY', regZip: '11373',
    plate: 'XYZ9876', plateState: 'NY', yearMakeModel: '2016 TOYOTA CAMRY', vehicleType: 'PAS', vin: '4T1BF1FK5GU123456',
    insuranceCode: 'STATE', insuranceCompany: 'STATE FARM', policyNumber: 'SF-5544332',
  };
  return {
    crash: {
      month: '08', day: '07', year: '2026', time: '2:30', ampm: 'PM', vehicleCount: '2', injured: '0', fatalities: '0',
      policeResponded: true, policeFiledReport: true, policeAgencyNumber: 'NYPD 1234', vandalized: 'No', inNewYork: 'Yes',
      injuredOrOver1000: 'Yes', ebikeInjury: 'No', damageOver1000: true, diagramCode: '4',
      description: 'Vehicle A was stopped at the red light on 23rd Street. Vehicle B, traveling southbound, failed to stop and struck the driver side of Vehicle A.',
      trafficControl: '2.', roadwaySurface: '1.', directionUnit1: '3.', directionUnit2: '7.', preCrashUnit1: '8.', preCrashUnit2: '1.',
      typeOfCrash: '', typeOfCrashUnit1: '1.', typeOfCrashUnit2: '1.',
    },
    location: {
      county: 'QUEENS', cityType: 'City', cityName: 'City of New York', road: '23RD STREET', houseNumber: '', landmark: '',
      intersectionType: 'At Intersection With:', crossStreet: 'NORTHERN BLVD', feet: '', miles: '', compass: [],
      distanceRouteOf: '', atIntersection: true, parkingLot: false,
    },
    partA,
    partB,
    otherPartyTypes: ['OTHER DRIVER'],
    persons: [
      { name: 'DOE, JANE A', unit: '1.', position: '1.', safety: '4.', age: '40', sex: 'F', injury: '', seriousInjuries: '', deathDate: '' },
      { name: 'SMITH, JOHN R', unit: '2.', position: '1.', safety: '4.', age: '46', sex: 'M', injury: 'C.', seriousInjuries: 'Neck discomfort', deathDate: '' },
    ],
    signing: { printName: 'DOE, JANE A', date: '08/08/2026', onBehalfOf: false, onBehalfUnit: '', reason: '', firefighter: false },
  };
}
