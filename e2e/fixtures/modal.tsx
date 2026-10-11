import { useState } from "react";
import { createRoot } from "react-dom/client";
import { Modal } from "../../src/components/ui/Modal";
import { Field } from "../../src/components/ui/Fields";
import "../../src/styles.css";
function Fixture() {
  const [open, setOpen] = useState(true);
  return open ? (
    <Modal title="Testni obrazac" onClose={() => setOpen(false)}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setOpen(false);
        }}
      >
        <Field name="note" label="Bilješka" />
        <button className="primary">Spremi</button>
      </form>
    </Modal>
  ) : (
    <p>Obrazac zatvoren</p>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
