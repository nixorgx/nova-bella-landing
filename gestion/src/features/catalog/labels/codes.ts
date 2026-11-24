import { code128, drawingSVG } from "bwip-js/generic";
import QRCode from "qrcode";
import type { LabelData } from "./presets";

const PRINTABLE_ASCII = /^[\x20-\x7E]+$/;

/** The text under the Code 128 bars: the shoebox barcode when we have it, else the SKU. */
export function barcodeText(label: Pick<LabelData, "sku" | "barcode">): string {
  return label.barcode && PRINTABLE_ASCII.test(label.barcode) ? label.barcode : label.sku;
}

export function qrSvg(text: string): Promise<string> {
  return QRCode.toString(text, { type: "svg", margin: 0, errorCorrectionLevel: "M" });
}

export function code128Svg(text: string): string {
  return code128(
    { bcid: "code128", text, scale: 2, height: 10, includetext: false, paddingwidth: 0, paddingheight: 0 },
    drawingSVG(),
  );
}

/** Images from data URIs are sandboxed, so no raw SVG is ever injected into the page. */
export function svgToDataUri(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export interface LabelImages {
  readonly qr: string;
  readonly barcode: string;
}

/** Builds QR + Code 128 images once per distinct variant (copies share them). */
export async function buildLabelImages(
  labels: readonly Pick<LabelData, "variantId" | "sku" | "barcode">[],
): Promise<Readonly<Record<string, LabelImages>>> {
  const unique = new Map(labels.map((label) => [label.variantId, label]));
  const entries = await Promise.all(
    [...unique.values()].map(async (label) => {
      const qr = svgToDataUri(await qrSvg(label.sku));
      const barcode = svgToDataUri(code128Svg(barcodeText(label)));
      return [label.variantId, { qr, barcode }] as const;
    }),
  );
  return Object.fromEntries(entries);
}
