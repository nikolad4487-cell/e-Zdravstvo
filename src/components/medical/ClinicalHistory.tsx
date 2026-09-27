import { useState } from "react";
import type { PatientChart, MedicalEncounter } from "../../types/clinical";
import { dateLabel, readableError } from "../../utils/format";
import { db } from "../../lib/supabase";
import { unwrap } from "../../services/clinical";
import { Modal } from "../ui/Modal";
import { ErrorMessage } from "../ui/Feedback";
export const clinicalStatus: Record<string, string> = {
  ACTIVE: "Aktivno",
  CHRONIC: "Kronična",
  RESOLVED: "Razriješena",
  SUSPECTED: "Sumnja",
  STOPPED: "Prekinuta",
  COMPLETED: "Završeno",
};
export function ClinicalHistory({
  tab,
  chart,
  onAmend,
  onRefresh,
}: {
  tab: string;
  chart: PatientChart;
  onAmend: (e: MedicalEncounter) => void;
  onRefresh: () => void;
}) {
  const [change, setChange] = useState<{
      kind: string;
      id: string;
      status: string;
    } | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function confirm() {
    if (!change) return;
    setBusy(true);
    try {
      unwrap(
        await db().rpc("set_clinical_status", {
          entity_type: change.kind,
          entity_id: change.id,
          new_status: change.status,
        }),
      );
      setChange(null);
      onRefresh();
    } catch (e) {
      setError(readableError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="section-stack">
      {tab === "POVIJEST" &&
        (chart.encounters.length ? (
          chart.encounters.map((e) => (
            <section className="card" key={e.id}>
              <div className="item-head">
                <div>
                  <h3>{e.kind}</h3>
                  <p>
                    {dateLabel(e.encountered_at)} · {e.doctor_name}
                  </p>
                </div>
                <span className="status-text">
                  {e.superseded_by
                    ? "Zamijenjena verzija"
                    : e.supersedes_id
                      ? "Ispravljena verzija"
                      : "Spremljeno"}
                </span>
              </div>
              <h3>{e.reason}</h3>
              <dl className="detail-grid">
                {[
                  [
                    "Tlak",
                    e.systolic
                      ? `${e.systolic}/${e.diastolic ?? "—"} mmHg`
                      : null,
                  ],
                  ["Puls", e.pulse ? `${e.pulse}/min` : null],
                  ["Temperatura", e.temperature ? `${e.temperature} °C` : null],
                  ["SpO₂", e.spo2 !== null ? `${e.spo2}%` : null],
                  [
                    "Visina / težina",
                    e.height_cm || e.weight_kg
                      ? `${e.height_cm ?? "—"} cm / ${e.weight_kg ?? "—"} kg`
                      : null,
                  ],
                  ["BMI", e.bmi?.toString()],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value ?? "—"}</dd>
                  </div>
                ))}
              </dl>
              {(
                [
                  ["Anamneza", e.anamnesis],
                  ["Tegobe", e.symptoms],
                  ["Objektivni status", e.objective_status],
                  [
                    "Dijagnoze",
                    e.diagnoses.map((d) => d.code + " " + d.name).join("; "),
                  ],
                  ["Terapija", e.therapy],
                  ["Preporuke", e.recommendations],
                  ["Napomena", e.notes],
                  ["Razlog ispravka", e.amendment_reason],
                ] as const
              )
                .filter(([, v]) => v)
                .map(([label, value]) => (
                  <div className="clinical-note" key={label}>
                    <strong>{label}</strong>
                    <p className="note-text">{value}</p>
                  </div>
                ))}
              {e.follow_up && (
                <p className="note-text">Kontrola: {dateLabel(e.follow_up)}</p>
              )}
              {chart.can_write && !e.superseded_by && (
                <button className="secondary" onClick={() => onAmend(e)}>
                  Izradi ispravak pregleda
                </button>
              )}
            </section>
          ))
        ) : (
          <section className="card empty-state">
            Još nema zabilježenih pregleda.
          </section>
        ))}
      {tab === "DIJAGNOZE" &&
        (chart.diagnoses.length ? (
          chart.diagnoses.map((d) => (
            <section className="card" key={d.id}>
              <div className="item-head">
                <div>
                  <h3>
                    {d.code} · {d.name}
                  </h3>
                  <p>
                    {dateLabel(d.diagnosed_at)} · {d.doctor_name}
                  </p>
                </div>
                <span className="status-text">{clinicalStatus[d.status]}</span>
              </div>
              <p className="note-text">{d.notes || "Bez napomene."}</p>
              {chart.can_write && d.status !== "RESOLVED" && (
                <button
                  className="secondary"
                  onClick={() => {
                    setError("");
                    setChange({
                      kind: "diagnosis",
                      id: d.id,
                      status: "RESOLVED",
                    });
                  }}
                >
                  Označi razriješenom
                </button>
              )}
            </section>
          ))
        ) : (
          <section className="card empty-state">
            Nema evidentiranih dijagnoza.
          </section>
        ))}
      {tab === "TERAPIJA" &&
        (chart.therapy.length ? (
          chart.therapy.map((t) => (
            <section className="card" key={t.id}>
              <div className="item-head">
                <div>
                  <h3>
                    {t.name} · {t.strength}
                  </h3>
                  <p>
                    {dateLabel(t.start_date)} – {dateLabel(t.end_date)} ·{" "}
                    {t.doctor_name}
                  </p>
                </div>
                <span className="status-text">{clinicalStatus[t.status]}</span>
              </div>
              <p className="note-text">
                <strong>{t.dosage}</strong> · {t.frequency}
              </p>
              <p className="note-text">{t.notes}</p>
              {chart.can_write && t.status === "ACTIVE" && (
                <div className="row-actions">
                  <button
                    className="secondary"
                    onClick={() => {
                      setError("");
                      setChange({
                        kind: "therapy",
                        id: t.id,
                        status: "COMPLETED",
                      });
                    }}
                  >
                    Završi terapiju
                  </button>
                  <button
                    className="secondary"
                    onClick={() => {
                      setError("");
                      setChange({
                        kind: "therapy",
                        id: t.id,
                        status: "STOPPED",
                      });
                    }}
                  >
                    Prekini terapiju
                  </button>
                </div>
              )}
            </section>
          ))
        ) : (
          <section className="card empty-state">
            Nema evidentirane terapije.
          </section>
        ))}
      {change && (
        <Modal
          title="Potvrdi promjenu statusa"
          busy={busy}
          onClose={() => setChange(null)}
        >
          <div className="modal-content">
            <p>
              Promijeniti status u „{clinicalStatus[change.status]}”? Promjena
              će ostati zabilježena u audit evidenciji.
            </p>
            {error && <ErrorMessage>{error}</ErrorMessage>}
            <div className="modal-actions">
              <button
                className="secondary"
                onClick={() => setChange(null)}
                disabled={busy}
              >
                Odustani
              </button>
              <button
                className="primary"
                onClick={() => void confirm()}
                disabled={busy}
              >
                Potvrdi
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
