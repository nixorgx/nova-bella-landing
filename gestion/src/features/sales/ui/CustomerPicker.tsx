"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import type { CustomerOption } from "@/features/customers/queries";
import { NewCustomerForm } from "@/features/customers/ui/NewCustomerForm";

interface Props {
  readonly customer: CustomerOption | null;
  readonly onChange: (customer: CustomerOption | null) => void;
}

/** Optional customer: search by name / phone / CI-NIT, or create one without leaving the sale. */
export function CustomerPicker({ customer, onChange }: Props) {
  const uid = useId();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<readonly CustomerOption[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [creating, setCreating] = useState(false);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const text = query.trim();
    if (text.length < 2) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/clientes/buscar?q=${encodeURIComponent(text)}`, { signal: controller.signal });
        if (!response.ok) return;
        const data = (await response.json()) as { customers: CustomerOption[] };
        setHits(data.customers);
        setActive(0);
      } catch {
        /* aborted or offline: the list simply keeps its last result */
      }
    }, 180);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  function choose(next: CustomerOption) {
    onChange(next);
    setQuery("");
    setHits([]);
    setOpen(false);
  }

  if (customer) {
    return (
      <div className="chosen">
        <p className="chosen__text">
          <strong>{customer.name}</strong>
          <span>{[customer.ciNit && `CI/NIT ${customer.ciNit}`, customer.phone].filter(Boolean).join(" · ") || "Sin más datos"}</span>
        </p>
        <button type="button" className="btn btn--small btn--quiet" onClick={() => onChange(null)} aria-label={`Quitar al cliente ${customer.name}`}>
          Quitar
        </button>
      </div>
    );
  }

  const shown = open && query.trim().length >= 2;
  return (
    <div className="vsearch">
      <label className="field__label" htmlFor={`${uid}-q`}>Cliente (opcional)</label>
      <input
        id={`${uid}-q`}
        className="field__control"
        type="search"
        role="combobox"
        aria-expanded={shown}
        aria-controls={`${uid}-list`}
        aria-autocomplete="list"
        autoComplete="off"
        placeholder="Nombre, teléfono o CI/NIT"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onBlur={() => {
          blurTimer.current = setTimeout(() => setOpen(false), 120);
        }}
        onFocus={() => {
          if (blurTimer.current) clearTimeout(blurTimer.current);
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && hits.length) {
            event.preventDefault();
            setActive((i) => (i + 1) % hits.length);
          } else if (event.key === "ArrowUp" && hits.length) {
            event.preventDefault();
            setActive((i) => (i - 1 + hits.length) % hits.length);
          } else if (event.key === "Enter" && shown && hits[active]) {
            event.preventDefault();
            choose(hits[active]);
          } else if (event.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      <ul id={`${uid}-list`} role="listbox" aria-label="Clientes" className="vsearch__list" hidden={!shown}>
        {hits.length === 0 ? <li className="vsearch__note" role="presentation">Sin resultados para “{query.trim()}”.</li> : null}
        {hits.map((hit, index) => (
          <li
            key={hit.id}
            role="option"
            aria-selected={index === active}
            className={`vsearch__option ${index === active ? "is-active" : ""}`}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => choose(hit)}
          >
            <span className="vsearch__main">
              <strong className="clip">{hit.name}</strong>
              <span className="clip">{[hit.ciNit, hit.phone].filter(Boolean).join(" · ") || "—"}</span>
            </span>
          </li>
        ))}
      </ul>
      <button type="button" className="btn btn--small" onClick={() => setCreating(true)}>
        Nuevo cliente
      </button>
      <Modal open={creating} onClose={() => setCreating(false)} title="Nuevo cliente">
        <NewCustomerForm
          onCreated={(created) => {
            setCreating(false);
            choose(created);
          }}
        />
      </Modal>
    </div>
  );
}
