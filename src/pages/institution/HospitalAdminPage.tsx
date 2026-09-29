import { useState } from "react";
import { useResource } from "../../hooks/useResource";
import { hospitalContext, hospitalSlots } from "../../services/hospital";
import { db } from "../../lib/supabase";
import { unwrap } from "../../services/clinical";
import { Field, values } from "../../components/ui/Fields";
import { Modal } from "../../components/ui/Modal";
import { ErrorMessage } from "../../components/ui/Feedback";
import { readableError, dateLabel } from "../../utils/format";
import { zagrebDate, zagrebTime, shiftDate } from "../../utils/calendar";
export function HospitalAdminPage() {
  const context = useResource(() => hospitalContext(true), "hospital-admin");
  const [service, setService] = useState(""),
    [date, setDate] = useState(zagrebDate()),
    [modal, setModal] = useState<"service" | "slots" | null>(null),
    [org, setOrg] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [success, setSuccess] = useState(""),
    [closing, setClosing] = useState<string | null>(null);
  const slots = useResource(
    () => hospitalSlots(service, date, shiftDate(date, 30), true),
    service + date,
  );
  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = values(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      if (modal === "service")
        unwrap(
          await db().rpc("save_hospital_service", {
            service_id: null,
            data: { ...data, institution_id: org },
          }),
        );
      else
        unwrap(
          await db().rpc("publish_hospital_slots", {
            service_id: service,
            local_start: data.start,
            duration: Number(data.duration),
            slot_count: Number(data.count),
            priority_only: data.priority === "true",
          }),
        );
      setModal(null);
      context.refresh();
      slots.refresh();
      setSuccess("Promjena je spremljena.");
    } catch (e) {
      setError(readableError(e));
    } finally {
      setBusy(false);
    }
  }
  async function close() {
    if (!closing) return;
    setBusy(true);
    setError("");
    try {
      unwrap(await db().rpc("close_hospital_slot", { slot_id: closing }));
      setClosing(null);
      slots.refresh();
      setSuccess("Slobodni termin je zatvoren.");
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
          <div className="eyebrow">USTANOVE · DOSTUPNOST</div>
          <h1>Bolničke usluge i termini</h1>
          <p>Objavite slobodne termine za naručivanje iz ordinacija.</p>
        </div>
        <button
          className="primary"
          onClick={() => {
            setError("");
            setModal("service");
          }}
        >
          Nova usluga
        </button>
      </div>
      {success && (
        <p role="status" className="success-toast">
          {success}
        </p>
      )}
      {(context.error || slots.error) && (
        <ErrorMessage>{context.error || slots.error}</ErrorMessage>
      )}
      {context.loading ? (
        <p role="status">Učitavanje usluga…</p>
      ) : (
        <section className="card spaced">
          <div className="form-grid">
            <label className="field">
              <span>Bolnička usluga</span>
              <select
                value={service}
                onChange={(e) => setService(e.target.value)}
              >
                <option value="">Odaberite uslugu</option>
                {context.data?.services.map((s) => (
                  <option value={s.id} key={s.id}>
                    {s.institution_name} · {s.name} · {s.doctor_name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Termini od</span>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value || zagrebDate())}
              />
            </label>
          </div>
          {service && (
            <button
              className="primary spaced"
              onClick={() => {
                setError("");
                setModal("slots");
              }}
            >
              Objavi slobodne termine
            </button>
          )}
          {context.data?.services.length === 0 && (
            <p>Nema usluga. Dodajte uslugu i liječnika svoje ustanove.</p>
          )}
        </section>
      )}
      {service && (
        <section className="card spaced">
          <h2>Sljedećih 31 dan</h2>
          {slots.loading ? (
            <p role="status">Učitavanje termina…</p>
          ) : slots.data?.length === 0 ? (
            <p>Nema objavljenih termina u ovom razdoblju.</p>
          ) : (
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Datum i vrijeme</th>
                    <th>Trajanje</th>
                    <th>Namjena</th>
                    <th>Status</th>
                    <th>Radnja</th>
                  </tr>
                </thead>
                <tbody>
                  {slots.data?.map((s) => (
                    <tr key={s.id}>
                      <td>
                        {dateLabel(zagrebDate(new Date(s.starts_at)))} ·{" "}
                        {zagrebTime(s.starts_at)}
                      </td>
                      <td>{s.duration_minutes} min</td>
                      <td>
                        {s.priority_only ? "Prioritetni" : "Svi pacijenti"}
                      </td>
                      <td>
                        {s.booked
                          ? "Rezervirano"
                          : s.active
                            ? "Slobodno"
                            : "Zatvoreno"}
                      </td>
                      <td>
                        {s.active && !s.booked && (
                          <button
                            className="text-link"
                            onClick={() => {
                              setError("");
                              setClosing(s.id);
                            }}
                          >
                            Zatvori termin
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
      {modal && (
        <Modal
          title={
            modal === "service" ? "Nova bolnička usluga" : "Objava termina"
          }
          busy={busy}
          onClose={() => setModal(null)}
        >
          <form onSubmit={save}>
            <div className="form-grid">
              {modal === "service" ? (
                <>
                  <label className="field">
                    <span>Ustanova</span>
                    <select
                      required
                      value={org}
                      onChange={(e) => setOrg(e.target.value)}
                    >
                      <option value="">Odaberite ustanovu</option>
                      {context.data?.institutions.map((i) => (
                        <option value={i.id} key={i.id}>
                          {i.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <Field name="doctor_id" label="Liječnik specijalist" required>
                    <option value="">Odaberite liječnika</option>
                    {context.data?.doctors
                      .filter((d) => d.institution_id === org)
                      .map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.display_name}
                        </option>
                      ))}
                  </Field>
                  <Field
                    name="name"
                    label="Naziv pregleda"
                    required
                    maxLength={150}
                  />
                  <Field
                    name="specialty"
                    label="Specijalnost"
                    required
                    maxLength={150}
                  />
                  <Field
                    name="location"
                    label="Lokacija i ambulanta"
                    required
                    maxLength={300}
                  />
                  <Field
                    name="instructions"
                    label="Upute za dolazak"
                    type="textarea"
                    maxLength={2000}
                  />
                </>
              ) : (
                <>
                  <Field
                    name="start"
                    label="Prvi termin (Europe/Zagreb)"
                    type="datetime-local"
                    required
                  />
                  <Field
                    name="duration"
                    label="Trajanje u minutama"
                    type="number"
                    min={5}
                    max={240}
                    defaultValue={30}
                    required
                  />
                  <Field
                    name="count"
                    label="Broj uzastopnih termina"
                    type="number"
                    min={1}
                    max={48}
                    defaultValue={1}
                    required
                  />
                  <label>
                    <input type="checkbox" name="priority" value="true" /> Samo
                    za prioritetne pacijente
                  </label>
                </>
              )}
            </div>
            {error && <ErrorMessage>{error}</ErrorMessage>}
            <p className="confirm-box">
              Potvrdom objavljujete podatke dostupne liječnicima za naručivanje.
            </p>
            <div className="modal-actions">
              <button className="primary" disabled={busy}>
                {busy ? "Spremanje…" : "Potvrdi objavu"}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {closing && (
        <Modal
          title="Zatvaranje slobodnog termina"
          busy={busy}
          onClose={() => setClosing(null)}
        >
          <div className="modal-content">
            <p>
              Termin više neće biti dostupan za nove narudžbe. Postojeća
              evidencija ostaje sačuvana.
            </p>
            {error && <ErrorMessage>{error}</ErrorMessage>}
            <button
              className="primary"
              disabled={busy}
              onClick={() => void close()}
            >
              Potvrdi zatvaranje
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
