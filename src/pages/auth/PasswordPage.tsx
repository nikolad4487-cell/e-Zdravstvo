import { useState } from "react";
import { Link } from "react-router-dom";
import { Brand } from "../../components/ui/Brand";
import { ErrorMessage } from "../../components/ui/Feedback";
import { configured, db } from "../../lib/supabase";
import { useAuth } from "../../hooks/useAuth";
export function PasswordPage({ reset = false }: { reset?: boolean }) {
  const { session, signOut } = useAuth();
  const [value, setValue] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (reset && value !== confirm) {
      setError("Lozinke se ne podudaraju.");
      return;
    }
    setBusy(true);
    try {
      const result = reset
        ? await db().auth.updateUser({ password: value })
        : await db().auth.resetPasswordForEmail(value.trim(), {
            redirectTo: `${window.location.origin}/nova-lozinka`,
          });
      if (result.error)
        throw new Error(
          "Zahtjev nije uspio. Pokušajte ponovno ili zatražite novu poveznicu.",
        );
      if (reset) await signOut();
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Zahtjev nije uspio.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="standalone">
      <Brand />
      <h1>{reset ? "Nova lozinka" : "Zaboravljena lozinka?"}</h1>
      <p className="muted">
        {reset
          ? "Odaberite lozinku s najmanje 12 znakova."
          : "Poslat ćemo vam poveznicu za obnovu pristupa."}
      </p>
      {done ? (
        <div role="status" className="feedback success">
          {reset
            ? "Lozinka je promijenjena. Prijavite se novom lozinkom."
            : "Ako račun postoji, poveznica za promjenu lozinke poslana je na unesenu adresu."}
        </div>
      ) : reset && !session ? (
        <ErrorMessage>
          Poveznica nije valjana ili je istekla. Zatražite novu poveznicu za
          obnovu pristupa.
        </ErrorMessage>
      ) : (
        <form onSubmit={submit}>
          <label htmlFor="value">
            {reset ? "Nova lozinka" : "E-mail adresa"}
          </label>
          <input
            id="value"
            type={reset ? "password" : "email"}
            autoComplete={reset ? "new-password" : "email"}
            minLength={reset ? 12 : undefined}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            required
          />
          {reset && (
            <>
              <label htmlFor="confirm">Ponovite lozinku</label>
              <input
                id="confirm"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
              />
            </>
          )}
          {error && <ErrorMessage>{error}</ErrorMessage>}
          <button className="primary" disabled={busy || !configured}>
            {busy ? "Slanje…" : reset ? "Spremi lozinku" : "Pošalji poveznicu"}
          </button>
        </form>
      )}
      <Link className="back-link" to="/prijava">
        ← Povratak na prijavu
      </Link>
    </main>
  );
}
