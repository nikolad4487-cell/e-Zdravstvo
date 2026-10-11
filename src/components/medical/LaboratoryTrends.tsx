import { useState } from "react";
import { z } from "zod";
import { useResource } from "../../hooks/useResource";
import { db } from "../../lib/supabase";
import { unwrap } from "../../services/clinical";
import { ErrorMessage } from "../ui/Feedback";
import { Field } from "../ui/Fields";
import { Pagination } from "../ui/Pagination";
import { dateLabel } from "../../utils/format";
import { shiftDate, zagrebDate } from "../../utils/calendar";
import { labFlagLabels } from "../../types/laboratory";
const catalogSchema = z.array(
  z.object({ code: z.string(), name: z.string(), unit: z.string() }),
);
const pointSchema = z.array(
  z.object({
    id: z.string(),
    value: z.number(),
    unit: z.string(),
    reference_low: z.number().nullable(),
    reference_high: z.number().nullable(),
    flag: z.enum(["LOW", "NORMAL", "HIGH", "CRITICAL"]).nullable(),
    sampled_at: z.string(),
    result_id: z.string(),
    laboratory_name: z.string(),
  }),
);
export function LaboratoryTrends({ patientId }: { patientId?: string }) {
  const [selected, setSelected] = useState(""),
    [from, setFrom] = useState(shiftDate(zagrebDate(), -365)),
    [to, setTo] = useState(zagrebDate()),
    [page, setPage] = useState(0);
  const catalog = useResource(
    async () =>
      catalogSchema.parse(
        unwrap(
          await db().rpc("laboratory_trend_catalog", {
            patient_filter: patientId ?? null,
          }),
        ),
      ),
    patientId ?? "personal",
  );
  const parameter = catalog.data?.find(
    (p) => JSON.stringify([p.code, p.unit]) === selected,
  );
  const points = useResource(
    async () => {
      if (!parameter) return [];
      if (!from || !to || from > to)
        throw new Error("Odaberite valjano razdoblje za usporedbu.");
      return pointSchema.parse(
        unwrap(
          await db().rpc("laboratory_trend_points", {
            patient_filter: patientId ?? null,
            parameter_code: parameter.code,
            parameter_unit: parameter.unit,
            date_from: from,
            date_to: to,
            page_number: page,
          }),
        ),
      );
    },
    JSON.stringify([patientId, selected, from, to, page, parameter]),
  );
  const rows = [...(points.data ?? [])].reverse();
  const min = Math.min(...rows.map((p) => p.value)),
    max = Math.max(...rows.map((p) => p.value));
  const range = max - min || Math.max(Math.abs(max) * 0.1, 1);
  const firstTime = rows.length ? new Date(rows[0].sampled_at).getTime() : 0;
  const lastTime = rows.length
    ? new Date(rows.at(-1)!.sampled_at).getTime()
    : 0;
  const positions = rows.map((p) => ({
    p,
    x:
      40 +
      (firstTime === lastTime
        ? 260
        : ((new Date(p.sampled_at).getTime() - firstTime) /
            (lastTime - firstTime)) *
          520),
    y: min === max ? 105 : 170 - ((p.value - min) / range) * 130,
  }));
  return (
    <section className="card spaced">
      <h2>Rezultati kroz vrijeme</h2>
      <p>
        Pretražuje se povijest aktualnih nalaza za isti parametar i jedinicu.
        Graf prikazuje rezultate na odabranoj stranici; referentni interval može
        se razlikovati među nalazima.
      </p>
      <div className="form-grid">
        <Field
          label="Parametar"
          name="trend_parameter"
          value={selected}
          onChange={(e) => {
            setSelected(e.target.value);
            setPage(0);
          }}
        >
          <option value="">Odaberite parametar</option>
          {catalog.data?.map((p) => (
            <option
              key={JSON.stringify([p.code, p.unit])}
              value={JSON.stringify([p.code, p.unit])}
            >
              {p.code} · {p.name} ({p.unit})
            </option>
          ))}
        </Field>
        <Field
          label="Uzorkovano od"
          name="trend_from"
          type="date"
          value={from}
          onChange={(e) => {
            setFrom(e.target.value);
            setPage(0);
          }}
        />
        <Field
          label="Uzorkovano do"
          name="trend_to"
          type="date"
          value={to}
          onChange={(e) => {
            setTo(e.target.value);
            setPage(0);
          }}
        />
      </div>
      {(catalog.error || points.error) && (
        <ErrorMessage>{catalog.error || points.error}</ErrorMessage>
      )}
      {catalog.loading || points.loading ? (
        <p role="status">Učitavanje trendova…</p>
      ) : (
        selected && (
          <>
            {rows.length > 0 && (
              <svg
                viewBox="0 0 600 210"
                role="img"
                aria-label={`Trend: ${parameter?.name}, ${rows.length} rezultata`}
                style={{ width: "100%", maxHeight: 260 }}
              >
                <line x1="40" y1="180" x2="570" y2="180" stroke="#b5c9ce" />
                <polyline
                  fill="none"
                  stroke="#087e8b"
                  strokeWidth="2"
                  points={positions.map(({ x, y }) => `${x},${y}`).join(" ")}
                />
                {positions.map(({ p, x, y }) => (
                  <circle
                    key={p.id}
                    cx={x}
                    cy={y}
                    r="4"
                    fill={p.flag === "CRITICAL" ? "#b42318" : "#087e8b"}
                  >
                    <title>
                      {dateLabel(p.sampled_at)}: {p.value} {p.unit} ·{" "}
                      {p.laboratory_name}
                    </title>
                  </circle>
                ))}
                <text x="40" y="204" fontSize="12">
                  {dateLabel(rows[0].sampled_at)}
                </text>
                <text x="570" y="204" fontSize="12" textAnchor="end">
                  {dateLabel(rows.at(-1)?.sampled_at)}
                </text>
              </svg>
            )}
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Uzorkovanje</th>
                    <th>Rezultat</th>
                    <th>Referentni interval</th>
                    <th>Oznaka</th>
                    <th>Laboratorij</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p) => (
                    <tr key={p.id}>
                      <td>{dateLabel(p.sampled_at)}</td>
                      <td>
                        {p.value} {p.unit}
                      </td>
                      <td>
                        {p.reference_low ?? "—"} – {p.reference_high ?? "—"}
                      </td>
                      <td>
                        {p.flag ? labFlagLabels[p.flag] : "Bez intervala"}
                      </td>
                      <td>{p.laboratory_name}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!rows.length && <p>Nema nalaza za odabrano razdoblje.</p>}
            <Pagination
              page={page}
              size={points.data?.length ?? 0}
              loading={points.loading}
              onChange={setPage}
            />
          </>
        )
      )}
    </section>
  );
}
