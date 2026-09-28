import { useEffect, useState } from "react";
import { useAuth } from "../../hooks/useAuth";
import { useResource } from "../../hooks/useResource";
import { getAdminUsers, getAdminConfiguration } from "../../services/admin";
import { unwrap } from "../../services/clinical";
import { db } from "../../lib/supabase";
import { USER_ROLES } from "../../types";
import type { UserRole } from "../../types";
import type { AdminUser } from "../../types/admin";
import { roleLabels } from "../../lib/roles";
import { Modal } from "../../components/ui/Modal";
import { ErrorMessage } from "../../components/ui/Feedback";
import { readableError } from "../../utils/format";
export function UsersPage() {
  const auth = useAuth(),
    [search, setSearch] = useState(""),
    [term, setTerm] = useState(""),
    [page, setPage] = useState(0),
    [selected, setSelected] = useState<AdminUser | null>(null),
    [role, setRole] = useState<UserRole>("DOCTOR"),
    [institution, setInstitution] = useState(""),
    [revoke, setRevoke] = useState<{
      id: string;
      name: string;
      label: string;
    } | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [success, setSuccess] = useState("");
  useEffect(() => {
    const t = setTimeout(() => {
      setTerm(search);
      setPage(0);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);
  const users = useResource(() => getAdminUsers(term, page), `${term}:${page}`),
    config = useResource(getAdminConfiguration, "users-config");
  const global = ["SYSTEM_ADMIN", "PATIENT", "SCHOOL_ADMIN"].includes(role);
  async function grant(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      unwrap(
        await db().rpc("admin_grant_role", {
          target_user: selected.id,
          requested: role,
          target_institution: global ? null : institution,
        }),
      );
      setSelected(null);
      setSuccess("Uloga je dodijeljena.");
      users.refresh();
    } catch (e) {
      setError(readableError(e));
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!revoke) return;
    setBusy(true);
    setError("");
    try {
      unwrap(await db().rpc("revoke_role", { assignment_id: revoke.id }));
      setRevoke(null);
      setSuccess("Uloga je opozvana.");
      users.refresh();
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
          <div className="eyebrow">CENTRAL · PRISTUP</div>
          <h1>Korisnici i ovlasti</h1>
          <p>
            Uloge određuju pristup portalima. Skrbna veza zasebno određuje
            pristup pacijentu.
          </p>
        </div>
      </div>
      <label className="field">
        <span>Pretraži korisnike</span>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Ime, prezime ili e-mail"
          maxLength={100}
        />
      </label>
      {success && (
        <p className="success-toast spaced" role="status">
          {success}
        </p>
      )}
      {(users.error || config.error) && (
        <ErrorMessage>{users.error || config.error}</ErrorMessage>
      )}
      <section className="card table-scroll spaced">
        {users.loading ? (
          <p role="status">Učitavanje korisnika…</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Korisnik</th>
                <th>Uloge i ustanove</th>
                <th>Upravljanje</th>
              </tr>
            </thead>
            <tbody>
              {users.data?.length === 0 && (
                <tr>
                  <td colSpan={3}>Nema korisnika za zadanu pretragu.</td>
                </tr>
              )}
              {users.data?.map((u) => (
                <tr key={u.id}>
                  <td>
                    <strong>
                      {u.first_name} {u.last_name}
                    </strong>
                    <br />
                    <small>{u.email}</small>
                  </td>
                  <td>
                    {u.roles.map((r) => (
                      <div className="role-assignment" key={r.id}>
                        <span>
                          {roleLabels[r.role]}
                          {r.institution_name ? " · " + r.institution_name : ""}
                        </span>
                        {!(
                          r.role === "SYSTEM_ADMIN" && u.id === auth.profile?.id
                        ) && (
                          <button
                            className="text-link"
                            onClick={() => {
                              setError("");
                              setRevoke({
                                id: r.id,
                                name: u.first_name + " " + u.last_name,
                                label: roleLabels[r.role],
                              });
                            }}
                          >
                            Opozovi
                          </button>
                        )}
                      </div>
                    ))}
                  </td>
                  <td>
                    <button
                      className="secondary"
                      onClick={() => {
                        setError("");
                        setRole("DOCTOR");
                        setInstitution("");
                        setSelected(u);
                      }}
                    >
                      Dodijeli ulogu
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <div className="document-actions">
        <button
          className="secondary"
          disabled={page === 0 || users.loading}
          onClick={() => setPage(page - 1)}
        >
          Prethodna
        </button>
        <span>Stranica {page + 1}</span>
        <button
          className="secondary"
          disabled={users.data?.length !== 50 || users.loading}
          onClick={() => setPage(page + 1)}
        >
          Sljedeća
        </button>
      </div>
      {selected && (
        <Modal
          title="Dodjela ovlasti"
          busy={busy}
          onClose={() => setSelected(null)}
        >
          <form onSubmit={grant}>
            <p className="form-intro">
              {selected.first_name} {selected.last_name}
            </p>
            <label className="field">
              <span>Uloga</span>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as UserRole)}
              >
                {USER_ROLES.map((r) => (
                  <option value={r} key={r}>
                    {roleLabels[r]}
                  </option>
                ))}
              </select>
            </label>
            {!global && (
              <label className="field spaced">
                <span>Ustanova</span>
                <select
                  required
                  value={institution}
                  onChange={(e) => setInstitution(e.target.value)}
                >
                  <option value="">Odaberite ustanovu</option>
                  {config.data?.institutions.map((i) => (
                    <option value={i.id} key={i.id}>
                      {i.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <p className="confirm-box spaced">
              Potvrdom dodjeljujete odabrane ovlasti ovom korisniku
              {!global ? " i aktivirate njegovo članstvo u ustanovi" : ""}.
              Promjena će biti evidentirana u auditu.
            </p>
            {error && <ErrorMessage>{error}</ErrorMessage>}
            <div className="modal-actions">
              <button
                className="secondary"
                type="button"
                disabled={busy}
                onClick={() => setSelected(null)}
              >
                Odustani
              </button>
              <button className="primary" disabled={busy}>
                {busy ? "Spremanje…" : "Potvrdi dodjelu"}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {revoke && (
        <Modal
          title="Opoziv ovlasti"
          busy={busy}
          onClose={() => setRevoke(null)}
        >
          <div className="modal-content">
            <p>
              Opozvati ulogu „{revoke.label}” korisniku {revoke.name}? Pristup
              povezan s tom ulogom prestaje odmah.
            </p>
            {error && <ErrorMessage>{error}</ErrorMessage>}
            <div className="modal-actions">
              <button
                className="secondary"
                disabled={busy}
                onClick={() => setRevoke(null)}
              >
                Odustani
              </button>
              <button
                className="primary"
                disabled={busy}
                onClick={() => void remove()}
              >
                Potvrdi opoziv
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
