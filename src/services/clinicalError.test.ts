import { describe, it, expect, vi } from "vitest";
vi.mock("../lib/supabase", () => ({ db: vi.fn() }));
import { unwrap } from "./clinical";
describe("workflow feedback", () => {
  it("gives an actionable receipt requirement without exposing arbitrary database errors", () => {
    expect(() =>
      unwrap({
        data: null,
        error: {
          message:
            "Svi uzorci ovog uzorkovanja moraju biti zaprimljeni prije obrade i izdavanja nalaza.",
        },
      }),
    ).toThrow("Svi uzorci");
    expect(() =>
      unwrap({
        data: null,
        error: { message: "Failing row contains PRIVATE_TEST_VALUE" },
      }),
    ).toThrow("Spremanje ili dohvat nije uspio");
  });
});
