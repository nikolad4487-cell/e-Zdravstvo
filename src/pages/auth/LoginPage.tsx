import { useState } from "react";
import { Link, Navigate } from "react-router-dom";
import {
  ArrowRight,
  Activity,
  Eye,
  EyeOff,
  HeartPulse,
  LockKeyhole,
  ShieldCheck,
  Stethoscope,
  Users,
  Check,
  Mail,
  ArrowUpRight,
} from "lucide-react";
import { Brand } from "../../components/ui/Brand";
import {
  Disclaimer,
  ErrorMessage,
  Loading,
} from "../../components/ui/Feedback";
import { useAuth } from "../../hooks/useAuth";
import { useBackendStatus } from "../../hooks/useBackendStatus";
import { homeFor } from "../../lib/roles";
export function LoginPage() {
  const auth = useAuth();
  const backend = useBackendStatus();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [audience, setAudience] = useState<"staff" | "patient">("staff");
  if (auth.loading) return <Loading />;
  if (auth.session && !busy)
    return (
      <Navigate
        to={auth.recovery ? "/nova-lozinka" : homeFor(auth.roles)}
        replace
      />
    );
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await auth.signIn(email, password, remember);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Prijava nije uspjela.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="login-page">
      <header className="public-header">
        <Brand />
        <span className="header-caption">Povezana skrb. Bolje zdravlje.</span>
        <Link className="text-link" to="/o-sustavu">
          O sustavu <ArrowUpRight size={15} />
        </Link>
      </header>
      <main className="login-grid">
        <section className="login-story">
          <div className="eyebrow">
            <span className="tiny-dot" /> DIGITALNA SKRB, BLIŽA VAMA
          </div>
          <h1>
            Vi brinete o zdravlju.
            <br />
            <span>
              Mi povezujemo <br />
              sve ostalo.
            </span>
          </h1>
          <p className="story-description">
            Jedno mjesto za zdravstvene djelatnike i pacijente.
            <br className="desktop-break" /> Za povezaniju skrb i više vremena
            za ono što je važno.
          </p>
          <div className="care-visual" aria-hidden="true">
            <div className="orbit orbit-one" />
            <div className="orbit orbit-two" />
            <div className="visual-dots" />
            <div className="connection line-one" />
            <div className="connection line-two" />
            <div className="connection line-three" />
            <div className="care-node node-doctor">
              <Stethoscope />
              <span>Vaša ordinacija</span>
            </div>
            <div className="care-node node-record">
              <Activity />
              <span>Zdravstveni podaci</span>
            </div>
            <div className="care-node node-patient">
              <Users />
              <span>Pacijent u središtu</span>
            </div>
            <div className="care-center">
              <HeartPulse size={43} strokeWidth={1.6} />
            </div>
            <div className="secure-tag">
              <span>
                <Check size={12} />
              </span>{" "}
              Sigurno povezani
            </div>
          </div>
          <div className="story-bottom">
            <ShieldCheck size={21} />
            <div>
              <strong>Privatnost je dio svakog koraka.</strong>
              <span>Pristup podacima prema dodijeljenim ovlastima.</span>
            </div>
          </div>
        </section>
        <section className="login-form-side">
          <div className="form-topline">
            <span>VAŠ DIGITALNI ZDRAVSTVENI PROSTOR</span>
            <span className="version">RAZVOJNA VERZIJA</span>
          </div>
          <div className="login-form-content">
            <div className="welcome-icon">
              <LockKeyhole size={24} />
            </div>
            <h2>Dobro došli.</h2>
            <p className="muted">Prijavite se u e-Zdravstvo.</p>
            <div
              className="audience-switch"
              role="group"
              aria-label="Vrsta portala"
            >
              <button
                type="button"
                className={audience === "staff" ? "selected" : ""}
                aria-pressed={audience === "staff"}
                onClick={() => setAudience("staff")}
              >
                <Stethoscope size={17} /> Zdravstveni djelatnici
              </button>
              <button
                type="button"
                className={audience === "patient" ? "selected" : ""}
                aria-pressed={audience === "patient"}
                onClick={() => setAudience("patient")}
              >
                <Users size={17} /> Građani
              </button>
            </div>
            <p className="form-context">
              {audience === "staff"
                ? "Integrirani digitalni zdravstveni sustav"
                : "Moje e-Zdravstvo — vaš osobni zdravstveni portal"}
            </p>
            {backend !== "ready" && (
              <div className="setup-notice">
                <span className="tiny-dot" />
                <div>
                  <strong>
                    {backend === "missing-schema"
                      ? "Projekt je povezan. Baza čeka postavljanje."
                      : backend === "checking"
                        ? "Provjera veze sa sustavom…"
                        : backend === "unavailable"
                          ? "Veza sa sustavom nije dostupna."
                          : "Pripremljeno za povezivanje"}
                  </strong>
                  <p>
                    {backend === "missing-schema"
                      ? "Prije prijave primijenite SQL migracije."
                      : backend === "unavailable"
                        ? "Provjerite konfiguraciju ili osvježite stranicu."
                        : backend === "checking"
                          ? "Provjeravamo dostupnost baze."
                          : "Za prijavu povežite Supabase projekt."}{" "}
                    <Link to="/postavljanje">
                      Upute za postavljanje <ArrowRight size={12} />
                    </Link>
                  </p>
                </div>
              </div>
            )}
            <form onSubmit={submit}>
              <label htmlFor="email">E-mail adresa</label>
              <div className="input-icon">
                <Mail size={18} />
                <input
                  id="email"
                  type="email"
                  autoComplete="username"
                  placeholder="ime.prezime@ustanova.hr"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  disabled={busy}
                />
              </div>
              <label htmlFor="password">Lozinka</label>
              <div className="input-icon">
                <LockKeyhole size={18} />
                <input
                  id="password"
                  type={visible ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="Unesite svoju lozinku"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  disabled={busy}
                />
                <button
                  className="password-toggle"
                  type="button"
                  aria-label={visible ? "Sakrij lozinku" : "Prikaži lozinku"}
                  onClick={() => setVisible(!visible)}
                >
                  {visible ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              <div className="form-options">
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={remember}
                    onChange={(e) => setRemember(e.target.checked)}
                  />{" "}
                  Zapamti me
                </label>
                <Link to="/zaboravljena-lozinka">Zaboravljena lozinka?</Link>
              </div>
              {error && <ErrorMessage>{error}</ErrorMessage>}
              <button
                className="primary login-submit"
                disabled={busy || backend !== "ready"}
              >
                {busy ? "Prijava u tijeku…" : "Prijavi se"}
                <ArrowRight size={18} />
              </button>
            </form>
            <p className="login-help">
              Pristupne podatke dodjeljuje administrator vaše ustanove.
              <br />
              Portal se otvara prema ovlastima vašeg računa.
            </p>
            <div className="security-row">
              <ShieldCheck size={15} />
              <span>Kontroliran pristup</span>
              <span className="separator-dot">·</span>
              <LockKeyhole size={14} />
              <span>Zaštićena veza</span>
            </div>
          </div>
        </section>
      </main>
      <footer className="public-footer">
        <span>© {new Date().getFullYear()} e-Zdravstvo</span>
        <Disclaimer />
        <Link to="/privatnost">Privatnost i sigurnost</Link>
      </footer>
    </div>
  );
}
