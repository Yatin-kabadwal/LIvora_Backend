import PDFDocument from "pdfkit";
import { IBooking } from "../models/Booking";
import { getSettings } from "./settings";

const inr = (n: number) => "Rs. " + Math.round(n).toLocaleString("en-IN");
const fmt = (d?: Date) => (d ? d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }) : "-");

export async function buildInvoice(b: IBooking): Promise<PDFKit.PDFDocument> {
  const s = await getSettings();
  const doc = new PDFDocument({ size: "A4", margin: 48 });
  const green = "#1c3a2b";
  const gold = "#a8842f";

  doc.rect(0, 0, doc.page.width, 110).fill(green);
  doc.fillColor("#f4efe2").fontSize(22).text(s.resortName, 48, 38);
  doc.fillColor("#d9b76a").fontSize(9).text("TAX INVOICE", 48, 70, { characterSpacing: 3 });
  doc.fillColor("#f4efe2").fontSize(9).text(`Invoice: ${b.bookingRef}`, 360, 40, { align: "right", width: 187 });
  doc.text(`Date: ${fmt(new Date())}`, 360, 54, { align: "right", width: 187 });
  if (s.gstNumber) doc.text(`GSTIN: ${s.gstNumber}`, 360, 68, { align: "right", width: 187 });

  doc.fillColor("#222").fontSize(10);
  let y = 135;
  doc.fillColor(gold).fontSize(9).text("BILLED TO", 48, y);
  doc.fillColor("#111").fontSize(11).text(b.guestName, 48, y + 14);
  doc.fillColor("#555").fontSize(9).text(`${b.guestEmail}\n${b.guestPhone}`, 48, y + 30);

  doc.fillColor(gold).fontSize(9).text("STAY", 320, y);
  doc.fillColor("#111").fontSize(11).text(b.roomName || b.roomType, 320, y + 14);
  doc.fillColor("#555").fontSize(9).text(
    `Room ${b.roomNumber}\n${fmt(b.checkIn)} to ${fmt(b.checkOut)} (${b.nights} night${b.nights > 1 ? "s" : ""})\n${b.adults} adult(s), ${b.children} child(ren)`,
    320, y + 30
  );

  y = 240;
  const row = (label: string, amount: string, bold = false) => {
    doc.fillColor(bold ? "#111" : "#333").fontSize(bold ? 11 : 10).text(label, 48, y, { width: 340 });
    doc.text(amount, 400, y, { width: 147, align: "right" });
    y += bold ? 24 : 20;
  };
  doc.moveTo(48, y - 8).lineTo(547, y - 8).strokeColor("#ddd").stroke();
  row(`Room tariff (${b.nights} x ${inr(b.pricePerNight)})`, inr(b.roomAmount));
  if (b.mealAmount) row(`Meal plan (${b.mealPlan.toUpperCase()})`, inr(b.mealAmount));
  b.extras.forEach((e) => row(e.description, inr(e.amount)));
  if (b.discountAmount) row(`Discount${b.promoCode ? " (" + b.promoCode + ")" : ""}`, "- " + inr(b.discountAmount));
  doc.moveTo(48, y).lineTo(547, y).strokeColor("#ddd").stroke();
  y += 10;
  row("Taxable value", inr(b.baseAmount));
  const half = b.gstRate * 50;
  row(`CGST @ ${half}%`, inr(b.gstAmount / 2));
  row(`SGST @ ${half}%`, inr(b.gstAmount / 2));
  doc.moveTo(48, y).lineTo(547, y).strokeColor(green).lineWidth(1.5).stroke();
  y += 10;
  row("Total (inclusive of GST)", inr(b.totalAmount), true);
  row("Amount paid", inr(b.paidAmount));
  row("Balance due", inr(b.balanceDue), true);

  if (b.payments.length) {
    y += 14;
    doc.fillColor(gold).fontSize(9).text("PAYMENTS", 48, y);
    y += 16;
    b.payments.forEach((p) => {
      doc.fillColor("#555").fontSize(9).text(`${fmt(p.at)}  ·  ${p.method.toUpperCase()}${p.reference ? "  ·  " + p.reference : ""}`, 48, y, { width: 340 });
      doc.text(inr(p.amount), 400, y, { width: 147, align: "right" });
      y += 16;
    });
  }

  doc.fillColor("#888").fontSize(8).text(
    `${s.resortName} · ${s.address}\n${s.phone} · ${s.email}\nThis is a computer generated invoice.`,
    48, 760, { align: "center", width: 499 }
  );
  return doc;
}
