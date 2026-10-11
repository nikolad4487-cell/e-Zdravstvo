import { useState } from "react";
import { createRoot } from "react-dom/client";
import { PriorityHospitalBooking } from "../../src/components/medical/PriorityHospitalBooking";
import "../../src/styles.css";
function Fixture() {
  const [message, setMessage] = useState("");
  return message ? (
    <p role="status">{message}</p>
  ) : (
    <PriorityHospitalBooking
      patientId="fictional-patient"
      patientName="Testna Osoba"
      onClose={() => setMessage("Zatvoreno")}
      onSaved={setMessage}
    />
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
