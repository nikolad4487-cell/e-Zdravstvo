import {
  Pill,
  ArrowUpRight,
  Files,
  Bell,
  Stethoscope,
  FileCheck2,
  HeartPulse,
} from "lucide-react";
import { useResource } from "../../hooks/useResource";
import { getPatientDashboard } from "../../services/attachments";
import { ErrorMessage } from "../ui/Feedback";
import { dateLabel } from "../../utils/format";
import { kindLabels, documentStatusLabels } from "../../types/documents";
export function PatientOverview({
  version,
  navigate,
}: {
  version: number;
  navigate: (tab: string) => void;
}) {
  const resource = useResource(getPatientDashboard, String(version));
  if (resource.error) return <ErrorMessage>{resource.error}</ErrorMessage>;
  if (resource.loading)
    return <p role="status">Učitavanje osobnog pregleda…</p>;
  const data = resource.data;
  if (!data)
    return (
      <section className="card empty-state">
        Vaš račun još nije povezan sa zdravstvenim kartonom.
      </section>
    );
  const cards = [
    {
      tab: "RECEPTI",
      label: "Aktivni recepti",
      count: data.active_prescriptions,
      Icon: Pill,
    },
    {
      tab: "UPUTNICE",
      label: "Aktivne uputnice",
      count: data.active_referrals,
      Icon: ArrowUpRight,
    },
    {
      tab: "PRIVITCI",
      label: "Učitani dokumenti",
      count: data.attachments,
      Icon: Files,
    },
    {
      tab: "OBAVIJESTI",
      label: "Nepročitane obavijesti",
      count: data.unread_notifications,
      Icon: Bell,
    },
  ];
  return (
    <>
      <div className="patient-summary-grid">
        {cards.map(({ tab, label, count, Icon }) => (
          <button
            className="card patient-summary"
            key={tab}
            onClick={() => navigate(tab)}
          >
            <Icon size={23} />
            <strong>{count}</strong>
            <span>{label}</span>
            <ArrowUpRight className="summary-arrow" size={18} />
          </button>
        ))}
      </div>
      <div className="account-grid">
        <section className="card">
          <div className="section-heading">
            <h2>
              <HeartPulse size={18} className="inline-icon" /> Aktivna terapija
            </h2>
            <button className="text-link" onClick={() => navigate("TERAPIJA")}>
              Sva terapija →
            </button>
          </div>
          {data.active_therapy.length ? (
            data.active_therapy.map((t) => (
              <article className="clinical-note" key={t.id}>
                <strong>
                  {t.name} · {t.strength}
                </strong>
                <p className="note-text">
                  {t.dosage} · {t.frequency}
                </p>
              </article>
            ))
          ) : (
            <p className="empty-state">Nemate aktivnu terapiju.</p>
          )}
        </section>
        <section className="card">
          <h2>
            <Stethoscope size={18} className="inline-icon" /> Moji liječnici
          </h2>
          {data.doctors.length ? (
            data.doctors.map((d) => (
              <article className="clinical-note" key={d.id}>
                <strong>{d.name}</strong>
                <p className="note-text">
                  {d.specialty} · {d.institution}
                </p>
                {d.is_primary && (
                  <span className="status-text">Izabrani liječnik</span>
                )}
              </article>
            ))
          ) : (
            <p className="empty-state">Liječnik još nije dodijeljen.</p>
          )}
        </section>
        <section className="card">
          <div className="section-heading">
            <h2>
              <FileCheck2 size={18} className="inline-icon" /> Nedavni dokumenti
            </h2>
            <button className="text-link" onClick={() => navigate("DOKUMENTI")}>
              Svi dokumenti →
            </button>
          </div>
          {data.recent_documents.length ? (
            data.recent_documents.map((d) => (
              <button
                className="document-summary"
                key={d.id}
                onClick={() =>
                  navigate(
                    d.kind === "PRESCRIPTION"
                      ? "RECEPTI"
                      : d.kind === "REFERRAL"
                        ? "UPUTNICE"
                        : "ISPRIČNICE",
                  )
                }
              >
                <strong>{kindLabels[d.kind]}</strong>
                <span>{d.number}</span>
                <small>
                  {dateLabel(d.issued_at)} ·{" "}
                  {documentStatusLabels[d.status] ?? d.status}
                </small>
              </button>
            ))
          ) : (
            <p className="empty-state">Još nema izdanih dokumenata.</p>
          )}
        </section>
        <section className="card">
          <div className="section-heading">
            <h2>Nedavne aktivnosti</h2>
            <button
              className="text-link"
              onClick={() => navigate("OBAVIJESTI")}
            >
              Sve obavijesti →
            </button>
          </div>
          {data.recent_activity.length ? (
            data.recent_activity.map((n) => (
              <article className="timeline-item" key={n.id}>
                <span className="timeline-dot" />
                <div>
                  <p>{n.message}</p>
                  <small>
                    {new Date(n.created_at).toLocaleString("hr-HR")}
                  </small>
                </div>
              </article>
            ))
          ) : (
            <p className="empty-state">Nema nedavnih aktivnosti.</p>
          )}
        </section>
      </div>
    </>
  );
}
