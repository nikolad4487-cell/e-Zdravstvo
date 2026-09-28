import { PDFDocument, rgb, type PDFFont } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import QRCode from "qrcode";
import type { ClinicalDocument } from "../types/documents";
import { documentStatusLabels } from "../types/documents";
import { dateLabel } from "./format";

export function savePdf(bytes: Uint8Array, name: string) {
  const url = URL.createObjectURL(
    new Blob([new Uint8Array(bytes)], { type: "application/pdf" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name + ".pdf";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

/** Render only the immutable issuer and template snapshot stored at issuance. */
export async function schoolExcusePdf(
  d: ClinicalDocument,
  verificationUrl: string,
  preview = false,
) {
  const p = d.payload,
    t = p.details,
    template = t.template,
    clinic = t.clinic;
  if (!template || !clinic)
    throw new Error("Nedostaje spremljeni predložak ispričnice.");
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  async function font(name: string) {
    const r = await fetch("/fonts/" + name + ".ttf");
    if (!r.ok) throw new Error("Font dokumenta nije dostupan.");
    return pdf.embedFont(await r.arrayBuffer(), { subset: true });
  }
  const [regular, bold, italic] = await Promise.all([
    font(
      template.font_family === "SERIF"
        ? "NotoSerif-Regular"
        : "NotoSans-Regular",
    ),
    font("NotoSerif-Bold"),
    font("NotoSerif-Italic"),
  ]);
  const hex = template.accent.slice(1),
    ink = rgb(
      parseInt(hex.slice(0, 2), 16) / 255,
      parseInt(hex.slice(2, 4), 16) / 255,
      parseInt(hex.slice(4, 6), 16) / 255,
    ),
    muted = rgb(0.36, 0.4, 0.43);
  let page = pdf.addPage([595.28, 841.89]),
    y = 776;
  const margin = 54,
    width = 487,
    size = template.font_size;
  function next() {
    page = pdf.addPage([595.28, 841.89]);
    y = 776;
  }
  function lines(text: string, f: PDFFont, s: number, w: number) {
    const result: string[] = [];
    for (const paragraph of text
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
      .split("\n")) {
      let row = "";
      for (const char of paragraph) {
        if (f.widthOfTextAtSize(row + char, s) > w && row) {
          const split = row.lastIndexOf(" ");
          if (split > row.length / 2) {
            result.push(row.slice(0, split));
            row = row.slice(split + 1) + char;
          } else {
            result.push(row);
            row = char;
          }
        } else row += char;
      }
      result.push(row);
    }
    return result;
  }
  function text(
    value: string,
    {
      f = regular,
      s = size,
      align = "left",
      x = margin,
      w = width,
      gap = 6,
    }: {
      f?: PDFFont;
      s?: number;
      align?: "left" | "center";
      x?: number;
      w?: number;
      gap?: number;
    } = {},
  ) {
    for (const row of lines(value, f, s, w)) {
      if (y < 108) next();
      page.drawText(row, {
        x: align === "center" ? x + (w - f.widthOfTextAtSize(row, s)) / 2 : x,
        y,
        font: f,
        size: s,
        color: ink,
      });
      y -= s * 1.5;
    }
    y -= gap;
  }
  text(preview ? "PREGLED PREDLOŠKA · NIJE IZDANI DOKUMENT" : "e-Zdravstvo", {
    s: 9,
    f: bold,
    align: "center",
    gap: 18,
  });
  const align = template.header_align === "CENTER" ? "center" : "left";
  text(p.institution, { f: bold, s: 11, align, gap: 0 });
  text(clinic.name, { s: 10, align, gap: 0 });
  text([clinic.address, clinic.city].filter(Boolean).join(", "), {
    s: 10,
    align,
    gap: 0,
  });
  text(p.doctor + " · šifra liječnika: " + t.doctor_code, {
    s: 10,
    align,
    gap: 0,
  });
  text("Šifra ambulante: " + clinic.code, { s: 10, align, gap: 0 });
  text(
    [clinic.phone && "Tel. " + clinic.phone, clinic.email]
      .filter(Boolean)
      .join(" · "),
    { s: 9, align, gap: 8 },
  );
  if (template.show_separator) {
    page.drawLine({
      start: { x: margin, y },
      end: { x: 541, y },
      thickness: 0.65,
      color: ink,
    });
    y -= 26;
  } else y -= 18;
  text(template.title, { f: bold, s: 16, align: "center", gap: 4 });
  text(
    template.excuse_type === "PE"
      ? "Tjelesna i zdravstvena kultura"
      : "Redovna nastava",
    { s: 10, align: "center", gap: 22 },
  );
  text(
    "Učenik " +
      p.patient.first_name +
      " " +
      p.patient.last_name +
      " (" +
      dateLabel(p.patient.birth_date) +
      ")",
    { f: bold },
  );
  text(
    template.body_text +
      " OD " +
      dateLabel(t.date_from) +
      " DO " +
      dateLabel(t.date_to) +
      ".",
    { x: 70, w: 471, gap: 14 },
  );
  if (t.category) text("Razlog izostanka: " + t.category);
  if (t.diagnosis_code) text("Šifra bolesti: " + t.diagnosis_code);
  if (t.school) text("Škola: " + t.school);
  if (t.notes) text("Napomena: " + t.notes);
  text([clinic.city, dateLabel(d.issued_at)].filter(Boolean).join(", "), {
    gap: 18,
  });
  // Keep the personal seal, visible signature and verification together.
  if (y < 345) next();
  const sealTop = y,
    sealBottom = y - 81;
  page.drawRectangle({
    x: margin,
    y: sealBottom,
    width: 218,
    height: 81,
    borderColor: ink,
    borderWidth: 1,
  });
  const sealLines = [
    p.doctor,
    "Šifra: " + t.doctor_code,
    "e-Zdravstvo · osobni pečat",
    t.signer_fingerprint ?? "",
  ];
  let sy = sealTop - 17;
  for (const [i, label] of sealLines.entries()) {
    const f = i === 0 ? bold : regular;
    const s = Math.min(
      i === 0 ? 10 : 8,
      194 / Math.max(f.widthOfTextAtSize(label, 1), 1),
    );
    page.drawText(label, {
      x: margin + 12,
      y: sy,
      font: f,
      size: s,
      color: ink,
    });
    sy -= 17;
  }
  let nameSize = Math.min(
    16,
    238 / Math.max(italic.widthOfTextAtSize(p.doctor, 1), 1),
  );
  page.drawText(p.doctor, {
    x: 303,
    y: sealTop - 28,
    font: italic,
    size: nameSize,
    color: ink,
  });
  page.drawLine({
    start: { x: 303, y: sealTop - 40 },
    end: { x: 541, y: sealTop - 40 },
    thickness: 0.5,
    color: ink,
  });
  page.drawText(
    preview
      ? "Pregled osobne oznake"
      : d.signature.status === "REVOKED"
        ? "Potpis opozvan"
        : d.signature.integrity_valid
          ? "Digitalno potpisano"
          : "Integritet nije potvrđen",
    { x: 303, y: sealTop - 54, font: regular, size: 9, color: ink },
  );
  page.drawText(
    preview
      ? "Bez elektroničkog potpisa"
      : d.signature.signature_hash.slice(0, 28),
    { x: 303, y: sealTop - 70, font: regular, size: 7, color: muted },
  );
  y = sealBottom - 26;
  if (template.footer_text) text(template.footer_text, { s: 9 });
  if (d.revocation_reason)
    text("Razlog opoziva: " + d.revocation_reason, { s: 9 });
  if (y < 240) next();
  text("Dokument je elektronički izdan putem sustava e-Zdravstvo.", {
    s: 9,
    gap: 1,
  });
  text(p.signature_disclaimer, { s: 8, gap: 10 });
  if (!preview) {
    const qr = await pdf.embedPng(
      await QRCode.toDataURL(verificationUrl, { width: 280, margin: 2 }),
    );
    page.drawImage(qr, { x: margin, y: y - 84, width: 84, height: 84 });
    const qx = margin + 96;
    page.drawText(d.number, {
      x: qx,
      y: y - 17,
      font: bold,
      size: 10,
      color: ink,
    });
    page.drawText(
      "Status pri preuzimanju: " + (documentStatusLabels[d.status] ?? d.status),
      { x: qx, y: y - 35, font: regular, size: 9, color: ink },
    );
    page.drawText("Aktualnu valjanost provjerite QR kodom.", {
      x: qx,
      y: y - 53,
      font: regular,
      size: 9,
      color: ink,
    });
  }
  for (const [index, pg] of pdf.getPages().entries()) {
    pg.drawText(preview ? "PREGLED PREDLOŠKA" : d.number, {
      x: margin,
      y: 37,
      font: regular,
      size: 8,
      color: muted,
    });
    pg.drawText(`${index + 1} / ${pdf.getPageCount()}`, {
      x: 510,
      y: 37,
      font: regular,
      size: 8,
      color: muted,
    });
  }
  pdf.setTitle(preview ? "Pregled predloška" : d.number);
  pdf.setAuthor("e-Zdravstvo");
  return pdf.save();
}
