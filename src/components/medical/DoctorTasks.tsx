import { Link } from "react-router-dom";
import { z } from "zod";
import { useResource } from "../../hooks/useResource";
import { useScheduleRefresh } from "../../hooks/useScheduleRefresh";
import { db } from "../../lib/supabase";
import { unwrap } from "../../services/clinical";
import { ErrorMessage } from "../ui/Feedback";
const schema = z.object({
  waiting: z.number(),
  unread_messages: z.number(),
  renewals: z.number(),
  critical_results: z.number(),
  clinic_requests: z.number(),
});
export function DoctorTasks() {
  const resource = useResource(
    async () =>
      schema.parse(unwrap(await db().rpc("doctor_task_overview", {}))),
    "tasks",
  );
  useScheduleRefresh(resource.refresh);
  return (
    <section className="card">
      <div className="section-heading">
        <h2>Zadaci za obradu</h2>
        <Link className="text-link" to="/ordinacija/tijek-skrbi">
          Tijek skrbi i kontrolne obveze
        </Link>
        <button
          className="text-link"
          disabled={resource.loading}
          onClick={resource.refresh}
        >
          Osvježi
        </button>
      </div>
      {resource.error && <ErrorMessage>{resource.error}</ErrorMessage>}
      {resource.loading ? (
        <p role="status">Učitavanje zadataka…</p>
      ) : (
        resource.data && (
          <div className="account-grid">
            {(
              [
                [
                  "/ordinacija/cekaonica",
                  "Pacijenti u čekaonici",
                  resource.data.waiting,
                ],
                [
                  "/ordinacija/zahtjevi-za-termin",
                  "Zahtjevi za termin",
                  resource.data.clinic_requests,
                ],
                [
                  "/ordinacija/komunikacija",
                  "Nepročitane poruke",
                  resource.data.unread_messages,
                ],
                [
                  "/ordinacija/obnova",
                  "Zahtjevi za obnovu terapije",
                  resource.data.renewals,
                ],
                [
                  "/ordinacija/laboratorij",
                  "Kritični nalazi bez potvrde preuzimanja",
                  resource.data.critical_results,
                ],
              ] as const
            ).map(([to, label, count]) => (
              <Link key={to} className="clinical-note" to={to}>
                <strong>{count}</strong>
                <p>{label}</p>
              </Link>
            ))}
          </div>
        )
      )}
    </section>
  );
}
