import { useState } from "react";
import { useAuth } from "../../hooks/useAuth";
import { useResource } from "../../hooks/useResource";
import { priorityContext } from "../../services/priorityHospital";
import { hospitalContext } from "../../services/hospital";
import { db } from "../../lib/supabase";
import { unwrap } from "../../services/clinical";
import { Field, values } from "../../components/ui/Fields";
import { ErrorMessage } from "../../components/ui/Feedback";
import { readableError } from "../../utils/format";
const days = [
  "Ponedjeljak",
  "Utorak",
  "Srijeda",
  "Četvrtak",
  "Petak",
  "Subota",
  "Nedjelja",
];
const shifts = {
  MORNING: "Jutro · 07:00–13:30",
  AFTERNOON: "Poslijepodne · 13:30–19:00",
};
export function HospitalClinicsPage() {
  const { roles } = useAuth();
  const admin =
    roles.includes("SYSTEM_ADMIN") || roles.includes("INSTITUTION_ADMIN");
  const context = useResource(() => priorityContext(true), "clinic-management");
  const base = useResource(
    () => (admin ? hospitalContext(true) : Promise.resolve(null)),
    String(admin),
  );
  const [selected, setSelected] = useState(""),
    [department, setDepartment] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [success, setSuccess] = useState("");
  const clinic = context.data?.services.find(
    (s) => s.id === (selected || context.data?.services[0]?.id),
  );
  const dept = context.data?.departments.find((d) => d.id === department);
  async function save(
    e: React.FormEvent<HTMLFormElement>,
    kind: "department" | "service" | "assign" | "shift",
  ) {
    e.preventDefault();
    const data = values(e.currentTarget);
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      if (kind === "department")
        unwrap(
          await db().rpc("save_hospital_department", {
            department_id: data.department_id || null,
            institution_id: data.institution_id,
            name: data.name,
            duration_minutes: Number(data.duration_minutes),
            active: data.active !== "false",
          }),
        );
      if (kind === "service" && dept)
        unwrap(
          await db().rpc("create_priority_hospital_service", {
            department_id: dept.id,
            doctor_id: data.doctor_id,
            name: data.name,
            specialty: data.specialty,
            location: data.location,
            instructions: data.instructions,
          }),
        );
      if (kind === "assign")
        unwrap(
          await db().rpc("assign_hospital_department", {
            service_id: data.service_id,
            department_id: data.department_id,
          }),
        );
      if (kind === "shift" && clinic)
        unwrap(
          await db().rpc("set_hospital_clinic_shift", {
            service_id: clinic.id,
            weekday: Number(data.weekday),
            shift: data.shift || null,
          }),
        );
      context.refresh();
      base.refresh();
      setSuccess(
        "Postavka je spremljena. Slobodni termini računaju se prema novom rasporedu.",
      );
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
          <h1>Bolnički odjeli i ambulante</h1>
          <p>
            Trajanje pregleda određuje odjel, a specijalist postavlja smjene
            svoje ambulante.
          </p>
        </div>
      </div>
      {(error || context.error || base.error) && (
        <ErrorMessage>{error || context.error || base.error}</ErrorMessage>
      )}
      {success && (
        <p className="success-toast" role="status">
          {success}
        </p>
      )}
      {admin && (
        <section className="card spaced">
          <h2>Odjeli bolnice</h2>
          <form onSubmit={(e) => void save(e, "department")}>
            <div className="form-grid">
              <Field name="institution_id" label="Bolnica" required>
                <option value="">Odaberite bolnicu</option>
                {base.data?.institutions.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
              </Field>
              <Field
                name="name"
                label="Naziv novog odjela"
                required
                minLength={2}
                maxLength={150}
              />
              <Field name="duration_minutes" label="Trajanje pregleda">
                <option value="15">15 minuta</option>
                <option value="30">30 minuta</option>
              </Field>
            </div>
            <button className="primary spaced" disabled={busy}>
              Dodaj odjel
            </button>
          </form>
          {context.data?.departments.map((d) => (
            <form
              className="card spaced"
              key={JSON.stringify(d)}
              onSubmit={(e) => void save(e, "department")}
            >
              <input type="hidden" name="department_id" value={d.id} />
              <input
                type="hidden"
                name="institution_id"
                value={d.institution_id}
              />
              <h3>{d.institution_name}</h3>
              <div className="form-grid">
                <Field
                  name="name"
                  label="Naziv odjela"
                  required
                  maxLength={150}
                  defaultValue={d.name}
                />
                <Field
                  name="duration_minutes"
                  label="Trajanje pregleda"
                  defaultValue={d.duration_minutes}
                >
                  <option value="15">15 minuta</option>
                  <option value="30">30 minuta</option>
                </Field>
                <Field
                  name="active"
                  label="Dostupnost odjela"
                  defaultValue={String(d.active)}
                >
                  <option value="true">Aktivan</option>
                  <option value="false">Pauzirano naručivanje</option>
                </Field>
              </div>
              <button className="secondary spaced" disabled={busy}>
                Spremi odjel
              </button>
            </form>
          ))}
          <p className="note-text">
            Promjena trajanja ili pauziranje odjela ne mijenja već potvrđene
            narudžbe.
          </p>
        </section>
      )}
      {admin && (
        <section className="card spaced">
          <h2>Dodjela specijalista odjelu</h2>
          <Field
            name="clinic_department"
            label="Odjel za novu ambulantu"
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
          >
            <option value="">Odaberite odjel</option>
            {context.data?.departments
              .filter((d) => d.active)
              .map((d) => (
                <option key={d.id} value={d.id}>
                  {d.institution_name} · {d.name}
                </option>
              ))}
          </Field>
          {dept && (
            <form
              key={dept.id}
              className="spaced"
              onSubmit={(e) => void save(e, "service")}
            >
              <div className="form-grid">
                <Field name="doctor_id" label="Specijalist bolnice" required>
                  <option value="">Odaberite specijalista</option>
                  {base.data?.doctors
                    .filter((d) => d.institution_id === dept.institution_id)
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
                  minLength={2}
                  maxLength={150}
                />
                <Field
                  name="specialty"
                  label="Specijalnost za uputnicu"
                  required
                  defaultValue={dept.name}
                  minLength={2}
                  maxLength={150}
                />
                <Field
                  name="location"
                  label="Lokacija ambulante"
                  required
                  minLength={2}
                  maxLength={300}
                />
                <Field
                  name="instructions"
                  label="Upute za dolazak"
                  type="textarea"
                  maxLength={2000}
                />
              </div>
              <button className="primary spaced" disabled={busy}>
                Dodaj ambulantu specijalista
              </button>
            </form>
          )}
          <details className="spaced">
            <summary>Poveži postojeću bolničku uslugu s odjelom</summary>
            <form onSubmit={(e) => void save(e, "assign")}>
              <div className="form-grid">
                <Field name="service_id" label="Postojeća usluga" required>
                  <option value="">Odaberite uslugu</option>
                  {base.data?.services.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.institution_name} · {s.doctor_name} · {s.name}
                    </option>
                  ))}
                </Field>
                <Field name="department_id" label="Odjel iste bolnice" required>
                  <option value="">Odaberite odjel</option>
                  {context.data?.departments
                    .filter((d) => d.active)
                    .map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.institution_name} · {d.name}
                      </option>
                    ))}
                </Field>
              </div>
              <button className="secondary spaced" disabled={busy}>
                Poveži s odjelom
              </button>
            </form>
          </details>
        </section>
      )}
      <section className="card spaced">
        <h2>Smjene specijalista</h2>
        {context.loading ? (
          <p role="status">Učitavanje ambulanti…</p>
        ) : !clinic ? (
          <p>
            Nema dodijeljenih ambulanti. Administrator bolnice treba povezati
            specijalista s odjelom.
          </p>
        ) : (
          <>
            <Field
              name="clinic_service"
              label="Ambulanta specijalista"
              value={clinic.id}
              onChange={(e) => {
                setSelected(e.target.value);
                setError("");
                setSuccess("");
              }}
            >
              {context.data?.services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.institution_name} · {s.department_name} · {s.doctor_name} ·{" "}
                  {s.name}
                </option>
              ))}
            </Field>
            <p>
              Trajanje pregleda:{" "}
              <strong>{clinic.duration_minutes} minuta</strong>. Primjenjuju se
              i opće radno vrijeme i evidentirane odsutnosti liječnika.
            </p>
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Dan</th>
                    <th>Smjena ambulante</th>
                  </tr>
                </thead>
                <tbody>
                  {days.map((d, i) => (
                    <tr key={d}>
                      <td>{d}</td>
                      <td>
                        {shifts[
                          clinic.shifts.find((s) => s.weekday === i + 1)
                            ?.shift as keyof typeof shifts
                        ] ?? "Ne radi / nije postavljeno"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <form
              key={clinic.id}
              className="spaced"
              onSubmit={(e) => void save(e, "shift")}
            >
              <div className="form-grid">
                <Field name="weekday" label="Dan u tjednu">
                  {days.map((d, i) => (
                    <option key={d} value={i + 1}>
                      {d}
                    </option>
                  ))}
                </Field>
                <Field name="shift" label="Smjena">
                  <option value="MORNING">Jutro · 07:00–13:30</option>
                  <option value="AFTERNOON">Poslijepodne · 13:30–19:00</option>
                  <option value="">Ne radi / ukloni smjenu</option>
                </Field>
              </div>
              <button className="primary spaced" disabled={busy}>
                Spremi smjenu
              </button>
            </form>
            <p className="note-text">
              Termini se nude samo za postavljene smjene. Potvrđene narudžbe
              ostaju sačuvane nakon promjene rasporeda.
            </p>
          </>
        )}
      </section>
    </>
  );
}
