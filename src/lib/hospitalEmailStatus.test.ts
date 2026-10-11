import { beforeEach, describe, expect, it, vi } from "vitest";
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("./supabase", () => ({ db: () => ({ rpc }) }));
import { hospitalEmailStatusMessage } from "../services/priorityHospital";

describe("hospital email delivery feedback", () => {
  beforeEach(() => {
    rpc.mockReset();
  });
  it.each(["PENDING", "SENDING", "FAILED", "CANCELLED"])(
    "does not claim delivery for %s",
    async (status) => {
      rpc.mockResolvedValue({ data: status, error: null });
      const message = await hospitalEmailStatusMessage("booking-test");
      expect(rpc).toHaveBeenCalledWith("hospital_booking_email_status", {
        booking_id: "booking-test",
      });
      expect(message).not.toContain("prihvatio");
      expect(message).not.toContain("je poslana");
    },
  );
  it("distinguishes provider acceptance from inbox delivery", async () => {
    rpc.mockResolvedValue({ data: "SENT", error: null });
    expect(await hospitalEmailStatusMessage("booking-test")).toContain(
      "Primitak u sandučiću nije potvrđen",
    );
  });
  it("keeps the saved booking successful when the status lookup fails", async () => {
    rpc.mockRejectedValue(new Error("offline"));
    expect(await hospitalEmailStatusMessage("booking-test")).toContain(
      "trenutačno nije dostupan",
    );
  });
});
