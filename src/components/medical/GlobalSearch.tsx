import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Search } from "lucide-react";
import { Modal } from "../ui/Modal";
import { ErrorMessage } from "../ui/Feedback";
import { useResource } from "../../hooks/useResource";
import { searchPatients } from "../../services/clinical";
import { listDocuments } from "../../services/documents";
import { dateLabel } from "../../utils/format";
export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    function key(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    }
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  return (
    <>
      <button
        className="search-command"
        onClick={() => setOpen(true)}
        aria-label="Pretraži pacijente, dokumente, recepte"
      >
        <Search size={16} />
        <span>Pretraži pacijente, dokumente, recepte…</span>
        <kbd>Ctrl K</kbd>
      </button>
      {open && <SearchDialog close={() => setOpen(false)} />}
    </>
  );
}
function SearchDialog({ close }: { close: () => void }) {
  const [input, setInput] = useState(""),
    [term, setTerm] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setTerm(input.trim()), 300);
    return () => clearTimeout(timer);
  }, [input]);
  const result = useResource(async () => {
    if (term.length < 2) return null;
    const [patients, documents] = await Promise.all([
      searchPatients(term),
      term.toUpperCase().startsWith("EZ-")
        ? listDocuments()
        : Promise.resolve([]),
    ]);
    return {
      patients,
      documents: documents.filter((d) =>
        d.number.toLowerCase().includes(term.toLowerCase()),
      ),
    };
  }, term);
  return (
    <Modal title="Pretraživanje" onClose={close}>
      <div className="modal-content">
        <label className="field">
          <span>
            Ime, prezime, datum rođenja, ID pacijenta ili broj dokumenta
          </span>
          <input
            autoFocus
            value={input}
            onChange={(e) => setInput(e.target.value)}
            maxLength={100}
          />
        </label>
        <p className="signature-note">
          Najmanje 2 znaka. Pretraga dokumenata obuhvaća posljednjih 100
          dostupnih dokumenata.
        </p>
        {result.error && <ErrorMessage>{result.error}</ErrorMessage>}
        {result.loading ? (
          <p role="status">Pretraživanje…</p>
        ) : (
          result.data && (
            <div className="section-stack spaced">
              {result.data.patients.map((p) => (
                <Link
                  className="clinical-note"
                  key={p.id}
                  onClick={close}
                  to={"/ordinacija/pacijenti/" + p.id}
                >
                  <strong>
                    {p.first_name} {p.last_name}
                  </strong>
                  <p>
                    {p.patient_number} · {dateLabel(p.birth_date)}
                  </p>
                  <small>{p.primary_doctor}</small>
                </Link>
              ))}
              {result.data.documents.map((d) => (
                <Link
                  className="clinical-note"
                  key={d.id}
                  onClick={close}
                  to={"/ordinacija/pacijenti/" + d.patient_id}
                >
                  <strong>{d.number}</strong>
                  <p>
                    {d.payload.patient.first_name} {d.payload.patient.last_name}
                  </p>
                </Link>
              ))}
              {!result.data.patients.length &&
                !result.data.documents.length && (
                  <p className="empty-state">Nema rezultata.</p>
                )}
            </div>
          )
        )}
      </div>
    </Modal>
  );
}
