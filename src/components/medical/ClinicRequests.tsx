import { useState } from "react";
import { z } from "zod";
import { useResource } from "../../hooks/useResource";
import { useScheduleRefresh } from "../../hooks/useScheduleRefresh";
import { db } from "../../lib/supabase";
import { unwrap } from "../../services/clinical";
import { ErrorMessage } from "../ui/Feedback";
import { Field, values } from "../ui/Fields";
import { Modal } from "../ui/Modal";
import { Pagination } from "../ui/Pagination";
import { dateLabel, readableError } from "../../utils/format";
import { shiftDate, zagrebDate } from "../../utils/calendar";
const schema = z.array(
  z.object({
    id: z.string(),
    patient_id: z.string(),
    doctor_id: z.string(),
    patient_name: z.string(),
    doctor_name: z.string(),
    preferred_date: z.string(),
    preferred_period: z.enum(["MORNING", "AFTERNOON", "ANY"]),
    note: z.string(),
    status: z.enum(["PENDING", "APPROVED", "DECLINED", "CANCELLED"]),
    response: z.string().nullable(),
    appointment_starts_at: z.string().nullable(),
    version: z.number(),
  }),
);
type Request = z.infer<typeof schema>[number];
const labels = {
  PENDING: "Čeka obradu",
  APPROVED: "Termin potvrđen",
  DECLINED: "Zahtjev odbijen",
  CANCELLED: "Zahtjev otkazan",
};
const periods = {
  MORNING: "Prijepodne",
  AFTERNOON: "Poslijepodne",
  ANY: "Bilo koje vrijeme",
};
export function ClinicRequests({ personal = false }: { personal?: boolean }) {
  const [page, setPage] = useState(0),
    [creating, setCreating] = useState(false),
    [selected, setSelected] = useState<Request | null>(null),
    [approve, setApprove] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [requestId, setRequestId] = useState(crypto.randomUUID());
  const resource = useResource(
    async () =>
      schema.parse(
        unwrap(
          await db().rpc("clinic_appointment_requests", {
            personal,
            page_number: page,
          }),
        ),
      ),
    `${personal}:${page}`,
  );
  const doctors = useResource(
    async () =>
      personal
        ? z
            .array(
              z.object({
                id: z.string(),
                name: z.string(),
                institution: z.string(),
              }),
            )
            .parse(unwrap(await db().rpc("my_care_doctors", {})))
        : [],
    String(personal),
  );
  useScheduleRefresh(resource.refresh);
  async function create(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = values(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      unwrap(
        await db().rpc("request_clinic_appointment", {
          doctor_id: data.doctor_id,
          preferred_date: data.preferred_date,
          preferred_period: data.preferred_period,
          note: data.note,
          request_id: requestId,
        }),
      );
      setCreating(false);
      setRequestId(crypto.randomUUID());
      setPage(0);
      resource.refresh();
    } catch (e) {
      setError(readableError(e));
    } finally {
      setBusy(false);
    }
  }
  async function resolve(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!selected) return;
    const data = values(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      unwrap(
        await db().rpc("resolve_clinic_request", {
          request_id: selected.id,
          expected_version: selected.version,
          approve,
          response: data.response,
          appointment_data: approve
            ? {
                local_time: data.local_time,
                duration_minutes: Number(data.duration_minutes),
                kind: data.kind,
              }
            : null,
        }),
      );
      setSelected(null);
      resource.refresh();
    } catch (e) {
      setError(readableError(e));
    } finally {
      setBusy(false);
    }
  }
  async function cancel(r: Request) {
    if (!window.confirm("Otkazati ovaj zahtjev za termin?")) return;
    setBusy(true);
    setError("");
    try {
      unwrap(
        await db().rpc("cancel_clinic_request", {
          request_id: r.id,
          expected_version: r.version,
        }),
      );
      resource.refresh();
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
          <h2>Zahtjevi za termin u ordinaciji</h2>
          <p>
            Zahtjev nije rezervacija. Termin vrijedi nakon potvrde ordinacije.
            Za hitna stanja nemojte koristiti zahtjev za termin.
          </p>
        </div>
        {personal && (
          <button
            className="primary"
            onClick={() => {
              setCreating(true);
              setError("");
            }}
            disabled={doctors.loading || !doctors.data?.length}
          >
            Zatraži termin
          </button>
        )}
      </div>
      {(error || resource.error || doctors.error) && (
        <ErrorMessage>{error || resource.error || doctors.error}</ErrorMessage>
      )}
      {personal && !doctors.loading && !doctors.data?.length && (
        <p>
          Za zahtjev je potreban dodijeljeni liječnik s aktivnom skrbnom vezom.
        </p>
      )}
      {resource.loading ? (
        <p role="status">Učitavanje zahtjeva…</p>
      ) : resource.data?.length ? (
        resource.data.map((r) => (
          <section className="card spaced" key={r.id}>
            <div className="section-heading">
              <h3>{personal ? r.doctor_name : r.patient_name}</h3>
              <strong>{labels[r.status]}</strong>
            </div>
            <p>
              Željeni datum: {dateLabel(r.preferred_date)} ·{" "}
              {periods[r.preferred_period]}
            </p>
            {r.note && <p>{r.note}</p>}
            {r.response && <p>Odgovor ordinacije: {r.response}</p>}
            {r.appointment_starts_at && (
              <p>
                Potvrđeni termin:{" "}
                {new Date(r.appointment_starts_at).toLocaleString("hr-HR", {
                  timeZone: "Europe/Zagreb",
                })}
              </p>
            )}
            {r.status === "PENDING" &&
              (personal ? (
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => void cancel(r)}
                >
                  Otkaži zahtjev
                </button>
              ) : (
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() => {
                    setSelected(r);
                    setApprove(true);
                    setError("");
                  }}
                >
                  Obradi zahtjev
                </button>
              ))}
          </section>
        ))
      ) : (
        <p className="empty-state">Nema zahtjeva na ovoj stranici.</p>
      )}
      <Pagination
        page={page}
        size={resource.data?.length ?? 0}
        loading={resource.loading}
        onChange={setPage}
      />
      {creating && (
        <Modal
          title="Zahtjev za termin"
          busy={busy}
          onClose={() => setCreating(false)}
        >
          <form onSubmit={create}>
            <div className="form-grid">
              <Field label="Liječnik" name="doctor_id" required>
                {doctors.data?.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} · {d.institution}
                  </option>
                ))}
              </Field>
              <Field
                label="Željeni datum"
                name="preferred_date"
                type="date"
                min={zagrebDate()}
                max={shiftDate(zagrebDate(), 90)}
                required
              />
              <Field label="Željeno razdoblje" name="preferred_period">
                <option value="ANY">Bilo koje vrijeme</option>
                <option value="MORNING">Prijepodne</option>
                <option value="AFTERNOON">Poslijepodne</option>
              </Field>
              <Field
                label="Napomena ordinaciji"
                name="note"
                type="textarea"
                maxLength={1000}
              />
            </div>
            {error && <ErrorMessage>{error}</ErrorMessage>}
            <div className="modal-actions">
              <button className="primary" disabled={busy}>
                Pošalji zahtjev
              </button>
            </div>
          </form>
        </Modal>
      )}
      {selected && (
        <Modal
          title="Obrada zahtjeva za termin"
          busy={busy}
          onClose={() => setSelected(null)}
        >
          <form onSubmit={resolve}>
            <p>
              {selected.patient_name} · {dateLabel(selected.preferred_date)} ·{" "}
              {periods[selected.preferred_period]}
            </p>
            <label className="field">
              <span>Odluka</span>
              <select
                value={String(approve)}
                onChange={(e) => setApprove(e.target.value === "true")}
              >
                <option value="true">Potvrdi termin</option>
                <option value="false">Odbij zahtjev</option>
              </select>
            </label>
            {approve && (
              <div className="form-grid">
                <Field
                  label="Datum i vrijeme (Europe/Zagreb)"
                  name="local_time"
                  type="datetime-local"
                  defaultValue={
                    selected.preferred_date +
                    "T" +
                    (selected.preferred_period === "AFTERNOON"
                      ? "14:00"
                      : "09:00")
                  }
                  required
                />
                <Field
                  label="Trajanje u minutama"
                  name="duration_minutes"
                  type="number"
                  defaultValue={30}
                  min={5}
                  max={240}
                  required
                />
                <Field
                  label="Vrsta termina"
                  name="kind"
                  defaultValue="Pregled u ordinaciji"
                  required
                  maxLength={200}
                />
              </div>
            )}
            <Field
              label="Odgovor pacijentu"
              name="response"
              type="textarea"
              required
              minLength={5}
              maxLength={1000}
            />
            {error && <ErrorMessage>{error}</ErrorMessage>}
            <div className="modal-actions">
              <button className="primary" disabled={busy}>
                {approve ? "Potvrdi i rezerviraj termin" : "Odbij zahtjev"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
