import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CalendarDays, Plus, ChevronLeft, ChevronRight } from "lucide-react";
import { useResource } from "../../hooks/useResource";
import { useScheduleRefresh } from "../../hooks/useScheduleRefresh";
import {
  getAppointments,
  getAppointmentDoctors,
  saveAppointment,
  setAppointmentStatus,
} from "../../services/appointments";
import { searchPatients } from "../../services/clinical";
import type { Appointment, AppointmentStatus } from "../../types/appointments";
import { appointmentStatusLabels } from "../../types/appointments";
import { Modal } from "../ui/Modal";
import { Field, values } from "../ui/Fields";
import { ErrorMessage } from "../ui/Feedback";
import { StatusBadge } from "../ui/StatusBadge";
import {
  zagrebDate,
  zagrebTime,
  shiftDate,
  calendarRange,
} from "../../utils/calendar";
import { dateLabel, readableError } from "../../utils/format";

export function AppointmentPanel({
  personal = false,
  waiting = false,
  compact = false,
  patientId,
}: {
  personal?: boolean;
  waiting?: boolean;
  compact?: boolean;
  patientId?: string;
}) {
  const [date, setDate] = useState(zagrebDate()),
    [view, setView] = useState<"day" | "week" | "month">(
      personal ? "week" : "day",
    ),
    [editing, setEditing] = useState<Appointment | null | undefined>(),
    [change, setChange] = useState<{
      appointment: Appointment;
      status: AppointmentStatus;
    } | null>(null),
    [error, setError] = useState(""),
    [success, setSuccess] = useState(""),
    [busy, setBusy] = useState(false);
  const days = calendarRange(date, waiting || compact ? "day" : view),
    from = days[0],
    to = days[days.length - 1];
  const resource = useResource(
    () => getAppointments(from, to, personal, patientId),
    [from, to, personal, patientId].join(":"),
  );
  useScheduleRefresh(resource.refresh);
  const list = resource.data ?? [],
    display = waiting
      ? list.filter((a) =>
          ["SCHEDULED", "ARRIVED", "IN_PROGRESS"].includes(a.status),
        )
      : list;
  async function transition(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!change) return;
    setBusy(true);
    setError("");
    try {
      await setAppointmentStatus(
        change.appointment.id,
        change.appointment.version,
        change.status,
        values(e.currentTarget).reason,
      );
      setChange(null);
      setSuccess("Status termina je ažuriran.");
      resource.refresh();
    } catch (e) {
      setError(readableError(e));
    } finally {
      setBusy(false);
    }
  }
  function move(direction: number) {
    if (view === "month") {
      const d = new Date(date.slice(0, 8) + "01T12:00:00Z");
      d.setUTCMonth(d.getUTCMonth() + direction);
      setDate(d.toISOString().slice(0, 10));
    } else setDate(shiftDate(date, direction * (view === "week" ? 7 : 1)));
  }
  return (
    <>
      <div className="section-heading">
        <div>
          <h2>
            <CalendarDays size={20} className="inline-icon" />{" "}
            {waiting
              ? "Današnja čekaonica"
              : compact
                ? "Današnji termini"
                : personal
                  ? "Moji termini"
                  : "Kalendar ordinacije"}
          </h2>
          <p className="muted">
            Vrijeme je prikazano za Hrvatsku (Europe/Zagreb).
          </p>
        </div>
        {!personal && (
          <button
            className="primary"
            onClick={() => {
              setError("");
              setEditing(null);
            }}
          >
            <Plus size={16} /> Novi termin
          </button>
        )}
      </div>
      {!personal && (
        <div className="schedule-summary">
          <span>
            <strong>
              {list.filter((a) => a.status === "SCHEDULED").length}
            </strong>{" "}
            naručenih
          </span>
          <span>
            <strong>{list.filter((a) => a.status === "ARRIVED").length}</strong>{" "}
            u čekaonici
          </span>
          <span>
            <strong>
              {list.filter((a) => a.status === "IN_PROGRESS").length}
            </strong>{" "}
            pregled u tijeku
          </span>
          <span>
            <strong>
              {list.filter((a) => a.status === "COMPLETED").length}
            </strong>{" "}
            završeno
          </span>
        </div>
      )}
      {!waiting && !compact && (
        <div className="calendar-toolbar">
          <button
            className="secondary"
            aria-label="Prethodno razdoblje"
            onClick={() => move(-1)}
          >
            <ChevronLeft size={18} />
          </button>
          <label className="field">
            <span>Datum prikaza</span>
            <input
              type="date"
              required
              value={date}
              onChange={(e) => {
                if (e.target.value) setDate(e.target.value);
              }}
            />
          </label>
          <button
            className="secondary"
            aria-label="Sljedeće razdoblje"
            onClick={() => move(1)}
          >
            <ChevronRight size={18} />
          </button>
          <button className="secondary" onClick={() => setDate(zagrebDate())}>
            Danas
          </button>
          <div className="calendar-views">
            {(["day", "week", "month"] as const).map((v, i) => (
              <button
                className={view === v ? "primary" : "secondary"}
                key={v}
                onClick={() => setView(v)}
              >
                {["Dan", "Tjedan", "Mjesec"][i]}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="section-heading">
        <small>
          {dateLabel(from)}
          {from !== to ? " – " + dateLabel(to) : ""}
        </small>
        <button
          className="text-link"
          disabled={resource.loading}
          onClick={resource.refresh}
        >
          Osvježi termine
        </button>
      </div>
      {success && (
        <p className="feedback success" role="status">
          {success}
        </p>
      )}
      {resource.error && <ErrorMessage>{resource.error}</ErrorMessage>}
      {resource.loading ? (
        <p role="status">Učitavanje termina…</p>
      ) : (
        <div
          className={
            days.length > 1
              ? "calendar-grid " + (view === "month" ? "month" : "week")
              : "schedule-list"
          }
        >
          {days.map((day) => (
            <section
              className={days.length > 1 ? "calendar-day" : "schedule-day"}
              key={day}
            >
              {days.length > 1 && (
                <h3 className={day === zagrebDate() ? "today" : ""}>
                  {new Intl.DateTimeFormat("hr-HR", {
                    weekday: "short",
                    day: "numeric",
                    month: "numeric",
                    timeZone: "Europe/Zagreb",
                  }).format(new Date(day + "T12:00:00Z"))}
                </h3>
              )}
              {display
                .filter((a) => zagrebDate(new Date(a.starts_at)) === day)
                .map((a) => (
                  <article className="appointment-card card" key={a.id}>
                    <div className="section-heading">
                      <strong>
                        {zagrebTime(a.starts_at)}{" "}
                        <small>· {a.duration_minutes} min</small>
                      </strong>
                      <StatusBadge status={a.status} />
                    </div>
                    {!personal && (
                      <Link to={"/ordinacija/pacijenti/" + a.patient_id}>
                        <strong>{a.patient_name}</strong>
                      </Link>
                    )}
                    <p>{a.kind}</p>
                    <small>
                      {a.doctor_name} · {a.institution}
                    </small>
                    {a.cancellation_reason && (
                      <p className="muted">
                        Razlog otkazivanja: {a.cancellation_reason}
                      </p>
                    )}
                    {a.can_manage && (
                      <div className="appointment-actions">
                        {a.status === "SCHEDULED" && (
                          <button
                            className="text-link"
                            onClick={() => setEditing(a)}
                          >
                            Premjesti / uredi
                          </button>
                        )}
                        {(a.status === "SCHEDULED"
                          ? ["ARRIVED", "NO_SHOW", "CANCELLED"]
                          : a.status === "ARRIVED"
                            ? a.can_clinical
                              ? ["IN_PROGRESS", "CANCELLED"]
                              : ["CANCELLED"]
                            : a.status === "IN_PROGRESS" && a.can_clinical
                              ? ["COMPLETED"]
                              : []
                        ).map((status) => (
                          <button
                            className="secondary"
                            key={status}
                            onClick={() => {
                              setError("");
                              setChange({
                                appointment: a,
                                status: status as AppointmentStatus,
                              });
                            }}
                          >
                            {
                              appointmentStatusLabels[
                                status as AppointmentStatus
                              ]
                            }
                          </button>
                        ))}
                      </div>
                    )}
                  </article>
                ))}
              {!display.some(
                (a) => zagrebDate(new Date(a.starts_at)) === day,
              ) && (
                <p className="empty-state">
                  {waiting ? "Nema pacijenata u čekaonici." : "Nema termina."}
                </p>
              )}
            </section>
          ))}
        </div>
      )}
      {compact && (
        <Link className="text-link" to="/ordinacija/termini">
          Otvori kalendar →
        </Link>
      )}
      {editing !== undefined && (
        <AppointmentEditor
          appointment={editing}
          patientId={patientId}
          date={date}
          onClose={() => setEditing(undefined)}
          onSaved={() => {
            setEditing(undefined);
            setSuccess("Termin je spremljen i pacijent je obaviješten.");
            resource.refresh();
          }}
        />
      )}
      {change && (
        <Modal
          title="Promjena statusa termina"
          busy={busy}
          onClose={() => setChange(null)}
        >
          <form onSubmit={transition}>
            <p>
              {change.appointment.patient_name} ·{" "}
              {dateLabel(change.appointment.starts_at)}{" "}
              {zagrebTime(change.appointment.starts_at)}
            </p>
            <p>
              Postaviti status:{" "}
              <strong>{appointmentStatusLabels[change.status]}</strong>?
            </p>
            {change.status === "CANCELLED" && (
              <Field
                name="reason"
                label="Razlog otkazivanja"
                type="textarea"
                required
                minLength={5}
                maxLength={500}
              />
            )}
            <p className="signature-note">
              Promjena se evidentira i bit će vidljiva pacijentu.
            </p>
            {error && <ErrorMessage>{error}</ErrorMessage>}
            <div className="modal-actions">
              <button
                className="secondary"
                type="button"
                disabled={busy}
                onClick={() => setChange(null)}
              >
                Odustani
              </button>
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
function AppointmentEditor({
  appointment,
  patientId,
  date,
  onClose,
  onSaved,
}: {
  appointment: Appointment | null;
  patientId?: string;
  date: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [query, setQuery] = useState(""),
    [term, setTerm] = useState(""),
    [pid, setPid] = useState(appointment?.patient_id ?? patientId ?? ""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [requestId] = useState(() => crypto.randomUUID());
  useEffect(() => {
    const timer = setTimeout(() => setTerm(query), 250);
    return () => clearTimeout(timer);
  }, [query]);
  const patients = useResource(() => searchPatients(term), term),
    doctors = useResource(
      () => (pid ? getAppointmentDoctors(pid) : Promise.resolve([])),
      pid,
    );
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fields = values(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      await saveAppointment(
        appointment?.id ?? null,
        appointment?.version ?? null,
        {
          ...fields,
          patient_id: pid,
          doctor_id: appointment?.doctor_id ?? fields.doctor_id,
        },
        requestId,
      );
      onSaved();
    } catch (e) {
      setError(readableError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={appointment ? "Uredi termin" : "Novi termin"}
      busy={busy}
      onClose={onClose}
    >
      <form onSubmit={submit}>
        {!appointment && !patientId && (
          <>
            <label className="field">
              <span>Pretraži pacijenta za termin</span>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Ime, prezime ili ID"
                maxLength={100}
              />
            </label>
            <label className="field spaced">
              <span>Pacijent</span>
              <select
                required
                value={pid}
                onChange={(e) => setPid(e.target.value)}
              >
                <option value="">Odaberite pacijenta</option>
                {patients.data?.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.first_name} {p.last_name} · {p.patient_number}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
        {appointment && (
          <p>
            {appointment.patient_name} · {appointment.doctor_name}
          </p>
        )}
        <div className="form-grid spaced">
          {!appointment && (
            <Field name="doctor_id" label="Liječnik" required>
              <option value="">Odaberite liječnika</option>
              {doctors.data?.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} · {d.institution}
                </option>
              ))}
            </Field>
          )}
          <Field
            name="local_time"
            type="datetime-local"
            label="Datum i vrijeme (Hrvatska)"
            defaultValue={
              appointment
                ? zagrebDate(new Date(appointment.starts_at)) +
                  "T" +
                  zagrebTime(appointment.starts_at)
                : date + "T08:00"
            }
            required
          />
          <Field
            name="duration_minutes"
            label="Trajanje u minutama"
            type="number"
            min={5}
            max={240}
            defaultValue={appointment?.duration_minutes ?? 15}
            required
          />
          <Field
            name="kind"
            label="Vrsta pregleda"
            required
            minLength={2}
            maxLength={100}
            defaultValue={appointment?.kind ?? "Pregled u ordinaciji"}
          />
        </div>
        <p className="signature-note">
          Spremanjem se pacijentu šalje obavijest u Moje e-Zdravstvo.
        </p>
        {(error || patients.error || doctors.error) && (
          <ErrorMessage>
            {error || patients.error || doctors.error}
          </ErrorMessage>
        )}
        <div className="modal-actions">
          <button
            className="secondary"
            type="button"
            onClick={onClose}
            disabled={busy}
          >
            Odustani
          </button>
          <button
            className="primary"
            disabled={busy || doctors.loading || !pid}
          >
            {busy ? "Spremanje…" : "Spremi termin"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
