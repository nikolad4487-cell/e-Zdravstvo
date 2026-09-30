import { z } from "zod";
import { db } from "../lib/supabase";
import { unwrap } from "./clinical";
import { labResultSchema, labFlagLabels } from "../types/laboratory";
import { dateLabel } from "../utils/format";
export const reportSchema = z.object({
  id: z.string(),
  number: z.string(),
  patient_id: z.string(),
  doctor_id: z.string(),
  booking_id: z.string().nullable(),
  report_type: z.enum(["SPECIALIST", "DISCHARGE"]),
  reported_on: z.string(),
  diagnosis: z.string(),
  content: z.string(),
  conclusion: z.string(),
  recommendations: z.string(),
  patient_name: z.string(),
  patient_number: z.string(),
  doctor_name: z.string(),
  institution_name: z.string(),
  specialty: z.string(),
  version: z.number(),
  superseded_by: z.string().nullable(),
  supersedes_id: z.string().nullable(),
  correction_reason: z.string(),
  can_amend: z.boolean().optional(),
});
export type MedicalReport = z.infer<typeof reportSchema>;
export async function medicalReports(
  personal: boolean,
  patientId?: string,
  page = 0,
) {
  return z
    .array(reportSchema)
    .parse(
      unwrap(
        await db().rpc("list_medical_reports", {
          personal,
          patient_filter: patientId ?? null,
          page_number: page,
        }),
      ),
    );
}
export async function downloadMedicalReport(id: string) {
  const r = reportSchema.parse(
      unwrap(await db().rpc("download_medical_report", { report_id: id })),
    ),
    { exportReportPdf } = await import("../utils/reportPdf");
  await exportReportPdf(
    r.report_type === "DISCHARGE" ? "Otpusno pismo" : "Specijalistički nalaz",
    r.number,
    [
      { label: "Pacijent", text: r.patient_name + " · " + r.patient_number },
      {
        label: "Izdavatelj",
        text: r.institution_name + "\n" + r.doctor_name + " · " + r.specialty,
      },
      {
        label: "Datum i verzija",
        text:
          dateLabel(r.reported_on) +
          " · verzija " +
          r.version +
          (r.superseded_by ? " · ZAMIJENJENO NOVIJOM VERZIJOM" : ""),
      },
      { label: "Dijagnoze", text: r.diagnosis },
      { label: "Nalaz", text: r.content },
      { label: "Zaključak", text: r.conclusion },
      { label: "Preporuke", text: r.recommendations },
      ...(r.correction_reason
        ? [{ label: "Razlog ispravka", text: r.correction_reason }]
        : []),
    ],
  );
}
export async function downloadLabResult(id: string) {
  const r = z
      .object({
        number: z.string(),
        patient_name: z.string(),
        patient_number: z.string(),
        laboratory_name: z.string(),
        result: labResultSchema,
      })
      .parse(
        unwrap(await db().rpc("download_laboratory_result", { result_id: id })),
      ),
    { exportReportPdf } = await import("../utils/reportPdf");
  await exportReportPdf(
    "Laboratorijski nalaz",
    r.number + "-v" + r.result.version,
    [
      { label: "Pacijent", text: r.patient_name + " · " + r.patient_number },
      {
        label: "Laboratorij",
        text: r.laboratory_name + "\n" + r.result.author,
      },
      {
        label: "Uzorkovanje i objava",
        text:
          dateLabel(r.result.sampled_at) +
          " / " +
          dateLabel(r.result.reported_at) +
          (r.result.superseded_by ? "\nZAMIJENJENO NOVIJOM VERZIJOM" : ""),
      },
      ...r.result.parameters.map((p) => ({
        label: p.code + " · " + p.name,
        text: `${p.value} ${p.unit}\nReferentni interval: ${p.reference_low ?? "—"} – ${p.reference_high ?? "—"} ${p.unit}\n${p.flag ? labFlagLabels[p.flag] : "Bez oznake urednosti"}`,
      })),
      { label: "Komentar", text: r.result.summary },
      ...(r.result.correction_reason
        ? [{ label: "Razlog ispravka", text: r.result.correction_reason }]
        : []),
    ],
  );
}
