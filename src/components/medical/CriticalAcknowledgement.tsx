import { useState } from "react";
import { z } from "zod";
import { useResource } from "../../hooks/useResource";
import { db } from "../../lib/supabase";
import { unwrap } from "../../services/clinical";
import { readableError } from "../../utils/format";
import { ErrorMessage } from "../ui/Feedback";
const schema = z
  .object({ name: z.string(), acknowledged_at: z.string() })
  .nullable();
export function CriticalAcknowledgement({
  resultId,
  canAcknowledge,
}: {
  resultId: string;
  canAcknowledge: boolean;
}) {
  const resource = useResource(
    async () =>
      schema.parse(
        unwrap(
          await db().rpc("laboratory_acknowledgement", { result_id: resultId }),
        ),
      ),
    resultId,
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function acknowledge() {
    setBusy(true);
    setError("");
    try {
      unwrap(
        await db().rpc("acknowledge_laboratory_result", {
          result_id: resultId,
        }),
      );
      resource.refresh();
    } catch (e) {
      setError(readableError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="confirm-box spaced">
      <strong>Kritični rezultat</strong>
      <p>Oznaku kritičnosti postavio je laboratorij.</p>
      {(error || resource.error) && (
        <ErrorMessage>{error || resource.error}</ErrorMessage>
      )}
      {resource.loading ? (
        <p role="status">Provjera preuzimanja…</p>
      ) : resource.data ? (
        <p>
          Preuzimanje potvrdio/la {resource.data.name} ·{" "}
          {new Date(resource.data.acknowledged_at).toLocaleString("hr-HR", {
            timeZone: "Europe/Zagreb",
          })}
        </p>
      ) : (
        <>
          <p>Preuzimanje odgovornog liječnika još nije potvrđeno.</p>
          {canAcknowledge && (
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={() => void acknowledge()}
            >
              Potvrdi da sam preuzeo/la nalaz
            </button>
          )}
        </>
      )}
    </div>
  );
}
