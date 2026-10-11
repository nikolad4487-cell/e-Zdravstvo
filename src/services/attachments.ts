import { z } from "zod";
import { db } from "../lib/supabase";
import { unwrap } from "./clinical";
import { attachmentSchema, patientDashboardSchema } from "../types/attachments";
export async function listAttachments(
  patientId: string,
  includeArchived = false,
  filters: {
    search?: string;
    category?: string;
    from?: string;
    to?: string;
    page?: number;
  } = {},
) {
  return z.array(attachmentSchema).parse(
    unwrap(
      await db().rpc("search_attachments", {
        patient_filter: patientId,
        include_archived: includeArchived,
        search_term: filters.search ?? "",
        category_filter: filters.category || null,
        date_from: filters.from || null,
        date_to: filters.to || null,
        page_number: filters.page ?? 0,
      }),
    ),
  );
}
export async function getPatientDashboard() {
  return patientDashboardSchema
    .nullable()
    .parse(unwrap(await db().rpc("patient_dashboard", {})));
}
async function transfer(body: FormData | string) {
  const { data, error } = await db().auth.getSession();
  if (error || !data.session) throw new Error("Prijavite se ponovno.");
  const response = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/document-files`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${data.session.access_token}`,
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
        ...(typeof body === "string"
          ? { "Content-Type": "application/json" }
          : {}),
      },
      body,
      cache: "no-store",
    },
  );
  if (!response.ok) {
    const result: unknown = await response.json().catch(() => null);
    throw new Error(
      z.object({ error: z.string() }).safeParse(result).data?.error ??
        "Prijenos nije uspio. Pokušajte ponovno.",
    );
  }
  return response;
}
export async function uploadAttachment(
  patientId: string,
  title: string,
  category: string,
  file: File,
  requestId: string,
) {
  const form = new FormData();
  form.set("patient_id", patientId);
  form.set("title", title);
  form.set("category", category);
  form.set("file", file);
  form.set("request_id", requestId);
  const response = await transfer(form);
  return z.object({ id: z.string() }).parse(await response.json()).id;
}
export async function downloadAttachment(id: string, fileName: string) {
  const response = await transfer(JSON.stringify({ attachment_id: id }));
  const url = URL.createObjectURL(await response.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
