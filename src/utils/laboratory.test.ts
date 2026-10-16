import { describe, it, expect } from "vitest";
import { laboratorySlotAllowed } from "./laboratory";
describe("laboratory reschedule windows", () => {
  it("checks Zagreb time and requires the complete appointment to fit", () => {
    const routine = { sampling_from: "07:00:00", sampling_until: "09:30:00" };
    expect(laboratorySlotAllowed(routine, "2026-11-04T08:15:00Z", 15)).toBe(
      true,
    );
    expect(laboratorySlotAllowed(routine, "2026-11-04T08:30:00Z", 15)).toBe(
      false,
    );
    expect(laboratorySlotAllowed(routine, "2026-11-04T08:15:00Z", 30)).toBe(
      false,
    );
  });
  it("intersects a fixed sampling time with its window and retains legacy snapshots", () => {
    expect(
      laboratorySlotAllowed(
        {
          required_time: "08:00:00",
          sampling_from: "08:00:00",
          sampling_until: "14:00:00",
        },
        "2026-11-04T07:00:00Z",
        15,
      ),
    ).toBe(true);
    expect(
      laboratorySlotAllowed(
        { required_time: "08:00:00" },
        "2026-11-04T08:00:00Z",
        15,
      ),
    ).toBe(false);
    expect(laboratorySlotAllowed(null, "2026-11-04T08:00:00Z", 15)).toBe(true);
  });
});
