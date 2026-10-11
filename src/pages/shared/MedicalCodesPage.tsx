import { useEffect, useState } from "react";
import { useResource } from "../../hooks/useResource";
import {
  medicalCodeCatalogs,
  medicalCodeSource,
  searchDiagnosisCodes,
  searchMedicalCodes,
} from "../../services/medicalCodes";
import { ErrorMessage } from "../../components/ui/Feedback";
export function MedicalCodesPage() {
  const catalogs = useResource(medicalCodeCatalogs, "medical-catalogs");
  const [list, setList] = useState("MKB"),
    [search, setSearch] = useState(""),
    [term, setTerm] = useState(""),
    [page, setPage] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => {
      setTerm(search);
      setPage(0);
    }, 250);
    return () => clearTimeout(t);
  }, [search]);
  const results = useResource(
    async () =>
      list === "MKB"
        ? (await searchDiagnosisCodes(term, page)).map((d) => ({
            code: d.code,
            name: d.name,
            description: d.coding_system ?? "",
            metadata: d.catalog_metadata,
          }))
        : (await searchMedicalCodes(list, term, page)).map((c) => ({
            ...c,
            metadata: null,
          })),
    JSON.stringify([list, term, page]),
  );
  const source = useResource(
    () => (list === "MKB" ? Promise.resolve(null) : medicalCodeSource(list)),
    list,
  );
  const current = catalogs.data?.lists.find((l) => l.id === list);
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">MEDICINSKI ŠIFRARNICI</div>
          <h1>Šifre bolesti, uputnica i pregleda</h1>
          <p>Pretraživanje šifri i naziva iz priloženih HZJZ i CEZIH izvora.</p>
        </div>
      </div>
      {catalogs.data?.sources.map((s) => (
        <p className="note-text" key={s.id}>
          {s.file_name} · {s.imported_count.toLocaleString("hr-HR")} /{" "}
          {s.expected_count.toLocaleString("hr-HR")} šifri · {s.revision}
        </p>
      ))}
      <div className="form-grid">
        <label className="field">
          <span>Šifrarnik</span>
          <select
            value={list}
            onChange={(e) => {
              setList(e.target.value);
              setPage(0);
              setSearch("");
              setTerm("");
            }}
          >
            <option value="MKB">MKB-10 — šifre bolesti</option>
            {catalogs.data?.lists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.id} · {l.name} ({l.count})
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Šifra ili naziv</span>
          <input
            type="search"
            maxLength={200}
            placeholder="Primjer: E66.9, šećerna, A1…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
      </div>
      {(catalogs.error || results.error || source.error) && (
        <ErrorMessage>
          {catalogs.error || results.error || source.error}
        </ErrorMessage>
      )}
      {results.loading ? (
        <p role="status">Pretraživanje…</p>
      ) : (
        <section className="card spaced">
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Šifra</th>
                  <th>Naziv</th>
                  <th>Detalji</th>
                </tr>
              </thead>
              <tbody>
                {results.data?.map((c) => (
                  <tr key={c.code}>
                    <td>
                      <strong>{c.code}</strong>
                    </td>
                    <td>{c.name}</td>
                    <td>
                      {c.description}
                      {c.metadata && (
                        <details>
                          <summary>Poglavlje i blok</summary>
                          <p>{String(c.metadata.chapter_name ?? "")}</p>
                          <p>{String(c.metadata.block_name ?? "")}</p>
                        </details>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!results.data?.length && (
            <p>
              {current?.external_only
                ? "U priloženom PDF-u za ovu listu naveden je izvor, bez ugrađene tablice šifri."
                : "Nema pronađenih šifri."}
            </p>
          )}
          <div className="catalog-page-controls">
            <button
              className="secondary"
              disabled={page === 0}
              onClick={() => setPage(page - 1)}
            >
              Prethodna stranica
            </button>
            <span>Stranica {page + 1}</span>
            <button
              className="secondary"
              disabled={(results.data?.length ?? 0) < 50}
              onClick={() => setPage(page + 1)}
            >
              Sljedeća stranica
            </button>
          </div>
        </section>
      )}
      {source.data && (
        <details className="card spaced">
          <summary>Izvorna specifikacija odabrane kodne liste</summary>
          <pre className="catalog-source-text">{source.data.source_text}</pre>
        </details>
      )}
    </>
  );
}
