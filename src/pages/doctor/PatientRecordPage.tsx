import { InpatientCare } from "../../components/medical/InpatientCare";
import { CarePathways } from "../../components/medical/CarePathways";
import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  ShieldAlert,
  UserRound,
  Plus,
  Stethoscope,
} from "lucide-react";
import { useResource } from "../../hooks/useResource";
import { getChart } from "../../services/clinical";
import { EditPatient } from "../../components/medical/EditPatient";
import { ErrorMessage } from "../../components/ui/Feedback";
import { ClinicalModal } from "../../components/medical/ClinicalModal";
import type { ClinicalAction } from "../../components/medical/ClinicalModal";
import { ClinicalHistory } from "../../components/medical/ClinicalHistory";
import type { MedicalEncounter } from "../../types/clinical";
import { AttachmentList } from "../../components/medical/AttachmentList";
import { DocumentList } from "../../components/medical/DocumentList";
import { AppointmentPanel } from "../../components/medical/AppointmentPanel";
import { LaboratoryPanel } from "../../components/medical/LaboratoryPanel";
import { HospitalBookings } from "../../components/medical/HospitalBookings";
import { PriorityHospitalBooking } from "../../components/medical/PriorityHospitalBooking";
import { RenewalPanel } from "../../components/medical/RenewalPanel";
import { MedicalReports } from "../../components/medical/MedicalReports";
import { VaccinationPanel } from "../../components/medical/VaccinationPanel";
import { FhirExport } from "../../components/medical/FhirExport";
import { IssueDocumentModal } from "../../components/medical/IssueDocumentModal";
import type { DocumentKind } from "../../types/documents";
import { age, dateLabel } from "../../utils/format";
export function PatientRecordPage() {
  const [editingPatient, setEditingPatient] = useState(false);
  const [issue, setIssue] = useState<DocumentKind | null>(null),
    [priorityBooking, setPriorityBooking] = useState(false),
    [documentVersion, setDocumentVersion] = useState(0);
  const { id = "" } = useParams();
  const chart = useResource(() => getChart(id), id);
  const [params] = useSearchParams();
  const [tab, setTab] = useState(
      params.get("tab") &&
        [
          "HOSPITALIZACIJE",
          "UPUTNICE",
          "LABORATORIJ",
          "NARUDŽBE",
          "NALAZI",
        ].includes(params.get("tab")!)
        ? params.get("tab")!
        : "PREGLED",
    ),
    [action, setAction] = useState<ClinicalAction | null>(null),
    [amendment, setAmendment] = useState<MedicalEncounter>(),
    [success, setSuccess] = useState("");
  useEffect(() => {
    const section = params.get("tab");
    if (
      section &&
      [
        "HOSPITALIZACIJE",
        "UPUTNICE",
        "LABORATORIJ",
        "NARUDŽBE",
        "NALAZI",
      ].includes(section)
    )
      setTab(section);
  }, [params, id]);
  if (chart.error) return <ErrorMessage>{chart.error}</ErrorMessage>;
  if (!chart.data) return <p role="status">Učitavanje kartona…</p>;
  const {
    patient: p,
    record,
    allergies,
    doctors,
    can_write,
    therapy,
    diagnoses,
  } = chart.data;
  function open(a: ClinicalAction) {
    setAmendment(undefined);
    setAction(a);
  }
  return (
    <>
      <Link className="back-link" to="/ordinacija/pacijenti">
        <ArrowLeft size={14} /> Svi pacijenti
      </Link>
      <section className="patient-header card">
        <div className="avatar large">
          {p.first_name[0]}
          {p.last_name[0]}
        </div>
        <div>
          <div className="eyebrow">ZDRAVSTVENI KARTON · {p.patient_number}</div>
          <h1>
            {p.first_name} {p.last_name}
          </h1>
          <p>
            {dateLabel(p.birth_date)} · {age(p.birth_date)} god. · Krvna grupa:{" "}
            {record?.blood_group ?? "Nepoznata"}
          </p>
        </div>
        {can_write && (
          <div className="patient-actions">
            <button
              className="secondary"
              onClick={() => setEditingPatient(true)}
            >
              Uredi pacijenta
            </button>
            <button className="primary" onClick={() => open("encounter")}>
              <Stethoscope size={17} />
              Novi pregled
            </button>
            <button
              className="secondary"
              onClick={() => setPriorityBooking(true)}
            >
              Naruči prioritetni pregled
            </button>
          </div>
        )}
      </section>
      <FhirExport patientId={id} />
      {tab === "HOSPITALIZACIJE" && (
        <InpatientCare
          patientId={id}
          patientName={p.first_name + " " + p.last_name}
        />
      )}
      {tab === "TIJEK SKRBI" && can_write && <CarePathways patientId={id} />}
      {editingPatient && (
        <EditPatient
          patient={p}
          onClose={() => setEditingPatient(false)}
          onSaved={() => {
            setEditingPatient(false);
            setSuccess("Podaci pacijenta su spremljeni.");
            chart.refresh();
          }}
        />
      )}
      {success && (
        <div role="status" className="success-toast">
          {success}
        </div>
      )}
      {(allergies.length > 0 || record?.warnings) && (
        <div className="medical-alert">
          <ShieldAlert />
          <div>
            <strong>Medicinska upozorenja</strong>
            <p>
              {allergies.map((a) => a.name).join(", ")}
              {record?.warnings ? " · " + record.warnings : ""}
            </p>
          </div>
        </div>
      )}
      <nav className="record-tabs" aria-label="Dijelovi kartona">
        {[
          "PREGLED",
          ...(can_write ? ["TIJEK SKRBI"] : []),
          "HOSPITALIZACIJE",
          "POVIJEST",
          "DIJAGNOZE",
          "TERAPIJA",
          ...(can_write ? ["OBNOVA LIJEKOVA"] : []),
          "RECEPTI",
          "UPUTNICE",
          "ISPRIČNICE",
          "DOKUMENTI",
          "TERMINI",
          "NARUDŽBE",
          "LABORATORIJ",
          "NALAZI",
          "CIJEPLJENJA",
        ].map((t) => (
          <button
            key={t}
            className={tab === t ? "active" : ""}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </nav>
      {can_write && (
        <div className="clinical-shortcuts">
          {tab === "DIJAGNOZE" && (
            <button className="primary" onClick={() => open("diagnosis")}>
              <Plus size={16} />
              Dodaj dijagnozu
            </button>
          )}
          {tab === "TERAPIJA" && (
            <button className="primary" onClick={() => open("therapy")}>
              <Plus size={16} />
              Dodaj terapiju
            </button>
          )}
          {tab === "PREGLED" && (
            <>
              <button className="secondary" onClick={() => open("allergy")}>
                Dodaj alergiju
              </button>
              <button className="secondary" onClick={() => open("warnings")}>
                Uredi upozorenja
              </button>
            </>
          )}
        </div>
      )}
      {can_write && (
        <div className="clinical-shortcuts">
          <button
            className="secondary"
            onClick={() => setIssue("PRESCRIPTION")}
          >
            Novi recept
          </button>
          <button className="secondary" onClick={() => setIssue("REFERRAL")}>
            Nova uputnica
          </button>
          <button
            className="secondary"
            onClick={() => setIssue("SCHOOL_EXCUSE")}
          >
            Nova ispričnica
          </button>
        </div>
      )}
      {tab === "CIJEPLJENJA" ? (
        <VaccinationPanel patientId={id} canWrite={can_write} />
      ) : tab === "NALAZI" ? (
        <MedicalReports patientId={id} canPublish={can_write} />
      ) : tab === "OBNOVA LIJEKOVA" ? (
        <RenewalPanel patientId={id} />
      ) : tab === "NARUDŽBE" ? (
        <HospitalBookings mode="CARE" patientId={id} canBook={can_write} />
      ) : tab === "LABORATORIJ" ? (
        <LaboratoryPanel mode="CARE" patientId={id} canOrder={can_write} />
      ) : tab === "TERMINI" ? (
        <AppointmentPanel patientId={id} />
      ) : ["RECEPTI", "UPUTNICE", "ISPRIČNICE", "DOKUMENTI"].includes(tab) ? (
        <>
          {tab === "DOKUMENTI" && (
            <AttachmentList patientId={id} canUpload={can_write} />
          )}
          <DocumentList
            patientId={id}
            kind={
              tab === "RECEPTI"
                ? "PRESCRIPTION"
                : tab === "UPUTNICE"
                  ? "REFERRAL"
                  : tab === "ISPRIČNICE"
                    ? "SCHOOL_EXCUSE"
                    : undefined
            }
            version={documentVersion}
          />
        </>
      ) : tab === "PREGLED" ? (
        <>
          <div className="account-grid">
            <section className="card">
              <div className="card-title">
                <UserRound size={18} />
                <h2>Podaci pacijenta</h2>
              </div>
              <dl>
                {[
                  [
                    "Adresa",
                    [p.address, p.city, p.postal_code]
                      .filter(Boolean)
                      .join(", "),
                  ],
                  ["Telefon", p.phone],
                  ["E-mail", p.email],
                  ["Hitni kontakt", p.emergency_contact],
                  ["Osiguranje", p.insurance],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value || "Nije navedeno"}</dd>
                  </div>
                ))}
              </dl>
            </section>
            <section className="card">
              <h2>Tim koji skrbi o pacijentu</h2>
              {doctors.map((d) => (
                <div className="institution-card" key={d.id}>
                  <div>
                    <h3>{d.display_name}</h3>
                    <p>
                      {d.specialty}
                      {d.is_primary ? " · Izabrani liječnik" : ""}
                    </p>
                  </div>
                </div>
              ))}
            </section>
            <section className="card">
              <h2>Aktivna terapija</h2>
              {therapy
                .filter(
                  (t) =>
                    t.status === "ACTIVE" &&
                    (!t.end_date ||
                      t.end_date >= new Date().toISOString().slice(0, 10)),
                )
                .map((t) => (
                  <div className="clinical-note" key={t.id}>
                    <strong>
                      {t.name} · {t.packaging || t.strength}
                    </strong>
                    <p className="note-text">
                      {t.dosage} · {t.frequency}
                    </p>
                  </div>
                ))}
              {!therapy.some((t) => t.status === "ACTIVE") && (
                <p className="empty-state">Nema aktivne terapije.</p>
              )}
            </section>
            <section className="card">
              <h2>Kronične bolesti i alergije</h2>
              {diagnoses
                .filter((d) => d.status === "CHRONIC")
                .map((d) => (
                  <p className="clinical-note" key={d.id}>
                    {d.code} · {d.name}
                  </p>
                ))}
              {allergies.map((a) => (
                <div className="clinical-note" key={a.id}>
                  <strong>{a.name}</strong>
                  <p className="note-text">
                    {a.reaction || "Reakcija nije navedena."}
                  </p>
                </div>
              ))}
              {!allergies.length &&
                !diagnoses.some((d) => d.status === "CHRONIC") && (
                  <p className="empty-state">Nema evidentiranih stavki.</p>
                )}
            </section>
          </div>
        </>
      ) : (
        <ClinicalHistory
          tab={tab}
          chart={chart.data}
          onRefresh={chart.refresh}
          onAmend={(e) => {
            setAmendment(e);
            setAction("encounter");
          }}
        />
      )}
      {issue && (
        <IssueDocumentModal
          kind={issue}
          chart={chart.data}
          onClose={() => setIssue(null)}
          onSaved={() => {
            setIssue(null);
            setTab("DOKUMENTI");
            setDocumentVersion((v) => v + 1);
            setSuccess("Dokument je izdan i dostupan pacijentu.");
          }}
        />
      )}
      {priorityBooking && (
        <PriorityHospitalBooking
          patientId={id}
          patientName={`${p.first_name} ${p.last_name}`}
          onClose={() => setPriorityBooking(false)}
          onSaved={(message) => {
            setPriorityBooking(false);
            setTab("NARUDŽBE");
            setDocumentVersion((v) => v + 1);
            setSuccess(message);
          }}
        />
      )}
      {action && (
        <ClinicalModal
          action={action}
          chart={chart.data}
          amendment={amendment}
          onClose={() => setAction(null)}
          onSaved={(message) => {
            setAction(null);
            setSuccess(message);
            if (action === "encounter") setTab("POVIJEST");
            chart.refresh();
          }}
        />
      )}
    </>
  );
}
