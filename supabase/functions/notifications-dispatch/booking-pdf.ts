import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import QRCode from "qrcode";
import { BOOKING_FONT_BASE64 } from "./fonts/booking-font.ts";

export interface BookingPdfDetails {
  eventType?: "BOOKED" | "RESCHEDULED" | "CANCELLED";
  patientName?: string;
  bookingReference?: string;
  startsAt: string;
  durationMinutes: number;
  institution?: string;
  hospital?: string;
  doctor?: string;
  specialist?: string;
  department?: string;
  kind?: string;
  priority?: boolean;
  location: string;
  pdfDetails?: {
    patientBirthDate?: string | null;
    patientAddress?: string | null;
    patientPhone?: string | null;
    institutionAddress?: string | null;
    institutionPhone?: string | null;
    bookedAt?: string;
    bookedBy?: string | null;
  };
}
export const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(binary);
};
const fontBytes = Uint8Array.from(atob(BOOKING_FONT_BASE64), (c) =>
  c.charCodeAt(0),
);

/** Only immutable database snapshots reach this renderer; no clinical free text. */
export async function bookingPdf(details: BookingPdfDetails) {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(fontBytes);
  const supported = new Set(font.getCharacterSet());
  const clean = (value: string) =>
    Array.from(value.replace(/[\u0000-\u001f\u007f]/g, " "))
      .map((c) => (supported.has(c.codePointAt(0)!) ? c : "?"))
      .join("");
  const data = details.pdfDetails ?? {};
  const timestamp = new Date(data.bookedAt ?? details.startsAt);
  // Fixed metadata and font/QR bytes keep retry attachments identical.
  pdf.setCreationDate(timestamp);
  pdf.setModificationDate(timestamp);
  pdf.setCreator("e-Zdravstvo");
  pdf.setProducer("e-Zdravstvo");
  pdf.setAuthor("e-Zdravstvo");
  pdf.setTitle("Potvrda o narudžbi pacijenta");
  let page = pdf.addPage([595.28, 841.89]);
  const margin = 48,
    width = 499.28;
  let y = 792;
  function next() {
    page = pdf.addPage([595.28, 841.89]);
    y = 792;
  }
  function lines(value: string, size: number, available: number) {
    const result: string[] = [];
    let row = "";
    for (const char of clean(value)) {
      if (font.widthOfTextAtSize(row + char, size) > available && row) {
        const lastSpace = row.lastIndexOf(" ");
        if (lastSpace > 0) {
          result.push(row.slice(0, lastSpace));
          row = row.slice(lastSpace + 1) + char;
        } else {
          result.push(row);
          row = char;
        }
      } else row += char;
    }
    result.push(row);
    return result;
  }
  function draw(
    value: string,
    x: number,
    baseline: number,
    size = 10,
    bold = false,
  ) {
    const text = clean(value);
    page.drawText(text, { x, y: baseline, size, font, color: rgb(0, 0, 0) });
    if (bold)
      page.drawText(text, {
        x: x + 0.18,
        y: baseline,
        size,
        font,
        color: rgb(0, 0, 0),
      });
  }
  function paragraph(
    value: string,
    size = 10,
    bold = false,
    center = false,
    available = width,
  ) {
    const wrapped = lines(value, size, available);
    if (y - wrapped.length * (size + 4) < 48) next();
    for (const line of wrapped) {
      draw(
        line,
        center
          ? margin + (available - font.widthOfTextAtSize(line, size)) / 2
          : margin,
        y,
        size,
        bold,
      );
      y -= size + 4;
    }
  }
  function rule() {
    page.drawLine({
      start: { x: margin, y },
      end: { x: margin + width, y },
      thickness: 0.65,
    });
    y -= 18;
  }
  function field(label: string, value?: string | null, bold = false) {
    const labelSize = 9.4;
    const labelWidth = font.widthOfTextAtSize(clean(label), labelSize);
    const separate = labelWidth > 290;
    const x = separate ? margin : margin + labelWidth + 12;
    const wrapped = lines(
      value?.trim() || "Nije evidentirano",
      10,
      margin + width - x,
    );
    if (y - 18 - wrapped.length * 14 < 65) next();
    draw(label, margin, y, labelSize);
    if (separate) y -= 17;
    for (const row of wrapped) {
      draw(row, x, y, 10, bold);
      y -= 14;
    }
    page.drawLine({
      start: { x, y: y + 10 },
      end: { x: margin + width, y: y + 10 },
      thickness: 0.5,
    });
    y -= 15;
  }
  const event = details.eventType ?? "BOOKED";
  const title =
    event === "CANCELLED"
      ? "POTVRDA O OTKAZIVANJU NARUDŽBE"
      : event === "RESCHEDULED"
        ? "POTVRDA O PROMJENI TERMINA"
        : "POTVRDA O NARUDŽBI PACIJENTA";
  const date = (value: string) =>
    new Intl.DateTimeFormat("hr-HR", {
      timeZone: "Europe/Zagreb",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(new Date(value));
  paragraph(
    details.institution || details.hospital || "Zdravstvena ustanova",
    13,
    true,
    true,
    width - 82,
  );
  if (details.department)
    paragraph(details.department, 11, false, true, width - 82);
  paragraph(
    details.doctor || details.specialist || "Liječnik",
    10,
    false,
    true,
    width - 82,
  );
  if (data.institutionAddress)
    paragraph(data.institutionAddress, 9, false, true, width - 82);
  if (data.institutionPhone)
    paragraph("Telefon: " + data.institutionPhone, 9, false, true, width - 82);
  if (details.bookingReference) {
    const image = await pdf.embedPng(
      await QRCode.toDataURL(details.bookingReference, {
        margin: 0,
        width: 128,
      }),
    );
    page.drawImage(image, {
      x: margin + width - 64,
      y: 735,
      width: 64,
      height: 64,
    });
  }
  y = Math.min(y - 8, 713);
  rule();
  paragraph(
    details.hospital
      ? "BOLNIČKA JEDINICA ZA NARUČIVANJE"
      : "NARUČIVANJE U ORDINACIJI",
    10,
    true,
    true,
  );
  y -= 6;
  paragraph(title, 14, true, true);
  if (details.bookingReference)
    paragraph(details.bookingReference, 10, true, true);
  paragraph(
    event === "CANCELLED"
      ? "STATUS: OTKAZANO"
      : event === "RESCHEDULED"
        ? "STATUS: PROMIJENJENO"
        : "STATUS: POTVRĐENO",
    10,
    true,
    true,
  );
  if (details.priority) paragraph("PRIORITETNI PREGLED", 10, true, true);
  y -= 10;
  const category = details.hospital
    ? "Specijalistički i subspecijalistički pregled"
    : "Pregled u ordinaciji";
  page.drawRectangle({
    x: margin,
    y: y - 1,
    width: 9,
    height: 9,
    color: rgb(0, 0, 0),
  });
  draw(category, margin + 17, y, 10);
  y -= 31;
  field(
    "Ime i prezime pacijenta:",
    (details.patientName || "Pacijent") +
      (data.patientBirthDate
        ? " (" + date(data.patientBirthDate + "T12:00:00Z") + ")"
        : ""),
    true,
  );
  field("Matični broj osiguranika (MBO):");
  field("Adresa pacijenta:", data.patientAddress);
  field("Telefon ili mobitel pacijenta:", data.patientPhone);
  field("Zdravstvena usluga:", details.kind || "Pregled");
  field("Šifra postupka:");
  field("Datum narudžbe:", data.bookedAt ? date(data.bookedAt) : null);
  field(
    "Datum i sat zakazanog pregleda:",
    `${new Intl.DateTimeFormat("hr-HR", { timeZone: "Europe/Zagreb", weekday: "short" }).format(new Date(details.startsAt))} ${date(details.startsAt)} ${new Intl.DateTimeFormat("hr-HR", { timeZone: "Europe/Zagreb", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(details.startsAt))}`,
    true,
  );
  field("Ambulanta / lokacija:", details.location);
  field("Liječnik:", details.doctor || details.specialist);
  field("Narudžbu evidentirao/la:", data.bookedBy);
  y -= 8;
  paragraph(
    event === "CANCELLED"
      ? "Naputak: Ovaj termin je otkazan. Za dogovor novog termina obratite se liječniku koji Vas je naručio."
      : "Naputak: Molimo doći nekoliko minuta prije zakazanog termina na navedenu lokaciju. Za pripremu za pregled, potrebnu dokumentaciju i eventualnu promjenu ili otkazivanje termina obratite se liječniku koji Vas je naručio.",
    9,
  );
  y -= 10;
  paragraph(
    "Dokument je automatski izrađen u aplikaciji e-Zdravstvo. Podaci se odnose na narudžbu; potvrda ne zamjenjuje uputnicu." +
      (details.bookingReference ? " QR kod sadrži samo broj rezervacije." : ""),
    8,
  );
  return pdf.save();
}
