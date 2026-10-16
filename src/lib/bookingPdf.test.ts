import { describe, expect, it, vi } from "vitest";
import { bookingPdf as legacyBookingPdf } from "../../supabase/functions/notifications-dispatch/booking-pdf-v1";
import { PDFDocument } from "pdf-lib";
import { bookingPdf } from "../../supabase/functions/notifications-dispatch/booking-pdf";
import {
  APPOINTMENT_SENDER,
  deliverNotification,
} from "../../supabase/functions/notifications-dispatch/delivery";

const details = {
  eventType: "BOOKED" as const,
  patientName: "Ana Đurić Čalić",
  bookingReference: "PREG-2026-00125",
  startsAt: "2026-10-15T07:40:00Z",
  durationMinutes: 30,
  hospital: "Testna ustanova",
  specialist: "dr. Test",
  kind: "Kontrolni pregled",
  location: "Ambulanta 2",
  priority: true,
  pdfDetails: {
    patientBirthDate: "1990-04-12",
    patientAddress: "Testna ulica 12, Zagreb",
    patientPhone: "01 000 0000",
    bookedAt: "2026-10-11T12:00:00Z",
    bookedBy: "dr. Drugi",
  },
};
const config = {
  apiKey: "test-only-key",
  from: APPOINTMENT_SENDER,
  applicationUrl: "https://example.test",
};

describe("booking PDF attachments", () => {
  it("creates a valid A4 PDF and identical bytes when retrying the same snapshot", async () => {
    const first = await bookingPdf(details);
    expect(await bookingPdf(details)).toEqual(first);
    const pdf = await PDFDocument.load(first);
    expect(pdf.getPageCount()).toBe(1);
    expect(pdf.getPage(0).getSize()).toEqual({ width: 595.28, height: 841.89 });
    expect(pdf.getCreationDate()?.toISOString()).toBe(
      new Date(details.pdfDetails.bookedAt).toISOString(),
    );
    expect(pdf.getTitle()).toBe("Potvrda o narudžbi pacijenta");
  });
  it("preserves retry bytes for existing non-laboratory snapshots", async () => {
    expect(await bookingPdf(details)).toEqual(await legacyBookingPdf(details));
  });
  it("attaches the laboratory protocol without leaking tests or preparation into the email body", async () => {
    const laboratory = {
      procedure_code: "VVK",
      service_name: "Laboratorij - Uzimanje venske krvi",
      sampling_method: "CANNULA",
      tests: [
        {
          code: "LOCAL-CORT",
          name: "Testna pretraga",
          instructions: "Privatna testna uputa",
          steps: [
            {
              day_offset: -1,
              time: "20:00",
              label: "Testni povezani korak",
              instructions: "Posebna testna priprema",
            },
          ],
        },
      ],
    };
    const confirmation = {
      ...details,
      kind: "Laboratorijska usluga",
      pdfDetails: { ...details.pdfDetails, laboratory },
    };
    const first = await bookingPdf(confirmation);
    expect(await bookingPdf(confirmation)).toEqual(first);
    expect(
      (await PDFDocument.load(first)).getPageCount(),
    ).toBeGreaterThanOrEqual(1);
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ id: "test-provider" }), { status: 200 }),
      );
    await deliverNotification(
      {
        id: "lab-test",
        email: "test@example.test",
        portalAccess: false,
        confirmation,
      },
      config,
      request,
    );
    const body = JSON.parse(request.mock.calls[0][1]?.body as string);
    for (const sensitive of [
      "Privatna testna uputa",
      "Testna pretraga",
      "Posebna testna priprema",
      "LOCAL-CORT",
    ]) {
      expect(body.html).not.toContain(sensitive);
      expect(body.text).not.toContain(sensitive);
    }
    expect(body.attachments).toHaveLength(1);
  });
  it.each([
    ["BOOKED", "narudzba"],
    ["RESCHEDULED", "promjena-termina"],
    ["CANCELLED", "otkazivanje"],
  ] as const)(
    "sends %s with its PDF while keeping extended demographics out of the email body",
    async (eventType, prefix) => {
      const request = vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({ id: "provider-test" }), {
          status: 200,
        }),
      );
      await deliverNotification(
        {
          id: "job-test",
          email: "test@example.test",
          portalAccess: false,
          confirmation: { ...details, eventType },
        },
        config,
        request,
      );
      const body = JSON.parse(request.mock.calls[0][1]?.body as string);
      expect(body.attachments).toHaveLength(1);
      expect(body.attachments[0].filename).toBe(
        `${prefix}-PREG-2026-00125.pdf`,
      );
      expect(body.attachments[0].content_type).toBe("application/pdf");
      const pdf = await PDFDocument.load(
        Uint8Array.from(atob(body.attachments[0].content), (c) =>
          c.charCodeAt(0),
        ),
      );
      expect(pdf.getPageCount()).toBe(1);
      expect(body.text).toContain("U privitku je PDF");
      expect(body.html + body.text).not.toContain(
        details.pdfDetails.patientAddress,
      );
      expect(body.html + body.text).not.toContain(
        details.pdfDetails.patientPhone,
      );
      expect(body.html + body.text).not.toContain(
        details.pdfDetails.patientBirthDate,
      );
      if (eventType === "CANCELLED") {
        expect(body.text).toContain("otkazivanja");
        expect(body.text).not.toContain("dođete nekoliko minuta ranije");
      }
    },
  );
  it("fails before contacting Resend if the PDF snapshot is invalid", async () => {
    const request = vi.fn<typeof fetch>();
    await expect(
      deliverNotification(
        {
          id: "bad",
          email: "test@example.test",
          appointment: {
            ...details,
            startsAt: "invalid",
            pdfDetails: undefined,
          },
        },
        config,
        request,
      ),
    ).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });
});
