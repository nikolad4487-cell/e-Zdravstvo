import { useState } from "react";
import { Modal } from "../ui/Modal";
import { Field, values } from "../ui/Fields";
import { ErrorMessage } from "../ui/Feedback";
import { MedicalCodePicker } from "./MedicalCodePicker";
import { useResource } from "../../hooks/useResource";
import {
  laboratorySamples,
  laboratorySampleLabel,
  createLaboratorySample,
  changeLaboratorySample,
  sampleLabels,
  type LaboratorySample,
} from "../../services/laboratorySamples";
import { dateLabel, readableError } from "../../utils/format";
import { zagrebDate, zagrebTime } from "../../utils/calendar";
export function LaboratorySamples({
  orderId,
  onClose,
  onChanged,
}: {
  orderId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [scan, setScan] = useState(""),
    [filter, setFilter] = useState(""),
    [specimen, setSpecimen] = useState(""),
    [request, setRequest] = useState(crypto.randomUUID()),
    [replacement, setReplacement] = useState<LaboratorySample | null>(null),
    [reject, setReject] = useState<LaboratorySample | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [success, setSuccess] = useState("");
  const resource = useResource(
    () => laboratorySamples(orderId, filter),
    JSON.stringify([orderId, filter]),
  );
  async function run(fn: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError("");
    try {
      await fn();
      setSuccess(message);
      setRequest(crypto.randomUUID());
      setReplacement(null);
      setReject(null);
      resource.refresh();
      onChanged();
    } catch (e) {
      setError(readableError(e));
    } finally {
      setBusy(false);
    }
  }
  async function print(sample: LaboratorySample) {
    if (!resource.data) return;
    setBusy(true);
    setError("");
    try {
      const { sampleLabelPdf } = await import("../../utils/sampleLabelPdf");
      const { savePdf } = await import("../../utils/schoolExcusePdf");
      const label = await laboratorySampleLabel(sample.id);
      savePdf(await sampleLabelPdf(label.items[0], label.order), sample.code);
    } catch (e) {
      setError(readableError(e));
    } finally {
      setBusy(false);
    }
  }
  const closed =
      resource.data &&
      ["COMPLETED", "CANCELLED"].includes(resource.data.order.status),
    processing = resource.data?.order.sample_status === "PROCESSING",
    received =
      resource.data && resource.data.order.sample_status !== "EXPECTED";
  return (
    <Modal title="Uzorci i oznake" wide busy={busy} onClose={onClose}>
      <div className="modal-content">
        {resource.data && (
          <>
            <h3>{resource.data.order.patient_name}</h3>
            <p>
              {resource.data.order.patient_number} ·{" "}
              {resource.data.order.number}
            </p>
          </>
        )}
        <p className="note-text">
          Oznaka sadrži QR kod za skeniranje. Ispišite PDF na 100 % veličine (90
          × 50 mm) i provjerite identitet prije označavanja uzorka.
        </p>
        {success && (
          <p role="status" className="feedback success">
            {success}
          </p>
        )}
        {(error || resource.error) && (
          <ErrorMessage>{error || resource.error}</ErrorMessage>
        )}
        <form
          className="form-grid spaced"
          onSubmit={(e) => {
            e.preventDefault();
            setFilter(scan.trim());
          }}
        >
          <Field
            name="sample_scan"
            label="Skeniraj ili upiši oznaku uzorka"
            value={scan}
            maxLength={80}
            onChange={(e) => setScan(e.target.value)}
          />
          <div className="document-actions">
            <button className="secondary" disabled={busy}>
              Pronađi oznaku
            </button>
            <button
              type="button"
              className="text-link"
              disabled={busy}
              onClick={() => {
                setScan("");
                setFilter("");
              }}
            >
              Prikaži sve uzorke
            </button>
          </div>
        </form>
        {!closed && !processing && received && (
          <form
            className="card spaced"
            onSubmit={(e) => {
              e.preventDefault();
              void run(
                () =>
                  createLaboratorySample(
                    orderId,
                    replacement?.specimen_code ?? specimen,
                    request,
                    replacement?.id ?? null,
                  ),
                "Oznaka uzorka je izrađena.",
              );
            }}
          >
            <h3>
              {replacement
                ? "Zamjenski uzorak za " + replacement.code
                : "Nova oznaka uzorka"}
            </h3>
            {replacement ? (
              <p>{replacement.specimen_name}</p>
            ) : (
              <MedicalCodePicker
                list="2.2.18"
                name="sample_specimen"
                label="Vrsta uzorka"
                onSelected={(items) => setSpecimen(items[0]?.code ?? "")}
              />
            )}
            <div className="document-actions spaced">
              <button
                className="primary"
                disabled={busy || (!replacement && !specimen)}
              >
                Izradi oznaku
              </button>
              {replacement && (
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    setReplacement(null);
                    setRequest(crypto.randomUUID());
                  }}
                >
                  Odustani od zamjene
                </button>
              )}
            </div>
          </form>
        )}
        {processing && (
          <p className="note-text">
            Za promjenu ili odbijanje uzorka prvo zatražite novo uzorkovanje u
            dnevnom rasporedu.
          </p>
        )}
        {reject && (
          <form
            className="card spaced"
            onSubmit={(e) => {
              e.preventDefault();
              const reason = values(e.currentTarget).reason;
              void run(
                () => changeLaboratorySample(reject, "REJECTED", reason),
                "Uzorak je odbijen; razlog ostaje u povijesti.",
              );
            }}
          >
            <h3>Odbijanje uzorka {reject.code}</h3>
            <Field
              name="reason"
              label="Razlog odbijanja uzorka"
              type="textarea"
              required
              minLength={5}
              maxLength={500}
            />
            <div className="document-actions">
              <button className="primary" disabled={busy}>
                Potvrdi odbijanje
              </button>
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => setReject(null)}
              >
                Odustani
              </button>
            </div>
          </form>
        )}
        {resource.loading ? (
          <p role="status">Učitavanje uzoraka…</p>
        ) : resource.data?.items.length ? (
          <div className="section-stack spaced">
            {resource.data.items.map((sample) => (
              <section className="card" key={sample.id}>
                <div className="section-heading">
                  <h3>{sample.code}</h3>
                  <span className="sample-stage">
                    {sampleLabels[sample.status]}
                    {sample.replaced ? " · zamijenjen" : ""}
                  </span>
                </div>
                <p>
                  {sample.specimen_code} · {sample.specimen_name} · uzorkovanje{" "}
                  {sample.collection_round}.
                </p>
                {sample.reason && <p>{sample.reason}</p>}
                <div className="document-actions">
                  <button
                    type="button"
                    className="secondary"
                    disabled={
                      busy || sample.replaced || sample.status === "REJECTED"
                    }
                    onClick={() => print(sample)}
                  >
                    PDF oznaka
                  </button>
                  {!closed && !processing && sample.status === "REGISTERED" && (
                    <button
                      type="button"
                      className="primary"
                      disabled={busy}
                      onClick={() =>
                        run(
                          () => changeLaboratorySample(sample, "ACCEPTED", ""),
                          "Uzorak je zaprimljen.",
                        )
                      }
                    >
                      Zaprimi uzorak
                    </button>
                  )}
                  {!closed && !processing && sample.status !== "REJECTED" && (
                    <button
                      type="button"
                      className="text-link"
                      disabled={busy}
                      onClick={() => {
                        setReject(sample);
                        setError("");
                      }}
                    >
                      Odbij uzorak
                    </button>
                  )}
                  {!closed &&
                    !processing &&
                    sample.status === "REJECTED" &&
                    !sample.replaced && (
                      <button
                        type="button"
                        className="secondary"
                        disabled={busy}
                        onClick={() => {
                          setReplacement(sample);
                          setRequest(crypto.randomUUID());
                        }}
                      >
                        Izradi zamjensku oznaku
                      </button>
                    )}
                </div>
                <details className="spaced">
                  <summary>Povijest uzorka</summary>
                  {sample.history.map((event) => (
                    <p key={event.id}>
                      {dateLabel(zagrebDate(new Date(event.created_at)))} u{" "}
                      {zagrebTime(event.created_at)} ·{" "}
                      {event.actor ?? "Laboratorij"} ·{" "}
                      {sampleLabels[event.status as keyof typeof sampleLabels]}{" "}
                      {event.reason}
                    </p>
                  ))}
                </details>
              </section>
            ))}
          </div>
        ) : (
          <p className="spaced">
            {filter
              ? "Oznaka nije pronađena u ovom zahtjevu. Provjerite pacijenta i oznaku."
              : "Još nema izrađenih oznaka."}
          </p>
        )}
      </div>
    </Modal>
  );
}
