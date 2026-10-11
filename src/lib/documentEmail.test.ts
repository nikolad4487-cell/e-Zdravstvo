import { describe, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import {
  documentPdf,
  type DocumentEmailDetails,
} from "../../supabase/functions/notifications-dispatch/document-pdf";
import {
  deliverNotification,
  renderNotification,
  APPOINTMENT_SENDER,
} from "../../supabase/functions/notifications-dispatch/delivery";
const config = {
  apiKey: "test-only",
  from: APPOINTMENT_SENDER,
  applicationUrl: "https://example.test",
};
const example: DocumentEmailDetails = {
  kind: "REFERRAL",
  number: "EZ-UPU-2026-00000001",
  title: "Uputnica",
  issuedAt: "2026-10-11T10:00:00Z",
  sections: [
    { label: "Pacijent", text: "Ana Primjerić" },
    { label: "Nalaz", text: "PRIVATE MEDICAL CONTENT čćđšž" },
  ],
};
describe("issued document email attachments", () => {
  it.each([
    "REFERRAL",
    "SCHOOL_EXCUSE",
    "MEDICAL_REPORT",
    "LAB_RESULT",
  ] as const)(
    "sends %s as a real PDF without clinical content in the email body",
    async (kind) => {
      const request = vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          new Response(JSON.stringify({ id: "provider-test" }), {
            status: 200,
          }),
        );
      const document = { ...example, kind };
      const job = {
        id: "document-test",
        email: "fictional@example.test",
        document,
      };
      const result = await deliverNotification(job, config, request);
      expect(result.succeeded).toBe(true);
      const body = JSON.parse(request.mock.calls[0][1]?.body as string);
      expect(body.attachments).toHaveLength(1);
      expect(body.attachments[0].filename).toBe(example.number + ".pdf");
      const pdf = await PDFDocument.load(
        Buffer.from(body.attachments[0].content, "base64"),
      );
      expect(pdf.getPageCount()).toBe(1);
      expect(pdf.getPages()[0].getWidth()).toBeCloseTo(595.28);
      expect(body.subject + body.html + body.text).not.toContain("PRIVATE");
      expect(body.subject + body.html + body.text).not.toContain(
        "Ana Primjerić",
      );
      expect(request.mock.calls[0][1]?.headers).toMatchObject({
        "Idempotency-Key": "notification-document-test",
      });
    },
  );
  it("keeps multipage documents deterministic across retries", async () => {
    const d = {
      ...example,
      sections: [
        { label: "Nalaz", text: "Čćšđž testni podatak\n".repeat(350) },
      ],
    };
    const a = await documentPdf(d),
      b = await documentPdf(d);
    expect(a).toEqual(b);
    expect((await PDFDocument.load(a)).getPageCount()).toBeGreaterThan(1);
  });
  it("rejects unsafe filenames before sending", async () => {
    const request = vi.fn<typeof fetch>();
    await expect(
      deliverNotification(
        {
          id: "test",
          email: "fictional@example.test",
          document: { ...example, number: "../../patient.pdf" },
        },
        config,
        request,
      ),
    ).rejects.toThrow("snapshot");
    expect(request).not.toHaveBeenCalled();
  });
  it("does not expose snapshot text through the generic HTML template", () => {
    const content = renderNotification(
      { id: "test", email: "fictional@example.test", document: example },
      config.applicationUrl,
    );
    expect(content.html).toContain("viewport");
    expect(content.text).toContain("PDF");
    expect(JSON.stringify(content)).not.toContain("PRIVATE");
  });
});
