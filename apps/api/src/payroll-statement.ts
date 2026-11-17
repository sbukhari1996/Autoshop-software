import PDFDocument from 'pdfkit';

const amountFields = [
  'grossPay', 'federalWithholding', 'nysWithholding', 'nycWithholding',
  'socialSecurityEmployee', 'medicareEmployee', 'sdiEmployee', 'pflEmployee',
  'netPay', 'socialSecurityEmployer', 'medicareEmployer', 'futaEmployer',
] as const;

type PayrollAmounts = Record<typeof amountFields[number], number>;

type PayRunStatement = PayrollAmounts & {
  id: string;
  payDate: Date;
  employeeId: string;
  employee: { name: string; role: string | null; ssnLast4: string | null };
};

const money = (value: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
const shortDate = (value: Date) => value.toISOString().slice(0, 10);

export function totalPayrollAmounts(runs: readonly PayrollAmounts[]): PayrollAmounts {
  const totals: PayrollAmounts = {
    grossPay: 0, federalWithholding: 0, nysWithholding: 0, nycWithholding: 0,
    socialSecurityEmployee: 0, medicareEmployee: 0, sdiEmployee: 0, pflEmployee: 0,
    netPay: 0, socialSecurityEmployer: 0, medicareEmployer: 0, futaEmployer: 0,
  };
  for (const field of amountFields) {
    totals[field] = runs.reduce((cents, run) => cents + Math.round(run[field] * 100), 0) / 100;
  }
  return totals;
}

export function buildPayrollStatementPdf(run: PayRunStatement, ytd: PayrollAmounts): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const document = new PDFDocument({ size: 'LETTER', margin: 36, compress: false });
    const chunks: Buffer[] = [];
    document.on('data', (chunk: Buffer) => chunks.push(chunk));
    document.on('error', reject);
    document.on('end', () => resolve(Buffer.concat(chunks)));

    const periodEnd = new Date(Date.UTC(run.payDate.getUTCFullYear(), run.payDate.getUTCMonth(), run.payDate.getUTCDate()));
    const periodStart = new Date(periodEnd);
    periodStart.setUTCDate(periodStart.getUTCDate() - 6);
    const deductions = [
      ['Federal income tax', 'federalWithholding'],
      ['New York State income tax', 'nysWithholding'],
      ['New York City income tax', 'nycWithholding'],
      ['Social Security', 'socialSecurityEmployee'],
      ['Medicare', 'medicareEmployee'],
      ['NY disability insurance (SDI)', 'sdiEmployee'],
      ['NY paid family leave (PFL)', 'pflEmployee'],
    ] as const;
    const totalDeductions = (amounts: PayrollAmounts) =>
      deductions.reduce((cents, [, field]) => cents + Math.round(amounts[field] * 100), 0) / 100;
    const employerTaxes = [
      ['Employer Social Security', 'socialSecurityEmployer'],
      ['Employer Medicare', 'medicareEmployer'],
      ['Federal unemployment (FUTA)', 'futaEmployer'],
    ] as const;
    const totalEmployerTaxes = (amounts: PayrollAmounts) =>
      employerTaxes.reduce((cents, [, field]) => cents + Math.round(amounts[field] * 100), 0) / 100;

    const left = document.page.margins.left;
    const right = document.page.width - document.page.margins.right;
    const width = right - left;
    const currentX = left + 300;
    const ytdX = left + 414;
    const line = (y: number) => document.strokeColor('#b8c2cc').lineWidth(0.5).moveTo(left, y).lineTo(right, y).stroke();
    const text = (value: string, x: number, y: number, cellWidth: number, bold = false, size = 9) => {
      document.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size).fillColor('#17212b')
        .text(value, x, y, { width: cellWidth, height: 24, ellipsis: true });
    };
    document.font('Helvetica-Bold').fontSize(17).text('Mastercraft Auto Repair & Collision', left, 36);
    text('PAY STUB / EMPLOYEE PAY STATEMENT', left, 64, width, true, 12);
    line(88);
    text('EMPLOYEE INFORMATION', left + 8, 100, 250, true);
    text('PAY STUB INFORMATION', left + 282, 100, 250, true);
    text(run.employee.name, left + 8, 119, 252, true, 11);
    text(`Position: ${run.employee.role || 'Not recorded'}`, left + 8, 148, 252);
    text(`Employee ID: ${run.employeeId}`, left + 8, 170, 252);
    const maskedSsn = run.employee.ssnLast4 && /^\d{4}$/.test(run.employee.ssnLast4)
      ? `XXX-XX-${run.employee.ssnLast4}` : 'Not recorded';
    text(`SSN: ${maskedSsn}`, left + 8, 192, 252);
    text(`Pay period start: ${shortDate(periodStart)}`, left + 282, 120, 250);
    text(`Pay period end: ${shortDate(periodEnd)}`, left + 282, 142, 250);
    text(`Pay date: ${shortDate(run.payDate)}`, left + 282, 164, 250);
    text('Pay frequency: Weekly', left + 282, 186, 250);
    line(218);

    let y = 230;
    const drawSection = (title: string) => {
      document.rect(left, y, width, 23).fill('#e8edf2');
      text(title, left + 8, y + 7, 282, true);
      text('Current pay', currentX, y + 7, 105, true);
      text('Year to date', ytdX, y + 7, 118, true);
      y += 23;
    };
    const drawRow = (label: string, current: number, yearToDate: number, bold = false) => {
      if (bold) document.rect(left, y, width, 21).fill('#f1f4f7');
      text(label, left + 8, y + 6, 282, bold);
      document.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9).fillColor('#17212b');
      document.text(money(current), currentX, y + 6, { width: 105, align: 'right', lineBreak: false });
      document.text(money(yearToDate), ytdX, y + 6, { width: 118, align: 'right', lineBreak: false });
      y += 21;
      line(y);
    };

    drawSection('EARNINGS');
    drawRow('Regular weekly wages (1 week)', run.grossPay, ytd.grossPay);
    drawRow('Gross pay / Total earnings', run.grossPay, ytd.grossPay, true);
    y += 10;
    drawSection('EMPLOYEE TAXES AND DEDUCTIONS');
    deductions.forEach(([label, field]) => drawRow(label, run[field], ytd[field]));
    drawRow('Total deductions', totalDeductions(run), totalDeductions(ytd), true);
    y += 10;
    drawSection('NET PAY');
    drawRow('Take-home pay / Net payable', run.netPay, ytd.netPay, true);
    y += 10;
    drawSection('Employer-paid taxes (not deducted from pay)');
    employerTaxes.forEach(([label, field]) => drawRow(label, run[field], ytd[field]));
    drawRow('Total employer taxes', totalEmployerTaxes(run), totalEmployerTaxes(ytd), true);

    document.font('Helvetica').fontSize(7).fillColor('#555555');
    document.text(
      `YTD covers recorded payroll dated January 1, ${run.payDate.getUTCFullYear()} through ${shortDate(run.payDate)}. The weekly period is the seven days ending on the pay date; separate work-period dates and hours are not recorded. Withholding uses the shop tax settings. This is not an official tax form or a substitute for professional payroll advice.`,
      left,
      y + 10,
      { width, height: 40 },
    );
    document.end();
  });
}
