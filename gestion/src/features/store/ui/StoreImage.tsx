import { preload } from "react-dom";
import { BrandMark } from "@/components/ui/BrandMark";
import { imageUrl } from "../image-url";

/**
 * Product photo. The files are already optimized WebP made by sharp at upload time (two sizes), so a plain
 * <img> with explicit dimensions (no layout shift), srcset and lazy loading is the right tool here.
 */
export function StoreImage({
  id,
  alt,
  width,
  height,
  priority = false,
  sizes,
  useFull = false,
}: {
  id: string;
  alt: string;
  width: number;
  height: number;
  priority?: boolean;
  sizes: string;
  /** Large tiles use the 900px file instead of the 400px thumbnail. */
  useFull?: boolean;
}) {
  const src = imageUrl(id, useFull ? "full" : "thumb");
  if (priority) {
    // Hint the LCP image into the document head so it is requested before scripts and styles finish queueing.
    preload(src, { as: "image", imageSrcSet: `${imageUrl(id, "thumb")} 400w, ${imageUrl(id, "full")} 900w`, imageSizes: sizes, fetchPriority: "high" });
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- already optimized by sharp; the route sets immutable caching
    <img
      className="store-img"
      src={src}
      srcSet={`${imageUrl(id, "thumb")} 400w, ${imageUrl(id, "full")} 900w`}
      sizes={sizes}
      alt={alt}
      width={width}
      height={height}
      loading={priority ? "eager" : "lazy"}
      decoding="async"
      fetchPriority={priority ? "high" : "auto"}
    />
  );
}

/** Brand-styled stand-in while a model has no photo yet. */
export function ProductPlaceholder({ name, hex }: { name: string; hex?: string | null }) {
  const style = hex && /^#[0-9a-fA-F]{6}$/.test(hex) ? ({ "--ph": hex } as React.CSSProperties) : undefined;
  return (
    <div className="ph" style={style} aria-hidden="true">
      <BrandMark className="ph__mark" />
      <span className="ph__initial">{name.trim().charAt(0).toUpperCase()}</span>
    </div>
  );
}
