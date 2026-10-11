import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import {
  documentPdf,
  type DocumentEmailDetails,
} from "../../supabase/functions/notifications-dispatch/document-pdf";
import { clinicalDocumentPdfV2 } from "../../supabase/functions/notifications-dispatch/clinical-document-pdf-v2";
import { clinicalDocumentPdfV3 } from "../../supabase/functions/notifications-dispatch/clinical-document-pdf-v3";
import { clinicalDocumentPdf } from "../../supabase/functions/notifications-dispatch/clinical-document-pdf";
import { schoolExcusePdf } from "../utils/schoolExcusePdf";
import { schoolExcuseDocumentPdf } from "../../supabase/functions/notifications-dispatch/school-excuse-pdf";
import { documentSchema } from "../types/documents";
const date = "2026-10-11T10:00:00Z";
const base: DocumentEmailDetails = {
  kind: "REFERRAL",
  title: "Uputnica",
  number: "EZ-UPU-2026-00000001",
  issuedAt: date,
  layoutVersion: 3,
  sections: [
    { label: "Pacijent", text: "Ana Primjerić" },
    { label: "Vrsta / specijalnost", text: "SPECIALIST / Kardiologija" },
    { label: "Razlog upućivanja", text: "Izmišljeni primjer čćđšž." },
  ],
};
export const schoolFixture = documentSchema.parse({
  id: "fixture",
  patient_id: "fixture",
  kind: "SCHOOL_EXCUSE",
  number: "EZ-ISP-2026-00000001",
  status: "VALID",
  issued_at: date,
  expires_on: "2026-12-31",
  revocation_reason: null,
  can_revoke: true,
  verification_token: "00000000-0000-4000-8000-000000000001",
  payload: {
    number: "EZ-ISP-2026-00000001",
    kind: "SCHOOL_EXCUSE",
    issued_at: date,
    expires_on: "2026-12-31",
    patient: {
      first_name: "Ana",
      last_name: "Primjerić",
      birth_date: "2010-02-15",
      patient_number: "EZ-PAC-00000001",
    },
    doctor: "dr. Marko Primjer",
    institution: "Primjer zdravstvene ustanove",
    institution_address: "Primjer ulice 1, Zagreb",
    signature_disclaimer:
      "Primjer dokumenta za provjeru izgleda. Nije službena isprava.",
    details: {
      date_from: "2026-10-10",
      date_to: "2026-10-11",
      category: "Opravdani izostanak",
      school: "Primjer škole",
      notes: "Isključivo izmišljeni podaci.",
      doctor_code: "PRIMJER",
      clinic: {
        id: "fixture",
        name: "Primjer ordinacije",
        code: "PRIMJER",
        address: "Primjer ulice 1",
        city: "Zagreb",
        phone: "",
        email: "ordinacija@example.test",
      },
    },
  },
  signature: {
    signed_at: date,
    signature_hash: "0".repeat(64),
    signature_method: "DEMO_SHA256",
    certificate_name: "Primjer interne oznake",
    status: "VALID",
    integrity_valid: true,
  },
});
describe("shared clinical print layouts", () => {
  it("preserves version 3 retry bytes and renders official codes only in version 4", async () => {
    const layout = {
      referralCode: "A1",
      referralCodeName: "Konzilijarni pregled",
      examinationCode: "1",
      examinationName: "Jednostavni pregled",
      visitCode: "01",
      visitName: "Prvi pregled",
    };
    const old = { ...base, layout };
    expect(await documentPdf(old)).toEqual(await clinicalDocumentPdfV3(old));
    const current = { ...old, layoutVersion: 4 as const };
    const bytes = await documentPdf(current);
    expect(bytes).toEqual(await clinicalDocumentPdf(current));
    expect(bytes).toEqual(await documentPdf(current));
    expect(bytes).not.toEqual(await documentPdf(old));
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });
  it("preserves the existing version 2 PDF for jobs that may already have been attempted", async () => {
    const d = { ...base, layoutVersion: 2 as const };
    expect(await documentPdf(d)).toEqual(await clinicalDocumentPdfV2(d));
  });

  it("paginates long referrals without changing retry bytes", async () => {
    const d = {
      ...base,
      sections: [
        ...base.sections,
        { label: "Napomena", text: "Duga napomena čćđšž.\n".repeat(300) },
      ],
    };
    const a = await documentPdf(d, "https://example.test/verify/fixture"),
      b = await documentPdf(d, "https://example.test/verify/fixture");
    expect(a).toEqual(b);
    expect((await PDFDocument.load(a)).getPageCount()).toBeGreaterThan(4);
  });
  it("paginates structured laboratory results including zero bounds and long names", async () => {
    const d: DocumentEmailDetails = {
      ...base,
      kind: "LAB_RESULT",
      number: "EZ-LAB-2026-00000001-v1",
      title: "Laboratorijski nalaz",
      sections: [
        { label: "Pacijent", text: "Ana Primjerić" },
        { label: "Laboratorij", text: "Primjer laboratorija" },
        { label: "Komentar", text: "Izmišljeni podaci" },
      ],
      layout: {
        laboratoryRows: Array.from({ length: 80 }, (_, i) => ({
          code: "TEST" + i,
          name:
            "Testni parametar " +
            i +
            (i === 4 ? " dugi naziv".repeat(100) : ""),
          value: "42",
          unit: "mmol/L",
          referenceLow: "0",
          referenceHigh: "50",
          flag: i % 2 ? "HIGH" : "LOW",
        })),
      },
    };
    const bytes = await documentPdf(d);
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(1);
    expect(bytes).toEqual(await documentPdf(d));
  });
  it("uses the same school excuse PDF for browser downloads and mail attachments", async () => {
    const url =
      "https://example.test/verify/" + schoolFixture.verification_token;
    const d: DocumentEmailDetails = {
      ...base,
      kind: "SCHOOL_EXCUSE",
      number: schoolFixture.number,
      title: "Ispričnica",
      sections: [],
      layout: { schoolDocument: schoolFixture },
    };
    expect(await documentPdf(d, url)).toEqual(
      await schoolExcusePdf(schoolFixture, url),
    );
    expect(
      (await PDFDocument.load(await documentPdf(d, url))).getPageCount(),
    ).toBe(1);
  });
  it("keeps template previews available without pretending they are issued documents", async () => {
    const bytes = await schoolExcuseDocumentPdf(
      { ...schoolFixture, number: "PREGLED PREDLOŠKA" },
      "",
      true,
    );
    expect((await PDFDocument.load(bytes)).getTitle()).toBe(
      "Pregled predloška",
    );
  });
  it("paginates specialist narrative and keeps its issue date", async () => {
    const d: DocumentEmailDetails = {
      ...base,
      kind: "MEDICAL_REPORT",
      title: "Specijalistički nalaz",
      number: "EZ-NAL-2026-00000001-v1",
      sections: [
        {
          label: "Izdavatelj",
          text: "Primjer ustanove\ndr. Marko Primjer\nKardiologija",
        },
        { label: "Pacijent", text: "Ana Primjerić" },
        { label: "Nalaz", text: "Izmišljeni opis nalaza čćđšž.\n".repeat(180) },
      ],
    };
    const p = await PDFDocument.load(await documentPdf(d));
    expect(p.getPageCount()).toBeGreaterThan(3);
    expect(p.getCreationDate()?.toISOString()).toBe(date.replace("Z", ".000Z"));
  });
});
