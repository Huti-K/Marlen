/**
 * Shared helpers for serving stored or foreign file bytes to the browser.
 * The served MIME always derives from the filename extension, never from a
 * caller-supplied type, so foreign content can never be served as executable
 * text/html on the app origin.
 */

/** Map a file extension (no leading dot required) to a browser-friendly MIME type. */
export function mimeForExt(ext: string): string {
  switch (ext.toLowerCase().replace(/^\./, "")) {
    case "pdf":
      return "application/pdf";
    case "md":
    case "markdown":
    case "txt":
    case "csv":
      return "text/plain; charset=utf-8";
    case "html":
    case "htm":
      // Never text/html: these routes serve sender-controlled content (email
      // attachments, saved email exports), and serving that inline as HTML on
      // the app origin would let its script call every /api endpoint.
      return "text/plain; charset=utf-8";
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "avif":
      return "image/avif";
    case "bmp":
      return "image/bmp";
    case "docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    default:
      return "application/octet-stream";
  }
}

/**
 * Whether a resolved MIME renders safely inline in the browser. PDFs, plain
 * text (html/htm map to text/plain above, so they show as inert source rather
 * than executing) and raster images are safe; SVG is deliberately excluded
 * (it can carry script), so it downloads.
 */
export function inlineForMime(mime: string): boolean {
  return /^(application\/pdf|text\/plain|image\/(png|jpeg|gif|webp|avif|bmp))/.test(mime);
}

/**
 * Build a Content-Disposition header value for a filename that may contain
 * non-Latin1 or quote characters, which Node's raw header serializer rejects
 * (ERR_INVALID_CHAR) or which would otherwise malform the quoted-string.
 * Ships an ASCII `filename` fallback plus the exact name via RFC 5987/6266
 * `filename*`.
 */
export function contentDisposition(kind: "inline" | "attachment", filename: string): string {
  const ascii = filename.replace(/[\\"]/g, "").replace(/[^\x20-\x7e]/g, "_");
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
