import { describe, it, expect, vi } from "vitest";
import QRCode from "qrcode";
import { PDFDocument } from "pdf-lib";
import { sampleLabelPdf } from "./sampleLabelPdf";
describe("sample label PDF", () => {
  it("prints a 90 × 50 mm label and encodes only the sample code", async () => {
    const qr = vi.spyOn(QRCode, "toDataURL");
    try {
      const bytes = await sampleLabelPdf(
        {
          id: "sample-1",
          code: "EZ-UZ-2026-00000001",
          specimen_code: "00",
          specimen_name: "Kapilarna krv",
          collection_round: 1,
          status: "REGISTERED",
          reason: "",
          version: 1,
          replaced: false,
          created_at: "2026-10-28T08:00:00Z",
          history: [],
        },
        {
          number: "EZ-LAB-TEST",
          patient_name: "Izmišljena Osoba",
          patient_number: "EZ-PAC-TEST",
          status: "ORDERED",
          sample_status: "ARRIVED",
          attempt: 0,
        },
      );
      const pdf = await PDFDocument.load(bytes);
      expect(pdf.getPageCount()).toBe(1);
      expect(pdf.getPage(0).getWidth()).toBeCloseTo(255.12, 2);
      expect(pdf.getPage(0).getHeight()).toBeCloseTo(141.73, 2);
      expect(qr).toHaveBeenCalledWith(
        "EZ-UZ-2026-00000001",
        expect.any(Object),
      );
      expect(qr.mock.calls[0][0]).not.toContain("Osoba");
    } finally {
      qr.mockRestore();
    }
  });
});
