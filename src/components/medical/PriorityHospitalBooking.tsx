import { DiagnosisPicker } from "./DiagnosisPicker";
import { ReferenceCodeField } from "./ReferenceCodeField";
import { useState } from "react";
import { z } from "zod";
import { useResource } from "../../hooks/useResource";
import { db } from "../../lib/supabase";
import { unwrap } from "../../services/clinical";
import {
  priorityContext,
  prioritySlots,
  priorityReferrals,
  hospitalEmailStatusMessage,
  type PrioritySlot,
} from "../../services/priorityHospital";
import { Modal } from "../ui/Modal";
import { Field, values } from "../ui/Fields";
import { Pagination } from "../ui/Pagination";
import { ErrorMessage } from "../ui/Feedback";
import { shiftDate, zagrebDate, zagrebTime } from "../../utils/calendar";
import { dateLabel, readableError } from "../../utils/format";
export function PriorityHospitalBooking({
  patientId,
  patientName,
  onClose,
  onSaved,
}: {
  patientId: string;
  patientName?: string;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const context = useResource(() => priorityContext(), "priority-context");
  const [hospital, setHospital] = useState(""),
    [department, setDepartment] = useState(""),
    [service, setService] = useState(""),
    [from, setFrom] = useState(zagrebDate()),
    [day, setDay] = useState(""),
    [selected, setSelected] = useState<PrioritySlot | null>(null),
    [source, setSource] = useState("EXISTING"),
    [referral, setReferral] = useState(""),
    [term, setTerm] = useState(""),
    [page, setPage] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [requestId] = useState(crypto.randomUUID());
  const slots = useResource(
    () => prioritySlots(patientId, service, from, shiftDate(from, 30)),
    JSON.stringify([patientId, service, from]),
  );
  const referrals = useResource(
    () =>
      priorityReferrals(
        patientId,
        service,
        selected?.starts_at ?? "",
        term,
        page,
      ),
    JSON.stringify([patientId, service, selected?.starts_at, term, page]),
  );
  const departments = context.data?.departments.filter((d) => d.active) ?? [];
  const hospitals = [
    ...new Map(
      departments.map((d) => [d.institution_id, d.institution_name]),
    ).entries(),
  ];
  const services =
    context.data?.services.filter(
      (s) => s.department_id === department && s.institution_id === hospital,
    ) ?? [];
  const chosen = services.find((s) => s.id === service);
  const days = [
    ...new Set(slots.data?.map((s) => zagrebDate(new Date(s.starts_at))) ?? []),
  ];
  const effectiveDay = days.includes(day) ? day : days[0];
  function clearTime() {
    setSelected(null);
    setDay("");
    setReferral("");
    setPage(0);
    setError("");
  }
  async function book(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!selected || !chosen) return;
    const data = values(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      const result = z
        .object({ booking_id: z.string(), referral_id: z.string() })
        .parse(
          unwrap(
            await db().rpc("book_priority_hospital", {
              patient_id: patientId,
              service_id: chosen.id,
              starts_at: selected.starts_at,
              referral_id: source === "EXISTING" ? referral : null,
              new_referral:
                source === "NEW"
                  ? {
                      reason: data.referral_reason,
                      referral_code: data.referral_code,
                      examination_code: data.examination_code,
                      visit_code: data.visit_code,
                      diagnosis_id: data.diagnosis_id,
                      expires_on: data.expires_on,
                      notes: data.referral_notes,
                    }
                  : null,
              priority_reason: data.priority_reason,
              request_id: requestId,
            }),
          ),
        );
      const message =
        "Prioritetni pregled je potvrđen i povezan s uputnicom. " +
        (await hospitalEmailStatusMessage(result.booking_id));
      onSaved(message);
    } catch (e) {
      setError(readableError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Prioritetni pregled u bolnici" busy={busy} onClose={onClose}>
      <form onSubmit={book}>
        <p className="confirm-box">
          Pacijent:{" "}
          <strong>{patientName ?? "Pacijent iz otvorenog kartona"}</strong>.
          Narudžba se vodi kao <strong>PRIORITETNI pregled</strong>.
        </p>
        {(context.error || slots.error || referrals.error || error) && (
          <ErrorMessage>
            {error || context.error || slots.error || referrals.error}
          </ErrorMessage>
        )}
        {context.loading ? (
          <p role="status">Učitavanje bolnica i odjela…</p>
        ) : (
          <>
            <div className="form-grid">
              <Field
                name="priority_hospital"
                label="Bolnica"
                required
                value={hospital}
                onChange={(e) => {
                  setHospital(e.target.value);
                  setDepartment("");
                  setService("");
                  clearTime();
                }}
              >
                <option value="">Odaberite bolnicu</option>
                {hospitals.map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </Field>
              <Field
                name="priority_department"
                label="Odjel"
                required
                value={department}
                onChange={(e) => {
                  setDepartment(e.target.value);
                  setService("");
                  clearTime();
                }}
              >
                <option value="">Odaberite odjel</option>
                {departments
                  .filter((d) => d.institution_id === hospital)
                  .map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} · {d.duration_minutes} min
                    </option>
                  ))}
              </Field>
              <Field
                name="priority_specialist"
                label="Specijalist"
                required
                value={service}
                onChange={(e) => {
                  setService(e.target.value);
                  clearTime();
                }}
              >
                <option value="">Odaberite specijalista</option>
                {services.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.doctor_name} · {s.name}
                  </option>
                ))}
              </Field>
              <Field
                name="priority_from"
                label="Traži termine od"
                type="date"
                required
                min={zagrebDate()}
                max={shiftDate(zagrebDate(), 334)}
                value={from}
                onChange={(e) => {
                  setFrom(e.target.value || zagrebDate());
                  clearTime();
                }}
              />
            </div>
            {!departments.length && (
              <p>
                Nema aktivnih bolničkih odjela. Administrator bolnice treba
                postaviti odjel i dodijeliti specijaliste.
              </p>
            )}
            {department && !services.length && (
              <p>Nema aktivnih specijalista za odabrani odjel.</p>
            )}
            {chosen && (
              <section className="card spaced">
                <h3>Slobodni termini · {chosen.duration_minutes} min</h3>
                <p>
                  {chosen.location} · {chosen.specialty}
                </p>
                <p className="note-text">
                  Europe/Zagreb · jutro 07:00–13:30, poslijepodne 13:30–19:00.
                  Prikazuje se sljedećih 31 dan.
                </p>
                {slots.loading ? (
                  <p role="status">Učitavanje slobodnih termina…</p>
                ) : days.length ? (
                  <>
                    <Field
                      name="priority_day"
                      label="Dan pregleda"
                      value={effectiveDay}
                      onChange={(e) => {
                        setDay(e.target.value);
                        setSelected(null);
                        setReferral("");
                        setPage(0);
                      }}
                    >
                      {days.map((d) => (
                        <option key={d} value={d}>
                          {dateLabel(d)}
                        </option>
                      ))}
                    </Field>
                    <div
                      className="document-actions spaced"
                      role="group"
                      aria-label="Slobodna vremena pregleda"
                    >
                      {slots.data
                        ?.filter(
                          (s) =>
                            zagrebDate(new Date(s.starts_at)) === effectiveDay,
                        )
                        .map((s) => (
                          <button
                            key={s.starts_at}
                            className={
                              selected?.starts_at === s.starts_at
                                ? "primary"
                                : "secondary"
                            }
                            type="button"
                            aria-pressed={selected?.starts_at === s.starts_at}
                            disabled={busy}
                            onClick={() => {
                              setSelected(s);
                              setReferral("");
                              setPage(0);
                            }}
                          >
                            {zagrebTime(s.starts_at)}
                          </button>
                        ))}
                    </div>
                  </>
                ) : (
                  <p>
                    Nema slobodnih termina u ovom razdoblju. Odaberite drugi
                    početni datum ili specijalista.
                  </p>
                )}
                <button
                  className="text-link spaced"
                  type="button"
                  disabled={busy || slots.loading}
                  onClick={() => {
                    clearTime();
                    slots.refresh();
                  }}
                >
                  Osvježi slobodne termine
                </button>
              </section>
            )}
            {selected && chosen && (
              <>
                <p className="confirm-box">
                  Odabrano:{" "}
                  <strong>
                    {dateLabel(zagrebDate(new Date(selected.starts_at)))} u{" "}
                    {zagrebTime(selected.starts_at)}
                  </strong>{" "}
                  · {selected.duration_minutes} min · {chosen.institution_name}{" "}
                  · {chosen.department_name} · {chosen.doctor_name}
                </p>
                <Field
                  name="referral_source"
                  label="Uputnica za pregled"
                  value={source}
                  onChange={(e) => {
                    setSource(e.target.value);
                    setReferral("");
                  }}
                >
                  <option value="EXISTING">Odaberi postojeću uputnicu</option>
                  <option value="NEW">Izradi novu uputnicu</option>
                </Field>
                {source === "EXISTING" ? (
                  <section className="spaced">
                    <Field
                      name="referral_search"
                      label="Traži uputnicu po broju"
                      value={term}
                      maxLength={100}
                      onChange={(e) => {
                        setTerm(e.target.value);
                        setPage(0);
                        setReferral("");
                      }}
                    />
                    {referrals.loading ? (
                      <p role="status">Učitavanje uputnica…</p>
                    ) : (
                      <Field
                        name="priority_referral"
                        label="Važeća uputnica"
                        required
                        value={referral}
                        onChange={(e) => setReferral(e.target.value)}
                      >
                        <option value="">Odaberite uputnicu</option>
                        {referrals.data?.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.number} · vrijedi do {dateLabel(r.expires_on)}
                          </option>
                        ))}
                      </Field>
                    )}
                    {!referrals.loading && !referrals.data?.length && (
                      <p>
                        Nema slobodne uputnice za ovu specijalnost koja vrijedi
                        na dan pregleda. Možete izraditi novu.
                      </p>
                    )}
                    <Pagination
                      page={page}
                      size={referrals.data?.length ?? 0}
                      loading={referrals.loading}
                      onChange={(p) => {
                        setPage(p);
                        setReferral("");
                      }}
                    />
                  </section>
                ) : (
                  <div className="form-grid spaced">
                    <ReferenceCodeField
                      list="2.2.5"
                      name="referral_code"
                      label="Vrsta uputnice"
                      required
                      defaultValue="A1"
                      allowed={["A1", "A2", "A4", "C1"]}
                    />
                    <ReferenceCodeField
                      list="2.2.42"
                      name="examination_code"
                      label="Vrsta pregleda (SKZZ)"
                    />
                    <ReferenceCodeField
                      list="2.2.39"
                      name="visit_code"
                      label="Pregled (PZZ)"
                    />
                    <DiagnosisPicker name="diagnosis_id" label="Dijagnoza" />
                    <Field
                      name="referral_reason"
                      label="Razlog upućivanja"
                      type="textarea"
                      required
                      minLength={5}
                      maxLength={4000}
                    />
                    <Field
                      name="expires_on"
                      label="Uputnica vrijedi do"
                      type="date"
                      required
                      min={zagrebDate(new Date(selected.starts_at))}
                      max={shiftDate(zagrebDate(), 730)}
                      defaultValue={shiftDate(
                        zagrebDate(new Date(selected.starts_at)),
                        30,
                      )}
                    />
                    <Field
                      name="referral_notes"
                      label="Napomena na uputnici"
                      type="textarea"
                      maxLength={2000}
                    />
                  </div>
                )}
                <Field
                  name="priority_reason"
                  label="Razlog prioritetnog pregleda"
                  type="textarea"
                  required
                  minLength={5}
                  maxLength={1000}
                />
                <p className="note-text">
                  Nova uputnica izdaje se zajedno s narudžbom. Potvrda e-mailom
                  šalje se na potvrđenu adresu pacijenta ako su e-mail usluga i
                  pacijentove obavijesti uključene. Narudžba je dostupna i u
                  portalu.
                </p>
                {chosen.instructions && (
                  <p>Upute za dolazak: {chosen.instructions}</p>
                )}
              </>
            )}
            <div className="modal-actions">
              <button
                className="primary"
                disabled={
                  busy ||
                  !selected ||
                  !chosen ||
                  slots.loading ||
                  (source === "EXISTING" && (!referral || referrals.loading))
                }
              >
                {busy ? "Rezervacija…" : "Potvrdi prioritetni pregled"}
              </button>
            </div>
          </>
        )}
      </form>
    </Modal>
  );
}
