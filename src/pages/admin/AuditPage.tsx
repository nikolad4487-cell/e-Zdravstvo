import { useState } from "react";
import { db } from "../../lib/supabase";
import { unwrap } from "../../services/clinical";
import { useResource } from "../../hooks/useResource";
import { ErrorMessage } from "../../components/ui/Feedback";
export function AuditPage() {
  const [page, setPage] = useState(0);
  const result = useResource(
    async () =>
      unwrap(
        await db()
          .from("audit_logs")
          .select("*")
          .order("created_at", { ascending: false })
          .order("id")
          .range(page * 50, page * 50 + 49),
      ),
    String(page),
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">CENTRAL · SIGURNOST</div>
          <h1>Audit događaji</h1>
          <p>
            Evidencija pristupa i promjena bez sadržaja medicinske
            dokumentacije.
          </p>
        </div>
        <button className="secondary" onClick={result.refresh}>
          Osvježi
        </button>
      </div>
      {result.error && <ErrorMessage>{result.error}</ErrorMessage>}
      <section className="card table-scroll">
        {result.loading ? (
          <p role="status">Učitavanje…</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Vrijeme</th>
                <th>Radnja</th>
                <th>Korisnik</th>
                <th>Entitet</th>
              </tr>
            </thead>
            <tbody>
              {result.data?.map((event) => (
                <tr key={event.id}>
                  <td>{new Date(event.created_at).toLocaleString("hr-HR")}</td>
                  <td>{event.action}</td>
                  <td>
                    <code>{event.user_id ?? "Javna provjera / sistem"}</code>
                  </td>
                  <td>
                    {event.entity_type}
                    <br />
                    <code>{event.entity_id}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <div className="document-actions">
        <button
          className="secondary"
          disabled={page === 0 || result.loading}
          onClick={() => setPage(page - 1)}
        >
          Prethodna
        </button>
        <span>Stranica {page + 1}</span>
        <button
          className="secondary"
          disabled={result.data?.length !== 50 || result.loading}
          onClick={() => setPage(page + 1)}
        >
          Sljedeća
        </button>
      </div>
    </>
  );
}
