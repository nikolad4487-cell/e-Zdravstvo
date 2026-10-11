import { useState } from "react";
import { z } from "zod";
import { useResource } from "../../hooks/useResource";
import { db } from "../../lib/supabase";
import { unwrap } from "../../services/clinical";
import { readableError } from "../../utils/format";
import { ErrorMessage } from "../ui/Feedback";
const schema = z.object({
  email_enabled: z.boolean(),
  appointment_reminders: z.boolean(),
  email_available: z.boolean(),
});
export function NotificationPreferences() {
  const resource = useResource(
    async () =>
      schema.parse(unwrap(await db().rpc("notification_preferences", {}))),
    "notification-preferences",
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [success, setSuccess] = useState("");
  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      unwrap(
        await db().rpc("save_notification_preferences", {
          email_enabled: data.get("email_enabled") === "on",
          appointment_reminders: data.get("appointment_reminders") === "on",
        }),
      );
      resource.refresh();
      setSuccess("Postavke obavijesti su spremljene.");
    } catch (e) {
      setError(readableError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card spaced">
      <h2>Postavke obavijesti</h2>
      {(error || resource.error) && (
        <ErrorMessage>{error || resource.error}</ErrorMessage>
      )}
      {success && <p role="status">{success}</p>}
      {resource.loading ? (
        <p role="status">Učitavanje postavki…</p>
      ) : (
        resource.data && (
          <form key={JSON.stringify(resource.data)} onSubmit={save}>
            <p>
              Obavijesti su dostupne u portalu. Podsjetnik za termin pojavljuje
              se tijekom 24 sata prije termina.
            </p>
            <label className="field">
              <span>
                <input
                  type="checkbox"
                  name="appointment_reminders"
                  defaultChecked={resource.data.appointment_reminders}
                />{" "}
                Podsjetnici za zakazane termine
              </span>
            </label>
            <label className="field">
              <span>
                <input
                  type="checkbox"
                  name="email_enabled"
                  defaultChecked={resource.data.email_enabled}
                  disabled={!resource.data.email_available}
                />{" "}
                Obavijesti e-poštom
              </span>
            </label>
            <p>
              {resource.data.email_available
                ? "Potvrde, promjene i otkazivanja termina šalju se na potvrđeni e-mail vašeg računa. Poruke ne sadrže dijagnoze ni sadržaj uputnice."
                : "Slanje e-pošte još nije aktivirano. Obavijesti možete pratiti u portalu."}
            </p>
            <button className="secondary" disabled={busy}>
              Spremi postavke obavijesti
            </button>
          </form>
        )
      )}
    </section>
  );
}
