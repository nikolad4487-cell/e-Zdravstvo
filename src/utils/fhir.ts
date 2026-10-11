import type {
  AllergyIntolerance,
  Bundle,
  Condition,
  Encounter,
  MedicationStatement,
  Observation,
  Patient,
  Resource,
} from "fhir/r4";
import type { PatientChart } from "../types/clinical";
const escape = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
const gender = (sex: string): Patient["gender"] =>
  sex === "F"
    ? "female"
    : sex === "M"
      ? "male"
      : sex === "OTHER"
        ? "other"
        : "unknown";
// Base FHIR R4 resources only. This does not assert conformance to any national
// implementation guide, provide a qualified signature, or transmit records.
export function chartToFhir(
  chart: PatientChart,
  timestamp = new Date().toISOString(),
): Bundle {
  const subject = { reference: `urn:uuid:${chart.patient.id}` };
  const p = chart.patient;
  const patient: Patient = {
    resourceType: "Patient",
    id: p.id,
    identifier: [
      { system: "urn:e-zdravstvo:patient-number", value: p.patient_number },
    ],
    name: [{ use: "official", family: p.last_name, given: [p.first_name] }],
    gender: gender(p.sex),
    birthDate: p.birth_date,
    telecom: [
      ...(p.phone ? [{ system: "phone" as const, value: p.phone }] : []),
      ...(p.email ? [{ system: "email" as const, value: p.email }] : []),
    ],
    address:
      p.address || p.city || p.postal_code
        ? [
            {
              line: p.address ? [p.address] : undefined,
              city: p.city ?? undefined,
              postalCode: p.postal_code ?? undefined,
            },
          ]
        : undefined,
  };
  const entries: NonNullable<Bundle["entry"]> = [
    { fullUrl: subject.reference, resource: patient },
  ];
  const add = (
    resource: Resource,
    fullUrl = `urn:uuid:${crypto.randomUUID()}`,
  ) => entries.push({ fullUrl, resource });
  for (const e of chart.encounters) {
    const visit: Encounter = {
      resourceType: "Encounter",
      id: e.id,
      status: "unknown",
      class: {
        system: "http://terminology.hl7.org/CodeSystem/v3-NullFlavor",
        code: "UNK",
      },
      subject,
      period: { start: e.encountered_at },
      type: [{ text: e.kind }],
      reasonCode: [{ text: e.reason }],
      participant: [{ individual: { display: e.doctor_name } }],
      text: {
        status: "additional",
        div: `<div xmlns="http://www.w3.org/1999/xhtml">${Object.entries({
          Razlog: e.reason,
          Anamneza: e.anamnesis,
          Simptomi: e.symptoms,
          "Objektivni status": e.objective_status,
          Terapija: e.therapy,
          Preporuke: e.recommendations,
          Napomena: e.notes,
          "Razlog ispravka": e.amendment_reason ?? "",
        })
          .filter(([, value]) => value)
          .map(
            ([label, value]) =>
              `<p><b>${escape(label)}:</b> ${escape(value)}</p>`,
          )
          .join("")}</div>`,
      },
      meta: e.superseded_by
        ? {
            tag: [
              { system: "urn:e-zdravstvo:record-state", code: "superseded" },
            ],
          }
        : undefined,
    };
    add(visit, `urn:uuid:${e.id}`);
    const vitals: [number | null, string, string, string, string][] = [
      [e.systolic, "8480-6", "Systolic blood pressure", "mm[Hg]", "systolic"],
      [
        e.diastolic,
        "8462-4",
        "Diastolic blood pressure",
        "mm[Hg]",
        "diastolic",
      ],
      [e.pulse, "8867-4", "Heart rate", "/min", "pulse"],
      [e.temperature, "8310-5", "Body temperature", "Cel", "temperature"],
      [e.spo2, "59408-5", "Oxygen saturation by pulse oximetry", "%", "spo2"],
      [e.height_cm, "8302-2", "Body height", "cm", "height"],
      [e.weight_kg, "29463-7", "Body weight", "kg", "weight"],
      [e.bmi, "39156-5", "Body mass index", "kg/m2", "bmi"],
    ];
    for (const [value, code, display, unit, suffix] of vitals) {
      if (value === null) continue;
      const observation: Observation = {
        resourceType: "Observation",
        id: `${e.id}-${suffix}`,
        status: "final",
        subject,
        encounter: { reference: `urn:uuid:${e.id}` },
        effectiveDateTime: e.encountered_at,
        code: { coding: [{ system: "http://loinc.org", code, display }] },
        valueQuantity: {
          value,
          unit,
          system: "http://unitsofmeasure.org",
          code: unit,
        },
      };
      add(observation);
    }
  }
  for (const d of chart.diagnoses) {
    const condition: Condition = {
      resourceType: "Condition",
      id: d.id,
      subject,
      code: { text: `${d.code} · ${d.name}` },
      onsetDateTime: d.diagnosed_at,
      clinicalStatus:
        d.status === "SUSPECTED"
          ? undefined
          : {
              coding: [
                {
                  system:
                    "http://terminology.hl7.org/CodeSystem/condition-clinical",
                  code: ["ACTIVE", "CHRONIC"].includes(d.status)
                    ? "active"
                    : d.status === "RESOLVED"
                      ? "resolved"
                      : "inactive",
                },
              ],
            },
      verificationStatus:
        d.status === "SUSPECTED"
          ? {
              coding: [
                {
                  system:
                    "http://terminology.hl7.org/CodeSystem/condition-ver-status",
                  code: "provisional",
                },
              ],
            }
          : undefined,
      note: d.notes ? [{ text: d.notes }] : undefined,
    };
    // The chart does not expose the code's source system; do not label local
    // or demonstration codes as official ICD/SNOMED terminology.
    add(condition, `urn:uuid:${d.id}`);
  }
  for (const a of chart.allergies) {
    const allergy: AllergyIntolerance = {
      resourceType: "AllergyIntolerance",
      id: a.id,
      patient: subject,
      code: { text: a.name },
      clinicalStatus: {
        coding: [
          {
            system:
              "http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical",
            code: "active",
          },
        ],
      },
      reaction: a.reaction
        ? [
            {
              manifestation: [{ text: a.reaction }],
              severity:
                a.severity === "SEVERE"
                  ? "severe"
                  : a.severity === "MODERATE"
                    ? "moderate"
                    : a.severity === "MILD"
                      ? "mild"
                      : undefined,
            },
          ]
        : undefined,
    };
    add(allergy, `urn:uuid:${a.id}`);
  }
  for (const t of chart.therapy) {
    const statement: MedicationStatement = {
      resourceType: "MedicationStatement",
      id: t.id,
      subject,
      status:
        t.status === "ACTIVE"
          ? "active"
          : t.status === "STOPPED"
            ? "stopped"
            : t.status === "COMPLETED"
              ? "completed"
              : "unknown",
      medicationCodeableConcept: { text: `${t.name} ${t.strength}` },
      effectivePeriod: { start: t.start_date, end: t.end_date ?? undefined },
      dosage: [{ text: [t.dosage, t.frequency].filter(Boolean).join(" · ") }],
      note: t.notes ? [{ text: t.notes }] : undefined,
    };
    add(statement, `urn:uuid:${t.id}`);
  }
  return {
    resourceType: "Bundle",
    type: "collection",
    timestamp,
    entry: entries,
  };
}
