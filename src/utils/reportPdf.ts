import { clinicalDocumentPdf } from "../../supabase/functions/notifications-dispatch/clinical-document-pdf";
import type { DocumentPrintLayout } from "../../supabase/functions/notifications-dispatch/document-layout-model";
import { savePdf } from "./schoolExcusePdf";
export async function exportReportPdf(
  title: string,
  number: string,
  sections: { label: string; text: string }[],
  issuedAt: string,
  layout?: DocumentPrintLayout,
) {
  const bytes = await clinicalDocumentPdf({
    kind: layout?.laboratoryRows ? "LAB_RESULT" : "MEDICAL_REPORT",
    title,
    number,
    issuedAt,
    sections,
    layoutVersion: 2,
    layout,
  });
  savePdf(bytes, number);
}
