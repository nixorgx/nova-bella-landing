/* eslint-disable @next/next/no-img-element -- data-URI SVGs for print; next/image cannot optimise them */
import { formatBs } from "@/lib/money";
import type { LabelImages } from "./codes";
import { paginate, type LabelData, type LabelPreset } from "./presets";

/** Pages beyond this are hidden on screen (they still print). */
const PREVIEW_PAGES = 2;
const BASE_WIDTH_MM = 50;

function LabelCard({ label, preset, images, showPrice }: {
  label: LabelData;
  preset: LabelPreset;
  images?: LabelImages;
  showPrice: boolean;
}) {
  const scale = preset.widthMm / BASE_WIDTH_MM;
  return (
    <article
      className="label"
      style={{
        width: `calc(${preset.widthMm} * var(--mm))`,
        height: `calc(${preset.heightMm} * var(--mm))`,
        ["--s" as string]: scale,
      }}
    >
      <div className="label__qr">
        {images ? <img src={images.qr} alt={`QR de ${label.sku}`} /> : <span className="label__ph" />}
        {showPrice ? <strong className="label__price num">{formatBs(label.price)}</strong> : null}
      </div>
      <div className="label__body">
        <strong className="label__model">{label.model}</strong>
        <div className="label__attrs">
          <span className="label__color">{label.color}</span>
          <span className="label__size">{label.size}</span>
        </div>
        {images ? <img className="label__bars" src={images.barcode} alt={`Código de barras de ${label.sku}`} /> : <span className="label__ph" />}
        <code className="label__sku">{label.sku}</code>
      </div>
    </article>
  );
}

interface Props {
  readonly labels: readonly LabelData[];
  readonly preset: LabelPreset;
  readonly images: Readonly<Record<string, LabelImages>>;
  readonly showPrice: boolean;
}

/** One <section> per physical page; the same markup serves the preview and the print job. */
export function LabelPages({ labels, preset, images, showPrice }: Props) {
  const pages = paginate(labels, preset);
  const mmOnScreen = preset.kind === "roll" ? "6px" : "2.6px";
  return (
    <div className="label-pages" style={{ ["--mm-screen" as string]: mmOnScreen }}>
      {pages.map((page, pageIndex) => (
        <section
          key={pageIndex}
          className={`label-page label-page--${preset.kind} ${pageIndex >= PREVIEW_PAGES ? "print-only" : ""}`}
          aria-label={`Página ${pageIndex + 1} de ${pages.length}`}
          style={{
            width: `calc(${preset.pageWidthMm} * var(--mm))`,
            height: `calc(${preset.pageHeightMm} * var(--mm))`,
            padding: `calc(${preset.marginTopMm} * var(--mm)) 0 0 calc(${preset.marginLeftMm} * var(--mm))`,
            gridTemplateColumns: `repeat(${preset.columns}, calc(${preset.widthMm} * var(--mm)))`,
            gridAutoRows: `calc(${preset.heightMm} * var(--mm))`,
            columnGap: `calc(${preset.gapXmm} * var(--mm))`,
            rowGap: `calc(${preset.gapYmm} * var(--mm))`,
          }}
        >
          {page.map((label, index) => (
            <LabelCard key={`${label.variantId}-${index}`} label={label} preset={preset} images={images[label.variantId]} showPrice={showPrice} />
          ))}
        </section>
      ))}
    </div>
  );
}
