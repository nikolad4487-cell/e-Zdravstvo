import { useState } from "react";
import { Modal } from "../ui/Modal";
import { Field, values } from "../ui/Fields";
import { ErrorMessage } from "../ui/Feedback";
import { createAdminAccount } from "../../services/admin";
import { readableError } from "../../utils/format";
export function CreateAccountModal({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: (email: string) => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [draft, setDraft] = useState<{
      email: string;
      first_name: string;
      last_name: string;
      password: string;
      is_demo: boolean;
      request_id: string;
    } | null>(null),
    [visible, setVisible] = useState(false);
  function review(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    const data = values(e.currentTarget);
    setDraft({
      email: data.email.trim(),
      first_name: data.first_name,
      last_name: data.last_name,
      password: data.password,
      is_demo: data.is_demo === "true",
      request_id: crypto.randomUUID(),
    });
  }
  async function create() {
    if (!draft) return;
    setBusy(true);
    setError("");
    try {
      const created = await createAdminAccount(draft);
      onSaved(created.email);
    } catch (e) {
      setError(readableError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Novi korisnički račun" busy={busy} onClose={onClose}>
      <form onSubmit={review} hidden={!!draft}>
        <div className="form-grid">
          <Field name="first_name" label="Ime" required maxLength={100} />
          <Field name="last_name" label="Prezime" required maxLength={100} />
          <Field
            name="email"
            label="E-mail računa"
            type="email"
            required
            maxLength={254}
          />
          <Field
            name="password"
            label="Početna lozinka"
            type={visible ? "text" : "password"}
            required
            minLength={12}
            maxLength={128}
          />
          <label>
            <input
              type="checkbox"
              checked={visible}
              onChange={(e) => setVisible(e.target.checked)}
            />{" "}
            Prikaži početnu lozinku
          </label>
          <label>
            <input type="checkbox" name="is_demo" value="true" /> Testni račun
          </label>
        </div>
        <p className="signature-note">
          Početnu lozinku predajte vlasniku sigurnim kanalom. Pri prvoj prijavi
          mora postaviti svoju lozinku. Otvaranje računa ne šalje e-mail.
        </p>
        <label>
          <input type="checkbox" required /> Potvrđujem identitet vlasnika i
          način dostave početne lozinke.
        </label>
        <div className="modal-actions">
          <button className="primary">Pregledaj račun</button>
        </div>
      </form>
      {draft && (
        <div className="modal-content">
          <div className="confirm-box">
            <h3>
              {draft.first_name} {draft.last_name}
            </h3>
            <p>{draft.email}</p>
            <p>{draft.is_demo ? "Testni račun" : "Korisnički račun"}</p>
            <p>
              Račun će biti otvoren bez uloga. Nakon otvaranja dodijelite mu
              potrebne ovlasti u popisu korisnika.
            </p>
          </div>
          {error && <ErrorMessage>{error}</ErrorMessage>}
          <div className="modal-actions">
            <button
              className="secondary"
              disabled={busy}
              onClick={() => setDraft(null)}
            >
              Natrag
            </button>
            <button
              className="primary"
              disabled={busy}
              onClick={() => void create()}
            >
              {busy ? "Otvaranje…" : "Potvrdi otvaranje računa"}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
