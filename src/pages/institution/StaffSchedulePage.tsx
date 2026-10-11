import { useState } from "react";
import { z } from "zod";
import { useResource } from "../../hooks/useResource";
import { db } from "../../lib/supabase";
import { unwrap } from "../../services/clinical";
import { ErrorMessage } from "../../components/ui/Feedback";
import { Field, values } from "../../components/ui/Fields";
import { readableError } from "../../utils/format";
const scheduleSchema = z.array(
  z.object({
    id: z.string(),
    name: z.string(),
    institution: z.string(),
    institution_id: z.string(),
    hours: z.array(
      z.object({
        weekday: z.number(),
        starts_at: z.string(),
        ends_at: z.string(),
      }),
    ),
    absences: z.array(
      z.object({
        id: z.string(),
        starts_at: z.string(),
        ends_at: z.string(),
        reason: z.string(),
        cancelled_at: z.string().nullable(),
        substitute_name: z.string().nullable(),
      }),
    ),
  }),
);
const weekdays = [
  "Ponedjeljak",
  "Utorak",
  "Srijeda",
  "Četvrtak",
  "Petak",
  "Subota",
  "Nedjelja",
];
const stamp = (value: string) =>
  new Date(value).toLocaleString("hr-HR", { timeZone: "Europe/Zagreb" });
export function StaffSchedulePage() {
  const resource = useResource(
    async () =>
      scheduleSchema.parse(unwrap(await db().rpc("doctor_schedule", {}))),
    "schedule",
  );
  const [selected, setSelected] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [success, setSuccess] = useState("");
  const doctor = resource.data?.find(
    (d) => d.id === (selected || resource.data?.[0]?.id),
  );
  async function saveHours(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!doctor) return;
    const data = values(e.currentTarget);
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      unwrap(
        await db().rpc("set_doctor_hours", {
          doctor_id: doctor.id,
          weekday: Number(data.weekday),
          starts_at: data.starts_at || "08:00",
          ends_at: data.ends_at || "16:00",
          enabled: data.enabled === "true",
        }),
      );
      resource.refresh();
      setSuccess("Radno vrijeme je spremljeno.");
    } catch (e) {
      setError(readableError(e));
    } finally {
      setBusy(false);
    }
  }
  async function absence(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!doctor) return;
    const form = e.currentTarget,
      data = values(form);
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      unwrap(
        await db().rpc("record_doctor_absence", {
          doctor_id: doctor.id,
          starts_at: data.starts_at,
          ends_at: data.ends_at,
          substitute_id: data.substitute_id || null,
          reason: data.reason,
        }),
      );
      form.reset();
      resource.refresh();
      setSuccess("Odsutnost je evidentirana.");
    } catch (e) {
      setError(readableError(e));
    } finally {
      setBusy(false);
    }
  }
  async function cancel(id: string) {
    setBusy(true);
    setError("");
    try {
      unwrap(await db().rpc("cancel_doctor_absence", { absence_id: id }));
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
          <h1>Radno vrijeme i odsutnosti</h1>
          <p>Raspored liječnika, planirane odsutnosti i dogovorene zamjene.</p>
        </div>
      </div>
      {(error || resource.error) && (
        <ErrorMessage>{error || resource.error}</ErrorMessage>
      )}
      {success && (
        <p role="status" className="success-toast">
          {success}
        </p>
      )}
      {resource.loading ? (
        <p role="status">Učitavanje rasporeda…</p>
      ) : !doctor ? (
        <p>Nema liječnika za koje možete uređivati raspored.</p>
      ) : (
        <>
          <Field
            label="Liječnik"
            name="schedule_doctor"
            value={doctor.id}
            onChange={(e) => {
              setSelected(e.target.value);
              setSuccess("");
              setError("");
            }}
          >
            {resource.data?.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} · {d.institution}
              </option>
            ))}
          </Field>
          <section className="card spaced">
            <h2>Tjedno radno vrijeme</h2>
            <p>
              Novi termini moraju biti unutar postavljenog radnog vremena. Dok
              raspored nije postavljen, termini nisu ograničeni radnim vremenom.
              Postojeći termini ostaju sačuvani.
            </p>
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Dan</th>
                    <th>Radno vrijeme</th>
                  </tr>
                </thead>
                <tbody>
                  {weekdays.map((name, i) => {
                    const h = doctor.hours.find((h) => h.weekday === i + 1);
                    return (
                      <tr key={name}>
                        <td>{name}</td>
                        <td>
                          {h
                            ? `${h.starts_at.slice(0, 5)} – ${h.ends_at.slice(0, 5)}`
                            : "Nije postavljeno"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <form onSubmit={saveHours} className="spaced">
              <div className="form-grid">
                <Field label="Dan" name="weekday" required>
                  {weekdays.map((name, i) => (
                    <option key={name} value={i + 1}>
                      {name}
                    </option>
                  ))}
                </Field>
                <Field
                  label="Početak smjene"
                  name="starts_at"
                  type="time"
                  defaultValue="08:00"
                  required
                />
                <Field
                  label="Završetak smjene"
                  name="ends_at"
                  type="time"
                  defaultValue="16:00"
                  required
                />
                <Field label="Postavka" name="enabled">
                  <option value="true">Postavi radno vrijeme</option>
                  <option value="false">Ukloni postavku za ovaj dan</option>
                </Field>
              </div>
              <button className="primary" disabled={busy}>
                Spremi radno vrijeme
              </button>
            </form>
          </section>
          <section className="card spaced">
            <h2>Planirana odsutnost</h2>
            <p>
              Datumi i vremena su u zoni Europe/Zagreb. Prije evidentiranja
              odsutnosti premjestite postojeće termine koji se preklapaju.
              Odabir zamjene sam po sebi ne dodjeljuje pristup kartonima;
              ovlasti se uređuju kroz Skrbne timove.
            </p>
            <form key={doctor.id} onSubmit={absence}>
              <div className="form-grid">
                <Field
                  label="Odsutnost od"
                  name="starts_at"
                  type="datetime-local"
                  required
                />
                <Field
                  label="Odsutnost do"
                  name="ends_at"
                  type="datetime-local"
                  required
                />
                <Field label="Zamjena" name="substitute_id">
                  <option value="">Bez evidentirane zamjene</option>
                  {resource.data
                    ?.filter(
                      (d) =>
                        d.id !== doctor.id &&
                        d.institution_id === doctor.institution_id,
                    )
                    .map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                </Field>
                <Field
                  label="Razlog / napomena"
                  name="reason"
                  required
                  minLength={5}
                  maxLength={500}
                />
              </div>
              <button className="primary" disabled={busy}>
                Evidentiraj odsutnost
              </button>
            </form>
            {doctor.absences.map((a) => (
              <div className="clinical-note spaced" key={a.id}>
                <strong>
                  {stamp(a.starts_at)} – {stamp(a.ends_at)}
                </strong>
                <p>{a.reason}</p>
                {a.substitute_name && <p>Zamjena: {a.substitute_name}</p>}
                {a.cancelled_at ? (
                  <p>Odsutnost otkazana</p>
                ) : (
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy}
                    onClick={() => void cancel(a.id)}
                  >
                    Otkaži odsutnost
                  </button>
                )}
              </div>
            ))}
          </section>
        </>
      )}
    </>
  );
}
