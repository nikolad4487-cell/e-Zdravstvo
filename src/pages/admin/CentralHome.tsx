import { Link } from "react-router-dom";
import {
  Building2,
  Users,
  Stethoscope,
  FilePenLine,
  BookOpen,
  ShieldCheck,
  ArrowUpRight,
} from "lucide-react";
import { useResource } from "../../hooks/useResource";
import { getCentralOverview } from "../../services/admin";
import { ErrorMessage } from "../../components/ui/Feedback";
export function CentralHome() {
  const stats = useResource(getCentralOverview, "central");
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">e-ZDRAVSTVO CENTRAL</div>
          <h1>Administracija sustava</h1>
          <p>
            Ustanove, korisničke ovlasti i izgled dokumenata na jednom mjestu.
          </p>
        </div>
        <button className="secondary" onClick={stats.refresh}>
          Osvježi
        </button>
      </div>
      {stats.error && <ErrorMessage>{stats.error}</ErrorMessage>}
      {stats.loading ? (
        <p role="status">Učitavanje statistike…</p>
      ) : (
        stats.data && (
          <div className="stat-grid">
            {[
              ["Ustanove", stats.data.institutions],
              ["Korisnici", stats.data.users],
              ["Liječnici", stats.data.doctors],
              ["Pacijenti", stats.data.patients],
              ["Pregledi danas", stats.data.encounters_today],
              ["Izdani recepti ukupno", stats.data.prescriptions],
              ["Izdane uputnice ukupno", stats.data.referrals],
              ["Aktivni korisnici · 7 dana", stats.data.active_users_7d],
              ["Audit događaji danas", stats.data.audit_today],
            ].map(([label, count]) => (
              <section className="card stat-card" key={label}>
                <span>{label}</span>
                <strong>{count}</strong>
              </section>
            ))}
          </div>
        )
      )}
      <div className="admin-module-grid">
        {[
          {
            path: "korisnici",
            title: "Korisnici i ovlasti",
            text: "Dodijelite ili opozovite uloge u ustanovama.",
            Icon: Users,
          },
          {
            path: "ustanove",
            title: "Zdravstvene ustanove",
            text: "Uredite ustanove, odjele i timove.",
            Icon: Building2,
          },
          {
            path: "ambulante",
            title: "Ambulante i liječnici",
            text: "Podaci ambulante, šifre i osobne oznake potpisa.",
            Icon: Stethoscope,
          },
          {
            path: "predlosci",
            title: "Predlošci ispričnica",
            text: "Redovna nastava i TZK, izgled i tekst dokumenta.",
            Icon: FilePenLine,
          },
          {
            path: "sifrarnici",
            title: "Dijagnoze i razlozi",
            text: "Upravljajte šiframa bolesti i razlozima izostanka.",
            Icon: BookOpen,
          },
          {
            path: "skrbni-timovi",
            title: "Skrbni timovi",
            text: "Dodjela pristupa pacijentima i povezivanje računa.",
            Icon: Users,
          },
          {
            path: "audit",
            title: "Sigurnosna evidencija",
            text: "Pregled aktivnosti i promjena ovlasti.",
            Icon: ShieldCheck,
          },
        ].map(({ path, title, text, Icon }) => (
          <Link
            className="card admin-module"
            to={"/central/" + path}
            key={path}
          >
            <Icon size={26} />
            <h2>{title}</h2>
            <p>{text}</p>
            <ArrowUpRight className="summary-arrow" size={20} />
          </Link>
        ))}
      </div>
      <p className="signature-note">
        Statistika prikazuje zbirne podatke. Administratorska uloga ne omogućuje
        pregled sadržaja zdravstvenih kartona.
      </p>
    </>
  );
}
