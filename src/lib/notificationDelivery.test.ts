import { describe, expect, it, vi } from "vitest";
import { deliverNotification } from "../../supabase/functions/notifications-dispatch/delivery";
const config = {
  apiKey: "test-only-key",
  from: "Sustav <noreply@example.test>",
  applicationUrl: "https://example.test",
};
describe("notification email delivery", () => {
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
    expect(Object.keys(body).sort()).toEqual(["from", "subject", "text", "to"]);
  });
  it("honors rate limiting without returning provider error details", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
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
    ).toEqual({ succeeded: false, providerId: null, retrySeconds: 120 });
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
