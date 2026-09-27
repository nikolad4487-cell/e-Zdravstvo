import { useState } from "react";
import { Building2, Plus } from "lucide-react";
import { useResource } from "../../hooks/useResource";
import { getInstitutions, unwrap } from "../../services/clinical";
import { db } from "../../lib/supabase";
import { Field, values } from "../../components/ui/Fields";
import { Modal } from "../../components/ui/Modal";
import { ErrorMessage } from "../../components/ui/Feedback";
import { readableError } from "../../utils/format";
export function InstitutionPage() {
  const resource = useResource(getInstitutions, "institutions");
  const [selected, setSelected] = useState<{
    id: string;
    kind: "edit" | "department" | "doctor";
    user?: string;
  } | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [success, setSuccess] = useState("");
  const institution = resource.data?.find((i) => i.id === selected?.id);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!selected) return;
    const data = values(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      if (selected.kind === "edit")
        unwrap(
          await db().rpc("save_institution", {
            institution_id: selected.id,
            data,
          }),
        );
      else if (selected.kind === "department")
        unwrap(
          await db().rpc("add_department", {
            institution_id: selected.id,
            name: data.name,
            code: data.code,
          }),
        );
      else
        unwrap(
          await db().rpc("register_doctor", {
            institution_id: selected.id,
            target_user: selected.user!,
            specialty: data.specialty,
          }),
        );
      setSelected(null);
      setSuccess("Promjene su spremljene.");
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
          <div className="eyebrow">UPRAVLJANJE USTANOVOM</div>
          <h1>Ustanove i timovi</h1>
          <p>Osnovni podaci, odjeli i liječnički profili.</p>
        </div>
      </div>
      {resource.error && <ErrorMessage>{resource.error}</ErrorMessage>}
      {success && (
        <div role="status" className="feedback success">
          {success}
        </div>
      )}
      {resource.loading && <p role="status">Učitavanje ustanova…</p>}
      {resource.data?.length === 0 && (
        <section className="card empty-state">
          Nemate dodijeljenu ustanovu.
        </section>
      )}
      {resource.data?.map((i) => (
        <section className="card institution-section" key={i.id}>
          <div className="section-heading">
            <div className="card-title">
              <Building2 />
              <h2>{i.name}</h2>
            </div>
            <button
              className="secondary"
              onClick={() => {
                setError("");
                setSelected({ id: i.id, kind: "edit" });
              }}
            >
              Uredi ustanovu
            </button>
          </div>
          <p className="muted">
            {[i.address, i.city, i.phone].filter(Boolean).join(" · ")}
          </p>
          <div className="section-heading">
            <h3>Odjeli</h3>
            <button
              className="text-link"
              onClick={() => {
                setError("");
                setSelected({ id: i.id, kind: "department" });
              }}
            >
              <Plus size={16} />
              Dodaj odjel
            </button>
          </div>
          <div className="chips">
            {i.departments.map((d) => (
              <span className="role-chip" key={d.id}>
                {d.name} · {d.code}
              </span>
            ))}
          </div>
          <h3 className="subheading">Zdravstveni djelatnici</h3>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Ime i prezime</th>
                  <th>Uloge</th>
                  <th>Status</th>
                  <th>Liječnički profil</th>
                </tr>
              </thead>
              <tbody>
                {i.staff.map((s) => (
                  <tr key={s.user_id}>
                    <td>
                      {s.first_name} {s.last_name}
                    </td>
                    <td>{s.roles?.join(", ")}</td>
                    <td>{s.active ? "Aktivan" : "Neaktivan"}</td>
                    <td>
                      {s.roles?.includes("DOCTOR") && (
                        <button
                          className="text-link"
                          onClick={() => {
                            setError("");
                            setSelected({
                              id: i.id,
                              kind: "doctor",
                              user: s.user_id,
                            });
                          }}
                        >
                          Uredi specijalnost
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
      {selected && (
        <Modal
          title={
            selected.kind === "edit"
              ? "Uredi ustanovu"
              : selected.kind === "doctor"
                ? "Liječnički profil"
                : "Novi odjel"
          }
          onClose={() => setSelected(null)}
          busy={busy}
        >
          <form onSubmit={submit}>
            <div className="form-grid">
              {selected.kind === "doctor" ? (
                <Field
                  name="specialty"
                  label="Specijalnost"
                  defaultValue="Obiteljska medicina"
                  required
                />
              ) : (
                <>
                  <Field
                    name="name"
                    label="Naziv"
                    defaultValue={
                      selected.kind === "edit" ? institution?.name : ""
                    }
                    required
                  />
                  {selected.kind === "department" ? (
                    <Field name="code" label="Oznaka odjela" required />
                  ) : (
                    <>
                      <Field
                        name="address"
                        label="Adresa"
                        defaultValue={institution?.address ?? ""}
                      />
                      <Field
                        name="city"
                        label="Grad"
                        defaultValue={institution?.city ?? ""}
                      />
                      <Field
                        name="postal_code"
                        label="Poštanski broj"
                        defaultValue={institution?.postal_code ?? ""}
                      />
                      <Field
                        name="phone"
                        label="Telefon"
                        defaultValue={institution?.phone ?? ""}
                      />
                    </>
                  )}
                </>
              )}
            </div>
            {error && <ErrorMessage>{error}</ErrorMessage>}
            <div className="modal-actions">
              <button className="primary" disabled={busy}>
                {busy ? "Spremanje…" : "Spremi"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
