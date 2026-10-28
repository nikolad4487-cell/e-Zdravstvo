import { createRoot } from "react-dom/client";
import { LaboratorySamples } from "../../src/components/medical/LaboratorySamples";
import "../../src/styles.css";
createRoot(document.getElementById("root")!).render(
  <LaboratorySamples
    orderId="order-test"
    onClose={() => {}}
    onChanged={() => {}}
  />,
);
