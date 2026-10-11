import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import QRCode from "qrcode";
import { referralTypeLabels } from "./document-layout-model.ts";
import type { DocumentEmailDetails } from "./document-pdf.ts";
import { BOOKING_FONT_BASE64 } from "./fonts/booking-font.ts";
import { NOTOSERIF_BOLD_BASE64 } from "./fonts/NotoSerif-Bold.ts";
import { schoolExcuseDocumentPdf } from "./school-excuse-pdf.ts";

/** Reference layouts shared by authorized browser downloads and immutable mail snapshots. */
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
  const serif =
    d.kind === "MEDICAL_REPORT"
      ? await pdf.embedFont(
          Uint8Array.from(atob(NOTOSERIF_BOLD_BASE64), (c) => c.charCodeAt(0)),
        )
      : font;
  const chars = new Set(font.getCharacterSet());
  const clean = (s: string) =>
    Array.from(s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ""))
      .map((c) =>
        c === "\n" || c === "\r" || chars.has(c.codePointAt(0)!) ? c : "?",
      )
      .join("");
  const black = rgb(0, 0, 0),
    blue = rgb(0.13, 0.28, 0.47),
    lightBlue = rgb(0.59, 0.69, 0.81),
    pale = rgb(0.965, 0.976, 0.987),
    grey = rgb(0.45, 0.45, 0.45);
  const isRef = d.kind === "REFERRAL",
    isLab = d.kind === "LAB_RESULT";
  const left = isLab ? 24 : 54,
    right = isLab ? 571 : 541,
    content = right - left,
    bottom = 66;
  let page = pdf.addPage([595.28, 841.89]),
    y = isLab ? 811 : 756;
  const advances = new Map<string, number>();
  const width = (text: string, size: number) =>
    Array.from(text).reduce((sum, c) => {
      if (!advances.has(c)) advances.set(c, font.widthOfTextAtSize(c, 1));
      return sum + advances.get(c)! * size;
    }, 0);
  const wrap = (text: string, w: number, size: number) => {
    const result: string[] = [];
    for (const p of clean(text).replace(/\r/g, "").split("\n")) {
      let row = "",
        rw = 0;
      for (const word of p.split(/\s+/)) {
        if (row && rw + width(" " + word, size) > w) {
          result.push(row);
          row = "";
          rw = 0;
        }
        for (const c of (row ? " " : "") + word) {
          const cw = width(c, size);
          if (row && rw + cw > w) {
            result.push(row);
            row = "";
            rw = 0;
          }
          row += c;
          rw += cw;
        }
      }
      result.push(row);
    }
    return result;
  };
  const draw = (
    s: string,
    x: number,
    at: number,
    size = 9,
    color = black,
    bold = false,
    center = false,
    useSerif = false,
  ) => {
    const text = clean(s),
      f = useSerif ? serif : font;
    const xx = center ? x - f.widthOfTextAtSize(text, size) / 2 : x;
    page.drawText(text, { x: xx, y: at, size, font: f, color });
    if (bold && !useSerif)
      page.drawText(text, { x: xx + 0.28, y: at, size, font: f, color });
  };
  const rule = (at: number, color = black, thickness = 0.45) =>
    page.drawLine({
      start: { x: left, y: at },
      end: { x: right, y: at },
      color,
      thickness,
    });
  const next = () => {
    page = pdf.addPage([595.28, 841.89]);
    y = 798;
    draw(d.title + " · nastavak", left, y, 8, isRef ? blue : black);
    draw(d.number, right - width(d.number, 7), y, 7, grey, false);
    y -= 18;
    rule(y, isRef ? lightBlue : grey);
    y -= 20;
  };
  const ensure = (height: number) => {
    if (y - height < bottom) next();
  };
  const text = (
    s: string,
    size = 9,
    color = black,
    x = left,
    w = content,
    bold = false,
    leading = size * 1.25,
    gap = 5,
  ) => {
    for (const row of wrap(s || "—", w, size)) {
      ensure(leading);
      draw(row, x, y, size, color, bold);
      y -= leading;
    }
    y -= gap;
  };
  const centered = (
    s: string,
    size: number,
    bold = false,
    useSerif = false,
  ) => {
    for (const row of wrap(s, content, size)) {
      ensure(size * 1.5);
      draw(row, (left + right) / 2, y, size, black, bold, true, useSerif);
      y -= size * 1.5;
    }
  };
  const get = (...labels: string[]) =>
    d.sections.find((s) => labels.includes(s.label))?.text ?? "";
  const consumed = new Set<string>();
  const take = (...labels: string[]) => {
    labels.forEach((l) => consumed.add(l));
    return get(...labels);
  };
  const label = (s: string) => {
    ensure(32);
    text(s, 9, black, left, content, true, 12, 3);
  };
  const field = (name: string, value: string) => {
    const labels = wrap(name.toLocaleUpperCase("hr-HR"), 78, 6.7),
      values = wrap(value || "—", right - (left + 97), 9.4);
    for (let i = 0; i < Math.max(labels.length, values.length); i++) {
      ensure(14);
      if (labels[i]) draw(labels[i], left, y, 6.7, lightBlue, true);
      if (values[i]) draw(values[i], left + 97, y, 9.4, blue);
      y -= 14;
    }
    y -= 7;
  };
  const band = (name: string) => {
    ensure(37);
    page.drawRectangle({
      x: left,
      y: y - 6,
      width: content,
      height: 21,
      color: pale,
    });
    draw("-", left + 3, y, 8, blue, true);
    draw(name.toLocaleUpperCase("hr-HR"), left + 97, y, 8, blue, true);
    y -= 29;
  };
  if (isRef) {
    y = 790;
    text(
      "Uputnica propisana " +
        new Intl.DateTimeFormat("hr-HR", {
          timeZone: "Europe/Zagreb",
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
        }).format(new Date(d.issuedAt)),
      8,
      rgb(0.19, 0.5, 0.89),
      left,
      content,
      false,
      12,
      1,
    );
    const [type, ...specialty] = take("Vrsta / specijalnost").split(" / ");
    text(
      specialty.join(" / ") || d.title,
      12,
      black,
      left,
      content,
      true,
      16,
      10,
    );
    rule(y, lightBlue, 0.6);
    y -= 27;
    draw("D E T A L J I  U P U T N I C E", left + 97, y, 7.3, blue, true);
    y -= 28;
    field("Vrsta pregleda", referralTypeLabels[type] ?? type);
    const [prescriber, facility, ...address] = take(
      "Liječnik / ustanova",
    ).split("\n");
    field(
      "Propisao",
      [facility, prescriber, ...address].filter(Boolean).join("\n"),
    );
    field("Upućuje se specijalistu", specialty.join(" / "));
    band("Postupci");
    field("-", referralTypeLabels[type] ?? type);
    field("Razlog upućivanja", take("Razlog upućivanja"));
    band("Dijagnoze");
    field("Dijagnoza", take("Dijagnoza"));
    const notes = take("Napomena");
    if (notes) field("Napomena", notes);
    field("ID uputnice", d.number);
    // Identification follows the same compact label/value rhythm; no invented HZZO codes.
    field("Pacijent", take("Pacijent"));
    field("Rođen / broj pacijenta", take("Datum rođenja / broj pacijenta"));
    field("Prioritet", take("Prioritet"));
    field("Izdano / vrijedi do", take("Izdano / vrijedi do"));
    if (d.layout?.status) field("Status", d.layout.status);
    for (const s of d.sections.filter(
      (s) =>
        !consumed.has(s.label) &&
        !["Elektronički potpis", "Oznaka potpisa"].includes(s.label),
    ))
      field(s.label, s.text);
    const disclaimer = get("Elektronički potpis"),
      signature = get("Oznaka potpisa");
    if (disclaimer) {
      ensure(40);
      text(disclaimer, 7, grey, left, content, false, 10, 4);
    }
    if (signature) text(signature, 6.5, grey, left, content, false, 9, 6);
    if (verificationUrl) {
      ensure(52);
      const qr = await pdf.embedPng(
        await QRCode.toDataURL(verificationUrl, { width: 140, margin: 1 }),
      );
      page.drawImage(qr, { x: left, y: y - 42, width: 42, height: 42 });
      draw("Provjera autentičnosti dokumenta", left + 53, y - 14, 7, grey);
      draw(
        "Aktualnu valjanost provjerite QR kodom.",
        left + 53,
        y - 26,
        7,
        grey,
      );
      y -= 48;
    }
  } else if (isLab) {
    const facility = take("Laboratorij") || "e-Zdravstvo";
    const headLines = wrap(
      facility.toLocaleUpperCase("hr-HR"),
      content - 24,
      11,
    );
    const hh = headLines.length * 15 + 30;
    // Rounded facility header, like the supplied laboratory document.
    page.drawSvgPath(
      `M ${left + 10} 0 L ${right - 10} 0 Q ${right} 0 ${right} 10 L ${right} ${hh - 10} Q ${right} ${hh} ${right - 10} ${hh} L ${left + 10} ${hh} Q ${left} ${hh} ${left} ${hh - 10} L ${left} 10 Q ${left} 0 ${left + 10} 0 Z`,
      { x: 0, y: y + 5, borderWidth: 0.7, borderColor: black },
    );
    for (const row of headLines) {
      draw(row, (left + right) / 2, y - 11, 11, black, false, true);
      y -= 15;
    }
    draw(
      "LABORATORIJSKI NALAZ",
      (left + right) / 2,
      y - 10,
      9,
      black,
      false,
      true,
    );
    y -= 35;
    const patient = take("Pacijent"),
      split = patient.split(/ \/ | · /),
      patientName = split[0],
      patientNumber = split.slice(1).join(" / ");
    const dates = take("Uzorkovanje / objava", "Uzorkovanje i objava").split(
      " / ",
    );
    // Two metadata columns and a protocol box keep the clinical table near the top.
    const at = y;
    const meta = (s: string, x: number, w: number) => {
      const rows = wrap(s, w, 8);
      for (const row of rows) {
        ensure(11);
        draw(row, x, y, 8);
        y -= 11;
      }
      return rows.length;
    };
    meta(
      "Ime i prezime:  " + patientName.toLocaleUpperCase("hr-HR"),
      left + 3,
      content * 0.54,
    );
    meta(
      "Broj pacijenta:  " + (patientNumber || "—"),
      left + 3,
      content * 0.54,
    );
    const leftEnd = y;
    y = at;
    meta(
      "Vrijeme uzorkovanja:  " + (dates[0] || "—"),
      left + content * 0.56,
      content * 0.44 - 3,
    );
    meta(
      "Vrijeme izdavanja:  " + (dates.slice(1).join(" / ") || "—"),
      left + content * 0.56,
      content * 0.44 - 3,
    );
    y = Math.min(y, leftEnd) - 7;
    draw("Broj nalaza", left + 3, y, 7);
    y -= 15;
    page.drawRectangle({
      x: left + 3,
      y: y - 5,
      width: 192,
      height: 19,
      borderColor: black,
      borderWidth: 0.45,
    });
    draw(d.number, left + 99, y + 1, 8, black, false, true);
    y -= 28;
    if (dates.join(" / ").includes("ZAMIJENJENO"))
      text("ZAMIJENJENO NOVIJOM VERZIJOM", 8, black, left, content, true);
    text("LABORATORIJSKE PRETRAGE", 9, black, left, content, false, 12, 7);
    const columns = [
      { x: left + 12, w: 45, title: "Šifra" },
      { x: left + 57, w: 182, title: "Pretraga" },
      { x: left + 239, w: 95, title: "Rezultat" },
      { x: left + 334, w: 72, title: "Jedinica" },
      { x: left + 406, w: content - 418, title: "Referentni interval" },
    ];
    const header = () => {
      ensure(32);
      for (const c of columns) {
        page.drawRectangle({
          x: c.x,
          y: y - 5,
          width: c.w,
          height: 17,
          borderColor: black,
          borderWidth: 0.45,
        });
        draw(c.title, c.x + c.w / 2, y, 7.6, black, c.title === "Šifra", true);
      }
      y -= 22;
    };
    const decimal = (s: string) =>
      /^[+-]?\d+(\.\d+)?$/.test(s) ? s.replace(".", ",") : s;
    const rows = d.layout?.laboratoryRows ?? [];
    header();
    for (const row of rows) {
      const interval =
        row.referenceLow === null
          ? row.referenceHigh === null
            ? "—"
            : "do " + decimal(row.referenceHigh)
          : row.referenceHigh === null
            ? "od " + decimal(row.referenceLow)
            : decimal(row.referenceLow) + " do " + decimal(row.referenceHigh);
      const flag =
        row.flag === "HIGH"
          ? "H"
          : row.flag === "LOW"
            ? "L"
            : row.flag === "CRITICAL"
              ? "!"
              : "";
      const cells = [
        row.code,
        row.name,
        decimal(row.value),
        row.unit || "—",
        interval,
      ];
      const lines = cells.map((s, i) => wrap(s, columns[i].w - 8, 8.3));
      const count = Math.max(...lines.map((l) => l.length));
      // Keep normal rows together; exceptionally long names may span pages.
      if (y - Math.min(count * 11, 180) < bottom) {
        next();
        header();
      }
      for (let i = 0; i < count; i++) {
        if (y - 11 < bottom) {
          next();
          header();
        }
        for (let c = 0; c < 5; c++)
          if (lines[c][i])
            draw(
              lines[c][i],
              c === 2 ? columns[c].x + columns[c].w / 2 - 6 : columns[c].x + 4,
              y,
              8.3,
              black,
              false,
              c === 2,
            );
        if (i === 0 && flag)
          draw(flag, columns[2].x + columns[2].w - 13, y, 8.3, black, true);
        y -= 11;
      }
      y -= 2;
    }
    rule(y);
    y -= 17;
    text(
      "H: povišeno   L: sniženo   !: kritična vrijednost",
      7,
      black,
      left + 12,
      content - 24,
      false,
      10,
      7,
    );
    const author = take("Autor");
    if (author)
      text(
        "Nalaz izradio:  " + author,
        7,
        black,
        left + 12,
        content - 24,
        false,
        10,
        9,
      );
    for (const s of d.sections.filter((s) =>
      ["Komentar", "Razlog ispravka"].includes(s.label),
    )) {
      label(s.label);
      text(s.text, 8.3);
      consumed.add(s.label);
    }
    // Older snapshots lacking structured rows still retain their full clinical content.
    if (!d.layout?.laboratoryRows)
      for (const s of d.sections.filter((s) => !consumed.has(s.label))) {
        label(s.label);
        text(s.text, 8.3);
      }
  } else {
    const issuer = take("Izdavatelj").split("\n"),
      institution = issuer[0] || "e-Zdravstvo",
      doctor = issuer[1] || "",
      specialty = issuer.slice(2).join(" · ");
    centered(institution.toLocaleUpperCase("hr-HR"), 9, true, true);
    if (specialty) centered(specialty.toLocaleUpperCase("hr-HR"), 8, true);
    y -= 15;
    rule(y, grey, 0.6);
    y -= 22;
    centered(
      d.title === "Otpusno pismo" ? "O T P U S N O  P I S M O" : "N A L A Z",
      11,
      true,
    );
    y -= 5;
    centered("Protokol broj: " + d.number, 8);
    y -= 7;
    const patient = take("Pacijent").split(/ \/ | · /);
    text(
      patient[0].toLocaleUpperCase("hr-HR"),
      10,
      black,
      left,
      content,
      true,
      13,
      2,
    );
    if (patient.length > 1)
      text(
        "Broj pacijenta: " + patient.slice(1).join(" / "),
        8,
        black,
        left,
        content,
        false,
        11,
        2,
      );
    text(
      "Datum nalaza / verzija: " + take("Datum / verzija", "Datum i verzija"),
      8,
      black,
      left,
      content,
      false,
      11,
      5,
    );
    rule(y, grey, 0.6);
    y -= 17;
    const ordered = [
      { names: ["Nalaz"], title: "Nalazi" },
      { names: ["Dijagnoze", "Dijagnoza"], title: "Dijagnoza" },
      { names: ["Zaključak"], title: "Mišljenje" },
      { names: ["Preporuke"], title: "Preporuke" },
      { names: ["Razlog ispravka"], title: "Razlog ispravka" },
    ];
    for (const block of ordered) {
      const value = take(...block.names);
      if (value) {
        label(block.title);
        text(value, 9.2, black, left, content, false, 11.6, 7);
      }
    }
    for (const s of d.sections.filter((s) => !consumed.has(s.label))) {
      label(s.label);
      text(s.text, 9.2);
    }
    if (doctor) {
      ensure(65);
      y -= 12;
      for (const s of [
        "Liječnik:",
        doctor,
        ...(specialty ? [specialty] : []),
      ]) {
        const size = s === doctor ? 9 : 7;
        for (const row of wrap(s, 235, size)) {
          draw(row, right - width(row, size), y, size, black, s === doctor);
          y -= 12;
        }
      }
    }
  }
  for (const [i, p] of pdf.getPages().entries()) {
    const labFooter = isLab
      ? "Nalaz je elektronički izdan putem sustava e-Zdravstvo."
      : "";
    if (labFooter)
      p.drawText(labFooter, {
        x: (595.28 - width(labFooter, 8)) / 2,
        y: 40,
        font,
        size: 8,
        color: black,
      });
    p.drawLine({
      start: { x: left, y: isLab ? 32 : 44 },
      end: { x: right, y: isLab ? 32 : 44 },
      color: isRef ? lightBlue : grey,
      thickness: 0.4,
    });
    p.drawText(d.number + " · e-Zdravstvo", {
      x: left,
      y: isLab ? 21 : 29,
      font,
      size: 6.5,
      color: isRef ? blue : grey,
    });
    p.drawText(`Stranica ${i + 1} / ${pdf.getPageCount()}`, {
      x: right - 67,
      y: isLab ? 21 : 29,
      font,
      size: 7,
      color: black,
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
