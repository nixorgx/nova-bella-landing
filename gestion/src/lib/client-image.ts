/**
 * Browser-side shrink of phone photos before upload (Vercel rejects request bodies over 4.5 MB, and a 6 MB
 * camera picture is normal). The server still validates and re-encodes everything; this only keeps big files
 * under the limit. Returns the original file when it is already small or the browser cannot decode it.
 */
export const SHRINK_ABOVE_BYTES = 1_200_000;
export const SHRINK_MAX_SIDE = 1800;

export async function shrinkImage(file: File): Promise<File> {
  if (file.size <= SHRINK_ABOVE_BYTES || typeof createImageBitmap !== "function") return file;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, SHRINK_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) return file;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.86));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], "foto.jpg", { type: "image/jpeg" });
  } catch {
    return file;
  }
}

/** Same cap the server enforces (images.ts MAX_UPLOAD_BYTES); checked here so a too-big file never hits the wire. */
export const CLIENT_UPLOAD_LIMIT = 4 * 1024 * 1024;
export const TOO_BIG_MESSAGE = "La imagen supera los 4 MB incluso reducida. Elija una más liviana.";
