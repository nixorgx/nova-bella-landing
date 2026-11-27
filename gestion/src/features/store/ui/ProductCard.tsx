import Link from "next/link";
import { formatBs } from "@/lib/money";
import { availabilityOf, AVAILABILITY_LABEL } from "../availability";
import type { CatalogModel } from "../public-data";
import { ProductPlaceholder, StoreImage } from "./StoreImage";

const MAX_DOTS = 5;

export function ProductCard({ model, featured = false, priority = false }: { model: CatalogModel; featured?: boolean; priority?: boolean }) {
  const availability = availabilityOf(model.units);
  const dots = model.colors.slice(0, MAX_DOTS);
  const extra = model.colors.length - dots.length;
  const width = model.image_w ?? 400;
  const height = model.image_h ?? 500;
  return (
    <li className={`pcard${featured ? " pcard--feature" : ""}${availability === "agotado" ? " pcard--out" : ""}`}>
      <Link className="pcard__link" href={`/tienda/${model.slug}`}>
        <span className="pcard__media">
          {model.image ? (
            <StoreImage
              id={model.image}
              alt=""
              width={width}
              height={height}
              priority={priority}
              useFull={featured}
              sizes={featured ? "(min-width: 48rem) 66vw, 50vw" : "(min-width: 72rem) 25vw, (min-width: 48rem) 33vw, 50vw"}
            />
          ) : (
            <ProductPlaceholder name={model.name} hex={model.colors[0]?.hex} />
          )}
          {availability !== "disponible" ? (
            <span className={`pcard__flag pcard__flag--${availability}`}>{AVAILABILITY_LABEL[availability]}</span>
          ) : null}
        </span>
        <span className="pcard__body">
          <span className="pcard__line">{model.line}</span>
          <span className="pcard__name">{model.name}</span>
          <span className="pcard__row">
            <span className="pcard__price num">{formatBs(model.price)}</span>
            {dots.length > 0 ? (
              <span className="pcard__dots" role="img" aria-label={`${model.colors.length} colores`}>
                {dots.map((color) => (
                  <i key={color.id} style={color.hex ? { background: color.hex } : undefined} />
                ))}
                {extra > 0 ? <b>+{extra}</b> : null}
              </span>
            ) : null}
          </span>
        </span>
      </Link>
    </li>
  );
}
