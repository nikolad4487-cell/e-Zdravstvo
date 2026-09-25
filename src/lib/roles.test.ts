import { describe, expect, it } from "vitest";
import { canAccess, homeFor, portals } from "./roles";
import { USER_ROLES } from "../types";
describe("portal authorization", () => {
  it("routes each supported role to its portal", () => {
    for (const role of USER_ROLES)
      expect(canAccess(homeFor([role]), [role])).toBe(true);
  });
  it("does not give school staff, patients or central admin clinical access", () => {
    for (const role of ["SCHOOL_ADMIN", "PATIENT", "SYSTEM_ADMIN"] as const)
      expect(canAccess("/ordinacija", [role])).toBe(false);
  });
  it("supports a doctor who also administers an institution", () => {
    expect(homeFor(["DOCTOR", "INSTITUTION_ADMIN"])).toBe("/ordinacija");
    expect(canAccess("/ustanove", ["DOCTOR", "INSTITUTION_ADMIN"])).toBe(true);
  });
  it("denies unassigned accounts and unknown routes", () => {
    expect(homeFor([])).toBe("/bez-pristupa");
    for (const p of portals) expect(canAccess(p.path, [])).toBe(false);
    expect(canAccess("/unknown", [...USER_ROLES])).toBe(false);
  });
});
