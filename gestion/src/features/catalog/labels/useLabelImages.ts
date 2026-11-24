"use client";

import { useEffect, useState } from "react";
import type { LabelImages } from "./codes";
import type { LabelData } from "./presets";

interface Result {
  readonly images: Readonly<Record<string, LabelImages>>;
  readonly failed: boolean;
}

/** Builds QR + Code 128 images in the browser (libraries load on demand). */
export function useLabelImages(labels: readonly LabelData[]): Result {
  const [result, setResult] = useState<Result>({ images: {}, failed: false });
  const signature = [...new Set(labels.map((l) => `${l.variantId}|${l.sku}|${l.barcode ?? ""}`))].join(",");

  useEffect(() => {
    let cancelled = false;
    const unique = new Map(labels.map((label) => [label.variantId, label]));
    import("./codes")
      .then(({ buildLabelImages }) => buildLabelImages([...unique.values()]))
      .then((images) => {
        if (!cancelled) setResult({ images, failed: false });
      })
      .catch(() => {
        if (!cancelled) setResult({ images: {}, failed: true });
      });
    return () => {
      cancelled = true;
    };
    // `signature` captures every field that changes the generated codes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  return result;
}
