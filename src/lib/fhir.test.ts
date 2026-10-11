import type { Observation, Condition, Encounter } from "fhir/r4";
import { describe, it, expect } from "vitest";
import { chartToFhir } from "../utils/fhir";
import { chartSchema } from "../types/clinical";
const pid = "60000000-0000-4000-8000-000000000001",
  eid = "60000000-0000-4000-8000-000000000002";
const timestamp = "2026-10-04T10:00:00Z";
const chart = chartSchema.parse({
  patient: {
    id: pid,
    patient_number: "TEST-001",
    first_name: "Test",
    last_name: "Osoba",
    birth_date: "2000-01-01",
    sex: "UNKNOWN",
    user_id: null,
    institution_id: pid,
    address: null,
    city: null,
    postal_code: null,
    phone: null,
    email: null,
    emergency_contact: null,
    insurance: null,
    created_at: timestamp,
  },
  record: null,
  doctors: [],
  allergies: [],
  can_write: false,
  encounters: [
    {
      id: eid,
      patient_id: pid,
      doctor_id: pid,
      doctor_name: "Testni liječnik",
      institution_id: pid,
      encountered_at: timestamp,
      kind: "Pregled",
      reason: "<script>alert('test')</script>",
      anamnesis: "",
      symptoms: "",
      objective_status: "",
      systolic: 120,
      diastolic: 80,
      pulse: null,
      temperature: null,
      spo2: 98,
      height_cm: null,
      weight_kg: null,
      bmi: null,
      therapy: "",
      recommendations: "",
      follow_up: null,
      notes: "",
      supersedes_id: null,
      superseded_by: null,
      amendment_reason: null,
      created_at: timestamp,
      diagnoses: [],
    },
  ],
  diagnoses: [
    {
      id: "60000000-0000-4000-8000-000000000003",
      diagnosis_id: pid,
      code: "TEST",
      name: "Testna dijagnoza",
      diagnosed_at: timestamp,
      status: "SUSPECTED",
      notes: "",
      doctor_name: "Test",
    },
  ],
  therapy: [],
});
describe("FHIR chart export", () => {
  it("resolves patient and encounter references inside the collection", () => {
    const bundle = chartToFhir(chart, timestamp),
      urls = new Set(bundle.entry?.map((e) => e.fullUrl));
    expect(bundle.type).toBe("collection");
    expect(bundle.timestamp).toBe(timestamp);
    for (const entry of bundle.entry ?? []) {
      const r = entry.resource;
      if (r?.resourceType === "Observation") {
        const o = r as Observation;
        expect(urls.has(o.subject?.reference)).toBe(true);
        expect(urls.has(o.encounter?.reference)).toBe(true);
      }
    }
    expect(urls.size).toBe(bundle.entry?.length);
  });
  it("escapes clinical narratives and exports only measured values with matching units", () => {
    const entries = chartToFhir(chart, timestamp).entry ?? [],
      visit = entries.find((e) => e.resource?.resourceType === "Encounter")
        ?.resource as Encounter | undefined;
    expect(visit?.text?.div).toContain("&lt;script&gt;");
    expect(visit?.text?.div).not.toContain("<script>");
    const observations = entries.flatMap((e) =>
      e.resource?.resourceType === "Observation"
        ? [e.resource as Observation]
        : [],
    );
    expect(observations).toHaveLength(3);
    expect(
      observations.find((o) => o.code.coding?.[0].code === "59408-5")
        ?.valueQuantity,
    ).toMatchObject({
      value: 98,
      code: "%",
      system: "http://unitsofmeasure.org",
    });
  });
  it("preserves suspected status and does not assert an official diagnosis code system", () => {
    const r = chartToFhir(chart, timestamp).entry?.find(
      (e) => e.resource?.resourceType === "Condition",
    )?.resource;
    if (r?.resourceType !== "Condition") throw new Error("Missing condition");
    const c = r as Condition;
    expect(c.code?.coding).toBeUndefined();
    expect(c.verificationStatus?.coding?.[0].code).toBe("provisional");
    expect(c.clinicalStatus).toBeUndefined();
  });
});
