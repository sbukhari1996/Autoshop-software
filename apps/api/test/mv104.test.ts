import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument } from 'pdf-lib';
import { fillMv104, fitMultiline, fitSingleLine } from '../src/mv104/mv104Form.js';
import { buildMv104Defaults, missingRequiredFields } from '../src/mv104/mv104Prefill.js';
import { sampleInput } from './mv104.sample.js';

async function readBack(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes);
  return doc.getForm();
}

test('single-line text shrinks to fit or is rejected', () => {
  assert.equal(fitSingleLine('ABC', 200, 14, 10), 10);
  assert.ok((fitSingleLine('X'.repeat(40), 160, 14, 10) ?? 0) >= 6);
  assert.equal(fitSingleLine('X'.repeat(200), 160, 14, 10), null);
});

test('multiline text fits the crash description box or is rejected', () => {
  assert.ok(fitMultiline('short description', 531, 42, 10) !== null);
  assert.equal(fitMultiline('word '.repeat(2000), 531, 42, 10), null);
});

test('filled MV-104 carries every value, checkbox and radio choice from the input', async () => {
  const bytes = await fillMv104(sampleInput());
  const form = await readBack(bytes);

  assert.equal(form.getTextField('(PART A: Your Vehicle/Unit) Driver Name - exactly as printed on license (Last, First, M.I. (middle initial))').getText(), 'DOE, JANE A');
  assert.equal(form.getTextField('Crash Date Year').getText(), '2026');
  assert.equal(form.getTextField('Crash Time').getText(), '2:30');
  assert.equal(form.getDropdown('Crash Date Month').getSelected()[0], '08');
  assert.equal(form.getDropdown('Crash Date Day').getSelected()[0], '07');
  assert.equal(form.getDropdown('Day of Week').getSelected()[0], 'Friday');
  assert.equal(form.getDropdown('3. TRAFFIC CONTROL').getSelected()[0], '2.');
  assert.equal(form.getDropdown('(PART B: Other Vehicle/Unit) Driver State').getSelected()[0], 'NY');
  assert.equal(form.getTextField('Name of Drivers, Passengers, Pedestrians and Bicyclists (Row 2)').getText(), 'SMITH, JOHN R');
  assert.equal(form.getDropdown('15. Injury (Row 2)').getSelected()[0], 'C.');

  assert.equal(form.getCheckBox('Police Responded').isChecked(), true);
  assert.equal(form.getCheckBox('OTHER DRIVER').isChecked(), true);
  assert.equal(form.getCheckBox('PEDESTRIAN').isChecked(), false);
  assert.equal(form.getCheckBox('Parking Lot').isChecked(), false);
  assert.equal(form.getCheckBox('Crash Occurred at an Intersection').isChecked(), true);

  assert.equal(form.getRadioGroup('Time AMPM').getSelected(), 'PM');
  assert.equal(form.getRadioGroup('Crash Location').getSelected(), 'City');
  assert.equal(form.getRadioGroup('Crash intersection or nearest location').getSelected(), 'At Intersection With:');
  assert.equal(form.getRadioGroup('Was your vehicle vandalized?').getSelected(), 'No');
  assert.equal(form.getRadioGroup('Was anyone killed or injured in this crash or was the estimated damage to any one vehicle or property greater than $1,000?').getSelected(), 'Yes');

  assert.equal(form.getFields().some((field) => field.getName() === 'RESET CLEAR'), false);
});

test('an unknown dropdown code is refused rather than silently dropped', async () => {
  const input = sampleInput();
  input.crash.trafficControl = '99.';
  await assert.rejects(fillMv104(input), (error: Error & { status?: number }) => {
    assert.equal(error.status, 422);
    assert.match(error.message, /3\. TRAFFIC CONTROL/);
    return true;
  });
});

test('text longer than its box is refused with the field named', async () => {
  const input = sampleInput();
  input.partA.driverName = 'X'.repeat(120);
  await assert.rejects(fillMv104(input), (error: Error & { status?: number }) => {
    assert.equal(error.status, 422);
    assert.match(error.message, /Driver Name/);
    return true;
  });
});

test('prefill from a claim leaves unknown facts blank and reports what is still required', () => {
  const defaults = buildMv104Defaults({
    claimNumber: 'C-100', incidentDate: new Date('2026-08-07T00:00:00Z'), driverLicense: 'd123', customerName: null,
    customerInsurance: 'GEICO', customerPolicyNumber: 'P1', vehicleYear: 2019, vehicleMake: 'Honda', vehicleModel: 'Civic',
    vehicleVin: 'VIN1', vehicleLicensePlate: 'abc1', vehiclePlateState: 'ny', policeReportNumber: null, policeDepartment: null,
    policeReportFiled: false, atFaultDriverName: null, atFaultDriverLicense: null, atFaultDlState: null, atFaultPlate: null,
    atFaultPlateState: null, atFaultVehicleYear: null, atFaultVehicleMake: null, atFaultVehicleModel: null, atFaultVehicleVin: null,
    atFaultInsurance: null, atFaultPolicyNumber: null,
    customer: { firstName: 'Jane', lastName: 'Doe', address: '1 Main St', city: 'Queens', state: 'NY', zipCode: '11101' },
  }, new Date('2026-10-21T12:00:00Z'));
  assert.equal(defaults.partA.driverName, 'DOE, JANE');
  assert.equal(defaults.partA.plate, 'ABC1');
  assert.equal(defaults.partA.plateState, 'NY');
  assert.equal(defaults.partA.yearMakeModel, '2019 HONDA CIVIC');
  assert.equal(defaults.crash.month, '08');
  assert.equal(defaults.crash.vehicleCount, '1');
  assert.equal(defaults.signing.date, '10/21/2026');
  const missing = missingRequiredFields(defaults);
  assert.ok(missing.includes('Crash time (with AM/PM)'));
  assert.ok(missing.includes('County'));
  assert.ok(!missing.includes('Your driver name'));
});
