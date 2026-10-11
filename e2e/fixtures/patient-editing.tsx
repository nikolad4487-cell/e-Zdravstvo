import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { PatientRecordPage } from "../../src/pages/doctor/PatientRecordPage";
import "../../src/styles.css";
createRoot(document.getElementById("root")!).render(
  <MemoryRouter initialEntries={["/ordinacija/pacijenti/fictional-patient"]}>
    <Routes>
      <Route path="/ordinacija/pacijenti/:id" element={<PatientRecordPage />} />
    </Routes>
  </MemoryRouter>,
);
