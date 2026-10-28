/** Supabase Auth JS may return an SVG data URI, rather than raw SVG. */
export function authenticatorQrDataUri(value: string) {
  const svg = value.trim();
  const prefix = svg.match(/^data:image\/svg\+xml(?:;[^,]*)?,/i);
  if (prefix) {
    if (prefix[0].includes(";base64,")) return svg;
    const payload = svg.slice(prefix[0].length);
    return (
      "data:image/svg+xml;charset=utf-8," +
      (payload.trimStart().startsWith("<")
        ? encodeURIComponent(payload)
        : payload)
    );
  }
  if (/^(?:<\?xml[^>]*>\s*)?<svg\b/.test(svg))
    return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  throw Error("QR kod autentifikatora nije moguće prikazati.");
}
