import { useState } from "react";
import { verifyDocument } from "../../services/documents";
import { VerificationResult } from "../VerificationPage";
import type { DocumentVerification } from "../../types/documents";
import { ErrorMessage } from "../../components/ui/Feedback";
import { readableError } from "../../utils/format";
export function SchoolPage() {
  const [code, setCode] = useState(""),
    [result, setResult] = useState<DocumentVerification | null>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function verify(value: string) {
    setBusy(true);
    setError("");
    setResult(undefined);
    try {
      let token = value.trim();
      if (token.startsWith("https://") || token.startsWith("http://")) {
        const url = new URL(token);
        if (
          url.origin !== window.location.origin ||
          !url.pathname.startsWith("/verify/")
        )
          throw new Error("QR kod ne pripada ovom sustavu.");
        token = url.pathname.split("/")[2];
      }
      setResult(await verifyDocument(token));
    } catch (e) {
      setError(readableError(e));
    } finally {
      setBusy(false);
    }
  }
  async function scan(file: File | undefined) {
    if (!file) return;
    setError("");
    try {
      if (file.size > 10_000_000)
        throw new Error("Slika smije imati najviše 10 MB.");
      const bitmap = await createImageBitmap(file);
      const canvas = document.createElement("canvas");
      const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Preglednik ne podržava obradu slike.");
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const { default: jsQR } = await import("jsqr");
      const found = jsQR(pixels.data, pixels.width, pixels.height);
      if (!found)
        throw new Error(
          "QR kod nije prepoznat. Pokušajte jasniju fotografiju.",
        );
      await verify(found.data);
    } catch (e) {
      setError(readableError(e));
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">ŠKOLSKI PORTAL</div>
          <h1>Provjera ispričnice</h1>
          <p>Provjerite autentičnost i trenutačni status dokumenta.</p>
        </div>
      </div>
      <section className="card">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void verify(code);
          }}
        >
          <label className="field">
            <span>Broj ispričnice ili poveznica iz QR koda</span>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="EZ-ISP-2026-00000001"
              required
              maxLength={300}
            />
          </label>
          <div className="document-actions">
            <button className="primary" disabled={busy}>
              {busy ? "Provjera…" : "Provjeri dokument"}
            </button>
            <label className="secondary">
              Učitaj / fotografiraj QR kod
              <input
                type="file"
                accept="image/*"
                capture="environment"
                disabled={busy}
                onChange={(e) => void scan(e.target.files?.[0])}
              />
            </label>
          </div>
        </form>
        <p className="signature-note">
          Slika QR koda obrađuje se samo u vašem pregledniku. Zdravstveni karton
          učenika nije dostupan školi.
        </p>
        {error && <ErrorMessage>{error}</ErrorMessage>}
      </section>
      {result !== undefined && (
        <section className="card spaced">
          <VerificationResult data={result} />
        </section>
      )}
    </>
  );
}
