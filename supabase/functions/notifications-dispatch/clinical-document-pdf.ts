import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import QRCode from "qrcode";
import { referralTypeLabels } from "./document-layout-model.ts";
import type { DocumentEmailDetails } from "./document-pdf.ts";
import { BOOKING_FONT_BASE64 } from "./fonts/booking-font.ts";
import { schoolExcuseDocumentPdf } from "./school-excuse-pdf.ts";

/** Shared browser / server layout. All content comes from an authorized document snapshot. */
export async function clinicalDocumentPdf(
  d: DocumentEmailDetails,
  verificationUrl?: string,
) {
  if (d.kind === "SCHOOL_EXCUSE" && d.layout?.schoolDocument)
    return schoolExcuseDocumentPdf(
      d.layout.schoolDocument,
      verificationUrl ?? d.number,
    );
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(
    Uint8Array.from(atob(BOOKING_FONT_BASE64), (c) => c.charCodeAt(0)),
  );
  const supported = new Set(font.getCharacterSet());
  const clean = (s: string) =>
    Array.from(s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ""))
      .map((c) =>
        c === "\n" || c === "\r" || supported.has(c.codePointAt(0)!) ? c : "?",
      )
      .join("");
  const ink = rgb(0.12, 0.16, 0.21),
    blue = rgb(0.1, 0.27, 0.46),
    muted = rgb(0.42, 0.51, 0.63),
    pale = rgb(0.95, 0.97, 0.99),
    rule = rgb(0.78, 0.84, 0.9);
  const advances = new Map<string, number>();
  const width = (s: string, size: number) =>
    Array.from(s).reduce((sum, c) => {
      if (!advances.has(c)) advances.set(c, font.widthOfTextAtSize(c, 1));
      return sum + advances.get(c)! * size;
    }, 0);
  const wrap = (text: string, max: number, size: number) => {
    const rows: string[] = [];
    for (const paragraph of clean(text || "Nije navedeno")
      .replace(/\r/g, "")
      .split("\n")) {
      let row = "";
      for (const word of paragraph.split(/\s+/)) {
        if (row && width(row + " " + word, size) > max) {
          rows.push(row);
          row = "";
        }
        for (const c of (row ? " " : "") + word) {
          if (row && width(row + c, size) > max) {
            rows.push(row);
            row = "";
          }
          row += c;
        }
      }
      rows.push(row);
    }
    return rows;
  };
  let page = pdf.addPage([595.28, 841.89]),
    y = 789;
  const draw = (
    s: string,
    x: number,
    baseline: number,
    size = 10,
    color = ink,
    bold = false,
  ) => {
    page.drawText(clean(s), { x, y: baseline, size, font, color });
    if (bold)
      page.drawText(clean(s), { x: x + 0.25, y: baseline, size, font, color });
  };
  const line = (baseline: number) =>
    page.drawLine({
      start: { x: 48, y: baseline },
      end: { x: 547, y: baseline },
      thickness: 0.6,
      color: rule,
    });
  const next = () => {
    page = pdf.addPage([595.28, 841.89]);
    y = 789;
    draw(d.title + " · nastavak", 48, y, 11, blue, true);
    y -= 22;
    line(y);
    y -= 22;
  };
  const ensure = (height: number) => {
    if (y - height < 77) next();
  };
  const paragraph = (
    s: string,
    size = 10,
    color = ink,
    x = 48,
    max = 499,
    bold = false,
  ) => {
    for (const row of wrap(s, max, size)) {
      ensure(size * 1.5);
      draw(row, x, y, size, color, bold);
      y -= size * 1.5;
    }
    y -= 7;
  };
  const band = (label: string) => {
    ensure(49);
    page.drawRectangle({
      x: 48,
      y: y - 6,
      width: 499,
      height: 22,
      color: pale,
    });
    draw(label.toLocaleUpperCase("hr-HR"), 58, y, 9, blue, true);
    y -= 29;
  };
  const field = (label: string, value: string) => {
    const labels = wrap(label.toLocaleUpperCase("hr-HR"), 110, 8),
      values = wrap(value, 365, 10);
    let i = 0;
    while (i < Math.max(labels.length, values.length)) {
      ensure(16);
      if (labels[i]) draw(labels[i], 48, y, 8, muted, true);
      if (values[i]) draw(values[i], 180, y, 10, blue);
      y -= 16;
      i++;
    }
    y -= 8;
  };
  const sections = d.sections;
  const get = (...labels: string[]) =>
    sections.find((s) => labels.includes(s.label))?.text ?? "";
  if (d.kind === "REFERRAL") {
    paragraph(
      "Uputnica propisana " +
        new Intl.DateTimeFormat("hr-HR", { timeZone: "Europe/Zagreb" }).format(
          new Date(d.issuedAt),
        ),
      9,
      blue,
    );
    paragraph(
      get("Vrsta / specijalnost").split(" / ").slice(1).join(" / ") || d.title,
      17,
      ink,
      48,
      499,
      true,
    );
    line(y);
    y -= 28;
    band("Detalji uputnice");
    for (const s of sections) {
      if (s.label === "Razlog upućivanja") band("Razlog upućivanja");
      if (s.label === "Dijagnoza") band("Dijagnoze");
      if (s.label === "Vrsta / specijalnost") {
        const [type, ...specialty] = s.text.split(" / ");
        field("Vrsta pregleda", referralTypeLabels[type] ?? type);
        field("Upućuje se specijalistu", specialty.join(" / "));
      } else field(s.label, s.text);
    }
    field("ID uputnice", d.number);
    if (d.layout?.status) field("Status", d.layout.status);
  } else {
    paragraph(
      get("Izdavatelj", "Laboratorij") || "e-Zdravstvo",
      12,
      ink,
      48,
      499,
      true,
    );
    line(y);
    y -= 29;
    paragraph(d.title.toLocaleUpperCase("hr-HR"), 19, blue, 48, 499, true);
    paragraph("Broj dokumenta: " + d.number, 9, muted);
    const metadata =
      d.kind === "LAB_RESULT"
        ? ["Pacijent", "Autor", "Uzorkovanje / objava", "Uzorkovanje i objava"]
        : ["Pacijent", "Datum / verzija", "Datum i verzija"];
    for (const s of sections.filter((s) => metadata.includes(s.label)))
      field(s.label, s.text);
    if (d.kind === "LAB_RESULT" && d.layout?.laboratoryRows) {
      const columns = [
        { x: 54, w: 206, title: "Pretraga" },
        { x: 268, w: 72, title: "Rezultat" },
        { x: 348, w: 65, title: "Jedinica" },
        { x: 421, w: 120, title: "Referentni interval" },
      ];
      const header = () => {
        ensure(35);
        page.drawRectangle({
          x: 48,
          y: y - 8,
          width: 499,
          height: 25,
          color: pale,
        });
        for (const c of columns) draw(c.title, c.x, y, 8, blue, true);
        y -= 31;
      };
      header();
      for (const row of d.layout.laboratoryRows) {
        const flag =
          row.flag === "HIGH"
            ? "H"
            : row.flag === "LOW"
              ? "L"
              : row.flag === "CRITICAL"
                ? "KRITIČNO"
                : "";
        const cells = [
          row.name + "\n" + row.code,
          row.value + (flag ? "\n" + flag : ""),
          row.unit || "—",
          (row.referenceLow ?? "—") + " – " + (row.referenceHigh ?? "—"),
        ];
        const lines = cells.map((s, i) => wrap(s, columns[i].w, 9));
        const count = Math.max(...lines.map((l) => l.length));
        // Split exceptionally long rows safely; repeat headings on every page.
        for (let i = 0; i < count; i++) {
          if (y - 14 < 77) {
            next();
            header();
          }
          for (let c = 0; c < 4; c++)
            if (lines[c][i])
              draw(
                lines[c][i],
                columns[c].x,
                y,
                9,
                c === 1 && flag ? blue : ink,
                c === 1 && !!flag,
              );
          y -= 14;
        }
        y -= 4;
        line(y);
        y -= 15;
      }
      paragraph(
        "H: povišeno · L: sniženo · KRITIČNO: kritična vrijednost",
        8,
        muted,
      );
      for (const s of sections.filter((s) =>
        ["Komentar", "Razlog ispravka"].includes(s.label),
      )) {
        band(s.label);
        paragraph(s.text);
      }
    } else {
      for (const s of sections.filter(
        (s) =>
          !metadata.includes(s.label) &&
          !["Izdavatelj", "Laboratorij"].includes(s.label),
      )) {
        band(s.label);
        paragraph(s.text);
      }
    }
  }
  if (verificationUrl) {
    ensure(105);
    const qr = await pdf.embedPng(
      await QRCode.toDataURL(verificationUrl, { width: 220, margin: 1 }),
    );
    page.drawImage(qr, { x: 48, y: y - 80, width: 80, height: 80 });
    draw("Provjera autentičnosti putem QR koda", 143, y - 24, 9, muted);
    draw(
      "Aktualni status provjerite prije uporabe dokumenta.",
      143,
      y - 42,
      8,
      muted,
    );
  }
  for (const [i, p] of pdf.getPages().entries()) {
    p.drawLine({
      start: { x: 48, y: 54 },
      end: { x: 547, y: 54 },
      color: rule,
      thickness: 0.5,
    });
    p.drawText(d.number + " · e-Zdravstvo", {
      x: 48,
      y: 37,
      font,
      size: 8,
      color: muted,
    });
    p.drawText(`${i + 1} / ${pdf.getPageCount()}`, {
      x: 511,
      y: 37,
      font,
      size: 8,
      color: muted,
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
