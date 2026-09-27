import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowUpRight, Plus, Search, Users } from "lucide-react";
import { useResource } from "../../hooks/useResource";
import { useAuth } from "../../hooks/useAuth";
import {
  createPatient,
  getContext,
  searchPatients,
} from "../../services/clinical";
import { Modal } from "../../components/ui/Modal";
import { Field, values } from "../../components/ui/Fields";
import { ErrorMessage } from "../../components/ui/Feedback";
import { dateLabel, readableError, today } from "../../utils/format";
export function NewPatient({ onClose }: { onClose: () => void }) {
  const auth = useAuth(),
    navigate = useNavigate();
  const context = useResource(getContext, "context");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = values(e.currentTarget);
    setBusy(true);
    try {
      const id = await createPatient(data, data.doctor_id);
      navigate("/ordinacija/pacijenti/" + id);
      onClose();
    } catch (e) {
      setError(readableError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Novi pacijent" onClose={onClose} busy={busy} wide>
      <form onSubmit={save}>
        <p className="form-intro">
          Interni ID dodjeljuje se automatski. Za testiranje koristite
          izmišljene podatke.
        </p>
        <div className="form-grid">
          <Field label="Ime" name="first_name" required maxLength={100} />
          <Field label="Prezime" name="last_name" required maxLength={100} />
          <Field
            label="Datum rođenja"
            name="birth_date"
            type="date"
            required
            min="1900-01-01"
            max={today()}
          />
          <Field label="Spol" name="sex" required>
            <option value="UNKNOWN">Nije naveden</option>
            <option value="F">Ženski</option>
            <option value="M">Muški</option>
            <option value="OTHER">Drugo</option>
          </Field>
          <Field label="Adresa" name="address" />
          <Field label="Grad" name="city" />
          <Field label="Poštanski broj" name="postal_code" />
          <Field label="Telefon" name="phone" />
          <Field label="E-mail" name="email" type="email" />
          <Field label="Zdravstveno osiguranje" name="insurance" />
          <Field label="Kontakt za hitne slučajeve" name="emergency_contact" />
          <Field label="Izabrani liječnik" name="doctor_id" required>
            <option value="">Odaberite ordinaciju</option>
            {context.data?.doctors
              .filter((d) => d.user_id === auth.session?.user.id)
              .map((d) => (
                <option key={d.id} value={d.id}>
                  {d.display_name} · {d.specialty}
                </option>
              ))}
          </Field>
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
          <button className="primary" disabled={busy || context.loading}>
            {busy ? "Spremanje…" : "Spremi pacijenta"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
export function PatientsPage() {
  const [search, setSearch] = useState(""),
    [term, setTerm] = useState(""),
    [creating, setCreating] = useState(false);
  const auth = useAuth();
  useEffect(() => {
    const t = setTimeout(() => setTerm(search), 300);
    return () => clearTimeout(t);
  }, [search]);
  const patients = useResource(() => searchPatients(term), term);
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">ORDINACIJA / PACIJENTI</div>
          <h1>Vaši pacijenti</h1>
          <p>Pacijenti za koje imate aktivnu ovlast pristupa.</p>
        </div>
        {auth.roles.includes("DOCTOR") && (
          <button className="primary" onClick={() => setCreating(true)}>
            <Plus size={17} />
            Novi pacijent
          </button>
        )}
      </div>
      <section className="card">
        <div className="list-toolbar">
          <div className="search-input">
            <Search size={18} />
            <input
              autoFocus
              aria-label="Pretraži pacijente"
              placeholder="Ime, prezime, ID ili datum rođenja…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <span className="muted">{patients.data?.length ?? 0} rezultata</span>
        </div>
        {patients.error && <ErrorMessage>{patients.error}</ErrorMessage>}
        {patients.loading ? (
          <p className="empty-state" role="status">
            Učitavanje pacijenata…
          </p>
        ) : patients.data?.length ? (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Pacijent</th>
                  <th>Datum rođenja</th>
                  <th>ID pacijenta</th>
                  <th>Izabrani liječnik</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {patients.data.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <Link
                        className="patient-link"
                        to={"/ordinacija/pacijenti/" + p.id}
                      >
                        <span className="avatar">
                          {p.first_name[0]}
                          {p.last_name[0]}
                        </span>
                        <strong>
                          {p.first_name} {p.last_name}
                        </strong>
                      </Link>
                    </td>
                    <td>{dateLabel(p.birth_date)}</td>
                    <td>
                      <code>{p.patient_number}</code>
                    </td>
                    <td>{p.primary_doctor ?? "Nije dodijeljen"}</td>
                    <td>
                      <Link
                        aria-label={
                          "Otvori karton: " + p.first_name + " " + p.last_name
                        }
                        to={"/ordinacija/pacijenti/" + p.id}
                      >
                        <ArrowUpRight size={18} />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">
            <Users size={32} />
            <h3>Nema pronađenih pacijenata</h3>
            <p>Promijenite pretragu ili dodajte novog pacijenta.</p>
          </div>
        )}
      </section>
      {creating && <NewPatient onClose={() => setCreating(false)} />}
    </>
  );
}
