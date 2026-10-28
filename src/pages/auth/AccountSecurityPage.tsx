import { authenticatorQrDataUri } from "../../utils/authenticatorQr";
import { useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useAuth } from "../../hooks/useAuth";
import { useResource } from "../../hooks/useResource";
import { db } from "../../lib/supabase";
import { homeFor } from "../../lib/roles";
import { sessionEvent } from "../../services/account";
import { Brand } from "../../components/ui/Brand";
import { ErrorMessage, Loading } from "../../components/ui/Feedback";
import { Field, values } from "../../components/ui/Fields";
import { readableError } from "../../utils/format";
async function factors() {
  const result = await db().auth.mfa.listFactors();
  if (result.error)
    throw Error("Faktori prijave nisu dostupni. Pokušajte ponovno.");
  return result.data.all.filter((f) => f.factor_type === "totp");
}
function CodeField() {
  return (
    <label className="field">
      <span>Šesteroznamenkasti kod iz autentifikatora</span>
      <input
        name="code"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]{6}"
        minLength={6}
        maxLength={6}
        required
      />
    </label>
  );
}
export function MfaChallengePage() {
  const auth = useAuth(),
    resource = useResource(factors, "mfa-challenge");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = values(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      const result = await db().auth.mfa.challengeAndVerify({
        factorId: data.factor_id,
        code: data.code,
      });
      if (result.error)
        throw Error(
          "Kod nije prihvaćen. Unesite trenutačni kod iz autentifikatora.",
        );
      await sessionEvent("LOGIN_SUCCESS");
    } catch (e) {
      setError(readableError(e));
    } finally {
      setBusy(false);
    }
  }
  if (auth.loading) return <Loading />;
  if (!auth.session) return <Navigate to="/prijava" replace />;
  if (!auth.mfaRequired)
    return (
      <Navigate
        to={auth.recovery ? "/nova-lozinka" : homeFor(auth.roles)}
        replace
      />
    );
  return (
    <main className="standalone">
      <Brand />
      <h1>Potvrda prijave</h1>
      <p>Za nastavak unesite kod iz aplikacije za autentifikaciju.</p>
      {(error || resource.error) && (
        <ErrorMessage>{error || resource.error}</ErrorMessage>
      )}
      {resource.loading ? (
        <p role="status">Učitavanje autentifikatora…</p>
      ) : (
        <form className="section-stack" onSubmit={submit}>
          <Field name="factor_id" label="Autentifikator" required>
            {resource.data
              ?.filter((f) => f.status === "verified")
              .map((f) => (
                <option key={f.id} value={f.id}>
                  {f.friendly_name || "Autentifikator"}
                </option>
              ))}
          </Field>
          <CodeField />
          <button className="primary" disabled={busy}>
            {busy ? "Provjera…" : "Potvrdi prijavu"}
          </button>
        </form>
      )}
      <p className="note-text">
        Ako ste izgubili autentifikator, obratite se administratoru ustanove
        radi provjere identiteta i oporavka pristupa.
      </p>
      <button
        type="button"
        className="secondary"
        disabled={busy}
        onClick={() =>
          void auth.signOut().catch((e) => setError(readableError(e)))
        }
      >
        Odjavi se
      </button>
    </main>
  );
}
export function AccountSecurityPage() {
  const resource = useResource(factors, "account-factors");
  const [enrollment, setEnrollment] = useState<{
      id: string;
      qr: string;
      secret: string;
    } | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  async function enroll(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const name = values(e.currentTarget).device_name;
      const result = await db().auth.mfa.enroll({
        factorType: "totp",
        friendlyName: name.trim() || "Moj autentifikator",
      });
      if (result.error)
        throw Error(
          "Aktivacija nije uspjela. Provjerite postojeće ili nedovršene faktore.",
        );
      setEnrollment({
        id: result.data.id,
        qr: authenticatorQrDataUri(result.data.totp.qr_code),
        secret: result.data.totp.secret,
      });
    } catch (e) {
      setError(readableError(e));
    } finally {
      setBusy(false);
    }
  }
  async function verify(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!enrollment) return;
    setBusy(true);
    setError("");
    try {
      const result = await db().auth.mfa.challengeAndVerify({
        factorId: enrollment.id,
        code: values(e.currentTarget).code,
      });
      if (result.error)
        throw Error("Kod nije prihvaćen. Provjerite kod i vrijeme na uređaju.");
      setEnrollment(null);
      setMessage(
        "Drugi faktor je aktiviran. Pri sljedećoj prijavi bit će potreban kod.",
      );
      resource.refresh();
    } catch (e) {
      setError(readableError(e));
    } finally {
      setBusy(false);
    }
  }
  async function remove(id: string) {
    if (
      !window.confirm(
        "Ukloniti ovaj autentifikator? Ako je posljednji, račun više neće imati drugi faktor.",
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      const result = await db().auth.mfa.unenroll({ factorId: id });
      if (result.error)
        throw Error(
          "Uklanjanje nije uspjelo. Potvrdite prijavu i pokušajte ponovno.",
        );
      if (enrollment?.id === id) setEnrollment(null);
      setMessage("Autentifikator je uklonjen.");
      resource.refresh();
    } catch (e) {
      setError(readableError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="standalone security-page">
      <Brand />
      <Link to="/">Povratak u aplikaciju</Link>
      <h1>Sigurnost računa</h1>
      <p>
        Uključite drugi faktor pomoću aplikacije za autentifikaciju. QR kod i
        tajni ključ čuvajte privatno; služe samo za povezivanje vašeg uređaja.
      </p>
      {error && <ErrorMessage>{error}</ErrorMessage>}
      {message && (
        <p role="status" className="feedback success">
          {message}
        </p>
      )}
      {resource.error && <ErrorMessage>{resource.error}</ErrorMessage>}
      {enrollment ? (
        <section className="card spaced">
          <h2>Povežite autentifikator</h2>
          <img
            className="mfa-qr"
            src={enrollment.qr}
            alt="QR kod za povezivanje vašeg autentifikatora"
          />
          <details>
            <summary>Ručni unos ključa</summary>
            <code className="mfa-secret">{enrollment.secret}</code>
          </details>
          <form className="section-stack spaced" onSubmit={verify}>
            <CodeField />
            <button className="primary" disabled={busy}>
              Potvrdi aktivaciju
            </button>
          </form>
          <button
            type="button"
            className="text-link spaced"
            disabled={busy}
            onClick={() => remove(enrollment.id)}
          >
            Otkaži aktivaciju
          </button>
        </section>
      ) : (
        <form className="card spaced section-stack" onSubmit={enroll}>
          <Field
            name="device_name"
            label="Naziv autentifikatora"
            maxLength={100}
            placeholder="Npr. moj telefon"
          />
          <button className="primary" disabled={busy || resource.loading}>
            Dodaj autentifikator
          </button>
        </form>
      )}
      <h2 className="spaced">Vaši autentifikatori</h2>
      {resource.loading ? (
        <p role="status">Učitavanje…</p>
      ) : resource.data?.length ? (
        <div className="section-stack">
          {resource.data.map((f) => (
            <section className="card" key={f.id}>
              <h3>{f.friendly_name || "Autentifikator"}</h3>
              <p>
                {f.status === "verified"
                  ? "Aktivan"
                  : "Aktivacija nije dovršena"}
              </p>
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => remove(f.id)}
              >
                Ukloni autentifikator
              </button>
            </section>
          ))}
        </div>
      ) : (
        <p>Drugi faktor još nije uključen.</p>
      )}
      <p className="note-text">
        Za izgubljen uređaj potreban je oporavak uz administratora nakon
        provjere identiteta.
      </p>
    </main>
  );
}
