import type { ClinicalDocument } from "../types/documents";
import { schoolExcuseDocumentPdf } from "../../supabase/functions/notifications-dispatch/school-excuse-pdf";
export function savePdf(bytes: Uint8Array, name: string) {
  const url = URL.createObjectURL(
    new Blob([new Uint8Array(bytes)], { type: "application/pdf" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name + ".pdf";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
export async function schoolExcusePdf(
  d: ClinicalDocument,
  verificationUrl: string,
  preview = false,
) {
  return schoolExcuseDocumentPdf(d, verificationUrl, preview);
}
