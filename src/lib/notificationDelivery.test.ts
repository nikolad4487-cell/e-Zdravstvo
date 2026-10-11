import { describe, expect, it, vi } from "vitest";
import {
  APPOINTMENT_SENDER,
  deliverNotification,
  renderNotification,
} from "../../supabase/functions/notifications-dispatch/delivery";
const config = {
  apiKey: "test-only-key",
  from: APPOINTMENT_SENDER,
  applicationUrl: "https://example.test",
};
describe("notification email delivery", () => {
  it("sends a priority booking confirmation with Zagreb time and a portal link", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ id: "confirmation-1" }), { status: 200 }),
      );
    await deliverNotification(
      {
        id: "confirmation-job",
        email: "fictional@example.test",
        confirmation: {
          startsAt: "2026-10-12T05:00:00Z",
          durationMinutes: 15,
          hospital: "Testna bolnica",
          department: "Kardiologija",
          specialist: "dr. Test",
          location: "Ambulanta 1",
        },
      },
      config,
      request,
    );
    const body = JSON.parse(request.mock.calls[0][1]?.body as string);
    expect(body.subject).toContain("Potvrda prioritetnog pregleda");
    expect(body.text).toContain("07:00");
    expect(body.text).toContain("Kardiologija");
    expect(body.text).toContain("https://example.test/moje/narudzbe");
    expect(body.text).not.toContain("test-only-key");
  });
  it("sends only a generic portal link and a stable idempotency key", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ id: "message-1" }), { status: 200 }),
      );
    expect(
      await deliverNotification(
        { id: "job-1", email: "fictional@example.test" },
        config,
        request,
      ),
    ).toMatchObject({ succeeded: true, providerId: "message-1" });
    const [url, init] = request.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init?.headers).toMatchObject({
      "Idempotency-Key": "notification-job-1",
    });
    const body = JSON.parse(init?.body as string);
    expect(body.to).toEqual(["fictional@example.test"]);
    expect(body.text).toContain("https://example.test/moje/obavijesti");
    expect(body.text).not.toContain("test-only-key");
    expect(Object.keys(body).sort()).toEqual([
      "from",
      "html",
      "subject",
      "text",
      "to",
    ]);
    expect(body.from).toBe("e-Zdravstvo <narudzbe@e-zdravstvo.tech>");
  });
  it("honors rate limiting without returning provider error details", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("sensitive provider body", {
        status: 429,
        headers: { "retry-after": "120" },
      }),
    );
    expect(
      await deliverNotification(
        { id: "job-1", email: "fictional@example.test" },
        config,
        request,
      ),
    ).toEqual({
      succeeded: false,
      providerId: null,
      retrySeconds: 120,
      failureCode: "RESEND_RATE_LIMITED",
      providerStatus: 429,
    });
  });
  it("diagnoses an unverified sender domain without exposing provider details", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          name: "validation_error",
          message:
            "The e-zdravstvo.tech domain is not verified. SECRET PATIENT AND TOKEN",
        }),
        { status: 403 },
      ),
    );
    const result = await deliverNotification(
      { id: "job-1", email: "fictional@example.test" },
      config,
      request,
    );
    expect(result).toMatchObject({
      succeeded: false,
      failureCode: "RESEND_DOMAIN_NOT_VERIFIED",
      providerStatus: 403,
    });
    expect(JSON.stringify(result)).not.toContain("SECRET");
  });
  it("rejects unsafe application URLs before sending", async () => {
    const request = vi.fn<typeof fetch>();
    await expect(
      deliverNotification(
        { id: "job-1", email: "fictional@example.test" },
        { ...config, applicationUrl: "http://example.test" },
        request,
      ),
    ).rejects.toThrow("HTTPS");
    expect(request).not.toHaveBeenCalled();
  });
  it("treats a malformed success response as an uncertain delivery", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("{}", { status: 200 }));
    await expect(
      deliverNotification(
        { id: "job-1", email: "fictional@example.test" },
        config,
        request,
      ),
    ).rejects.toThrow("Invalid email provider response");
  });
});

describe("Croatian appointment templates", () => {
  const appointment = {
    bookingReference: "PREG-2026-00125",
    patientName: 'Ana <img src=x onerror="alert(1)"> & Ivić',
    institution: "Testna ustanova",
    doctor: "dr. Test",
    kind: "Kontrolni pregled",
    startsAt: "2026-12-12T06:00:00Z",
    durationMinutes: 30,
    location: "Ambulanta 1, Testna ulica 2",
  };
  it("includes all arrival details and escapes HTML", () => {
    const content = renderNotification(
      { id: "test", email: "fictional@example.test", appointment },
      config.applicationUrl,
    );
    for (const value of [
      appointment.institution,
      appointment.doctor,
      appointment.kind,
      appointment.location,
      appointment.bookingReference,
      "07:00",
    ])
      expect(content.text).toContain(value);
    expect(content.html).toContain('lang="hr"');
    expect(content.html).toContain('name="viewport"');
    expect(content.html).toContain("&lt;img");
    expect(content.html).not.toContain("<img");
    expect(content.html).toContain("&amp; Ivić");
    expect(content.text).toContain("Status rezervacije: Potvrđeno");
    expect(content.text).toContain("Broj rezervacije: PREG-2026-00125");
    expect(content.text).toContain("Tim e-Zdravstvo");
  });
  it.each([
    ["RESCHEDULED", "Promjena termina", "novi podaci"],
    ["CANCELLED", "otkazan", "novog termina"],
  ] as const)(
    "renders %s without booking confirmation wording",
    (eventType, subject, wording) => {
      const content = renderNotification(
        {
          id: "test",
          email: "fictional@example.test",
          appointment: { ...appointment, eventType },
        },
        config.applicationUrl,
      );
      expect(content.subject).toContain(subject);
      expect(content.text).toContain(wording);
      expect(content.text).not.toContain("uspješno zakazan");
    },
  );
  it("rejects sender changes before calling Resend", async () => {
    const request = vi.fn<typeof fetch>();
    await expect(
      deliverNotification(
        { id: "test", email: "fictional@example.test" },
        { ...config, from: "other@example.test" },
        request,
      ),
    ).rejects.toThrow("sender");
    expect(request).not.toHaveBeenCalled();
  });
  it("does not serialize additional clinical fields into email", () => {
    const unsafe = {
      ...appointment,
      diagnosis: "SECRET DIAGNOSIS",
      cancellationReason: "SECRET REASON",
      referral: "SECRET REFERRAL",
    };
    const content = renderNotification(
      { id: "test", email: "fictional@example.test", appointment: unsafe },
      config.applicationUrl,
    );
    expect(content.html + content.text).not.toContain("SECRET");
  });
  it("gives accountless recipients complete details without instructions to log in", () => {
    const content = renderNotification(
      {
        id: "contact",
        email: "contact@example.test",
        portalAccess: false,
        appointment,
      },
      config.applicationUrl,
    );
    expect(content.text).toContain("Liječnik:");
    expect(content.text).toContain(
      "Za dodatne informacije ili promjenu termina",
    );
    expect(content.html).not.toContain("Otvori e-Zdravstvo");
    expect(content.text).not.toContain("Otvori portal");
    expect(content.html + content.text).not.toContain("prijavom u portal");
  });
});
