import { MedicalCodePicker } from "./MedicalCodePicker";
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
  const [specimenCodes, setSpecimenCodes] = useState<string[]>([]),
    [testSearch, setTestSearch] = useState("");
  const [bookingKind, setBookingKind] = useState("SPECIALIST"),
    [testIds, setTestIds] = useState<string[]>([]),
    [samplingMethod, setSamplingMethod] = useState("VENIPUNCTURE");
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
    async () =>
      bookingKind === "LABORATORY"
        ? !service || !testIds.length
          ? []
          : z
              .array(
                z.object({
                  starts_at: z.string(),
                  duration_minutes: z.number(),
                }),
              )
              .parse(
                unwrap(
                  await db().rpc("priority_laboratory_slots", {
                    patient_id: patientId,
                    service_id: service,
                    test_ids: testIds,
                    date_from: from,
                    date_to: shiftDate(from, 30),
                  }),
                ),
              )
        : prioritySlots(patientId, service, from, shiftDate(from, 30)),
    JSON.stringify([patientId, service, from, testIds, bookingKind]),
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
  const departments =
    context.data?.departments.filter(
      (d) =>
        d.active &&
        context.data?.services.some(
          (s) => s.department_id === d.id && s.booking_kind === bookingKind,
        ),
    ) ?? [];
  const hospitals = [
    ...new Map(
      departments.map((d) => [d.institution_id, d.institution_name]),
    ).entries(),
  ];
  const services =
    context.data?.services.filter(
      (s) =>
        s.department_id === department &&
        s.institution_id === hospital &&
        s.booking_kind === bookingKind,
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
            await db().rpc(
              bookingKind === "LABORATORY"
                ? "book_priority_laboratory"
                : "book_priority_hospital",
              {
                ...(bookingKind === "LABORATORY"
                  ? {
                      test_ids: testIds,
                      sampling_method: samplingMethod,
                      specimen_codes: specimenCodes,
                    }
                  : {}),
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
              },
            ),
          ),
        );
      const message =
        (bookingKind === "LABORATORY"
          ? "Prioritetna laboratorijska narudžba je potvrđena i povezana s uputnicom. "
          : "Prioritetni pregled je potvrđen i povezan s uputnicom. ") +
        (await hospitalEmailStatusMessage(result.booking_id));
      onSaved(message);
    } catch (e) {
      setError(readableError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Prioritetno naručivanje u bolnici"
      busy={busy}
      onClose={onClose}
    >
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
            <Field
              name="booking_kind"
              label="Vrsta naručivanja"
              value={bookingKind}
              onChange={(e) => {
                setBookingKind(e.target.value);
                setHospital("");
                setDepartment("");
                setService("");
                setTestIds([]);
                setSpecimenCodes([]);
                setSource("EXISTING");
                clearTime();
              }}
            >
              <option value="SPECIALIST">Specijalistički pregled</option>
              <option value="LABORATORY">Laboratorij / uzimanje uzorka</option>
            </Field>
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
                  setTestIds([]);
                  setSpecimenCodes([]);
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
                  setTestIds([]);
                  setSpecimenCodes([]);
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
                label={
                  bookingKind === "LABORATORY"
                    ? "Laboratorijska usluga"
                    : "Specijalist"
                }
                required
                value={service}
                onChange={(e) => {
                  setService(e.target.value);
                  setTestIds([]);
                  setSpecimenCodes([]);
                  clearTime();
                }}
              >
                <option value="">Odaberite specijalista</option>
                {services.map((s) => (
                  <option key={s.id} value={s.id}>
                    {bookingKind === "LABORATORY"
                      ? `${s.procedure_code ? s.procedure_code + " · " : ""}${s.name}`
                      : `${s.doctor_name} · ${s.name}`}
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
                Nema aktivnih odjela za odabranu vrstu naručivanja.
                Administrator treba postaviti odjel, uslugu i raspored.
              </p>
            )}
            {department && !services.length && (
              <p>Nema aktivnih usluga za odabrani odjel.</p>
            )}
            {chosen?.booking_kind === "LABORATORY" && (
              <section className="card spaced">
                <h3>Pretrage i način uzimanja uzorka</h3>
                <p>
                  {chosen.procedure_code ? chosen.procedure_code + " · " : ""}
                  {chosen.name}
                </p>
                <input
                  type="search"
                  aria-label="Traži laboratorijsku pretragu"
                  placeholder="Naziv ili CEZIH šifra pretrage…"
                  value={testSearch}
                  onChange={(e) => setTestSearch(e.target.value)}
                />
                {chosen.laboratory_tests
                  .filter(
                    (t) =>
                      t.active !== false &&
                      (t.code + " " + t.name)
                        .toLocaleLowerCase("hr")
                        .includes(testSearch.toLocaleLowerCase("hr")),
                  )
                  .map((t) => (
                    <label
                      className="clinical-note"
                      key={t.id}
                      style={{ display: "block" }}
                    >
                      <input
                        type="checkbox"
                        checked={testIds.includes(t.id)}
                        onChange={(e) => {
                          setTestIds(
                            e.target.checked
                              ? [...testIds, t.id]
                              : testIds.filter((id) => id !== t.id),
                          );
                          clearTime();
                        }}
                      />{" "}
                      {t.catalog_list ? `(${t.code}) ` : ""}
                      {t.name} ·{" "}
                      {`${t.sampling_from?.slice(0, 5) ?? "07:00"}–${t.sampling_until?.slice(0, 5) ?? "19:00"}`}{" "}
                      ·{" "}
                      {t.required_time
                        ? ` · obvezno u ${t.required_time.slice(0, 5)}`
                        : ""}
                    </label>
                  ))}
                {!chosen.laboratory_tests.length && (
                  <p>Laboratorij treba postaviti pretrage prije naručivanja.</p>
                )}
                <MedicalCodePicker
                  list="2.2.18"
                  name="specimen_codes"
                  label="Vrsta uzorka (CEZIH)"
                  multiple
                  onSelected={(items) =>
                    setSpecimenCodes(items.map((i) => i.code))
                  }
                />
                <Field
                  name="sampling_method"
                  label="Način uzimanja uzorka"
                  value={samplingMethod}
                  onChange={(e) => setSamplingMethod(e.target.value)}
                >
                  <option value="VENIPUNCTURE">
                    Uzimanje venske krvi – venepunkcija
                  </option>
                  <option value="CANNULA">
                    Uzimanje krvi putem venske kanile (branile)
                  </option>
                  <option value="OTHER">
                    Drugi način – prema protokolu laboratorija
                  </option>
                </Field>
                {chosen.laboratory_tests
                  .filter((t) => testIds.includes(t.id))
                  .map((t) => (
                    <div key={t.id}>
                      <strong>{t.name}</strong>
                      <p>{t.instructions}</p>
                    </div>
                  ))}
                {!testIds.length && (
                  <p>
                    Odaberite barem jednu pretragu za prikaz slobodnih termina.
                  </p>
                )}
              </section>
            )}
            {chosen && (
              <section className="card spaced">
                <h3>Slobodni termini · {chosen.duration_minutes} min</h3>
                <p>
                  {chosen.location} · {chosen.specialty}
                </p>
                <p className="note-text">
                  {chosen.booking_kind === "LABORATORY"
                    ? "Europe/Zagreb · laboratorij 07:00–19:00, prema danima rada i satnici odabranih pretraga."
                    : "Europe/Zagreb · jutro 07:00–13:30, poslijepodne 13:30–19:00."}{" "}
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
                {chosen.booking_kind === "LABORATORY" && (
                  <section className="confirm-box">
                    <h3>Odabrane pretrage i povezani koraci</h3>
                    {chosen.laboratory_tests
                      .filter((t) => testIds.includes(t.id))
                      .map((t) => (
                        <div key={t.id}>
                          <strong>{t.name}</strong>
                          <p>{t.instructions}</p>
                          {t.steps.map((step, index) => (
                            <p key={index}>
                              {dateLabel(
                                shiftDate(
                                  zagrebDate(new Date(selected.starts_at)),
                                  step.day_offset,
                                ),
                              )}{" "}
                              u {step.time} · {step.label} · {step.instructions}
                            </p>
                          ))}
                        </div>
                      ))}
                    <small>
                      Prikazani koraci su plan pripreme; zasebna uzorkovanja
                      naručuju se odvojeno.
                    </small>
                  </section>
                )}
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
                      key={bookingKind}
                      list="2.2.5"
                      name="referral_code"
                      label="Vrsta uputnice"
                      required
                      defaultValue={bookingKind === "LABORATORY" ? "A3" : "A1"}
                      allowed={
                        bookingKind === "LABORATORY"
                          ? ["A3", "A6"]
                          : ["A1", "A2", "A4", "C1"]
                      }
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
                {busy
                  ? "Rezervacija…"
                  : bookingKind === "LABORATORY"
                    ? "Potvrdi prioritetnu laboratorijsku narudžbu"
                    : "Potvrdi prioritetni pregled"}
              </button>
            </div>
          </>
        )}
      </form>
    </Modal>
  );
}
