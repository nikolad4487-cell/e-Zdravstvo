import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import QRCode from "qrcode";
import { kindLabels, documentStatusLabels } from "../types/documents";
import type { ClinicalDocument } from "../types/documents";
import { dateLabel } from "./format";

export async function downloadDocumentPdf(
  d: ClinicalDocument,
  verificationUrl: string,
) {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const response = await fetch("/fonts/NotoSans-Regular.ttf");
  if (!response.ok) throw new Error("Font dokumenta nije dostupan.");
  const font = await pdf.embedFont(await response.arrayBuffer(), {
    subset: true,
  });
  let page = pdf.addPage([595.28, 841.89]),
    y = 780;
  const ink = rgb(0.12, 0.2, 0.27),
    teal = rgb(0, 0.43, 0.47);
  function line(text: string, size = 11, color = ink) {
    const paragraphs = text.replace(/\r/g, "").split("\n");
    for (const paragraph of paragraphs) {
      let row = "";
      for (const word of paragraph.split(/\s+/)) {
        for (const part of word.match(/.{1,65}/gu) ?? [""]) {
          const next = row ? row + " " + part : part;
          if (font.widthOfTextAtSize(next, size) > 491 && row) {
            draw(row, size, color);
            row = part;
          } else row = next;
        }
      }
      draw(row, size, color);
    }
    y -= 6;
  }
  function draw(text: string, size: number, color: ReturnType<typeof rgb>) {
    if (y < 90) {
      page = pdf.addPage([595.28, 841.89]);
      y = 780;
    }
    page.drawText(text, { x: 52, y, size, font, color });
    y -= size * 1.5;
  }
  line("e-Zdravstvo", 24, teal);
  line("Integrirani digitalni zdravstveni sustav", 9);
  y -= 15;
  line(kindLabels[d.kind].toLocaleUpperCase("hr-HR"), 20, teal);
  line(d.number, 11);
  line("Status: " + (documentStatusLabels[d.status] ?? d.status));
  y -= 10;
  const p = d.payload,
    t = p.details;
  line("Pacijent: " + p.patient.first_name + " " + p.patient.last_name, 13);
  line(
    "Datum rođenja: " +
      dateLabel(p.patient.birth_date) +
      "  |  ID: " +
      p.patient.patient_number,
  );
  line("Liječnik: " + p.doctor);
  line("Ustanova: " + p.institution);
  if (p.institution_address) line(p.institution_address);
  line(
    "Izdano: " +
      dateLabel(d.issued_at) +
      "  |  Vrijedi do: " +
      dateLabel(d.expires_on),
  );
  y -= 12;
  if (d.kind === "SCHOOL_EXCUSE") {
    line("Razdoblje opravdanog izostanka", 13, teal);
    line(dateLabel(t.date_from) + " - " + dateLabel(t.date_to), 16);
    if (t.school) line("Škola: " + t.school);
    if (t.category) line("Kategorija: " + t.category);
  }
  if (d.kind === "REFERRAL") {
    line("Specijalnost: " + t.specialty, 13, teal);
    line("Prioritet: " + (t.priority === "URGENT" ? "Hitno" : "Redovno"));
    line("Razlog upućivanja: " + t.reason);
    if (t.diagnosis) line("Dijagnoza: " + t.diagnosis);
  }
  for (const item of t.items ?? []) {
    line(item.name + " · " + item.strength, 13, teal);
    line("Doziranje: " + item.dosage);
    line("Primjena: " + item.route + "  |  Trajanje: " + item.duration);
    line("Količina: " + item.quantity + "  |  " + item.packaging);
    if (item.notes) line(item.notes);
  }
  if (t.notes) line("Napomena: " + t.notes);
  if (d.revocation_reason) line("Razlog opoziva: " + d.revocation_reason);
  if (y < 280) {
    page = pdf.addPage([595.28, 841.89]);
    y = 780;
  }
  y -= 15;
  line(
    d.signature.status === "REVOKED"
      ? "Potpis opozvan"
      : d.signature.integrity_valid
        ? "Digitalno potpisano"
        : "Integritet nije potvrđen",
    13,
    teal,
  );
  line("Dokument je elektronički izdan putem sustava e-Zdravstvo.", 10);
  line(
    "Razvojni digitalni potpis - nije kvalificirani elektronički potpis.",
    9,
  );
  line("SHA-256 sadržaja: " + d.signature.signature_hash, 8);
  const qr = await pdf.embedPng(
    await QRCode.toDataURL(verificationUrl, { width: 280, margin: 2 }),
  );
  page.drawImage(qr, { x: 48, y: y - 100, width: 100, height: 100 });
  page.drawText("Provjera autentičnosti putem QR koda", {
    x: 160,
    y: y - 35,
    font,
    size: 10,
    color: ink,
  });
  page.drawText("Aktualni status provjerite prije uporabe dokumenta.", {
    x: 160,
    y: y - 53,
    font,
    size: 9,
    color: ink,
  });
  pdf.getPages().forEach((p, i) => {
    p.drawText(
      "Demonstracijski sustav. Nije povezan sa službenim zdravstvenim sustavima RH.",
      { x: 52, y: 43, font, size: 8, color: ink },
    );
    p.drawText(`${i + 1} / ${pdf.getPageCount()}`, {
      x: 510,
      y: 27,
      font,
      size: 8,
      color: ink,
    });
  });
  const bytes = await pdf.save();
  const url = URL.createObjectURL(
    new Blob([new Uint8Array(bytes)], { type: "application/pdf" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = d.number + ".pdf";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
