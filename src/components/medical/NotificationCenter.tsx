import { useState } from "react";
import { CheckCheck, Bell } from "lucide-react";
import { useResource } from "../../hooks/useResource";
import { getNotifications } from "../../services/documents";
import { unwrap } from "../../services/clinical";
import { db } from "../../lib/supabase";
import { ErrorMessage } from "../ui/Feedback";
import { readableError } from "../../utils/format";
export function NotificationCenter({
  version,
  onRead,
}: {
  version: number;
  onRead: () => void;
}) {
  const resource = useResource(getNotifications, String(version)),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function read(id: string | null) {
    setBusy(true);
    setError("");
    try {
      unwrap(await db().rpc("mark_notification_read", { notification_id: id }));
      resource.refresh();
      onRead();
    } catch (e) {
      setError(readableError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card">
      <div className="section-heading">
        <h2>Moje obavijesti</h2>
        <button
          className="secondary"
          disabled={busy || !resource.data?.some((n) => !n.read_at)}
          onClick={() => void read(null)}
        >
          <CheckCheck size={16} />
          Označi sve pročitanima
        </button>
      </div>
      {error && <ErrorMessage>{error}</ErrorMessage>}
      {resource.error && <ErrorMessage>{resource.error}</ErrorMessage>}
      {resource.loading ? (
        <p role="status">Učitavanje obavijesti…</p>
      ) : resource.data?.length ? (
        resource.data.map((n) => (
          <article
            className={"notification-item " + (!n.read_at ? "unread" : "")}
            key={n.id}
          >
            <Bell size={17} />
            <div>
              <p>{n.message}</p>
              <small>{new Date(n.created_at).toLocaleString("hr-HR")}</small>
            </div>
            {!n.read_at && (
              <button
                className="text-link"
                disabled={busy}
                onClick={() => void read(n.id)}
              >
                Označi pročitano
              </button>
            )}
          </article>
        ))
      ) : (
        <p className="empty-state">Nemate obavijesti.</p>
      )}
      <p className="signature-note">Prikazuje se posljednjih 50 obavijesti.</p>
    </section>
  );
}
