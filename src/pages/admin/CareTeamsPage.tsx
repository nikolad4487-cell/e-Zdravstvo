import { useEffect, useState } from "react";
import { z } from "zod";
import { useAuth } from "../../hooks/useAuth";
import { useResource } from "../../hooks/useResource";
import { db } from "../../lib/supabase";
import { unwrap } from "../../services/clinical";
import { getAdminUsers } from "../../services/admin";
import { ErrorMessage } from "../../components/ui/Feedback";
import { Field, values } from "../../components/ui/Fields";
import { Modal } from "../../components/ui/Modal";
import { readableError } from "../../utils/format";
const patientSchema = z.object({
  id: z.string(),
  patient_number: z.string(),
  first_name: z.string(),
  last_name: z.string(),
  institution: z.string(),
  account_linked: z.boolean(),
});
type AdminPatient = z.infer<typeof patientSchema>;
const memberSchema = z.object({
  id: z.string(),
  name: z.string(),
  assigned: z.boolean(),
  primary: z.boolean(),
  enabled: z.boolean(),
});
const teamSchema = z.object({
  doctors: z.array(memberSchema),
  nurses: z.array(memberSchema),
});
type Action = {
  kind: "DOCTOR" | "NURSE";
  id: string;
  name: string;
  enabled: boolean;
  primary: boolean;
};
export function CareTeamsPage() {
  const [search, setSearch] = useState(""),
    [term, setTerm] = useState(""),
    [page, setPage] = useState(0),
    [selected, setSelected] = useState<AdminPatient | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => {
      setTerm(search);
      setPage(0);
    }, 250);
    return () => clearTimeout(timer);
  }, [search]);
  const resource = useResource(
    async () =>
      z
        .array(patientSchema)
        .parse(
          unwrap(
            await db().rpc("admin_patients", {
              search_term: term,
              page_number: page,
            }),
          ),
        ),
    term + page,
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">ADMINISTRACIJA PRISTUPA</div>
          <h1>Skrbni timovi</h1>
          <p>
            Dodjela pristupa pacijentu i povezivanje računa. Medicinski sadržaj
            ovdje nije dostupan.
          </p>
        </div>
      </div>
      <label className="field">
        <span>Pretraži evidenciju pacijenata</span>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Ime, prezime ili interni ID"
          maxLength={100}
        />
      </label>
      {resource.error && <ErrorMessage>{resource.error}</ErrorMessage>}
      {resource.loading ? (
        <p role="status">Učitavanje evidencije…</p>
      ) : (
        <section className="card table-scroll spaced">
          <table className="data-table">
            <thead>
              <tr>
                <th>Pacijent</th>
                <th>Ustanova</th>
                <th>Račun</th>
                <th>Ovlasti</th>
              </tr>
            </thead>
            <tbody>
              {resource.data?.map((p) => (
                <tr key={p.id}>
                  <td>
                    <strong>
                      {p.first_name} {p.last_name}
                    </strong>
                    <br />
                    {p.patient_number}
                  </td>
                  <td>{p.institution}</td>
                  <td>{p.account_linked ? "Povezan" : "Nije povezan"}</td>
                  <td>
                    <button
                      className="secondary"
                      onClick={() => setSelected(p)}
                    >
                      Uredi skrbni tim
                    </button>
                  </td>
                </tr>
              ))}
              {!resource.data?.length && (
                <tr>
                  <td colSpan={4}>Nema pacijenata za zadanu pretragu.</td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      )}
      <div className="document-actions spaced">
        <button
          className="secondary"
          disabled={!page || resource.loading}
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
      {selected && (
        <CareEditor
          patient={selected}
          onClose={() => setSelected(null)}
          onLinked={() => {
            setSelected({ ...selected, account_linked: true });
            resource.refresh();
          }}
        />
      )}
    </>
  );
}
function CareEditor({
  patient,
  onClose,
  onLinked,
}: {
  patient: AdminPatient;
  onClose: () => void;
  onLinked: () => void;
}) {
  const auth = useAuth(),
    resource = useResource(
      async () =>
        teamSchema.parse(
          unwrap(await db().rpc("admin_care_team", { patient_id: patient.id })),
        ),
      patient.id,
    ),
    [action, setAction] = useState<Action | null>(null),
    [link, setLink] = useState(false),
    [userQuery, setUserQuery] = useState(""),
    [userTerm, setUserTerm] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [success, setSuccess] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setUserTerm(userQuery), 300);
    return () => clearTimeout(timer);
  }, [userQuery]);
  const users = useResource(
    () => (link ? getAdminUsers(userTerm, 0) : Promise.resolve([])),
    String(link) + userTerm,
  );
  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = values(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      if (action)
        unwrap(
          await db().rpc("set_patient_care", {
            patient_id: patient.id,
            kind: action.kind,
            target_id: action.id,
            enabled: action.enabled,
            primary_doctor: action.primary,
            reason: data.reason,
          }),
        );
      else if (link) {
        unwrap(
          await db().rpc("link_patient_account", {
            patient_id: patient.id,
            target_user: data.target_user,
            reason: data.reason,
          }),
        );
        onLinked();
      }
      setAction(null);
      setLink(false);
      setSuccess("Ovlasti su spremljene i promjena je evidentirana.");
      resource.refresh();
    } catch (e) {
      setError(readableError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={"Skrbni tim · " + patient.patient_number}
      wide
      busy={busy}
      onClose={onClose}
    >
      <div className="modal-content">
        <h3>
          {patient.first_name} {patient.last_name}
        </h3>
        <p>{patient.institution}</p>
        {success && (
          <p className="feedback success" role="status">
            {success}
          </p>
        )}
        {resource.error && <ErrorMessage>{resource.error}</ErrorMessage>}
        {resource.loading ? (
          <p>Učitavanje tima…</p>
        ) : !action && !link ? (
          <>
            {(["doctors", "nurses"] as const).map((group) => (
              <section key={group}>
                <h3>
                  {group === "doctors"
                    ? "Liječnici"
                    : "Medicinske sestre / tehničari"}
                </h3>
                {resource.data?.[group].map((m) => (
                  <div className="admin-row" key={m.id}>
                    <div>
                      <strong>{m.name}</strong>
                      <p>
                        {m.assigned
                          ? m.primary
                            ? "Izabrani liječnik"
                            : "Pristup dodijeljen"
                          : "Pristup nije dodijeljen"}
                        {!m.enabled ? " · Uloga ili članstvo nije aktivno" : ""}
                      </p>
                    </div>
                    <div className="document-actions">
                      <button
                        className="secondary"
                        disabled={!m.assigned && !m.enabled}
                        onClick={() => {
                          setError("");
                          setAction({
                            kind: group === "doctors" ? "DOCTOR" : "NURSE",
                            id: m.id,
                            name: m.name,
                            enabled: !m.assigned,
                            primary: false,
                          });
                        }}
                      >
                        {m.assigned ? "Opozovi pristup" : "Dodijeli pristup"}
                      </button>
                      {group === "doctors" && m.enabled && !m.primary && (
                        <button
                          className="text-link"
                          onClick={() => {
                            setError("");
                            setAction({
                              kind: "DOCTOR",
                              id: m.id,
                              name: m.name,
                              enabled: true,
                              primary: true,
                            });
                          }}
                        >
                          Postavi izabranog liječnika
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </section>
            ))}
            {auth.roles.includes("SYSTEM_ADMIN") && !patient.account_linked && (
              <button
                className="primary spaced"
                onClick={() => {
                  setError("");
                  setLink(true);
                }}
              >
                Poveži pacijentov račun
              </button>
            )}
          </>
        ) : (
          <form onSubmit={save}>
            {action ? (
              <div className="confirm-box">
                <p>
                  {action.enabled ? "Dodijeliti" : "Opozvati"} pristup:{" "}
                  <strong>{action.name}</strong>?
                </p>
                {action.primary && (
                  <p>
                    Ovaj liječnik postaje izabrani liječnik. Prethodni zadržava
                    pristup skrbnom timu.
                  </p>
                )}
                <p>Promjena odmah utječe na pristup zdravstvenom kartonu.</p>
              </div>
            ) : (
              <>
                <label className="field">
                  <span>Pronađi korisnički račun</span>
                  <input
                    value={userQuery}
                    onChange={(e) => setUserQuery(e.target.value)}
                    placeholder="E-mail ili ime računa"
                    maxLength={100}
                  />
                </label>
                <Field
                  name="target_user"
                  label="Račun s ulogom pacijenta"
                  required
                >
                  <option value="">Odaberite račun</option>
                  {users.data
                    ?.filter((u) => u.roles.some((r) => r.role === "PATIENT"))
                    .map((u) => (
                      <option value={u.id} key={u.id}>
                        {u.first_name} {u.last_name} · {u.email}
                      </option>
                    ))}
                </Field>
                {users.error && <ErrorMessage>{users.error}</ErrorMessage>}
                <p className="confirm-box">
                  Provjerite identitet osobe i e-mail. Povezivanjem odabrani
                  račun dobiva pristup cijelom ovom kartonu. Već povezani karton
                  ne može se preusmjeriti na drugi račun kroz ovu radnju.
                </p>
              </>
            )}
            <Field
              name="reason"
              label="Administrativni razlog promjene"
              type="textarea"
              required
              minLength={5}
              maxLength={500}
            />
            {error && <ErrorMessage>{error}</ErrorMessage>}
            <div className="modal-actions">
              <button
                className="secondary"
                type="button"
                disabled={busy}
                onClick={() => {
                  setAction(null);
                  setLink(false);
                }}
              >
                Odustani
              </button>
              <button className="primary" disabled={busy || users.loading}>
                {busy ? "Spremanje…" : "Potvrdi promjenu ovlasti"}
              </button>
            </div>
          </form>
        )}
      </div>
    </Modal>
  );
}
