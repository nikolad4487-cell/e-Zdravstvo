import { useState } from "react";
import { useResource } from "../../hooks/useResource";
import { useScheduleRefresh } from "../../hooks/useScheduleRefresh";
import {
  messageThreads,
  readMessages,
  type MessageThread,
} from "../../services/communication";
import { db } from "../../lib/supabase";
import { unwrap } from "../../services/clinical";
import { ErrorMessage } from "../ui/Feedback";
import { readableError } from "../../utils/format";
export function CommunicationPanel({
  personal = false,
}: {
  personal?: boolean;
}) {
  const [search, setSearch] = useState(""),
    [selected, setSelected] = useState<MessageThread | null>(null);
  const threads = useResource(
    () => messageThreads(personal, search),
    String(personal) + search,
  );
  useScheduleRefresh(threads.refresh);
  return (
    <>
      <div className="page-heading">
        <div>
          <h2>Komunikacija</h2>
          <p>
            Poruke između pacijenta i njegova liječnika. Poruke nisu namijenjene
            hitnim stanjima.
          </p>
        </div>
      </div>
      <label className="field">
        <span>Pretraži razgovore</span>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          maxLength={100}
        />
      </label>
      {threads.error && <ErrorMessage>{threads.error}</ErrorMessage>}
      <div className="communication-grid">
        <section className="card">
          {threads.loading ? (
            <p role="status">Učitavanje razgovora…</p>
          ) : threads.data?.length === 0 ? (
            <p>Nema dostupnih razgovora. Potrebna je aktivna skrbna veza.</p>
          ) : (
            threads.data?.map((t) => (
              <button
                key={t.patient_id + t.doctor_id}
                className={
                  "conversation-choice " +
                  (selected?.patient_id === t.patient_id &&
                  selected?.doctor_id === t.doctor_id
                    ? "active"
                    : "")
                }
                onClick={() => setSelected(t)}
              >
                <strong>{personal ? t.doctor_name : t.patient_name}</strong>
                <small>
                  {t.messaging_enabled
                    ? "Komunikacija otvorena"
                    : "Komunikacija zatvorena"}
                </small>
              </button>
            ))
          )}
        </section>
        {selected ? (
          <Conversation
            key={selected.patient_id + selected.doctor_id}
            thread={
              threads.data?.find(
                (t) =>
                  t.patient_id === selected.patient_id &&
                  t.doctor_id === selected.doctor_id,
              ) ?? selected
            }
            personal={personal}
            refresh={threads.refresh}
          />
        ) : (
          <section className="card empty-state">Odaberite razgovor.</section>
        )}
      </div>
    </>
  );
}
function Conversation({
  thread,
  personal,
  refresh,
}: {
  thread: MessageThread;
  personal: boolean;
  refresh: () => void;
}) {
  const [before, setBefore] = useState<string | null>(null),
    [body, setBody] = useState(""),
    [request, setRequest] = useState(crypto.randomUUID()),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const messages = useResource(
    () => readMessages(thread.patient_id, thread.doctor_id, before),
    thread.patient_id + thread.doctor_id + before,
  );
  useScheduleRefresh(messages.refresh);
  async function send(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      unwrap(
        await db().rpc("send_patient_message", {
          patient_id: thread.patient_id,
          doctor_id: thread.doctor_id,
          body,
          request_id: request,
        }),
      );
      setBody("");
      setRequest(crypto.randomUUID());
      setBefore(null);
      messages.refresh();
      refresh();
    } catch (e) {
      setError(readableError(e));
    } finally {
      setBusy(false);
    }
  }
  async function toggle() {
    setBusy(true);
    setError("");
    try {
      unwrap(
        await db().rpc("set_messaging_enabled", {
          doctor_id: thread.doctor_id,
          enabled: !thread.messaging_enabled,
        }),
      );
      refresh();
    } catch (e) {
      setError(readableError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card">
      <div className="section-heading">
        <h3>{personal ? thread.doctor_name : thread.patient_name}</h3>
        {!personal && (
          <button
            className="secondary"
            disabled={busy}
            onClick={() => void toggle()}
          >
            {thread.messaging_enabled
              ? "Zatvori komunikaciju"
              : "Otvori komunikaciju"}
          </button>
        )}
      </div>
      {(error || messages.error) && (
        <ErrorMessage>{error || messages.error}</ErrorMessage>
      )}
      <div className="message-history">
        {messages.loading ? (
          <p role="status">Učitavanje poruka…</p>
        ) : !messages.data?.length ? (
          <p>Nema poruka u razgovoru.</p>
        ) : (
          messages.data.map((m) => (
            <article
              key={m.id}
              className={"message-bubble " + (m.own ? "own" : "")}
            >
              <small>
                {m.own
                  ? "Vi"
                  : personal
                    ? thread.doctor_name
                    : thread.patient_name}{" "}
                ·{" "}
                {new Date(m.created_at).toLocaleString("hr-HR", {
                  timeZone: "Europe/Zagreb",
                })}
              </small>
              <p className="note-text">{m.body}</p>
            </article>
          ))
        )}
      </div>
      <div className="document-actions">
        {messages.data?.length === 100 && (
          <button
            className="text-link"
            onClick={() => setBefore(messages.data?.[0].created_at ?? null)}
          >
            Starije poruke
          </button>
        )}
        {before && (
          <button className="text-link" onClick={() => setBefore(null)}>
            Najnovije poruke
          </button>
        )}
      </div>
      {thread.messaging_enabled ? (
        <form onSubmit={send}>
          <label className="field">
            <span>Nova poruka</span>
            <textarea
              value={body}
              onChange={(e) => {
                setBody(e.target.value);
                setRequest(crypto.randomUUID());
              }}
              required
              maxLength={4000}
            />
          </label>
          <div className="modal-actions">
            <button className="primary" disabled={busy || !body.trim()}>
              {busy ? "Slanje…" : "Pošalji poruku"}
            </button>
          </div>
        </form>
      ) : (
        <p className="confirm-box">
          Liječnik trenutačno nema otvorenu komunikaciju. Prethodne poruke
          ostaju dostupne.
        </p>
      )}
    </section>
  );
}
