import { useState } from "react";
import { db } from "../../lib/supabase";
import { getContext, unwrap } from "../../services/clinical";
import { useResource } from "../../hooks/useResource";
import { Field, values } from "../ui/Fields";
import { Modal } from "../ui/Modal";
import { ErrorMessage } from "../ui/Feedback";
import { readableError, today } from "../../utils/format";
import type { MedicalEncounter, PatientChart } from "../../types/clinical";
export type ClinicalAction =
  "encounter" | "diagnosis" | "therapy" | "allergy" | "warnings";
const titles: Record<ClinicalAction, string> = {
  encounter: "Novi pregled",
  diagnosis: "Dodaj dijagnozu",
  therapy: "Dodaj terapiju",
  allergy: "Dodaj alergiju",
  warnings: "Medicinska upozorenja",
};
function localDateTime(value?: string) {
  const d = value ? new Date(value) : new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}
export function ClinicalModal({
  action,
  chart,
  amendment,
  onClose,
  onSaved,
}: {
  action: ClinicalAction;
  chart: PatientChart;
  amendment?: MedicalEncounter;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const context = useResource(getContext, "clinical-context");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [bmi, setBmi] = useState(amendment?.bmi?.toString() ?? "—");
  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget,
      data = values(form);
    setError("");
    setBusy(true);
    try {
      const patient_id = chart.patient.id;
      if (action === "encounter") {
        const selected = [...new FormData(form).getAll("secondary_diagnoses")]
          .map(String)
          .filter((v) => v && v !== data.primary_diagnosis);
        const diagnoses = [
          ...(data.primary_diagnosis
            ? [{ id: data.primary_diagnosis, is_primary: true }]
            : []),
          ...selected.map((id) => ({ id, is_primary: false })),
        ];
        unwrap(
          await db().rpc("create_encounter", {
            patient_id,
            data: {
              ...data,
              encountered_at: new Date(data.encountered_at).toISOString(),
              diagnoses,
            },
            supersedes_id: amendment?.id ?? null,
          }),
        );
      } else if (action === "diagnosis")
        unwrap(await db().rpc("add_patient_diagnosis", { patient_id, data }));
      else if (action === "therapy")
        unwrap(await db().rpc("add_patient_therapy", { patient_id, data }));
      else if (action === "allergy")
        unwrap(
          await db().rpc("add_patient_allergy", {
            patient_id,
            allergy_id: data.allergy_id,
            reaction: data.reaction,
            severity: data.severity,
          }),
        );
      else
        unwrap(
          await db().rpc("update_patient_record", {
            patient_id,
            blood_group: data.blood_group,
            warnings: data.warnings,
          }),
        );
      onSaved(
        action === "encounter"
          ? "Pregled je spremljen. Možete izdati dokument iz kartona."
          : "Podaci su spremljeni.",
      );
    } catch (e) {
      setError(readableError(e));
    } finally {
      setBusy(false);
    }
  }
  const a = amendment;
  return (
    <Modal
      title={a ? "Nova verzija pregleda" : titles[action]}
      onClose={onClose}
      busy={busy}
      wide={action === "encounter"}
    >
      <form
        onSubmit={save}
        onInput={(e) => {
          if (action === "encounter") {
            const d = values(e.currentTarget),
              h = Number(d.height_cm) / 100,
              w = Number(d.weight_kg);
            setBmi(h > 0 && w > 0 ? (w / (h * h)).toFixed(1) : "—");
          }
        }}
      >
        <p className="form-intro">
          {chart.patient.first_name} {chart.patient.last_name} ·{" "}
          {chart.patient.patient_number}
          {a ? " · Originalni pregled ostaje sačuvan." : ""}
        </p>
        <div className="form-grid">
          {action === "encounter" && (
            <>
              <Field
                name="encountered_at"
                label="Datum i vrijeme pregleda"
                type="datetime-local"
                defaultValue={localDateTime(a?.encountered_at)}
                max={localDateTime()}
                required
              />
              <Field
                name="kind"
                label="Vrsta pregleda"
                defaultValue={a?.kind ?? "Redovni pregled"}
                required
              >
                <option>Redovni pregled</option>
                <option>Kontrolni pregled</option>
                <option>Preventivni pregled</option>
                <option>Telefonska konzultacija</option>
                <option>Ostalo</option>
              </Field>
              <div className="field-full">
                <Field
                  name="reason"
                  label="Razlog dolaska"
                  defaultValue={a?.reason}
                  required
                  maxLength={2000}
                />
              </div>
              {(
                [
                  ["anamnesis", "Anamneza"],
                  ["symptoms", "Trenutne tegobe"],
                  ["objective_status", "Objektivni status"],
                ] as const
              ).map(([name, label]) => (
                <div className="field-full" key={name}>
                  <Field
                    name={name}
                    label={label}
                    type="textarea"
                    defaultValue={a?.[name]}
                  />
                </div>
              ))}
              {(
                [
                  ["systolic", "Sistolički tlak (mmHg)", 40, 300, "1"],
                  ["diastolic", "Dijastolički tlak (mmHg)", 20, 200, "1"],
                  ["pulse", "Puls (/min)", 20, 250, "1"],
                  ["temperature", "Temperatura (°C)", 25, 45, "0.1"],
                  ["spo2", "SpO₂ (%)", 0, 100, "1"],
                  ["height_cm", "Visina (cm)", 20, 250, "0.1"],
                  ["weight_kg", "Težina (kg)", 1, 500, "0.01"],
                ] as const
              ).map(([name, label, min, max, step]) => (
                <Field
                  key={name}
                  name={name}
                  label={label}
                  type="number"
                  min={min}
                  max={max}
                  step={step}
                  defaultValue={a?.[name] ?? undefined}
                />
              ))}
              <div className="field">
                <span>BMI (automatski)</span>
                <output className="bmi-output">{bmi}</output>
              </div>
              <Field
                name="primary_diagnosis"
                label="Glavna dijagnoza"
                defaultValue={a?.diagnoses.find((d) => d.is_primary)?.id ?? ""}
              >
                <option value="">Bez dijagnoze</option>
                {context.data?.diagnoses.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.code} · {d.name}
                  </option>
                ))}
              </Field>
              <label className="field">
                <span>Sekundarne dijagnoze</span>
                <select
                  name="secondary_diagnoses"
                  multiple
                  defaultValue={
                    a?.diagnoses
                      .filter((d) => !d.is_primary)
                      .map((d) => d.id) ?? []
                  }
                >
                  {context.data?.diagnoses.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.code} · {d.name}
                    </option>
                  ))}
                </select>
                <small>Za više odabira držite Ctrl / Cmd.</small>
              </label>
              {(
                [
                  ["therapy", "Terapija"],
                  ["recommendations", "Preporuke"],
                  ["notes", "Napomena liječnika"],
                ] as const
              ).map(([name, label]) => (
                <div className="field-full" key={name}>
                  <Field
                    name={name}
                    label={label}
                    type="textarea"
                    defaultValue={a?.[name]}
                  />
                </div>
              ))}
              <Field
                name="follow_up"
                label="Kontrola"
                type="date"
                defaultValue={a?.follow_up ?? undefined}
              />
              {a && (
                <div className="field-full">
                  <Field
                    name="amendment_reason"
                    label="Razlog ispravka (najmanje 5 znakova)"
                    required
                    maxLength={1000}
                  />
                </div>
              )}
            </>
          )}
          {action === "diagnosis" && (
            <>
              <Field name="diagnosis_id" label="Dijagnoza" required>
                <option value="">Odaberite dijagnozu</option>
                {context.data?.diagnoses.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.code} · {d.name}
                  </option>
                ))}
              </Field>
              <Field
                name="diagnosed_at"
                label="Datum postavljanja"
                type="date"
                defaultValue={today()}
                max={today()}
                required
              />
              <Field name="status" label="Status" defaultValue="ACTIVE">
                <option value="ACTIVE">Aktivna</option>
                <option value="CHRONIC">Kronična</option>
                <option value="SUSPECTED">Sumnja</option>
                <option value="RESOLVED">Razriješena</option>
              </Field>
              <Field name="notes" label="Napomena" type="textarea" />
            </>
          )}
          {action === "therapy" && (
            <>
              <Field name="medication_id" label="Lijek" required>
                <option value="">Odaberite lijek</option>
                {context.data?.medications.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} · {m.strength}
                  </option>
                ))}
              </Field>
              <Field name="dosage" label="Doziranje" required maxLength={500} />
              <Field
                name="frequency"
                label="Učestalost"
                required
                maxLength={300}
              />
              <Field
                name="start_date"
                label="Datum početka"
                type="date"
                defaultValue={today()}
                required
              />
              <Field name="end_date" label="Datum završetka" type="date" />
              <Field name="notes" label="Napomena" type="textarea" />
            </>
          )}
          {action === "allergy" && (
            <>
              <Field name="allergy_id" label="Alergen" required>
                <option value="">Odaberite alergen</option>
                {context.data?.allergies.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </Field>
              <Field name="severity" label="Ozbiljnost">
                <option value="UNKNOWN">Nepoznata</option>
                <option value="MILD">Blaga</option>
                <option value="MODERATE">Umjerena</option>
                <option value="SEVERE">Teška</option>
              </Field>
              <div className="field-full">
                <Field
                  name="reaction"
                  label="Reakcija / napomena"
                  type="textarea"
                />
              </div>
            </>
          )}
          {action === "warnings" && (
            <>
              <Field
                name="blood_group"
                label="Krvna grupa"
                defaultValue={chart.record?.blood_group ?? ""}
              >
                <option value="">Nepoznata</option>
                {["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </Field>
              <div className="field-full">
                <Field
                  name="warnings"
                  label="Važna medicinska upozorenja"
                  type="textarea"
                  defaultValue={chart.record?.warnings}
                />
              </div>
            </>
          )}
        </div>
        {(error || context.error) && (
          <ErrorMessage>{error || context.error}</ErrorMessage>
        )}
        <div className="modal-actions">
          <button
            type="button"
            className="secondary"
            onClick={onClose}
            disabled={busy}
          >
            Odustani
          </button>
          <button
            className="primary"
            disabled={busy || context.loading || !!context.error}
          >
            {busy
              ? "Spremanje…"
              : action === "encounter"
                ? "Spremi pregled"
                : "Spremi"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
