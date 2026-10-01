import { useState } from "react";
import { ReportEditor } from "./MedicalReports";
import { listDocuments } from "../../services/documents";
import { Link } from "react-router-dom";
import {
  hospitalBookings,
  hospitalContext,
  hospitalSlots,
  hospitalRescheduleHistory,
  rescheduleHospital,
} from "../../services/hospital";
import { useResource } from "../../hooks/useResource";
import { useScheduleRefresh } from "../../hooks/useScheduleRefresh";
import {
  type HospitalMode,
  type HospitalBooking,
  type HospitalSlot,
} from "../../types/hospital";
import { Modal } from "../ui/Modal";
import { Field, values } from "../ui/Fields";
import { ErrorMessage } from "../ui/Feedback";
import { StatusBadge } from "../ui/StatusBadge";
import { db } from "../../lib/supabase";
import { unwrap } from "../../services/clinical";
import { dateLabel, readableError } from "../../utils/format";
import { zagrebDate, zagrebTime, shiftDate } from "../../utils/calendar";
export function HospitalBookings({
  mode,
  patientId,
  canBook = false,
}: {
  mode: HospitalMode;
  patientId?: string;
  canBook?: boolean;
}) {
  const [reschedule, setReschedule] = useState<HospitalBooking | null>(null);
  const [history, setHistory] = useState<HospitalBooking | null>(null);
  const [report, setReport] = useState<HospitalBooking | null>(null);
  const [page, setPage] = useState(0),
    [cancelled, setCancelled] = useState(false),
    [booking, setBooking] = useState(false),
    [change, setChange] = useState<{
      item: HospitalBooking;
      status: string;
    } | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [success, setSuccess] = useState("");
  const resource = useResource(
    () => hospitalBookings(mode, patientId, page),
    mode + (patientId ?? "") + page,
  );
  useScheduleRefresh(resource.refresh);
  async function update(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!change) return;
    setBusy(true);
    setError("");
    try {
      unwrap(
        await db().rpc("change_hospital_booking", {
          booking_id: change.item.id,
          expected_version: change.item.version,
          new_status: change.status,
          reason: values(e.currentTarget).reason ?? "",
        }),
      );
      setChange(null);
      resource.refresh();
      setSuccess("Status narudžbe je promijenjen.");
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
          <h2>
            {mode === "PROVIDER" ? "Naručeni pacijenti u bolnici" : "Narudžbe"}
          </h2>
          <p>Specijalistički pregledi i pretrage u ustanovama.</p>
        </div>
        {canBook && patientId && (
          <button className="primary" onClick={() => setBooking(true)}>
            Naruči u ustanovu
          </button>
        )}
        {mode === "CARE" && !patientId && (
          <Link className="primary" to="/ordinacija/pacijenti">
            Odaberi pacijenta
          </Link>
        )}
      </div>
      <div className="document-actions">
        <label>
          <input
            type="checkbox"
            checked={cancelled}
            onChange={(e) => setCancelled(e.target.checked)}
          />{" "}
          Prikaži i otkazane narudžbe
        </label>
        <button className="text-link" onClick={resource.refresh}>
          Osvježi narudžbe
        </button>
      </div>
      {success && (
        <p role="status" className="success-toast">
          {success}
        </p>
      )}
      {resource.error && <ErrorMessage>{resource.error}</ErrorMessage>}
      {resource.loading ? (
        <p role="status">Učitavanje narudžbi…</p>
      ) : (
        <>
          {!resource.data?.filter((b) => cancelled || b.status !== "CANCELLED")
            .length && (
            <section className="card empty-state">
              Nema narudžbi za odabrani prikaz.
            </section>
          )}
          {resource.data
            ?.filter((b) => cancelled || b.status !== "CANCELLED")
            .map((b) => (
              <section className="card spaced" key={b.id}>
                <div className="section-heading">
                  <h3>{b.service_name}</h3>
                  <StatusBadge status={b.status} />
                </div>
                <p>
                  <strong>
                    {dateLabel(zagrebDate(new Date(b.starts_at)))} u{" "}
                    {zagrebTime(b.starts_at)}
                  </strong>{" "}
                  · {b.duration_minutes} min
                </p>
                <p>
                  {b.institution_name} · {b.location}
                </p>
                <p>
                  {b.specialty} · {b.specialist_name}
                </p>
                {mode !== "PERSONAL" && (
                  <p>
                    {b.patient_name} · {b.patient_number}
                  </p>
                )}
                {b.priority && (
                  <p className="medical-alert">
                    Prioritetni pacijent · {b.priority_reason}
                  </p>
                )}
                {b.instructions && <p>Upute: {b.instructions}</p>}
                {b.cancellation_reason && (
                  <p>Razlog otkazivanja: {b.cancellation_reason}</p>
                )}
                <div className="document-actions">
                  {b.can_process &&
                    ["ARRIVED", "COMPLETED"].includes(b.status) && (
                      <button className="primary" onClick={() => setReport(b)}>
                        Napiši nalaz
                      </button>
                    )}
                  <button className="text-link" onClick={() => setHistory(b)}>
                    Povijest premještanja
                  </button>
                  {b.can_reschedule && (
                    <button
                      className="secondary"
                      onClick={() => setReschedule(b)}
                    >
                      Premjesti termin
                    </button>
                  )}
                  {b.can_cancel && b.status === "BOOKED" && (
                    <button
                      className="secondary"
                      onClick={() => {
                        setError("");
                        setChange({ item: b, status: "CANCELLED" });
                      }}
                    >
                      Otkaži narudžbu
                    </button>
                  )}
                  {b.can_process &&
                    (b.status === "BOOKED"
                      ? ["ARRIVED", "NO_SHOW"]
                      : b.status === "ARRIVED"
                        ? ["COMPLETED"]
                        : []
                    ).map((s) => (
                      <button
                        key={s}
                        className="secondary"
                        onClick={() => {
                          setError("");
                          setChange({ item: b, status: s });
                        }}
                      >
                        {s === "ARRIVED"
                          ? "Evidentiraj dolazak"
                          : s === "NO_SHOW"
                            ? "Nije došao"
                            : "Završi pregled"}
                      </button>
                    ))}
                </div>
              </section>
            ))}
        </>
      )}
      <div className="document-actions">
        <button
          className="secondary"
          disabled={page === 0 || resource.loading}
          onClick={() => setPage(page - 1)}
        >
          Prethodna
        </button>
        <span>Stranica {page + 1}</span>
        <button
          className="secondary"
          disabled={resource.data?.length !== 50 || resource.loading}
          onClick={() => setPage(page + 1)}
        >
          Sljedeća
        </button>
      </div>
      {history && (
        <RescheduleHistory booking={history} onClose={() => setHistory(null)} />
      )}
      {reschedule && (
        <BookHospital
          patientId={reschedule.patient_id}
          reschedule={reschedule}
          onClose={() => setReschedule(null)}
          onSaved={() => {
            setReschedule(null);
            resource.refresh();
            setSuccess("Termin je premješten. Pacijent je obaviješten.");
          }}
        />
      )}
      {report && (
        <ReportEditor
          patientId={report.patient_id}
          bookingId={report.id}
          onClose={() => setReport(null)}
          onSaved={() => {
            setReport(null);
            setSuccess("Nalaz je objavljen i vidljiv pacijentu.");
          }}
        />
      )}
      {booking && patientId && (
        <BookHospital
          patientId={patientId}
          onClose={() => setBooking(false)}
          onSaved={() => {
            setBooking(false);
            resource.refresh();
            setSuccess("Narudžba je potvrđena i vidljiva pacijentu.");
          }}
        />
      )}
      {change && (
        <Modal
          title="Promjena narudžbe"
          busy={busy}
          onClose={() => setChange(null)}
        >
          <form onSubmit={update}>
            <p className="confirm-box">
              {change.item.service_name} ·{" "}
              {dateLabel(zagrebDate(new Date(change.item.starts_at)))}{" "}
              {zagrebTime(change.item.starts_at)}
              <br />
              Potvrdom mijenjate status i obavještavate pacijenta.
            </p>
            {change.status === "CANCELLED" && (
              <Field
                name="reason"
                label="Razlog otkazivanja"
                required
                minLength={5}
                maxLength={500}
              />
            )}{" "}
            {error && <ErrorMessage>{error}</ErrorMessage>}
            <div className="modal-actions">
              <button className="primary" disabled={busy}>
                Potvrdi promjenu
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
function BookHospital({
  reschedule,
  patientId,
  onClose,
  onSaved,
}: {
  patientId: string;
  onClose: () => void;
  onSaved: () => void;
  reschedule?: HospitalBooking;
}) {
  const referrals = useResource(
    () =>
      reschedule ? Promise.resolve([]) : listDocuments(patientId, "REFERRAL"),
    patientId,
  );
  const context = useResource(() => hospitalContext(), "booking-context"),
    [institution, setInstitution] = useState(""),
    [specialty, setSpecialty] = useState(""),
    [service, setService] = useState(reschedule?.service_id ?? ""),
    [from, setFrom] = useState(zagrebDate()),
    [priority, setPriority] = useState(reschedule?.priority ?? false),
    [selected, setSelected] = useState<HospitalSlot | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [requestId] = useState(crypto.randomUUID());
  const slots = useResource(
    () => hospitalSlots(service, from, shiftDate(from, 30)),
    service + from,
  );
  const chosen = context.data?.services.find((s) => s.id === service);
  async function book(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!selected) return;
    const data = values(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      if (reschedule)
        await rescheduleHospital(
          reschedule,
          selected.id,
          data.move_reason,
          requestId,
        );
      else
        unwrap(
          await db().rpc("book_hospital_slot", {
            patient_id: patientId,
            slot_id: selected.id,
            referral_id: data.referral_id || null,
            priority,
            priority_reason: data.reason ?? "",
            request_id: requestId,
          }),
        );
      onSaved();
    } catch (e) {
      setError(readableError(e));
      slots.refresh();
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={
        reschedule ? "Premještanje bolničkog termina" : "Naručivanje u ustanovu"
      }
      wide
      busy={busy}
      onClose={onClose}
    >
      <div className="modal-content">
        {(context.error || slots.error || error) && (
          <ErrorMessage>{context.error || slots.error || error}</ErrorMessage>
        )}
        {selected ? (
          <form onSubmit={book}>
            <div className="confirm-box">
              <h3>{chosen?.name}</h3>
              <p>
                {chosen?.institution_name} · {chosen?.location}
              </p>
              <strong>
                {dateLabel(zagrebDate(new Date(selected.starts_at)))} u{" "}
                {zagrebTime(selected.starts_at)}
              </strong>
              <p>{chosen?.doctor_name}</p>
              <p>{chosen?.instructions}</p>
              <p>
                {reschedule
                  ? "Potvrdom premještate narudžbu i oslobađate prethodni termin. Pacijent će dobiti obavijest."
                  : "Potvrdom rezervirate termin. Narudžba će odmah biti vidljiva pacijentu."}
              </p>
            </div>
            {!reschedule && (
              <Field name="referral_id" label="Povezana uputnica">
                <option value="">Bez povezane uputnice</option>
                {referrals.data
                  ?.filter(
                    (d) =>
                      d.status === "ISSUED" && d.expires_on >= zagrebDate(),
                  )
                  .map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.number}
                    </option>
                  ))}
              </Field>
            )}
            {reschedule && (
              <Field
                name="move_reason"
                label="Razlog premještanja (vidljiv pacijentu)"
                required
                minLength={5}
                maxLength={500}
                type="textarea"
              />
            )}
            {referrals.error && <ErrorMessage>{referrals.error}</ErrorMessage>}
            {priority && !reschedule && (
              <Field
                name="reason"
                label="Razlog prioriteta"
                required
                minLength={5}
                maxLength={1000}
                type="textarea"
              />
            )}
            <div className="modal-actions">
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => setSelected(null)}
              >
                Natrag
              </button>
              <button className="primary" disabled={busy}>
                {busy
                  ? "Spremanje…"
                  : reschedule
                    ? "Potvrdi premještanje"
                    : "Potvrdi narudžbu"}
              </button>
            </div>
          </form>
        ) : (
          <>
            {reschedule && (
              <p className="confirm-box">
                {reschedule.service_name} · {reschedule.institution_name}
                <br />
                Trenutačni termin:{" "}
                {dateLabel(zagrebDate(new Date(reschedule.starts_at)))} u{" "}
                {zagrebTime(reschedule.starts_at)}. Odaberite novi slobodan
                termin za isti pregled.
              </p>
            )}
            <div className="form-grid">
              {!reschedule && (
                <>
                  <label className="field">
                    <span>Ustanova</span>
                    <select
                      value={institution}
                      onChange={(e) => {
                        setInstitution(e.target.value);
                        setSpecialty("");
                        setService("");
                      }}
                    >
                      <option value="">Odaberite ustanovu</option>
                      {[
                        ...new Map(
                          context.data?.services.map((s) => [
                            s.institution_id,
                            s.institution_name,
                          ]),
                        ).entries(),
                      ].map(([id, name]) => (
                        <option value={id} key={id}>
                          {name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>Specijalnost</span>
                    <select
                      value={specialty}
                      onChange={(e) => {
                        setSpecialty(e.target.value);
                        setService("");
                      }}
                    >
                      <option value="">Odaberite specijalnost</option>
                      {[
                        ...new Set(
                          context.data?.services
                            .filter((s) => s.institution_id === institution)
                            .map((s) => s.specialty),
                        ),
                      ].map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>Pregled / pretraga</span>
                    <select
                      value={service}
                      onChange={(e) => setService(e.target.value)}
                    >
                      <option value="">Odaberite pregled</option>
                      {context.data?.services
                        .filter(
                          (s) =>
                            s.institution_id === institution &&
                            s.specialty === specialty,
                        )
                        .map((s) => (
                          <option value={s.id} key={s.id}>
                            {s.name} · {s.doctor_name}
                          </option>
                        ))}
                    </select>
                  </label>
                </>
              )}
              <label className="field">
                <span>Pretraži 31 dan od</span>
                <input
                  type="date"
                  value={from}
                  min={zagrebDate()}
                  onChange={(e) => setFrom(e.target.value || zagrebDate())}
                />
              </label>
              {!reschedule && (
                <label>
                  <input
                    type="checkbox"
                    checked={priority}
                    onChange={(e) => setPriority(e.target.checked)}
                  />{" "}
                  Prioritetni pacijent
                </label>
              )}
            </div>
            {context.loading || slots.loading ? (
              <p role="status">Učitavanje dostupnosti…</p>
            ) : service ? (
              <>
                <p className="muted">
                  Slobodni termini · Europe/Zagreb. Dostupnost se ponovno
                  provjerava pri potvrdi.
                </p>
                <div className="slot-grid">
                  {slots.data
                    ?.filter((s) => priority || !s.priority_only)
                    .map((s) => (
                      <button
                        className="slot-choice"
                        key={s.id}
                        onClick={() => setSelected(s)}
                      >
                        <strong>
                          {dateLabel(zagrebDate(new Date(s.starts_at)))}
                        </strong>
                        <span>
                          {zagrebTime(s.starts_at)} · {s.duration_minutes} min
                        </span>
                        {s.priority_only && <small>Prioritetni termin</small>}
                      </button>
                    ))}
                </div>
                {!slots.data?.filter((s) => priority || !s.priority_only)
                  .length && (
                  <p className="empty-state">
                    Nema slobodnih termina. Promijenite razdoblje ili uslugu.
                  </p>
                )}
              </>
            ) : (
              <p>Odaberite ustanovu i pregled za prikaz slobodnih termina.</p>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

function RescheduleHistory({
  booking,
  onClose,
}: {
  booking: HospitalBooking;
  onClose: () => void;
}) {
  const history = useResource(
    () => hospitalRescheduleHistory(booking.id),
    booking.id,
  );
  return (
    <Modal title="Povijest premještanja" onClose={onClose}>
      <div className="modal-content">
        <h3>{booking.service_name}</h3>
        {history.error && <ErrorMessage>{history.error}</ErrorMessage>}
        {history.loading ? (
          <p role="status">Učitavanje povijesti…</p>
        ) : (
          <>
            {!history.data?.length && <p>Narudžba nije premještana.</p>}
            {history.data?.map((h) => (
              <section className="clinical-note" key={h.id}>
                <p>
                  {dateLabel(zagrebDate(new Date(h.old_starts_at)))}{" "}
                  {zagrebTime(h.old_starts_at)} →{" "}
                  {dateLabel(zagrebDate(new Date(h.new_starts_at)))}{" "}
                  {zagrebTime(h.new_starts_at)}
                </p>
                <p>{h.reason}</p>
                <small>
                  Evidentirano: {dateLabel(h.created_at)}{" "}
                  {zagrebTime(h.created_at)}
                </small>
              </section>
            ))}
            <p className="muted">
              Prikazuje se do 100 najnovijih premještanja.
            </p>
          </>
        )}
      </div>
    </Modal>
  );
}
