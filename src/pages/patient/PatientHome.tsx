import { useEffect, useState } from "react";
import { useAuth } from "../../hooks/useAuth";
import { useResource } from "../../hooks/useResource";
import { getMyChart } from "../../services/clinical";
import { getNotifications } from "../../services/documents";
import { DocumentList } from "../../components/medical/DocumentList";
import { ClinicalHistory } from "../../components/medical/ClinicalHistory";
import { ErrorMessage } from "../../components/ui/Feedback";
import { db } from "../../lib/supabase";
import { dateLabel } from "../../utils/format";
export function PatientHome() {
  const auth = useAuth(),
    [tab, setTab] = useState("DOKUMENTI"),
    [version, setVersion] = useState(0);
  const chart = useResource(getMyChart, auth.profile?.id ?? "");
  const notifications = useResource(getNotifications, String(version));
  useEffect(() => {
    if (!auth.profile) return;
    const channel = db()
      .channel("patient-notifications")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${auth.profile.id}`,
        },
        () => {
          setVersion((v) => v + 1);
          chart.refresh();
        },
      )
      .subscribe();
    return () => {
      void db().removeChannel(channel);
    };
  }, [auth.profile, chart.refresh]);
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">MOJE e-ZDRAVSTVO</div>
          <h1>Dobro došli, {auth.profile?.first_name}</h1>
          <p>Vaši dokumenti i zdravstveni podaci na jednom mjestu.</p>
        </div>
      </div>
      <nav className="record-tabs" aria-label="Moj zdravstveni prostor">
        {[
          "DOKUMENTI",
          "RECEPTI",
          "UPUTNICE",
          "ISPRIČNICE",
          "TERAPIJA",
          "KARTON",
          "OBAVIJESTI",
        ].map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={tab === t ? "active" : ""}
          >
            {t}
          </button>
        ))}
      </nav>
      {["DOKUMENTI", "RECEPTI", "UPUTNICE", "ISPRIČNICE"].includes(tab) &&
        (chart.loading ? (
          <p role="status">Učitavanje…</p>
        ) : chart.error ? (
          <ErrorMessage>{chart.error}</ErrorMessage>
        ) : chart.data ? (
          <DocumentList
            patientId={chart.data.patient.id}
            version={version}
            kind={
              tab === "RECEPTI"
                ? "PRESCRIPTION"
                : tab === "UPUTNICE"
                  ? "REFERRAL"
                  : tab === "ISPRIČNICE"
                    ? "SCHOOL_EXCUSE"
                    : undefined
            }
          />
        ) : (
          <section className="card empty-state">
            Vaš račun još nije povezan sa zdravstvenim kartonom.
          </section>
        ))}
      {["KARTON", "TERAPIJA"].includes(tab) &&
        (chart.error ? (
          <ErrorMessage>{chart.error}</ErrorMessage>
        ) : chart.loading ? (
          <p role="status">Učitavanje kartona…</p>
        ) : chart.data ? (
          <>
            <section className="card spaced">
              <h2>
                {chart.data.patient.first_name} {chart.data.patient.last_name}
              </h2>
              <p>
                {chart.data.patient.patient_number} ·{" "}
                {dateLabel(chart.data.patient.birth_date)} · Krvna grupa:{" "}
                {chart.data.record?.blood_group ?? "Nije navedena"}
              </p>
              <p>
                {chart.data.doctors
                  .map(
                    (d) =>
                      d.display_name +
                      (d.is_primary ? " (izabrani liječnik)" : ""),
                  )
                  .join(", ")}
              </p>
              {chart.data.record?.warnings && (
                <p className="medical-alert">{chart.data.record.warnings}</p>
              )}
              {chart.data.allergies.map((a) => (
                <p key={a.id}>
                  Alergija: {a.name} · {a.reaction}
                </p>
              ))}
            </section>
            <ClinicalHistory
              tab={tab === "TERAPIJA" ? "TERAPIJA" : "POVIJEST"}
              chart={chart.data}
              onRefresh={chart.refresh}
              onAmend={() => undefined}
            />
            {tab === "KARTON" && (
              <ClinicalHistory
                tab="DIJAGNOZE"
                chart={chart.data}
                onRefresh={chart.refresh}
                onAmend={() => undefined}
              />
            )}
          </>
        ) : (
          <section className="card empty-state">
            Vaš račun još nije povezan sa zdravstvenim kartonom.
          </section>
        ))}
      {tab === "OBAVIJESTI" && (
        <section className="card">
          <h2>Obavijesti</h2>
          {notifications.error && (
            <ErrorMessage>{notifications.error}</ErrorMessage>
          )}
          {notifications.loading ? (
            <p role="status">Učitavanje…</p>
          ) : notifications.data?.length ? (
            notifications.data.map((n) => (
              <article className="clinical-note" key={n.id}>
                <p>{n.message}</p>
                <small>{dateLabel(n.created_at)}</small>
              </article>
            ))
          ) : (
            <p className="empty-state">Nemate novih obavijesti.</p>
          )}
        </section>
      )}
    </>
  );
}
