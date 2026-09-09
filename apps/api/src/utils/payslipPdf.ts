import fs from "fs";
import path from "path";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

/**
 * Renders the "Professional Fees" payslip PDF matching the CHS
 * template (logo + company header, Employee/Contractor Details table,
 * Pay Summary table, Authorization table). Used for every
 * auto-generated payslip regardless of country — only the currency
 * symbol changes.
 */
export interface PayslipPdfInput {
  employeeName: string;
  email: string;
  monthLabel: string; // e.g. "May 2026"
  totalWorkHours: number;
  holidayPay: number;
  leaveUsedDays: number;
  netPay: number;
  currencySymbol: string; // "₱" or "€"
}

const TAN = rgb(0xb6 / 255, 0x9b / 255, 0x7d / 255);
const LIGHT_GREY = rgb(0xf3 / 255, 0xf2 / 255, 0xf0 / 255);
const BORDER = rgb(0xe5 / 255, 0xe5 / 255, 0xe5 / 255);
const DARK = rgb(0x1a / 255, 0x15 / 255, 0x12 / 255);
const GOLD = rgb(0xd9 / 255, 0x9a / 255, 0x3d / 255);
const WHITE = rgb(1, 1, 1);

export async function renderPayslipPdf(input: PayslipPdfInput): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]); // A4
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const marginX = 90;
  const pageWidth = 595;
  const contentWidth = pageWidth - marginX * 2;

  // Logo — payslip-only asset (matches the official "Professional Fees"
  // template exactly), independent of the web app's own logo.png.
  try {
    const logoPath = path.resolve(__dirname, "../../assets/payslip-logo.png");
    const logoBytes = fs.readFileSync(logoPath);
    const logoImage = await doc.embedPng(logoBytes);
    const logoDim = logoImage.scale(60 / logoImage.width);
    page.drawImage(logoImage, { x: marginX, y: 700, width: logoDim.width, height: logoDim.height });
  } catch {
    // logo optional
  }

  // Company header block, right-aligned.
  const headerLines = [
    { text: "Cyberhealth Services Limited", bold: true },
    { text: "Dogpatch Labs", bold: false },
    { text: "The Chq Building", bold: false },
    { text: "Custom House Quay", bold: false },
    { text: "Dublin 1", bold: false },
    { text: "", bold: false },
    { text: "T +353 (046) 924 6769", bold: false },
    { text: "E info@cyberhealth.ie", bold: false },
  ];
  let headerY = 755;
  for (const line of headerLines) {
    if (line.text) {
      const f = line.bold ? bold : font;
      const size = 9;
      const width = f.widthOfTextAtSize(line.text, size);
      page.drawText(line.text, { x: pageWidth - marginX - width, y: headerY, size, font: f, color: DARK });
    }
    headerY -= 12;
  }

  // Title
  page.drawText("PROFESSIONAL FEES", {
    x: marginX,
    y: 640,
    size: 22,
    font: bold,
    color: TAN,
  });

  let y = 590;

  function sectionHeader(title: string) {
    page.drawRectangle({ x: marginX, y: y - 22, width: contentWidth, height: 22, color: TAN });
    page.drawText(title, { x: marginX + 10, y: y - 16, size: 10, font: bold, color: WHITE });
    y -= 22;
  }

  function row(label: string, value: string) {
    const rowHeight = 26;
    page.drawRectangle({ x: marginX, y: y - rowHeight, width: contentWidth * 0.35, height: rowHeight, color: LIGHT_GREY, borderColor: BORDER, borderWidth: 0.5 });
    page.drawRectangle({ x: marginX + contentWidth * 0.35, y: y - rowHeight, width: contentWidth * 0.65, height: rowHeight, color: WHITE, borderColor: BORDER, borderWidth: 0.5 });
    page.drawText(label, { x: marginX + 10, y: y - rowHeight + 8, size: 10, font: bold, color: DARK });
    page.drawText(value, { x: marginX + contentWidth * 0.35 + 10, y: y - rowHeight + 8, size: 10, font, color: DARK });
    y -= rowHeight;
  }

  sectionHeader("Employee / Contractor Details");
  row("Employee Name", input.employeeName);
  row("Email", input.email);
  row("Month", input.monthLabel);

  y -= 20;
  sectionHeader("Pay Summary");
  row("Total Work Hours", input.totalWorkHours.toFixed(1));
  row("Holiday Pay", `${input.currencySymbol}${input.holidayPay.toLocaleString(undefined, { maximumFractionDigits: 2 })}`);
  row("Leave Used", `${input.leaveUsedDays} day(s)`);
  row("Net Pay", `${input.currencySymbol}${input.netPay.toLocaleString(undefined, { maximumFractionDigits: 2 })}`);

  y -= 20;
  sectionHeader("Authorization");
  row("Prepared By", "HR Department");
  row("Approved By", "Manager");

  // Gold footer accent, matching the login/dashboard palette.
  page.drawRectangle({ x: 0, y: 0, width: pageWidth, height: 4, color: GOLD });

  const bytes = await doc.save();
  return Buffer.from(bytes);
}
