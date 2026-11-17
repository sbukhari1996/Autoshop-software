import PDFDocument from 'pdfkit';

type PayRunStatement = {
  id: string;
  payDate: Date;
  grossPay: number;
  federalWithholding: number;
  nysWithholding: number;
  nycWithholding: number;
  socialSecurityEmployee: number;
  medicareEmployee: number;
  sdiEmployee: number;
  pflEmployee: number;
  netPay: number;
  socialSecurityEmployer: number;
  medicareEmployer: number;
  futaEmployer: number;
  employee: { name: string; role: string | null };
};

const money = (value: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
const shortDate = (value: Date) => value.toISOString().slice(0, 10);

export function buildPayrollStatementPdf(run: PayRunStatement): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const document = new PDFDocument({ size: 'LETTER', margin: 48, compress: false });
    const chunks: Buffer[] = [];
    document.on('data', (chunk: Buffer) => chunks.push(chunk));
    document.on('error', reject);
    document.on('end', () => resolve(Buffer.concat(chunks)));

    const periodEnd = new Date(Date.UTC(run.payDate.getUTCFullYear(), run.payDate.getUTCMonth(), run.payDate.getUTCDate()));
    const periodStart = new Date(periodEnd);
    periodStart.setUTCDate(periodStart.getUTCDate() - 6);
    const deductions = [
      ['Federal income tax', run.federalWithholding],
      ['New York State income tax', run.nysWithholding],
      ['New York City income tax', run.nycWithholding],
      ['Social Security', run.socialSecurityEmployee],
      ['Medicare', run.medicareEmployee],
      ['NY disability insurance (SDI)', run.sdiEmployee],
      ['NY paid family leave (PFL)', run.pflEmployee],
    ] as const;
    const totalDeductions = deductions.reduce((total, [, amount]) => total + amount, 0);
    const employerTaxes = [
      ['Employer Social Security', run.socialSecurityEmployer],
      ['Employer Medicare', run.medicareEmployer],
      ['Federal unemployment (FUTA)', run.futaEmployer],
    ] as const;
    const totalEmployerTaxes = employerTaxes.reduce((total, [, amount]) => total + amount, 0);

    const left = document.page.margins.left;
    const right = document.page.width - document.page.margins.right;
    const amountX = right - 120;
    document.font('Helvetica-Bold').fontSize(18).text('Mastercraft Auto Repair & Collision', left, 48);
    document.fontSize(13).text('EMPLOYEE PAY STATEMENT', left, 78);
    document.font('Helvetica').fontSize(10);
    document.text(`Employee: ${run.employee.name}`, left, 112);
    if (run.employee.role) document.text(`Position: ${run.employee.role}`, left, 128);
    document.text(`Pay period: ${shortDate(periodStart)} through ${shortDate(periodEnd)}`, left, 144);
    document.text(`Pay date: ${shortDate(run.payDate)}`, left, 160);
    let y = 190;
    const drawRow = (label: string, amount: number, bold = false) => {
      document.font(bold ? 'Helvetica-Bold' : 'Helvetica').text(label, left, y, { width: amountX - left - 12 });
      document.text(money(amount), amountX, y, { width: 120, align: 'right' });
      y += 17;
    };
    const drawSection = (title: string) => {
      y += 9;
      document.font('Helvetica-Bold').fontSize(11).text(title, left, y);
      y += 18;
      document.fontSize(10);
    };

    drawSection('Earnings');
    drawRow('Weekly wages', run.grossPay);
    drawRow('Gross pay', run.grossPay, true);

    drawSection('Employee taxes and deductions');
    deductions.forEach(([label, amount]) => drawRow(label, amount));
    drawRow('Total deductions', totalDeductions, true);

    drawSection('Net pay');
    drawRow('Take-home pay', run.netPay, true);

    drawSection('Employer-paid taxes (not deducted from employee pay)');
    employerTaxes.forEach(([label, amount]) => drawRow(label, amount));
    drawRow('Total employer taxes', totalEmployerTaxes, true);

    document.font('Helvetica').fontSize(8).fillColor('#555555');
    document.text(
      'This statement summarizes amounts recorded by the shop payroll tool. Withholding is calculated using the shop tax settings and should be reviewed against current official rules. This is not an official tax form or a substitute for professional payroll advice.',
      left,
      y + 14,
      { width: right - left, height: 55 },
    );
    document.end();
  });
}
