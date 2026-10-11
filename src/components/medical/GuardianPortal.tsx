import { useState } from "react";
import { z } from "zod";
import { db } from "../../lib/supabase";
import { unwrap } from "../../services/clinical";
import { useScheduleRefresh } from "../../hooks/useScheduleRefresh";
import { useResource } from "../../hooks/useResource";
import { chartSchema } from "../../types/clinical";
import { ClinicalHistory } from "./ClinicalHistory";
import { DocumentList } from "./DocumentList";
import { LaboratoryPanel } from "./LaboratoryPanel";
import { ErrorMessage } from "../ui/Feedback";
import { Pagination } from "../ui/Pagination";
const childrenSchema = z.array(
  z.object({
    id: z.string(),
    first_name: z.string(),
    last_name: z.string(),
    patient_number: z.string(),
    birth_date: z.string(),
    expires_at: z.string(),
  }),
);
export function GuardianPortal() {
  const [page, setPage] = useState(0),
    [selected, setSelected] = useState<string | null>(null);
  const children = useResource(
    async () =>
      childrenSchema.parse(
        unwrap(await db().rpc("my_guardian_patients", { page_number: page })),
      ),
    String(page),
  );
  useScheduleRefresh(children.refresh);
  return (
    <>
      <h2>Djeca pod skrbništvom</h2>
      <p>
        Pristup za pregled podataka maloljetnika nakon provjere i dodjele
        ovlasti administratora. Ovlast istječe najkasnije s punoljetnošću.
      </p>
      {children.error && <ErrorMessage>{children.error}</ErrorMessage>}
      {children.loading ? (
        <p role="status">Učitavanje…</p>
      ) : (
        <section className="card">
          {children.data?.length ? (
            children.data.map((p) => (
              <button
                type="button"
                className="secondary"
                key={p.id}
                onClick={() => setSelected(p.id)}
              >
                {p.first_name} {p.last_name} · {p.patient_number}
              </button>
            ))
          ) : (
            <p>Nema dodijeljenog pristupa.</p>
          )}
        </section>
      )}
      <Pagination
        page={page}
        size={children.data?.length ?? 0}
        loading={children.loading}
        onChange={setPage}
      />
      {selected && <GuardianRecord key={selected} patientId={selected} />}
    </>
  );
}
function GuardianRecord({ patientId }: { patientId: string }) {
  const chart = useResource(
    async () =>
      chartSchema.parse(
        unwrap(
          await db().rpc("guardian_patient_record", { patient_id: patientId }),
        ),
      ),
    patientId,
  );
  const [tab, setTab] = useState("POVIJEST");
  useScheduleRefresh(chart.refresh);
  if (chart.error) return <ErrorMessage>{chart.error}</ErrorMessage>;
  if (!chart.data) return <p role="status">Učitavanje kartona…</p>;
  return (
    <>
      <h3>
        {chart.data.patient.first_name} {chart.data.patient.last_name}
      </h3>
      <nav className="record-tabs" aria-label="Pregled kartona djeteta">
        {["POVIJEST", "DIJAGNOZE", "TERAPIJA", "DOKUMENTI", "LABORATORIJ"].map(
          (t) => (
            <button
              type="button"
              className={tab === t ? "active" : ""}
              key={t}
              onClick={() => setTab(t)}
            >
              {t}
            </button>
          ),
        )}
      </nav>
      {tab === "DOKUMENTI" ? (
        <DocumentList patientId={patientId} />
      ) : tab === "LABORATORIJ" ? (
        <LaboratoryPanel mode="CARE" patientId={patientId} />
      ) : (
        <ClinicalHistory
          tab={tab}
          chart={{ ...chart.data, can_write: false }}
          onRefresh={chart.refresh}
          onAmend={() => undefined}
        />
      )}
    </>
  );
}
