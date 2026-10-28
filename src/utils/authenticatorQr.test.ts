import { describe, it, expect } from "vitest";
import { authenticatorQrDataUri } from "./authenticatorQr";
describe("authenticator QR image", () => {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg"><rect fill="#fff"/></svg>';
  it("accepts the actual Auth SDK data URI without double encoding its header", () => {
    const result = authenticatorQrDataUri("data:image/svg+xml;utf-8," + svg);
    expect(result).toBe(
      "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg),
    );
  });
  it("preserves encoded data and supports raw SVG", () => {
    expect(authenticatorQrDataUri(svg)).toBe(
      authenticatorQrDataUri(
        "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg),
      ),
    );
  });
  it("rejects external image URLs", () => {
    expect(() => authenticatorQrDataUri("https://example.test/qr")).toThrow();
  });
});
