"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { formatBs } from "@/lib/money";
import { availabilityDetail, availabilityOf, MAX_QTY_PER_LINE } from "../availability";
import { useCart } from "../cart/useCart";
import type { ProductDetail } from "../public-data";
import { productInquiryMessage, waLink } from "../whatsapp";
import { ProductPlaceholder, StoreImage } from "./StoreImage";

interface Props {
  readonly product: ProductDetail;
  readonly whatsapp: string | null;
  readonly open: boolean;
  readonly pageUrl: string;
}

export function ProductView({ product, whatsapp, open, pageUrl }: Props) {
  const cart = useCart();
  const firstWithStock = product.colors.find((color) => product.variants.some((v) => v.color_id === color.id && v.cap > 0));
  const [colorId, setColorId] = useState<string | null>((firstWithStock ?? product.colors[0])?.id ?? null);
  const [sizeId, setSizeId] = useState<string | null>(null);
  const [qty, setQty] = useState(1);
  const [imageIndex, setImageIndex] = useState(0);
  const [added, setAdded] = useState(false);
  const [hint, setHint] = useState("");

  const color = product.colors.find((c) => c.id === colorId) ?? null;
  const variantFor = (size: string) => product.variants.find((v) => v.color_id === colorId && v.size_id === size);
  const variant = sizeId ? variantFor(sizeId) : undefined;
  const cap = variant?.cap ?? 0;

  // Photos of the chosen color first, then the generic ones, then the rest.
  const images = useMemo(() => {
    const own = product.images.filter((i) => i.color_id === colorId);
    const generic = product.images.filter((i) => i.color_id === null);
    const rest = product.images.filter((i) => i.color_id !== colorId && i.color_id !== null);
    return [...own, ...generic, ...rest];
  }, [product.images, colorId]);
  const image = images[Math.min(imageIndex, Math.max(0, images.length - 1))];

  const chat = waLink(
    whatsapp,
    productInquiryMessage({ model: product.name, color: color?.name, size: sizeId ? product.sizes.find((s) => s.id === sizeId)?.label : undefined, price: String(product.price), url: pageUrl }),
  );
  const inCart = variant ? (cart.lines.find((l) => l.variantId === variant.id)?.qty ?? 0) : 0;

  function addToCart() {
    if (!variant) {
      setHint("Elija una talla para continuar.");
      return;
    }
    if (variant.cap <= 0) {
      setHint("Esa talla está agotada.");
      return;
    }
    const allowed = Math.min(MAX_QTY_PER_LINE, variant.cap) - inCart;
    if (allowed <= 0) {
      setHint("Ya tiene en su carrito todas las unidades disponibles de esta talla.");
      return;
    }
    cart.add(variant.id, Math.min(qty, allowed));
    setAdded(true);
    setHint("");
  }

  return (
    <div className="pview">
      <div className="pview__gallery">
        <div className="pview__stage">
          {image ? (
            <StoreImage
              key={image.id}
              id={image.id}
              alt={image.alt ?? `${product.name}${color ? `, ${color.name}` : ""}`}
              width={image.w}
              height={image.h}
              priority
              sizes="(min-width: 64rem) 46vw, 100vw"
              useFull
            />
          ) : (
            <ProductPlaceholder name={product.name} hex={color?.hex} />
          )}
        </div>
        {images.length > 1 ? (
          <ul className="pview__thumbs" aria-label="Fotos del modelo">
            {images.map((item, index) => (
              <li key={item.id}>
                <button type="button" className="pview__thumb" aria-label={`Ver foto ${index + 1}`} aria-pressed={index === imageIndex} onClick={() => setImageIndex(index)}>
                  <StoreImage id={item.id} alt="" width={item.tw} height={item.th} sizes="72px" />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="pview__panel">
        <p className="eyebrow">{product.line}</p>
        <h1 className="pview__title">{product.name}</h1>
        <p className="pview__price num">{formatBs(product.price)}</p>
        {product.description ? <p className="pview__desc">{product.description}</p> : null}

        {product.colors.length > 0 ? (
          <fieldset className="opt">
            <legend>
              Color: <strong>{color?.name}</strong>
            </legend>
            <div className="opt__row">
              {product.colors.map((item) => {
                const stock = product.variants.some((v) => v.color_id === item.id && v.cap > 0);
                return (
                  <label key={item.id} className="opt__swatch">
                    <input
                      type="radio"
                      name="color"
                      value={item.id}
                      checked={item.id === colorId}
                      onChange={() => {
                        setColorId(item.id);
                        setSizeId(null);
                        setImageIndex(0);
                        setAdded(false);
                        setHint("");
                      }}
                    />
                    <span className="opt__dot" style={item.hex ? { background: item.hex } : undefined} />
                    <span className="sr-only">
                      {item.name}
                      {stock ? "" : " (agotado)"}
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        ) : null}

        <fieldset className="opt">
          <legend>
            Talla{sizeId ? <>: <strong>{product.sizes.find((s) => s.id === sizeId)?.label}</strong></> : null}
          </legend>
          <div className="opt__row opt__row--sizes">
            {product.sizes.map((size) => {
              const v = variantFor(size.id);
              const unavailable = !v || v.cap <= 0;
              return (
                <label key={size.id} className="opt__size" data-unavailable={unavailable ? "true" : undefined}>
                  <input
                    type="radio"
                    name="size"
                    value={size.id}
                    disabled={unavailable}
                    checked={size.id === sizeId}
                    onChange={() => {
                      setSizeId(size.id);
                      setQty(1);
                      setAdded(false);
                      setHint("");
                    }}
                  />
                  <span>
                    {size.label}
                    {unavailable ? <span className="sr-only"> (agotada)</span> : null}
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>

        <p className="pview__stock" role="status">
          {variant ? (
            <span className={`sstock sstock--${availabilityOf(cap)}`}>{availabilityDetail(cap)}</span>
          ) : (
            <span className="sstock sstock--hint">Elija su talla para ver la disponibilidad.</span>
          )}
        </p>

        <div className="pview__buy">
          <div className="sqty" role="group" aria-label="Cantidad">
            <button type="button" className="sqty__btn" aria-label="Menos" onClick={() => setQty((q) => Math.max(1, q - 1))} disabled={qty <= 1}>
              −
            </button>
            <output className="sqty__value num" aria-live="polite">{qty}</output>
            <button
              type="button"
              className="sqty__btn"
              aria-label="Más"
              onClick={() => setQty((q) => Math.min(Math.min(MAX_QTY_PER_LINE, cap || MAX_QTY_PER_LINE), q + 1))}
              disabled={variant ? qty >= Math.min(MAX_QTY_PER_LINE, cap) : false}
            >
              +
            </button>
          </div>
          <button type="button" className="btn btn--primary pview__add" onClick={addToCart}>
            Agregar al carrito
          </button>
        </div>
        <p className="pview__hint" role="status" aria-live="polite">
          {hint}
          {added ? (
            <>
              Agregado al carrito.{" "}
              <Link href="/tienda/carrito">Ver carrito</Link>
            </>
          ) : null}
        </p>
        {!open ? <p className="notice">La tienda no recibe pedidos por ahora; puede dejar el producto en su carrito.</p> : null}
        {chat ? (
          <a className="pview__chat" href={chat} target="_blank" rel="noopener noreferrer">
            Consultar por WhatsApp
          </a>
        ) : null}
      </div>
    </div>
  );
}
