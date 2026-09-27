import { z } from "zod";
import { db } from "../lib/supabase";
import { unwrap } from "./clinical";
import {
  documentSchema,
  notificationSchema,
  verificationSchema,
} from "../types/documents";
import type { DocumentKind } from "../types/documents";
import type { Json } from "../lib/database.types";
export async function listDocuments(patientId?: string, kind?: DocumentKind) {
  return z.array(documentSchema).parse(
    unwrap(
      await db().rpc("list_documents", {
        patient_id: patientId ?? null,
        kind_filter: kind ?? null,
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
export async function getNotifications() {
  return z
    .array(notificationSchema)
    .parse(
      unwrap(
        await db()
          .from("notifications")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(50),
      ),
    );
}
