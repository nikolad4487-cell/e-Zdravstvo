import { Link } from "react-router-dom";
import { Users, Stethoscope, FileCheck2 } from "lucide-react";
import { useAuth } from "../../hooks/useAuth";
import { useResource } from "../../hooks/useResource";
import { searchPatients } from "../../services/clinical";
import { DocumentList } from "../../components/medical/DocumentList";
import { ErrorMessage } from "../../components/ui/Feedback";
import { AppointmentPanel } from "../../components/medical/AppointmentPanel";
export function DoctorHome() {
  const { profile, roles } = useAuth();
  const patients = useResource(() => searchPatients(), "");
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">e-ZDRAVSTVO ORDINACIJA</div>
          <h1>
            Dobar dan, {roles.includes("DOCTOR") ? "dr. " : ""}
            {profile?.first_name}
          </h1>
          <p>Pregledajte karton i nastavite skrb o svojim pacijentima.</p>
        </div>
        <Link className="primary" to="/ordinacija/pacijenti">
          <Users size={18} />
          Otvori pacijente
        </Link>
      </div>
      <AppointmentPanel compact />
      <div className="account-grid spaced">
        <section className="card">
          <Users size={26} />
          <h2>Vaši pacijenti</h2>
          {patients.error && <ErrorMessage>{patients.error}</ErrorMessage>}
          <p>
            {patients.loading
              ? "Učitavanje…"
              : `${patients.data?.length ?? 0}${patients.data?.length === 50 ? "+" : ""} dostupnih kartona`}
          </p>
          <Link className="text-link" to="/ordinacija/pacijenti">
            Pretraži pacijente →
          </Link>
        </section>
        <section className="card">
          <Stethoscope size={26} />
          <h2>Pregled i dokumenti</h2>
          <p>
            Odaberite pacijenta za novi pregled, recept, uputnicu ili
            ispričnicu.
          </p>
          <Link className="text-link" to="/ordinacija/pacijenti">
            Odaberi pacijenta →
          </Link>
        </section>
      </div>
      <div className="section-heading spaced">
        <h2>
          <FileCheck2 size={20} className="inline-icon" /> Nedavni dokumenti
        </h2>
      </div>
      <DocumentList />
    </>
  );
}
