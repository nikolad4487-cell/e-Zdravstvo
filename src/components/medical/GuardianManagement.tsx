import { useState } from "react";
import { z } from "zod";
import { useResource } from "../../hooks/useResource";
import { db } from "../../lib/supabase";
import { unwrap } from "../../services/clinical";
import { getAdminUsers } from "../../services/admin";
import { Field, values } from "../ui/Fields";
import { ErrorMessage } from "../ui/Feedback";
import { readableError, dateLabel } from "../../utils/format";
const schema = z.array(
  z.object({
    id: z.string(),
    name: z.string(),
    email: z.string().nullable(),
    legal_basis: z.string(),
    expires_at: z.string(),
    revoked_at: z.string().nullable(),
  }),
);
export function GuardianManagement({ patientId }: { patientId: string }) {
  const [term, setTerm] = useState(""),
    [query, setQuery] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const assignments = useResource(
    async () =>
      schema.parse(
        unwrap(
          await db().rpc("admin_patient_guardians", { patient_id: patientId }),
        ),
      ),
    patientId,
  );
  const users = useResource(
    () => (term ? getAdminUsers(term, 0) : Promise.resolve([])),
    term,
  );
  async function grant(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget,
      d = values(form);
    setBusy(true);
    setError("");
    try {
      unwrap(
        await db().rpc("grant_guardian_access", {
          patient_id: patientId,
          guardian_user_id: d.guardian,
          legal_basis: d.basis,
          verification_reference: d.reference,
          expires_on: d.expires,
        }),
      );
      form.reset();
      assignments.refresh();
    } catch (e) {
      setError(readableError(e));
    } finally {
      setBusy(false);
    }
  }
  async function revoke(id: string) {
    const reason = window.prompt("Razlog opoziva (najmanje 5 znakova)");
    if (!reason) return;
    setBusy(true);
    setError("");
    try {
      unwrap(
        await db().rpc("revoke_guardian_access", { assignment_id: id, reason }),
      );
      assignments.refresh();
    } catch (e) {
      setError(readableError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="spaced">
      <h3>Pristup skrbnika maloljetnika</h3>
      <p>
        Prije dodjele provjerite identitet i pravnu osnovu izvan aplikacije.
        Unesite referencu provjere; ovlast omogućuje samo čitanje i ne smije
        trajati nakon 18. rođendana.
      </p>
      {(error || assignments.error || users.error) && (
        <ErrorMessage>{error || assignments.error || users.error}</ErrorMessage>
      )}
      {assignments.data?.map((a) => (
        <div className="admin-row" key={a.id}>
          <p>
            {a.name} · {a.email} · {dateLabel(a.expires_at)}
            {a.revoked_at ? " · Opozvano" : ""}
          </p>
          {!a.revoked_at && (
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => void revoke(a.id)}
            >
              Opozovi
            </button>
          )}
        </div>
      ))}
      <div className="form-grid">
        <label className="field">
          <span>Pronađi račun skrbnika</span>
          <input
            maxLength={100}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <button
          type="button"
          className="secondary"
          onClick={() => setTerm(query.trim())}
        >
          Pronađi račun
        </button>
      </div>
      <form onSubmit={grant}>
        <div className="form-grid">
          <Field
            name="guardian"
            label="Provjereni račun s ulogom pacijenta"
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
          <Field name="basis" label="Pravna osnova" required>
            <option value="PARENT">Roditelj</option>
            <option value="COURT_APPOINTED">Imenovani skrbnik</option>
          </Field>
          <Field
            name="reference"
            label="Referenca provjere"
            required
            minLength={5}
            maxLength={200}
          />
          <Field
            name="expires"
            label="Posljednji dan ovlasti"
            type="date"
            required
          />
        </div>
        <button className="primary spaced" disabled={busy}>
          Dodijeli pristup za čitanje
        </button>
      </form>
    </section>
  );
}
