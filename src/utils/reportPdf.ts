import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
export async function exportReportPdf(
  title: string,
  number: string,
  sections: { label: string; text: string }[],
) {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const response = await fetch("/fonts/NotoSans-Regular.ttf");
  if (!response.ok) throw new Error("Font nije dostupan.");
  const font = await pdf.embedFont(await response.arrayBuffer(), {
    subset: true,
  });
  let page = pdf.addPage([595.28, 841.89]),
    y = 788;
  const ink = rgb(0.12, 0.2, 0.27),
    teal = rgb(0, 0.43, 0.47);
  function draw(text: string, size: number, color = ink) {
    if (y < 72) {
      page = pdf.addPage([595.28, 841.89]);
      y = 786;
    }
    page.drawText(text, { x: 48, y, font, size, color });
    y -= size * 1.55;
  }
  function paragraph(text: string, size = 10) {
    for (const line of text.replace(/\r/g, "").split("\n")) {
      let current = "";
      for (const char of line) {
        if (font.widthOfTextAtSize(current + char, size) > 498 && current) {
          draw(current, size);
          current = char;
        } else current += char;
      }
      draw(current, size);
    }
    y -= 6;
  }
  draw("e-Zdravstvo", 22, teal);
  y -= 8;
  paragraph(title, 17);
  paragraph(number, 10);
  y -= 12;
  for (const s of sections) {
    if (y < 125) {
      page = pdf.addPage([595.28, 841.89]);
      y = 786;
    }
    draw(s.label.toLocaleUpperCase("hr-HR"), 9, teal);
    paragraph(s.text || "Nije navedeno");
    y -= 8;
  }
  for (const [i, p] of pdf.getPages().entries()) {
    p.drawLine({
      start: { x: 48, y: 51 },
      end: { x: 546, y: 51 },
      color: rgb(0.8, 0.85, 0.87),
      thickness: 0.5,
    });
    p.drawText(number + " · e-Zdravstvo", {
      x: 48,
      y: 35,
      size: 8,
      font,
      color: ink,
    });
    p.drawText(`${i + 1} / ${pdf.getPageCount()}`, {
      x: 511,
      y: 35,
      size: 8,
      font,
      color: ink,
    });
  }
  pdf.setTitle(title);
  pdf.setAuthor("e-Zdravstvo");
  const bytes = await pdf.save(),
    url = URL.createObjectURL(
      new Blob([bytes as BlobPart], { type: "application/pdf" }),
    ),
    a = document.createElement("a");
  a.href = url;
  a.download = number + ".pdf";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
