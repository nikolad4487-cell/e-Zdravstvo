import { useEffect, useState } from "react";
import { useAuth } from "../../hooks/useAuth";
import { useResource } from "../../hooks/useResource";
import { getMyChart } from "../../services/clinical";
import { PatientOverview } from "../../components/medical/PatientOverview";
import { AttachmentList } from "../../components/medical/AttachmentList";
import { NotificationCenter } from "../../components/medical/NotificationCenter";
import { Home, Files, HeartPulse, Bell } from "lucide-react";
import { DocumentList } from "../../components/medical/DocumentList";
import { ClinicalHistory } from "../../components/medical/ClinicalHistory";
import { ErrorMessage } from "../../components/ui/Feedback";
import { db } from "../../lib/supabase";
import { dateLabel } from "../../utils/format";
import { AppointmentPanel } from "../../components/medical/AppointmentPanel";
export function PatientHome() {
  const auth = useAuth(),
    [tab, setTab] = useState("POČETNA"),
    [version, setVersion] = useState(0);
  const chart = useResource(getMyChart, auth.profile?.id ?? "");
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
          "POČETNA",
          "DOKUMENTI",
          "PRIVITCI",
          "RECEPTI",
          "UPUTNICE",
          "ISPRIČNICE",
          "TERMINI",
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
      {tab === "POČETNA" && (
        <PatientOverview version={version} navigate={setTab} />
      )}
      {tab === "TERMINI" && <AppointmentPanel personal />}
      {tab === "DOKUMENTI" && (
        <button className="secondary" onClick={() => setTab("PRIVITCI")}>
          Učitani dokumenti i upload →
        </button>
      )}
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
              chart={{ ...chart.data, can_write: false }}
              onRefresh={chart.refresh}
              onAmend={() => undefined}
            />
            {tab === "KARTON" && (
              <ClinicalHistory
                tab="DIJAGNOZE"
                chart={{ ...chart.data, can_write: false }}
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
      {tab === "PRIVITCI" &&
        (chart.loading ? (
          <p role="status">Učitavanje…</p>
        ) : chart.error ? (
          <ErrorMessage>{chart.error}</ErrorMessage>
        ) : chart.data ? (
          <AttachmentList
            patientId={chart.data.patient.id}
            canUpload
            version={version}
            onChanged={() => setVersion((v) => v + 1)}
          />
        ) : (
          <section className="card empty-state">
            Vaš račun još nije povezan sa zdravstvenim kartonom.
          </section>
        ))}
      {tab === "OBAVIJESTI" && (
        <NotificationCenter
          version={version}
          onRead={() => setVersion((v) => v + 1)}
        />
      )}
      <nav className="patient-bottom-nav" aria-label="Brza navigacija">
        {[
          { tab: "POČETNA", label: "Početna", Icon: Home },
          { tab: "DOKUMENTI", label: "Dokumenti", Icon: Files },
          { tab: "KARTON", label: "Karton", Icon: HeartPulse },
          { tab: "OBAVIJESTI", label: "Obavijesti", Icon: Bell },
        ].map((item) => (
          <button
            key={item.tab}
            className={tab === item.tab ? "active" : ""}
            onClick={() => setTab(item.tab)}
          >
            <item.Icon size={21} />
            <span>{item.label}</span>
          </button>
        ))}
      </nav>
    </>
  );
}
