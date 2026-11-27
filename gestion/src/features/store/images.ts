import { createHash } from "node:crypto";
import sharp from "sharp";

/**
 * Every image that enters the database (product photos, the shop's payment QR, buyers' payment proofs) goes
 * through here: size cap, magic-byte sniffing (jpeg / png / webp only; SVG, GIF, HEIC, PDF... are refused),
 * decode + re-encode with sharp (strips metadata and anything that is not pixels), resize and WebP output.
 * The bytes stored are always produced by sharp, never the user's file.
 *
 * Upload cap is 4 MiB: Vercel rejects request bodies over 4.5 MB before our code runs. The browser shrinks big
 * photos first (see ImagePicker), so phone pictures still work.
 */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
export const MAX_INPUT_PIXELS = 30_000_000;

export type ImageKind = "jpeg" | "png" | "webp";

export class ImageRejected extends Error {}

export function sniffImage(bytes: Uint8Array): ImageKind | null {
  if (bytes.length < 12) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (png.every((byte, i) => bytes[i] === byte)) return "png";
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.slice(from, to));
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "webp";
  return null;
}

export interface EncodedImage {
  readonly bytes: Buffer;
  readonly width: number;
  readonly height: number;
}

interface EncodeOptions {
  readonly maxSide: number;
  readonly maxBytes: number;
  readonly qualities: readonly number[];
  readonly lossless?: boolean;
}

const BACKGROUND = { r: 255, g: 250, b: 246 }; // marfil: transparent PNGs are flattened onto it

async function encode(input: Buffer, options: EncodeOptions): Promise<EncodedImage> {
  let lastError: unknown;
  for (const quality of options.qualities) {
    try {
      const { data, info } = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, failOn: "error" })
        .rotate()
        .flatten({ background: BACKGROUND })
        .resize({ width: options.maxSide, height: options.maxSide, fit: "inside", withoutEnlargement: true })
        .webp(options.lossless ? { lossless: true, effort: 4 } : { quality, effort: 4 })
        .toBuffer({ resolveWithObject: true });
      if (data.length <= options.maxBytes) return { bytes: data, width: info.width, height: info.height };
      if (options.lossless) break;
    } catch (error) {
      lastError = error;
      break;
    }
  }
  if (lastError) throw new ImageRejected("No se pudo leer la imagen. Use una foto JPG, PNG o WebP.");
  throw new ImageRejected("La imagen es demasiado pesada incluso comprimida. Use una más pequeña.");
}

/** Validates an uploaded file and returns its bytes, or throws ImageRejected with a user-facing message. */
export async function readUpload(file: File | Blob | null | undefined): Promise<Buffer> {
  if (!file || typeof file === "string" || file.size === 0) throw new ImageRejected("Elija una imagen.");
  if (file.size > MAX_UPLOAD_BYTES) throw new ImageRejected("La imagen supera los 4 MB. Elija una más liviana.");
  const bytes = Buffer.from(await file.arrayBuffer());
  if (!sniffImage(bytes)) throw new ImageRejected("Solo se aceptan fotos JPG, PNG o WebP (no SVG, GIF ni HEIC).");
  return bytes;
}

export interface ProductImageSet {
  readonly full: EncodedImage;
  readonly thumb: EncodedImage;
  readonly etag: string;
}

export const PRODUCT_FULL = { maxSide: 900, maxBytes: 150_000, qualities: [82, 74, 66, 58, 50, 42] } as const;
export const PRODUCT_THUMB = { maxSide: 400, maxBytes: 60_000, qualities: [74, 66, 58, 50, 42] } as const;

export async function processProductImage(upload: Buffer): Promise<ProductImageSet> {
  const [full, thumb] = await Promise.all([encode(upload, PRODUCT_FULL), encode(upload, PRODUCT_THUMB)]);
  return { full, thumb, etag: createHash("sha256").update(full.bytes).digest("hex").slice(0, 40) };
}

/** Buyer proof of payment: readable text matters more than size, still capped well below the DB limit. */
export async function processProof(upload: Buffer): Promise<{ image: EncodedImage; etag: string }> {
  const image = await encode(upload, { maxSide: 1400, maxBytes: 500_000, qualities: [80, 72, 64, 56, 48] });
  return { image, etag: createHash("sha256").update(image.bytes).digest("hex").slice(0, 40) };
}

/** The shop's payment QR must stay scannable: lossless WebP, no aggressive shrinking. */
export async function processQr(upload: Buffer): Promise<{ image: EncodedImage; etag: string }> {
  const image = await encode(upload, { maxSide: 900, maxBytes: 390_000, qualities: [100], lossless: true });
  return { image, etag: createHash("sha256").update(image.bytes).digest("hex").slice(0, 40) };
}
