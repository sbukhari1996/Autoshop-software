import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PDFDocument, PDFName, PDFDict, StandardFonts, TextAlignment, rgb, type PDFButton, type PDFCheckBox } from 'pdf-lib';
import { ApiError } from '../errors.js';

// Field names are the exact fully-qualified names inside the official NY DMV MV-104 (5/25) PDF.
const formUrl = new URL('../../assets/forms/mv104.pdf', import.meta.url);
const partPrefix = { A: '(PART A: Your Vehicle/Unit) ', B: '(PART B: Other Vehicle/Unit) ' } as const;

export interface Mv104Party {
  driverName: string; // Last, First, M.I.
  dlNumber: string;
  dlState: string;
  dobMonth: string; // 01-12
  dobDay: string; // 01-31
  dobYear: string;
  sex: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  peopleInVehicle: string;
  registrantName: string;
  regDobMonth: string;
  regDobDay: string;
  regDobYear: string;
  regSex: string;
  regAddress: string;
  regCity: string;
  regState: string;
  regZip: string;
  plate: string;
  plateState: string;
  yearMakeModel: string;
  vehicleType: string;
  vin: string;
  insuranceCode: string;
  insuranceCompany: string;
  policyNumber: string;
}

export interface Mv104Person {
  name: string;
  unit: string; // '1.' or '2.'
  position: string; // e.g. '1.'
  safety: string; // e.g. '4.'
  age: string;
  sex: string;
  injury: string; // 'A.' | 'B.' | 'C.' | ''
  seriousInjuries: string;
  deathDate: string;
}

export interface Mv104Input {
  crash: {
    month: string; // 01-12
    day: string; // 01-31
    year: string; // 4 digits
    time: string; // e.g. "2:30" (AM/PM in ampm)
    ampm: 'AM' | 'PM' | '';
    vehicleCount: string;
    injured: string;
    fatalities: string;
    policeResponded: boolean;
    policeFiledReport: boolean;
    policeAgencyNumber: string;
    vandalized: 'Yes' | 'No' | '';
    inNewYork: 'Yes' | 'No' | '';
    injuredOrOver1000: 'Yes' | 'No' | '';
    ebikeInjury: 'Yes' | 'No' | '';
    damageOver1000: boolean;
    diagramCode: string; // 0-9 or ''
    description: string;
    trafficControl: string;
    roadwaySurface: string;
    directionUnit1: string;
    directionUnit2: string;
    preCrashUnit1: string;
    preCrashUnit2: string;
    typeOfCrash: string;
    typeOfCrashUnit1: string;
    typeOfCrashUnit2: string;
  };
  location: {
    county: string;
    cityType: '' | 'City' | 'Town' | 'Village of:';
    cityName: string;
    road: string;
    houseNumber: string;
    landmark: string;
    intersectionType: '' | 'At Intersection With:' | 'Within distance of:';
    crossStreet: string;
    feet: string;
    miles: string;
    compass: Array<'N' | 'E' | 'S' | 'W'>;
    distanceRouteOf: string;
    atIntersection: boolean;
    parkingLot: boolean;
  };
  partA: Mv104Party;
  partB: Mv104Party;
  otherPartyTypes: Array<'OTHER DRIVER' | 'PEDESTRIAN' | 'BICYCLIST' | 'E-BIKE/E-SCOOTER'>;
  persons: Mv104Person[]; // up to 5
  signing: {
    printName: string;
    date: string;
    onBehalfOf: boolean;
    onBehalfUnit: string;
    reason: '' | 'Injury' | 'Death';
    firefighter: boolean;
  };
}

type Value = string;
interface Plan {
  texts: Array<[string, Value]>;
  dropdowns: Array<[string, Value]>;
  checks: Array<[string, boolean]>;
  radios: Array<[string, Value]>;
}

const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const courierWidth = 0.6; // Courier glyph advance, in em
const minFontSize = 6;

function partFields(part: 'A' | 'B', p: Mv104Party): Array<[string, Value]> {
  const x = partPrefix[part];
  return [
    [`${x}Driver License ID Identification Number`, p.dlNumber],
    [`${x}Driver Name - exactly as printed on license (Last, First, M.I. (middle initial))`, p.driverName],
    [`${x}Driver Address (include house number, street and apartment number)`, p.address],
    [`${x}Driver City or Town`, p.city],
    [`${x}Driver Zip Code`, p.zip],
    [`${x}Driver Date of Birth Year`, p.dobYear],
    [`${x}Driver Sex`, p.sex],
    [`${x}Number of People in Vehicle/Unit`, p.peopleInVehicle],
    [`${x}Registrant Name - exactly as printed on registration`, p.registrantName],
    [`${x}Registrant Date of Birth Year`, p.regDobYear],
    [`${x}Registrant Address (include house number, street and apartment number)`, p.regAddress],
    [`${x}Registrant Sex`, p.regSex],
    [`${x}Registrant City or Town`, p.regCity],
    [`${x}Registrant Zip Code`, p.regZip],
    [`${x}Registrant Plate Number`, p.plate],
    [`${x}Registrant Vehicle/Unit Year/Make/Model`, p.yearMakeModel],
    [`${x}Registrant Vehicle/Unit Type`, p.vehicleType],
    [`${x}Registrant Vehicle Identification Number`, p.vin],
    [`${x}Registrant Insurance Code`, p.insuranceCode],
    [`${x}Registrant Insurance Company/Self Insured Name`, p.insuranceCompany],
    [`${x}Registrant Insurance Policy/Certificate Number`, p.policyNumber],
  ];
}

function partDropdowns(part: 'A' | 'B', p: Mv104Party): Array<[string, Value]> {
  const x = partPrefix[part];
  return [
    [`${x}Driver State of License`, p.dlState],
    [`${x}Driver State`, p.state],
    [`${x}Driver Date of Birth Month`, p.dobMonth],
    [`${x}Driver Date of Birth Day`, p.dobDay],
    [`${x}Registrant Date of Birth Month`, p.regDobMonth],
    [`${x}Registrant Date of Birth Day`, p.regDobDay],
    [`${x}Registrant State`, p.regState],
    [`${x}Registrant State of Registration`, p.plateState],
  ];
}

/** Pure mapping from the structured input to PDF field values. Exported for tests. */
export function buildPlan(input: Mv104Input): Plan {
  const c = input.crash;
  const l = input.location;
  const texts: Array<[string, Value]> = [
    ['Crash Date Year', c.year],
    ['Crash Time', c.time],
    ['Number of Vehicles/Units', c.vehicleCount],
    ['Number of Injured', c.injured],
    ['Number of Fatalities', c.fatalities],
    ['Police Agency/Precinct/Crash Number', c.policeAgencyNumber],
    ['Crash Diagram Code', c.diagramCode],
    ['Briefly describe how the crash happened', c.description],
    ['County', l.county],
    ['Name of City, Town, or Village', l.cityName],
    ['Road Where Crash Occurred (route number, road, street name or address)', l.road],
    ['House Number', l.houseNumber],
    ['Permanent Landmark', l.landmark],
    ['At Intersection With: (Route Number, Road, Street Name or Exit Number)', l.crossStreet],
    ['Feet', l.feet],
    ['Miles', l.miles],
    ['of (Route Number, Road, Street Name, Exit Number or Milepost)', l.distanceRouteOf],
    ['I am signing on behalf of Vehicle/Unit (specify)', input.signing.onBehalfUnit],
    ['Date', input.signing.date],
    ['Print Name of Driver or Representative A representative may sign for the driver if the driver is unable to sign because of injury or death If you are signing as the drivers representative check the box next to I am signing on behalf of enter the vehicle unit number and check the box that describes why the driver cannot sign', input.signing.printName],
  ];
  texts.push(...partFields('A', input.partA), ...partFields('B', input.partB));

  const dropdowns: Array<[string, Value]> = [
    ['Crash Date Month', c.month],
    ['Crash Date Day', c.day],
    ['Day of Week', dayNameFor(c.year, c.month, c.day)],
    ['3. TRAFFIC CONTROL', c.trafficControl],
    ['6. ROADWAY SURFACE CONDITION', c.roadwaySurface],
    ['23. DIRECTION OF TRAVEL (Unit 1)', c.directionUnit1],
    ['24. DIRECTION OF TRAVEL (Unit 2)', c.directionUnit2],
    ['25. PRE-CRASH VEHICLE/UNIT ACTION (Unit 1)', c.preCrashUnit1],
    ['26. PRE-CRASH VEHICLE/UNIT ACTION (Unit 2)', c.preCrashUnit2],
    ['28. TYPE OF CRASH', c.typeOfCrash],
    ['29. TYPE OF CRASH (Unit 1)', c.typeOfCrashUnit1],
    ['30. TYPE OF CRASH (Unit 2)', c.typeOfCrashUnit2],
    ...partDropdowns('A', input.partA),
    ...partDropdowns('B', input.partB),
  ];
  for (let i = 0; i < 5; i++) {
    const p = input.persons[i];
    const row = i + 1;
    texts.push([`Name of Drivers, Passengers, Pedestrians and Bicyclists (Row ${row})`, p?.name ?? '']);
    texts.push([`12. Age (Row ${row})`, p?.age ?? '']);
    texts.push([`13. Sex (Row ${row})`, p?.sex ?? '']);
    texts.push([`Describe Most Serious Injuries (Row ${row})`, p?.seriousInjuries ?? '']);
    texts.push([`Date of Death (If Applicable)(Row ${row})`, p?.deathDate ?? '']);
    dropdowns.push([`8. Which Unit Occupied (Row ${row})`, p?.unit ?? '']);
    dropdowns.push([`9 . Position in/on Unit (Row ${row})`, p?.position ?? '']);
    dropdowns.push([`10. Safety Equipment Used (Row ${row})`, p?.safety ?? '']);
    dropdowns.push([`15. Injury (Row ${row})`, p?.injury ?? '']);
  }

  const checks: Array<[string, boolean]> = [
    ['Police Responded', c.policeResponded],
    ['Police Filed Crash Report', c.policeFiledReport],
    ['Cost of repairs to any one unit or property will be more than $1,000', c.damageOver1000],
    ['OTHER DRIVER', input.otherPartyTypes.includes('OTHER DRIVER')],
    ['PEDESTRIAN', input.otherPartyTypes.includes('PEDESTRIAN')],
    ['BICYCLIST', input.otherPartyTypes.includes('BICYCLIST')],
    ['E-BIKE/E-SCOOTER', input.otherPartyTypes.includes('E-BIKE/E-SCOOTER')],
    ['N (North)', l.compass.includes('N')],
    ['E (East)', l.compass.includes('E')],
    ['S (South)', l.compass.includes('S')],
    ['W (West)', l.compass.includes('W')],
    ['Parking Lot', l.parkingLot],
    ['Crash Occurred at an Intersection', l.atIntersection],
    ['I am signing on behalf of Vehicle/Unit', input.signing.onBehalfOf],
    ['Check this box if you are a firefighter and this crash occurred while responding to a call in emergency operation as defined by Vehicle and Traffic Law 114-b', input.signing.firefighter],
  ];

  // Radio groups: the PDF stores each choice as a separate widget; select the chosen on-state.
  const radios: Array<[string, Value]> = [
    ['Time AMPM', c.ampm],
    ['Crash Location', l.cityType === 'City' ? 'City' : l.cityType === 'Town' ? 'Town' : l.cityType === 'Village of:' ? 'Village of:' : ''],
    ['Crash intersection or nearest location', l.intersectionType],
    ['Was your vehicle vandalized?', c.vandalized],
    ['Did this crash occur in New York State?', c.inNewYork],
    ['Was anyone killed or injured in this crash or was the estimated damage to any one vehicle or property greater than $1,000?', c.injuredOrOver1000],
    ['Did this crash involve an e-bike or e-scooter in which a person was killed or suffered an injury?', c.ebikeInjury],
    ['Why the driver cannot sign', input.signing.reason],
  ];
  return { texts, dropdowns, checks, radios };
}

function dayNameFor(year: string, month: string, day: string): Value {
  if (!/^\d{4}$/.test(year) || !/^\d{2}$/.test(month) || !/^\d{2}$/.test(day)) return '';
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return dayNames[date.getUTCDay()];
}

/** Font size that keeps a value inside its box. Returns null when the value cannot fit at the minimum size. */
export function fitSingleLine(value: string, width: number, height: number, maxSize: number): number | null {
  const inner = width - 4;
  if (value.length === 0) return maxSize;
  const bySize = inner / (courierWidth * value.length);
  const byHeight = (height - 2) / 1.2;
  const size = Math.min(maxSize, bySize, byHeight);
  return size >= minFontSize ? Math.floor(size * 10) / 10 : null;
}

/** Word-wrap estimate for multiline boxes; returns the largest size that fits all lines. */
export function fitMultiline(value: string, width: number, height: number, maxSize: number): number | null {
  for (let size = maxSize; size >= minFontSize; size -= 0.5) {
    const perLine = Math.floor(((width - 4) / (courierWidth * size)) * 0.95);
    const maxLines = Math.floor((height - 4) / (size * 1.15));
    if (perLine < 1 || maxLines < 1) continue;
    let lines = 1;
    let used = 0;
    for (const word of value.split(/\s+/).filter(Boolean)) {
      const len = word.length;
      if (len > perLine) { lines += Math.ceil(len / perLine); used = len % perLine; continue; }
      if (used === 0) { used = len; continue; }
      if (used + 1 + len <= perLine) used += 1 + len;
      else { lines += 1; used = len; }
    }
    if (lines <= maxLines) return size;
  }
  return null;
}

interface WidgetHost {
  getWidgets(): Array<{ getRectangle(): { width: number; height: number } }>;
}

function rectOf(host: WidgetHost) {
  // Some rows in the official form store their rectangles with y1 > y2, so normalize to positive sizes.
  const r = host.getWidgets()[0].getRectangle();
  return { width: Math.abs(r.width), height: Math.abs(r.height) };
}

/**
 * Validates the plan against the real PDF (field existence, field type, dropdown/radio options,
 * max lengths, and whether text fits its box) and returns problems instead of silently dropping data.
 */
export async function fillMv104(input: Mv104Input): Promise<Uint8Array> {
  const bytes = await readFile(formUrl);
  const doc = await PDFDocument.load(bytes);
  const form = doc.getForm();
  const font = await doc.embedFont(StandardFonts.Courier);
  const plan = buildPlan(input);
  const problems: string[] = [];

  const apply = <T>(label: string, fn: () => T) => {
    try { return fn(); } catch (error) {
      problems.push(`${label}: ${error instanceof Error ? error.message : 'could not be set'}`);
      return undefined;
    }
  };

  for (const [name, value] of plan.texts) {
    if (!value) continue;
    const field = apply(name, () => form.getTextField(name));
    if (!field) continue;
    const max = field.getMaxLength();
    if (max !== undefined && value.length > max) {
      problems.push(`"${shortName(name)}" is ${value.length} characters; the form allows ${max}`);
      continue;
    }
    const { width, height } = rectOf(field.acroField);
    const multiline = field.isMultiline();
    const size = multiline
      ? fitMultiline(value, width, height, 10)
      : fitSingleLine(value, width, height, 10);
    if (size === null) {
      problems.push(`"${shortName(name)}" is too long for its box; shorten it`);
      continue;
    }
    apply(name, () => { field.setText(value); field.setFontSize(size); field.setAlignment(TextAlignment.Left); });
  }

  for (const [name, value] of plan.dropdowns) {
    if (!value) continue;
    const dropdown = apply(name, () => form.getDropdown(name));
    if (!dropdown) continue;
    const options = dropdown.getOptions();
    if (!options.includes(value)) {
      problems.push(`"${shortName(name)}" value "${value}" is not an allowed choice`);
      continue;
    }
    apply(name, () => dropdown.select(value));
  }

  for (const [name, checked] of plan.checks) {
    const box = apply(name, () => form.getCheckBox(name));
    if (!box) continue;
    apply(name, () => (checked ? box.check() : box.uncheck()));
  }

  for (const [name, value] of plan.radios) {
    if (!value) continue;
    const group = apply(name, () => form.getRadioGroup(name));
    if (!group) continue;
    if (!group.getOptions().includes(value)) {
      problems.push(`"${shortName(name)}" choice "${value}" is not on the form`);
      continue;
    }
    apply(name, () => group.select(value));
  }

  if (problems.length > 0) {
    throw new ApiError(422, `MV-104 cannot be filled as entered:\n- ${problems.join('\n- ')}`);
  }

  // Remove the on-screen RESET/CLEAR button so it does not print on the flattened form.
  removeResetButton(doc, form.getButton('RESET CLEAR'));

  // Regenerate every widget appearance with an embedded font so printed output matches the entered values.
  form.updateFieldAppearances(font);
  for (const [name, checked] of plan.checks) {
    if (checked) drawCheckMark(doc, form.getCheckBox(name));
  }
  // Intentionally not flattened: pdf-lib's flattened output breaks cross-reference parsing in some
  // PDF readers, while the fillable form renders correctly everywhere and stays editable for review.
  return doc.save({ useObjectStreams: false });
}

/** Removes the RESET/CLEAR push button from the form and from every page's annotation list. */
function removeResetButton(doc: PDFDocument, button: PDFButton): void {
  const widget = button.acroField.getWidgets()[0];
  const rect = widget.getRectangle();
  for (const page of doc.getPages()) {
    const annots = page.node.Annots();
    if (!annots) continue;
    for (let i = annots.size() - 1; i >= 0; i--) {
      if (annots.lookup(i, PDFDict) !== widget.dict) continue;
      annots.remove(i);
      // The button label is printed page content, so paint over it in white to keep the form clean.
      page.drawRectangle({
        x: Math.min(rect.x, rect.x + rect.width) - 1,
        y: Math.min(rect.y, rect.y + rect.height) - 1,
        width: Math.abs(rect.width) + 2,
        height: Math.abs(rect.height) + 2,
        color: rgb(1, 1, 1),
        borderWidth: 0,
      });
    }
  }
  doc.getForm().removeField(button);
}

/**
 * The form's own "on" appearance for checkboxes uses a ZapfDingbats glyph that does not survive
 * flattening (it prints as a substitute box). Replace it with a font-free vector check mark drawn
 * inside the same box, so checked boxes print clearly in every viewer.
 */
function drawCheckMark(doc: PDFDocument, box: PDFCheckBox): void {
  const widget = box.acroField.getWidgets()[0];
  const { width, height } = rectOf(box.acroField);
  const appearance = widget.dict.lookup(PDFName.of('AP'), PDFDict);
  const normal = appearance?.lookup(PDFName.of('N'), PDFDict);
  if (!normal) throw new ApiError(500, `MV-104 checkbox "${box.getName()}" has no appearance to update`);
  const lw = Math.max(0.9, Math.min(width, height) * 0.12);
  const content = [
    '0 G 0.8 w 0.5 0.5 ' + (width - 1).toFixed(2) + ' ' + (height - 1).toFixed(2) + ' re S',
    lw.toFixed(2) + ' w 1 J 1 j',
    (width * 0.22).toFixed(2) + ' ' + (height * 0.5).toFixed(2) + ' m ' +
      (width * 0.42).toFixed(2) + ' ' + (height * 0.22).toFixed(2) + ' l ' +
      (width * 0.8).toFixed(2) + ' ' + (height * 0.8).toFixed(2) + ' l S',
  ].join('\n');
  const stream = doc.context.flateStream(content, {
    Type: 'XObject',
    Subtype: 'Form',
    BBox: [0, 0, width, height],
    Resources: {},
  });
  normal.set(PDFName.of('Yes'), doc.context.register(stream));
}

function shortName(name: string): string {
  return name.length > 60 ? `${name.slice(0, 57)}...` : name;
}
