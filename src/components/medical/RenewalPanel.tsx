import { useState } from "react";
import { useResource } from "../../hooks/useResource";
import { useScheduleRefresh } from "../../hooks/useScheduleRefresh";
import {
  renewalOverview,
  type RenewalTherapy,
  type RenewalRequest,
} from "../../services/communication";
import { db } from "../../lib/supabase";
import { unwrap } from "../../services/clinical";
import { Modal } from "../ui/Modal";
import { Field, values } from "../ui/Fields";
import { ErrorMessage } from "../ui/Feedback";
import { dateLabel, readableError } from "../../utils/format";
import { shiftDate, zagrebDate } from "../../utils/calendar";
export function RenewalPanel({
  personal = false,
  patientId,
}: {
  personal?: boolean;
  patientId?: string;
}) {
  const resource = useResource(
    () => renewalOverview(personal, patientId),
    String(personal) + (patientId ?? ""),
  );
  useScheduleRefresh(resource.refresh);
  const [action, setAction] = useState<{
      kind: "permission" | "request" | "resolve";
      therapy: RenewalTherapy;
      request?: RenewalRequest;
    } | null>(null),
    [approve, setApprove] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [success, setSuccess] = useState("");
  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!action) return;
    const data = values(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      if (action.kind === "permission")
        unwrap(
          await db().rpc("set_renewal_allowed", {
            therapy_id: action.therapy.id,
            allowed: !action.therapy.renewal_allowed,
          }),
        );
      else if (action.kind === "request")
        unwrap(
          await db().rpc("request_medication_renewal", {
            therapy_id: action.therapy.id,
            note: data.note ?? "",
          }),
        );
      else if (action.request)
        unwrap(
          await db().rpc("resolve_medication_renewal", {
            renewal_id: action.request.id,
            approve,
            response: data.response ?? "",
            prescription_data: approve
              ? {
                  expires_on: data.expires_on,
                  items: [
                    {
                      medication_id: action.therapy.medication_id,
                      dosage: data.dosage,
                      quantity: Number(data.quantity),
                      route: data.route,
                      duration: data.duration,
                      notes: "",
                    },
                  ],
                }
              : null,
          }),
        );
      setAction(null);
      resource.refresh();
      setSuccess("Promjena je spremljena.");
    } catch (e) {
      setError(readableError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <h2>Obnova lijekova</h2>
          <p>
            Zahtjev za obnovu odobrene terapije pregledava liječnik prije
            izdavanja recepta.
          </p>
        </div>
      </div>
      {success && (
        <p className="success-toast" role="status">
          {success}
        </p>
      )}
      {resource.error && <ErrorMessage>{resource.error}</ErrorMessage>}
      {resource.loading ? (
        <p role="status">Učitavanje terapije…</p>
      ) : (
        <>
          <section className="card spaced">
            <h3>Terapije i dopuštenje obnove</h3>
            {!resource.data?.therapies.length && (
              <p>Nema evidentirane terapije.</p>
            )}
            {resource.data?.therapies.map((t) => (
              <div className="renewal-row" key={t.id}>
                <div>
                  <strong>
                    {t.name} · {t.strength}
                  </strong>
                  {!personal && <p>{t.patient_name}</p>}
                  <p>
                    {t.dosage} · {t.frequency}
                  </p>
                  <small>
                    {t.renewal_allowed
                      ? "Obnova dopuštena"
                      : "Obnova nije dopuštena"}{" "}
                    ·{" "}
                    {t.status === "ACTIVE"
                      ? "Aktivna terapija"
                      : "Neaktivna terapija"}
                  </small>
                </div>
                {!personal ? (
                  <button
                    className="secondary"
                    onClick={() => {
                      setError("");
                      setAction({ kind: "permission", therapy: t });
                    }}
                  >
                    {t.renewal_allowed ? "Isključi obnovu" : "Dopusti obnovu"}
                  </button>
                ) : (
                  t.renewal_allowed &&
                  t.status === "ACTIVE" &&
                  (!t.end_date || t.end_date >= zagrebDate()) && (
                    <button
                      className="primary"
                      disabled={resource.data?.requests.some(
                        (r) => r.therapy_id === t.id && r.status === "PENDING",
                      )}
                      onClick={() => {
                        setError("");
                        setAction({ kind: "request", therapy: t });
                      }}
                    >
                      Zatraži obnovu
                    </button>
                  )
                )}
              </div>
            ))}
          </section>
          <section className="card spaced">
            <h3>Zahtjevi</h3>
            {!resource.data?.requests.length && <p>Nema zahtjeva za obnovu.</p>}
            {resource.data?.requests.map((r) => (
              <div className="renewal-row" key={r.id}>
                <div>
                  <strong>{r.medication_name}</strong>
                  <p>
                    {!personal ? r.patient_name + " · " : ""}
                    {dateLabel(r.created_at)} ·{" "}
                    {r.status === "PENDING"
                      ? "Čeka liječnika"
                      : r.status === "APPROVED"
                        ? "Odobreno — recept je izdan"
                        : "Odbijeno"}
                  </p>
                  {r.note && <p className="note-text">{r.note}</p>}
                  {r.response && (
                    <p className="note-text">Odgovor: {r.response}</p>
                  )}
                </div>
                {!personal && r.status === "PENDING" && (
                  <button
                    className="primary"
                    onClick={() => {
                      const t = resource.data?.therapies.find(
                        (t) => t.id === r.therapy_id,
                      );
                      if (t) {
                        setApprove(false);
                        setError("");
                        setAction({ kind: "resolve", therapy: t, request: r });
                      }
                    }}
                  >
                    Obradi zahtjev
                  </button>
                )}
              </div>
            ))}
          </section>
        </>
      )}
      {action && (
        <Modal
          title={
            action.kind === "resolve"
              ? "Obrada zahtjeva"
              : action.kind === "request"
                ? "Zahtjev za obnovu"
                : "Dopuštenje obnove"
          }
          busy={busy}
          onClose={() => setAction(null)}
        >
          <form onSubmit={save}>
            <h3>
              {action.therapy.name} · {action.therapy.strength}
            </h3>
            {action.kind === "permission" ? (
              <p className="confirm-box">
                Potvrdom{" "}
                {action.therapy.renewal_allowed ? "isključujete" : "dopuštate"}{" "}
                pacijentu slanje zahtjeva za obnovu ove terapije. Svaki zahtjev
                i dalje zahtijeva liječničku odluku.
              </p>
            ) : action.kind === "request" ? (
              <>
                <Field
                  name="note"
                  label="Poruka liječniku"
                  type="textarea"
                  maxLength={1000}
                />
                <p>Slanje zahtjeva ne izdaje recept automatski.</p>
              </>
            ) : (
              <>
                <label className="field">
                  <span>Odluka</span>
                  <select
                    value={String(approve)}
                    onChange={(e) => setApprove(e.target.value === "true")}
                  >
                    <option value="false">Odbij zahtjev</option>
                    <option value="true">Odobri i izdaj recept</option>
                  </select>
                </label>
                {approve && (
                  <div className="form-grid">
                    <Field
                      name="dosage"
                      label="Doziranje"
                      required
                      defaultValue={action.therapy.dosage}
                    />
                    <Field
                      name="quantity"
                      label="Količina"
                      type="number"
                      required
                      min={1}
                      max={999}
                      defaultValue={1}
                    />
                    <Field
                      name="route"
                      label="Način primjene"
                      required
                      defaultValue={action.therapy.route}
                    />
                    <Field name="duration" label="Trajanje terapije" required />
                    <Field
                      name="expires_on"
                      label="Recept vrijedi do"
                      type="date"
                      required
                      defaultValue={shiftDate(zagrebDate(), 30)}
                    />
                  </div>
                )}
                <Field
                  name="response"
                  label="Odgovor / obrazloženje"
                  type="textarea"
                  required={!approve}
                  minLength={approve ? 0 : 5}
                  maxLength={1000}
                />
                <p className="confirm-box">
                  {approve
                    ? "Potvrdom izdajete recept vidljiv pacijentu."
                    : "Potvrdom odbijate zahtjev i šaljete obrazloženje pacijentu."}
                </p>
              </>
            )}
            {error && <ErrorMessage>{error}</ErrorMessage>}
            <div className="modal-actions">
              <button className="primary" disabled={busy}>
                {busy ? "Spremanje…" : "Potvrdi"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
