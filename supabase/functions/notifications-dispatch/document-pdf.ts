import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { BOOKING_FONT_BASE64 } from "./fonts/booking-font.ts";
import { clinicalDocumentPdf } from "./clinical-document-pdf.ts";
import type { DocumentPrintLayout } from "./document-layout-model.ts";
export interface DocumentEmailDetails {
  kind: "REFERRAL" | "SCHOOL_EXCUSE" | "MEDICAL_REPORT" | "LAB_RESULT";
  number: string;
  title: string;
  issuedAt: string;
  sections: { label: string; text: string }[];
  layoutVersion?: 2;
  layout?: DocumentPrintLayout;
}
/** Receives an immutable, server-generated snapshot of the issued document. */
export async function documentPdf(
  d: DocumentEmailDetails,
  verificationUrl?: string,
) {
  if (
    !["REFERRAL", "SCHOOL_EXCUSE", "MEDICAL_REPORT", "LAB_RESULT"].includes(
      d.kind,
    ) ||
    !/^EZ-[A-Z]+-\d{4}-\d+(?:-v\d+)?$/.test(d.number) ||
    !Number.isFinite(Date.parse(d.issuedAt)) ||
    !Array.isArray(d.sections) ||
    d.sections.length > 150 ||
    d.sections.some(
      (s) =>
        typeof s.text !== "string" ||
        s.text.length > 30000 ||
        typeof s.label !== "string" ||
        s.label.length > 300,
    )
  )
    throw new Error("Invalid document snapshot");
  if (d.layoutVersion === 2) return clinicalDocumentPdf(d, verificationUrl);
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(
    Uint8Array.from(atob(BOOKING_FONT_BASE64), (c) => c.charCodeAt(0)),
  );
  const supported = new Set(font.getCharacterSet());
  const clean = (s: string) =>
    Array.from(s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ""))
      .map((c) => (supported.has(c.codePointAt(0)!) ? c : "?"))
      .join("");
  let page = pdf.addPage([595.28, 841.89]),
    y = 785;
  const ink = rgb(0.12, 0.2, 0.27),
    teal = rgb(0, 0.43, 0.47);
  const draw = (text: string, size: number, color = ink) => {
    if (y < 75) {
      page = pdf.addPage([595.28, 841.89]);
      y = 785;
    }
    page.drawText(text, { x: 48, y, size, font, color });
    y -= size * 1.5;
  };
  // Cache glyph advances: measuring each growing line repeatedly is expensive
  // for long reports on the Edge runtime. Summed advances also bound line width.
  const advances = new Map<string, number>();
  const advance = (c: string) => {
    if (!advances.has(c)) advances.set(c, font.widthOfTextAtSize(c, 1));
    return advances.get(c)!;
  };
  const paragraph = (text: string, size = 10, color = ink) => {
    for (const line of clean(text).replace(/\r/g, "").split("\n")) {
      let row = "",
        rowWidth = 0;
      for (const c of line) {
        const characterWidth = advance(c) * size;
        if (row && rowWidth + characterWidth > 498) {
          draw(row, size, color);
          row = c;
          rowWidth = characterWidth;
        } else {
          row += c;
          rowWidth += characterWidth;
        }
      }
      draw(row, size, color);
    }
    y -= 7;
  };
  paragraph("e-Zdravstvo", 22, teal);
  paragraph(d.title, 17, teal);
  paragraph(d.number);
  for (const section of d.sections) {
    paragraph(section.label, 10, teal);
    paragraph(section.text || "Nije navedeno");
    y -= 5;
  }
  for (const [i, p] of pdf.getPages().entries()) {
    p.drawText(d.number + " · e-Zdravstvo", {
      x: 48,
      y: 35,
      size: 8,
      font,
      color: ink,
    });
    p.drawText(`${i + 1} / ${pdf.getPageCount()}`, {
      x: 510,
      y: 35,
      size: 8,
      font,
      color: ink,
    });
  }
  pdf.setTitle(d.title);
  pdf.setAuthor("e-Zdravstvo");
  pdf.setCreator("e-Zdravstvo");
  pdf.setProducer("e-Zdravstvo");
  pdf.setCreationDate(new Date(d.issuedAt));
  pdf.setModificationDate(new Date(d.issuedAt));
  return pdf.save();
}
