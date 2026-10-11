import { z } from "zod";
import { db } from "../lib/supabase";
import { unwrap } from "./clinical";
import {
  documentSchema,
  notificationSchema,
  verificationSchema,
  excuseContextSchema,
} from "../types/documents";
import type { DocumentKind } from "../types/documents";
import type { Json } from "../lib/database.types";
export async function getExcuseContext(patientId: string) {
  return excuseContextSchema.parse(
    unwrap(await db().rpc("excuse_context", { patient_id: patientId })),
  );
}
export interface DocumentFilters {
  search?: string;
  status?: string;
  from?: string;
  to?: string;
  page?: number;
  institution?: string;
}
export async function listDocuments(
  patientId?: string,
  kind?: DocumentKind,
  filters: DocumentFilters = {},
) {
  return z.array(documentSchema).parse(
    unwrap(
      await db().rpc("search_documents", {
        patient_filter: patientId ?? null,
        kind_filter: kind ?? null,
        search_term: filters.search ?? "",
        status_filter: filters.status || null,
        date_from: filters.from || null,
        date_to: filters.to || null,
        page_number: filters.page ?? 0,
        institution_filter: filters.institution || null,
      }),
    ),
  );
}
export async function getDocument(
  documentId: string,
  purpose: "VIEW" | "DOWNLOAD" = "VIEW",
) {
  return documentSchema.parse(
    unwrap(
      await db().rpc("get_document", { document_id: documentId, purpose }),
    ),
  );
}
export async function issueDocument(
  patientId: string,
  kind: DocumentKind,
  data: Json,
  requestId: string,
) {
  return z.string().parse(
    unwrap(
      await db().rpc("issue_document", {
        patient_id: patientId,
        document_kind: kind,
        data,
        request_id: requestId,
      }),
    ),
  );
}
export async function verifyDocument(code: string) {
  return verificationSchema
    .nullable()
    .parse(
      unwrap(
        await db().rpc("verify_document", { verification_code: code.trim() }),
      ),
    );
}
export async function getNotifications(page = 0) {
  return z.array(notificationSchema).parse(
    unwrap(
      await db()
        .from("notifications")
        .select("*")
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(page * 50, page * 50 + 49),
    ),
  );
}
