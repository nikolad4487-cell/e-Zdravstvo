import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import QRCode from "qrcode";
import { BOOKING_FONT_BASE64 } from "../../supabase/functions/notifications-dispatch/fonts/booking-font";
import type {
  LaboratorySample,
  SampleOrder,
} from "../services/laboratorySamples";
export async function sampleLabelPdf(
  sample: LaboratorySample,
  order: SampleOrder,
) {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(
    Uint8Array.from(atob(BOOKING_FONT_BASE64), (c) => c.charCodeAt(0)),
  );
  const page = doc.addPage([255.12, 141.73]);
  const clean = (value: string) =>
    [...value.replace(/[\r\n\t]/g, " ")]
      .filter((c) => font.getCharacterSet().includes(c.codePointAt(0)!))
      .join("");
  function text(
    value: string,
    x: number,
    y: number,
    width: number,
    size: number,
  ) {
    let line = clean(value);
    while (font.widthOfTextAtSize(line, size) > width && line.length)
      line = line.slice(0, -1);
    page.drawText(line, { x, y, size, font, color: rgb(0, 0, 0) });
  }
  text("e-Zdravstvo · uzorak", 9, 125, 165, 9);
  text(sample.code, 9, 109, 235, 10);
  text(order.patient_name, 9, 88, 160, 10);
  text(order.patient_number, 9, 73, 160, 9);
  text(order.number, 9, 58, 160, 8);
  text(sample.specimen_code + " · " + sample.specimen_name, 9, 42, 160, 8);
  text("Uzorkovanje: " + sample.collection_round, 9, 25, 160, 8);
  const png = await doc.embedPng(
    await QRCode.toDataURL(sample.code, {
      margin: 2,
      errorCorrectionLevel: "M",
      width: 300,
    }),
  );
  page.drawImage(png, { x: 178, y: 28, width: 69, height: 69 });
  return doc.save();
}
