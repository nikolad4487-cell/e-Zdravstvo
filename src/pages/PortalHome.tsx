import {
  ArrowUpRight,
  Building2,
  Check,
  Fingerprint,
  ShieldCheck,
  UserRound,
  LockKeyhole,
  Layers3,
} from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { portals, roleLabels } from "../lib/roles";
import { StatusBadge } from "../components/ui/StatusBadge";
export function PortalHome() {
  const { profile, roles, institutions } = useAuth();
  const location = useLocation();
  const portal = portals.find(
    (p) => p.path === location.pathname && roles.includes(p.role),
  );
  const patient = portal?.role === "PATIENT";
  const hour = new Date().getHours();
  const greeting =
    hour < 10 ? "Dobro jutro" : hour < 18 ? "Dobar dan" : "Dobra večer";
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">
            {new Intl.DateTimeFormat("hr-HR", {
              weekday: "long",
              day: "numeric",
              month: "long",
              year: "numeric",
            }).format(new Date())}
          </div>
          <h1>
            {greeting}, {portal?.role === "DOCTOR" ? "dr. " : ""}
            {profile?.first_name}.
          </h1>
          <p>{portal?.description}</p>
        </div>
        {profile?.is_demo && <StatusBadge status="DEMO" />}
      </div>
      <section className="welcome-banner">
        <div className="banner-icon">
          <ShieldCheck size={32} />
        </div>
        <div>
          <span className="eyebrow">SIGURAN POČETAK</span>
          <h2>Vaš radni prostor je spreman.</h2>
          <p>
            Uspješno ste prijavljeni. Vaš pristup određen je ulogama
            dodijeljenima u sustavu.
          </p>
        </div>
        <StatusBadge status="ACTIVE" />
      </section>
      <div className="account-grid">
        <section className="card">
          <div className="card-title">
            <UserRound size={19} />
            <h2>Moj račun</h2>
          </div>
          <div className="identity">
            <div className="avatar large">
              {profile?.first_name[0]}
              {profile?.last_name[0]}
            </div>
            <div>
              <h3>
                {profile?.first_name} {profile?.last_name}
              </h3>
              <span className="muted">
                {patient
                  ? "Osobni zdravstveni prostor"
                  : "Profesionalni radni prostor"}
              </span>
            </div>
          </div>
          <dl>
            <div>
              <dt>Status računa</dt>
              <dd>
                <span className="inline-active">● Aktivan</span>
              </dd>
            </div>
            <div>
              <dt>Dodijeljene uloge</dt>
              <dd>
                {roles.map((r) => (
                  <span className="role-chip" key={r}>
                    {roleLabels[r]}
                  </span>
                ))}
              </dd>
            </div>
            <div>
              <dt>Autentikacija</dt>
              <dd>Supabase Authentication</dd>
            </div>
          </dl>
        </section>
        <section className="card">
          <div className="card-title">
            <Building2 size={19} />
            <h2>{patient ? "Povezani prostori" : "Dostupne ustanove"}</h2>
          </div>
          {institutions.length ? (
            institutions.map((i) => (
              <div className="institution-card" key={i.id}>
                <span className="institution-icon">
                  <Building2 size={23} />
                </span>
                <div>
                  <h3>{i.name}</h3>
                  <p>
                    {[i.address, i.city].filter(Boolean).join(", ") || i.code}
                  </p>
                  <StatusBadge status="ACTIVE" />
                </div>
              </div>
            ))
          ) : (
            <div className="empty-state">
              <Building2 size={30} />
              <h3>Nema povezanih ustanova</h3>
              <p>
                {patient
                  ? "Vaš osobni portal dostupan je neovisno o članstvu u ustanovi."
                  : "Administrator vam može dodijeliti članstvo u ustanovi."}
              </p>
            </div>
          )}
          <p className="card-footnote">
            <LockKeyhole size={14} /> Prikazuju se samo ustanove dostupne vašem
            računu.
          </p>
        </section>
      </div>
      <section className="card roadmap">
        <div>
          <div className="card-title">
            <Layers3 size={19} />
            <h2>Gradimo povezano e-Zdravstvo</h2>
          </div>
          <p>
            Funkcionalnosti uvodimo postupno, s provjerenim ovlastima u svakoj
            fazi.
          </p>
        </div>
        <div className="phase-row">
          <div className="phase complete">
            <span>
              <Check size={17} />
            </span>
            <div>
              <strong>01 · Pristup i sigurnost</strong>
              <small>Prijava, uloge i radni prostori</small>
            </div>
            <StatusBadge status="COMPLETED" />
          </div>
          <div className="phase">
            <span>02</span>
            <div>
              <strong>Ustanove i pacijenti</strong>
              <small>Sljedeća faza implementacije</small>
            </div>
          </div>
          <div className="phase">
            <span>03</span>
            <div>
              <strong>Pregledi i terapija</strong>
              <small>Nakon povezivanja kartona</small>
            </div>
          </div>
        </div>
        <Link className="text-link" to="/o-sustavu">
          Saznajte više o sustavu <ArrowUpRight size={15} />
        </Link>
      </section>
      <div className="privacy-foot">
        <Fingerprint size={17} /> Vaš radni prostor. Samo vaše ovlasti.
      </div>
    </>
  );
}
