import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import type { AuthorizationFieldPlacement } from './authorization-fields.js';

// Shop details printed on every agreement.
export const SHOP = {
  name: 'Mastercraft Auto Repair & Collision',
  address: '3821 23rd St',
  cityLine: 'Long Island City, NY 11101',
  phone: '718-578-4563',
  email: 'shop@mastercraftautony.com',
  county: 'Queens',
};

export interface RentalAgreementPdfInput {
  agreementNumber: string;
  issuedOn: Date;
  status: string;
  customerName: string;
  customerPhone: string | null;
  customerEmail: string | null;
  customerAddress: string | null;
  insuranceCompany: string | null;
  claimNumber: string | null;
  adjusterName: string | null;
  adjusterPhone: string | null;
  adjusterEmail: string | null;
  rentalCar: { name: string; year: number | null; make: string | null; model: string | null; color: string | null; licensePlate: string | null; licenseState: string | null; vin: string | null };
  startDate: Date;
  endDate: Date;
  days: number;
  dailyRate: number;
  subtotal: number;
  taxRate: number;
  tax: number;
  total: number;
  mileageOut: number | null;
  mileageIn: number | null;
  fuelOut: string | null;
  fuelIn: string | null;
  conditionOut: string | null;
  conditionIn: string | null;
  damageNotes: string | null;
}

export interface RentalAgreementPdf {
  pdf: Uint8Array;
  // Signing boxes per signer, in PDF points measured from the top-left of each 612 x 792 page.
  fields: { renter: AuthorizationFieldPlacement[]; shop: AuthorizationFieldPlacement[] };
}

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN_X = 62;
const TOP = 56;
const BOTTOM = 80;
const WIDTH = PAGE_W - MARGIN_X * 2;
const money = (value: number) => `$${value.toFixed(2)}`;
const dateText = (value: Date) => value.toLocaleDateString('en-US', { timeZone: 'UTC' });
const dash = (value: unknown) => (value === null || value === undefined || value === '' ? '—' : String(value));

type Piece = { text: string; bold: boolean };

// Splits "plain **bold** plain" into pieces so bold lead-ins and key terms stay bold when wrapped.
function parse(markup: string): Piece[] {
  return markup.split('**').map((text, index) => ({ text, bold: index % 2 === 1 })).filter((piece) => piece.text);
}

class Writer {
  readonly pages: PDFPage[] = [];
  page!: PDFPage;
  y = 0;
  readonly fields: RentalAgreementPdf['fields'] = { renter: [], shop: [] };

  constructor(private readonly doc: PDFDocument, private readonly regular: PDFFont, private readonly bold: PDFFont) {
    this.newPage();
  }

  newPage() {
    this.page = this.doc.addPage([PAGE_W, PAGE_H]);
    this.pages.push(this.page);
    this.y = PAGE_H - TOP;
  }

  room(height: number) {
    if (this.y - height < BOTTOM) this.newPage();
  }

  private font(bold: boolean) {
    return bold ? this.bold : this.regular;
  }

  // Greedy word wrap. Each returned line is a list of pieces that together fit the width.
  private wrap(pieces: Piece[], width: number, size: number): Piece[][] {
    const lines: Piece[][] = [[]];
    let used = 0;
    for (const piece of pieces) {
      for (const part of piece.text.split(/(\s+)/)) {
        if (!part) continue;
        const line = lines[lines.length - 1];
        if (/^\s+$/.test(part)) {
          if (line.length) {
            line.push({ text: ' ', bold: false });
            used += this.regular.widthOfTextAtSize(' ', size);
          }
          continue;
        }
        const wordWidth = this.font(piece.bold).widthOfTextAtSize(part, size);
        if (used + wordWidth > width && used > 0) {
          const last = lines[lines.length - 1];
          while (last.length && last[last.length - 1].text === ' ') last.pop();
          lines.push([]);
          used = 0;
        }
        lines[lines.length - 1].push({ text: part, bold: piece.bold });
        used += wordWidth;
      }
    }
    return lines.filter((line) => line.some((piece) => piece.text.trim()));
  }

  private drawPieces(pieces: Piece[], x: number, baseline: number, size: number) {
    let cursor = x;
    for (const piece of pieces) {
      const font = this.font(piece.bold);
      this.page.drawText(piece.text, { x: cursor, y: baseline, size, font, color: rgb(0.07, 0.07, 0.07) });
      cursor += font.widthOfTextAtSize(piece.text, size);
    }
  }

  // Body paragraph; lines flow across pages.
  para(markup: string, size = 10, gap = 5) {
    const lh = size * 1.38;
    for (const line of this.wrap(parse(markup), WIDTH, size)) {
      this.room(lh);
      this.drawPieces(line, MARGIN_X, this.y - size, size);
      this.y -= lh;
    }
    this.y -= gap;
  }

  heading(title: string) {
    this.room(42);
    this.y -= 10;
    this.page.drawText(title.toUpperCase(), { x: MARGIN_X, y: this.y - 10, size: 10.5, font: this.bold, color: rgb(0.07, 0.07, 0.07) });
    this.page.drawLine({ start: { x: MARGIN_X, y: this.y - 14 }, end: { x: PAGE_W - MARGIN_X, y: this.y - 14 }, thickness: 0.6, color: rgb(0.3, 0.3, 0.3) });
    this.y -= 24;
  }

  // Two-column label/value table.
  table(rows: Array<[string, string]>) {
    const labelWidth = 150;
    const size = 9.8;
    const lh = size * 1.38;
    for (const [label, value] of rows) {
      const lines = this.wrap(parse(value), WIDTH - labelWidth, size);
      const count = Math.max(lines.length, 1);
      this.room(count * lh + 3);
      this.drawPieces([{ text: label, bold: true }], MARGIN_X, this.y - size, size);
      if (!lines.length) {
        this.drawPieces([{ text: '—', bold: false }], MARGIN_X + labelWidth, this.y - size, size);
      }
      lines.forEach((line, index) => {
        this.drawPieces(line, MARGIN_X + labelWidth, this.y - size - index * lh, size);
      });
      this.y -= count * lh;
      this.page.drawLine({ start: { x: MARGIN_X, y: this.y - 1.5 }, end: { x: PAGE_W - MARGIN_X, y: this.y - 1.5 }, thickness: 0.3, color: rgb(0.6, 0.6, 0.6) });
      this.y -= 4;
    }
    this.y -= 4;
  }

  // Acknowledgment line with an initials box for one signer.
  ack(markup: string, side: 'renter' | 'shop') {
    const size = 10;
    const lh = size * 1.38;
    const textWidth = 350;
    const lines = this.wrap(parse(markup), textWidth, size);
    this.room(Math.max(lines.length * lh, 22) + 8);
    const top = this.y;
    lines.forEach((line, index) => this.drawPieces(line, MARGIN_X, top - size - index * lh, size));
    const boxBottom = top - size - 4;
    this.page.drawText('Initials', { x: 424, y: boxBottom + 5, size: 8, font: this.regular, color: rgb(0.3, 0.3, 0.3) });
    this.page.drawRectangle({ x: 462, y: boxBottom, width: 84, height: 17, borderColor: rgb(0.2, 0.2, 0.2), borderWidth: 0.7 });
    this.addField(side, 'Initials', 'initials', 462, boxBottom, 84, 17);
    this.y -= Math.max(lines.length * lh, 22) + 8;
  }

  // Signature and date boxes for one signer, kept together on one page.
  signature(side: 'renter' | 'shop', printedName: string) {
    this.room(104);
    const lineY = this.y - 40;
    this.page.drawLine({ start: { x: MARGIN_X, y: lineY }, end: { x: MARGIN_X + 270, y: lineY }, thickness: 0.7, color: rgb(0.1, 0.1, 0.1) });
    this.page.drawLine({ start: { x: MARGIN_X + 330, y: lineY }, end: { x: MARGIN_X + 440, y: lineY }, thickness: 0.7, color: rgb(0.1, 0.1, 0.1) });
    this.page.drawText(side === 'renter' ? 'Renter signature' : 'Shop representative signature', { x: MARGIN_X, y: lineY - 12, size: 8.5, font: this.regular, color: rgb(0.2, 0.2, 0.2) });
    this.page.drawText('Date', { x: MARGIN_X + 330, y: lineY - 12, size: 8.5, font: this.regular, color: rgb(0.2, 0.2, 0.2) });
    this.page.drawText(`Printed name: ${printedName}`, { x: MARGIN_X, y: lineY - 26, size: 9.5, font: this.regular, color: rgb(0.07, 0.07, 0.07) });
    this.addField(side, side === 'renter' ? 'Renter signature' : 'Shop signature', 'signature', MARGIN_X, lineY + 2, 270, 34);
    this.addField(side, side === 'renter' ? 'Renter date signed' : 'Shop date signed', 'date', MARGIN_X + 330, lineY + 2, 110, 20);
    this.y = lineY - 44;
  }

  private addField(side: 'renter' | 'shop', name: string, type: AuthorizationFieldPlacement['type'], x: number, bottom: number, w: number, h: number) {
    this.fields[side].push({ name, type, required: true, x, y: PAGE_H - (bottom + h), w, h, page: this.pages.length });
  }
}

export async function createRentalAgreementPdf(input: RentalAgreementPdfInput): Promise<RentalAgreementPdf> {
  const doc = await PDFDocument.create();
  doc.setTitle(`${input.agreementNumber} Vehicle Loan and Rental Agreement`);
  doc.setAuthor(SHOP.name);
  const regular = await doc.embedFont(StandardFonts.TimesRoman);
  const bold = await doc.embedFont(StandardFonts.TimesRomanBold);
  const w = new Writer(doc, regular, bold);

  // Letterhead
  const center = (text: string, size: number, font: PDFFont, y: number) => {
    const x = (PAGE_W - font.widthOfTextAtSize(text, size)) / 2;
    w.page.drawText(text, { x, y, size, font, color: rgb(0.07, 0.07, 0.07) });
  };
  center(SHOP.name.toUpperCase(), 15, bold, w.y - 14);
  center(`${SHOP.address} · ${SHOP.cityLine}`, 9, regular, w.y - 30);
  center(`Tel. ${SHOP.phone} · ${SHOP.email}`, 9, regular, w.y - 42);
  w.page.drawLine({ start: { x: MARGIN_X, y: w.y - 52 }, end: { x: PAGE_W - MARGIN_X, y: w.y - 52 }, thickness: 1.4, color: rgb(0.07, 0.07, 0.07) });
  w.y -= 72;
  center('VEHICLE LOAN AND RENTAL AGREEMENT', 13, bold, w.y);
  w.y -= 16;
  center(`Agreement No. ${input.agreementNumber} · Issued ${dateText(input.issuedOn)} · Status: ${input.status}`, 9, regular, w.y);
  w.y -= 22;

  w.para(`This Vehicle Loan and Rental Agreement (the “Agreement”) is made between ${SHOP.name} (the “Shop”) and the person named below (the “Renter”). The Shop lends the vehicle described below (the “Vehicle”) to the Renter on the terms of this Agreement.`);

  const car = input.rentalCar;
  const carDetails = [car.year, car.make, car.model, car.color].filter(Boolean).join(' ');
  const plate = [car.licensePlate, car.licenseState].filter(Boolean).join(' ');
  w.heading('1. Parties, Vehicle and Rental Period');
  w.table([
    ['Renter', dash(input.customerName)],
    ['Phone', dash(input.customerPhone)],
    ['Email', dash(input.customerEmail)],
    ['Address', dash(input.customerAddress)],
    ['Claim number', dash(input.claimNumber)],
    ['Insurance company', dash(input.insuranceCompany)],
    ['Adjuster', dash(input.adjusterName)],
    ['Adjuster phone', dash(input.adjusterPhone)],
    ['Adjuster email', dash(input.adjusterEmail)],
    ['Vehicle', [car.name, carDetails].filter(Boolean).join(', ')],
    ['License plate', dash(plate)],
    ['VIN', dash(car.vin)],
    ['Pick-up date', dateText(input.startDate)],
    ['Return date', dateText(input.endDate)],
    ['Days rented', String(input.days)],
    ['Billed to', input.insuranceCompany ? `Insurance company: ${input.insuranceCompany}` : 'Renter (customer pays)'],
  ]);

  w.heading('2. Insurance Authorization and Renter Responsibility');
  w.para('**2.1**  The Shop lends the Vehicle while the Renter’s own vehicle is being repaired at the Shop, for the Rental Period above. The Renter may keep the Vehicle only for the period described in this Agreement.');
  w.para('**2.2**  If the Renter’s insurance company authorizes a loan or rental, the Shop may bill that company at the daily rate shown in Section 3 for the number of days it authorizes. An authorization does not limit the Renter’s obligations under this Agreement.');
  w.para('**2.3**  **Any day beyond the number of days the insurance company authorizes, and any amount the insurance company does not pay, is the Renter’s personal responsibility.** The Renter agrees to pay those charges at the daily rate, plus applicable sales tax, when the Shop issues an invoice.');
  w.para('**2.4**  The Renter understands that an insurance company may stop authorizing a rental at any time, and that the Renter remains responsible for all charges after that date.');

  w.heading('3. Charges, Billing and Payment');
  w.table([
    ['Daily rate', money(input.dailyRate)],
    ['Days', String(input.days)],
    ['Subtotal', money(input.subtotal)],
    [`Sales tax (${input.taxRate}% on whole total)`, money(input.tax)],
    ['Total', money(input.total)],
  ]);
  w.para(`**3.1**  The daily rate for this Agreement is **${money(input.dailyRate)}** per day. Each day or part of a day counts as one day. Sales tax is applied to the whole rental total at ${input.taxRate}%. The rental total on this Agreement is **${money(input.total)}**, including tax, before any fees under Sections 4 through 7.`);
  w.para('**3.2**  Charges are billed to the party shown in Section 1. Where charges are billed to an insurance company, the Renter remains liable for any part the company does not pay.');
  w.para('**3.3**  Invoices are due on receipt unless the Shop states otherwise in writing. Late payments may be charged interest at the maximum rate permitted by New York law.');
  w.para('**3.4**  The Renter authorizes the Shop to charge the Renter’s payment method on file for any amount due under this Agreement that is not paid when due.');
  w.para('**3.5**  The rate on this Agreement may be changed only by a written amendment signed by both parties before the Vehicle is released.');

  w.heading('4. Return of Vehicle and Holding Over');
  w.para('**4.1**  The Renter must return the Vehicle to the Shop on the Return Date, at the Shop’s place of business, with all keys, documents and accessories.');
  w.para('**4.2**  When the Renter’s repairs are complete, the Shop may ask the Renter to return the Vehicle within twenty-four (24) hours after notice by telephone, voicemail, text message, email or in person. Notice sent to the contact information in Section 1 is sufficient.');
  w.para('**4.3**  If the Vehicle is kept after the Return Date or after the notice period in Section 4.2, each additional day is charged at the daily rate. The Renter remains responsible for the Vehicle during that time, including for any loss, damage or theft.');
  w.para('**4.4**  If the Vehicle is not returned when required, the Renter agrees to pay the Shop’s reasonable costs to recover it, including towing, storage and attorney’s fees.');

  w.heading('5. Use of the Vehicle');
  w.para('**5.1**  Only the Renter, or a driver approved in writing by the Shop, may drive the Vehicle.');
  w.para('**5.2**  The Renter shall not sublet, lend, rent or allow anyone else to possess or use the Vehicle; use the Vehicle for hire, towing, racing, speed contests or off-road driving; carry more passengers than seats or any hazardous material; or drive the Vehicle outside the State of New York without the Shop’s written consent.');
  w.para('**5.3**  The Renter shall not operate the Vehicle while under the influence of alcohol, cannabis, narcotics or any other substance that impairs driving.');
  w.para('**5.4**  The Renter shall obey all traffic, parking and other laws. The Renter is responsible for all parking tickets, traffic violations, tolls, fines and impound fees assigned to the Vehicle while it is in the Renter’s possession.');

  w.heading('6. Driver Qualifications');
  w.para('**6.1**  The driver must be at least twenty-six (26) years old, hold a valid driver’s license for this class of vehicle, and present that license at pick-up.');
  w.para('**6.2**  The Renter confirms that the information about the Renter and the Renter’s insurance in this Agreement is accurate, and will tell the Shop promptly of any change.');

  w.heading('7. Care, Fuel, Cleaning and Keys');
  w.para('**7.1**  The Renter shall keep the Vehicle in good condition, lock it when unattended, and protect it from loss or damage.');
  w.para('**7.2**  **Smoking is prohibited in the Vehicle.** A cleaning fee of **$125.00** applies to smoke odor or smoking residue. The Renter is also responsible for any cleaning or repair cost above that amount.');
  w.para('**7.3**  The Renter shall return the Vehicle with the same fuel level recorded at pick-up in Section 8. For each quarter tank of fuel needed to restore that level, the Renter shall pay a **$20.00** fuel service charge plus the cost of the fuel.');
  w.para('**7.4**  The Renter shall not remove, alter, or add any equipment, accessory or sticker to the Vehicle.');
  w.para('**7.5**  The Renter is responsible for any lost, stolen or damaged keys or key fobs, including the cost of replacing or reprogramming them.');

  w.heading('8. Vehicle Condition Report');
  w.para('The Renter and the Shop have recorded the Vehicle’s condition below. The Renter accepts the Vehicle in the condition recorded at pick-up. Damage not recorded at pick-up is presumed to have occurred during the rental.');
  w.table([
    ['Mileage out', dash(input.mileageOut)],
    ['Mileage in', dash(input.mileageIn)],
    ['Fuel out', dash(input.fuelOut)],
    ['Fuel in', dash(input.fuelIn)],
    ['Condition out', dash(input.conditionOut)],
    ['Condition in', dash(input.conditionIn)],
    ['Damage noted', dash(input.damageNotes)],
  ]);

  w.heading('9. Insurance; Responsibility for Damage and Loss');
  w.para('**9.1**  The Renter’s own automobile insurance is primary for the Vehicle while it is in the Renter’s possession. The Renter certifies that the Renter carries motor vehicle liability insurance meeting New York requirements, and that the Renter’s policy covers the Renter while driving a loaned vehicle, to the extent the policy permits.');
  w.para('**9.2**  **The Renter is responsible for all damage to the Vehicle, regardless of fault,** including collision, theft, vandalism, weather, glass and undercarriage damage. This responsibility applies to the extent the Vehicle’s damage is not paid by an insurance company that accepts the claim. The Renter is responsible for all deductibles and for any repair the insurance company does not pay.');
  w.para('**9.3**  If the Vehicle is lost, stolen, destroyed, or cannot be returned for any reason, the Renter shall pay the Vehicle’s market value on the date of loss, the value of any missing accessories, and the Shop’s reasonable loss-of-use charge at the daily rate for the period the Vehicle is unavailable.');
  w.para('**9.4**  The Shop provides no warranty, express or implied, about the Vehicle. Any insurance maintained by the Shop is excess over, and does not replace, the Renter’s insurance and does not cover the Renter’s liability.');

  w.heading('10. Accidents and Reporting');
  w.para('**10.1**  The Renter must notify the Shop within **twelve (12) hours** of any accident, theft, vandalism, fire or other damage involving the Vehicle, and must provide the Shop a full written report.');
  w.para('**10.2**  The Renter shall report any accident to the police and the New York Department of Motor Vehicles when required by the New York Vehicle and Traffic Law, and shall give the Shop a copy of each report.');
  w.para('**10.3**  The Renter shall not admit fault, make any settlement, or waive any claim concerning the Vehicle without the Shop’s prior written consent, except where the law requires otherwise.');
  w.para('**10.4**  The Renter shall cooperate with the Shop and any insurance company in investigating and resolving any claim involving the Vehicle.');

  w.heading('11. Indemnification');
  w.para('**11.1**  To the fullest extent permitted by law, the Renter shall defend, indemnify and hold harmless the Shop, and its owners, employees and agents, from all claims, demands, suits, judgments, losses, damages, fines, penalties, attorney’s fees and costs arising from the possession, use, operation, storage or condition of the Vehicle while it is in the Renter’s possession or control, including claims for bodily injury or property damage. This obligation does not apply to the extent a loss is caused by the Shop’s gross negligence or willful misconduct.');

  w.heading('12. Default and Remedies');
  w.para('**12.1**  The Renter is in default if the Renter fails to pay any amount when due, fails to return the Vehicle when required, breaks any term of this Agreement, or gives false information to the Shop.');
  w.para('**12.2**  After a default, the Shop may demand return of the Vehicle, end the rental, and use any remedy available under New York law, including recovery of the Vehicle.');
  w.para('**12.3**  To the extent permitted by law, the Renter shall pay the Shop’s reasonable attorney’s fees, collection costs and court costs incurred in enforcing this Agreement.');
  w.para('**12.4**  The Shop’s rights are cumulative. A delay in enforcing any right is not a waiver of that right.');

  w.heading('13. Governing Law and Venue');
  w.para('**13.1**  This Agreement is governed by the laws of the State of New York.');
  w.para(`**13.2**  Any legal action arising from this Agreement shall be brought in the courts located in ${SHOP.county} County, New York, and the parties consent to the jurisdiction of those courts.`);

  w.heading('14. General Terms');
  w.para('**14.1**  This Agreement, together with any invoice issued under it, is the entire agreement about the rental of the Vehicle and replaces any prior discussion about it.');
  w.para('**14.2**  This Agreement may be changed only in a writing signed by both parties. If any provision is found unenforceable, the rest of this Agreement remains in effect, and that provision applies to the maximum extent permitted by law.');
  w.para('**14.3**  Notices to the Renter may be sent to the contact information in Section 1. The Renter shall tell the Shop in writing of any change of address, telephone number or email.');
  w.para('**14.4**  A photocopy, scan or electronic signature of this Agreement has the same effect as the original. Sections 9 through 14 survive the return of the Vehicle.');

  w.heading('15. Acknowledgment and Consent');
  w.para('The Renter initials each statement below to confirm it.', 10, 8);
  w.ack('I have read this Agreement, I understand it, and I agree to all of its terms.', 'renter');
  w.ack('I understand that any day beyond the insurance-authorized period, and any amount the insurance company does not pay, is my personal responsibility (Section 2).', 'renter');
  w.ack('I understand that I am responsible for damage to the Vehicle regardless of fault, to the extent it is not paid by insurance (Section 9).', 'renter');
  w.ack('I have had the opportunity to consult an attorney before signing, and I sign this Agreement voluntarily.', 'renter');
  w.y -= 14;
  w.signature('renter', input.customerName);
  w.signature('shop', '______________________________');

  // Footer on every page: agreement number, shop, and page count.
  const pages = w.pages;
  pages.forEach((page, index) => {
    page.drawLine({ start: { x: MARGIN_X, y: 50 }, end: { x: PAGE_W - MARGIN_X, y: 50 }, thickness: 0.5, color: rgb(0.5, 0.5, 0.5) });
    page.drawText(`${input.agreementNumber} · ${SHOP.name}`, { x: MARGIN_X, y: 38, size: 8, font: regular, color: rgb(0.3, 0.3, 0.3) });
    const label = `Page ${index + 1} of ${pages.length}`;
    page.drawText(label, { x: PAGE_W - MARGIN_X - regular.widthOfTextAtSize(label, 8), y: 38, size: 8, font: regular, color: rgb(0.3, 0.3, 0.3) });
  });

  return { pdf: await doc.save(), fields: w.fields };
}
