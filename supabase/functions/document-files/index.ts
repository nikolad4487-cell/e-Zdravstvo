import { createClient } from "npm:@supabase/supabase-js@2.117.1";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Expose-Headers": "Content-Disposition",
  "Cache-Control": "no-store",
};
class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}
async function boundedBody(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, "Nedostaje sadržaj.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 10 * 1024 * 1024 + 65536) {
      await reader.cancel();
      throw new HttpError(413, "Datoteka smije imati najviše 10 MB.");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
async function hash(bytes: ArrayBuffer) {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
  )
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
}
function detect(bytes: Uint8Array) {
  if (
    bytes.length >= 5 &&
    new TextDecoder().decode(bytes.slice(0, 5)) === "%PDF-"
  )
    return "application/pdf";
  if (
    bytes.length >= 8 &&
    [137, 80, 78, 71, 13, 10, 26, 10].every((n, i) => bytes[i] === n)
  )
    return "image/png";
  if (
    bytes.length >= 3 &&
    bytes[0] === 255 &&
    bytes[1] === 216 &&
    bytes[2] === 255
  )
    return "image/jpeg";
  throw new HttpError(
    400,
    "Podržani su PDF, JPEG i PNG dokumenti. Sadržaj datoteke mora odgovarati formatu.",
  );
}
type Transfer = {
  id: string;
  storage_path: string;
  file_name: string;
  content_type: string;
  byte_size: number;
  sha256: string;
  status: string;
};
Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS")
    return new Response(null, { headers: cors });
  if (request.method !== "POST")
    return json({ error: "Metoda nije podržana." }, 405);
  try {
    const authorization = request.headers.get("Authorization");
    if (!authorization?.startsWith("Bearer "))
      throw new HttpError(401, "Prijavite se ponovno.");
    const url = Deno.env.get("SUPABASE_URL")!,
      anon = Deno.env.get("SUPABASE_ANON_KEY")!,
      key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const user = createClient(url, anon, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false },
    });
    const { error: authError } = await user.auth.getUser();
    if (authError) throw new HttpError(401, "Prijavite se ponovno.");
    async function rpc<T>(
      name: string,
      args: Record<string, unknown>,
    ): Promise<T> {
      const { data, error } = await user.rpc(name, args);
      if (error) {
        if (error.code === "42501")
          throw new HttpError(403, "Nemate ovlast za ovu radnju.");
        throw new HttpError(
          400,
          "Zahtjev nije prihvaćen. Provjerite podatke i pokušajte ponovno.",
        );
      }
      return data as T;
    }
    const service = createClient(url, key, { auth: { persistSession: false } }),
      bucket = service.storage.from("medical-documents");
    const body = await boundedBody(request),
      contentType = request.headers.get("Content-Type") ?? "";
    if (contentType.startsWith("multipart/form-data")) {
      const form = await new Response(body, {
        headers: { "Content-Type": contentType },
      }).formData();
      const file = form.get("file");
      if (!(file instanceof File) || file.size < 1 || file.size > 10485760)
        throw new HttpError(400, "Odaberite datoteku do 10 MB.");
      const bytes = await file.arrayBuffer(),
        mime = detect(new Uint8Array(bytes)),
        sha256 = await hash(bytes);
      const stem =
        file.name
          .replace(/[\x00-\x1f\x7f/\\]/g, "_")
          .replace(/\.[^.]*$/, "")
          .slice(0, 190) || "dokument";
      const extension =
        mime === "application/pdf"
          ? ".pdf"
          : mime === "image/png"
            ? ".png"
            : ".jpg";
      const fileName = stem + extension;
      const id = await rpc<string>("reserve_attachment", {
        patient_id: form.get("patient_id"),
        request_id: form.get("request_id"),
        data: {
          title: form.get("title"),
          category: form.get("category"),
          file_name: fileName,
          content_type: mime,
          byte_size: file.size,
          sha256,
        },
      });
      const transfer = await rpc<Transfer>("attachment_transfer", {
        attachment_id: id,
        operation: "UPLOAD",
      });
      if (transfer.sha256 !== sha256)
        throw new HttpError(409, "Sadržaj ponovljenog zahtjeva nije jednak.");
      if (transfer.status === "PENDING") {
        const { error } = await bucket.upload(transfer.storage_path, bytes, {
          contentType: mime,
          upsert: false,
          cacheControl: "0",
        });
        if (error) {
          const existing = await bucket.download(transfer.storage_path);
          if (
            existing.error ||
            !existing.data ||
            (await hash(await existing.data.arrayBuffer())) !== sha256
          )
            throw new HttpError(
              503,
              "Prijenos nije uspio. Ponovite spremanje iste datoteke.",
            );
        }
        await rpc("finish_attachment", { attachment_id: id });
      }
      return json({ id });
    }
    if (!contentType.startsWith("application/json"))
      throw new HttpError(400, "Nepodržan zahtjev.");
    let data: unknown;
    try {
      data = JSON.parse(new TextDecoder().decode(body));
    } catch {
      throw new HttpError(400, "Neispravan zahtjev.");
    }
    if (
      !data ||
      typeof data !== "object" ||
      !("attachment_id" in data) ||
      typeof data.attachment_id !== "string"
    )
      throw new HttpError(400, "Nedostaje dokument.");
    const transfer = await rpc<Transfer>("attachment_transfer", {
      attachment_id: data.attachment_id,
      operation: "DOWNLOAD",
    });
    const file = await bucket.download(transfer.storage_path);
    if (file.error || !file.data)
      throw new HttpError(503, "Dokument trenutačno nije dostupan.");
    const bytes = await file.data.arrayBuffer();
    if ((await hash(bytes)) !== transfer.sha256)
      throw new HttpError(409, "Integritet datoteke nije potvrđen.");
    return new Response(bytes, {
      headers: {
        ...cors,
        "Content-Type": transfer.content_type,
        "Content-Disposition": `attachment; filename="document"; filename*=UTF-8''${encodeURIComponent(transfer.file_name).replace(/['()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase())}`,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return json(
      {
        error:
          error instanceof HttpError
            ? error.message
            : "Prijenos trenutačno nije dostupan.",
      },
      error instanceof HttpError ? error.status : 500,
    );
  }
});
