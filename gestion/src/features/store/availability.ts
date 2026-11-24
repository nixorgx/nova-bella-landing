/** Public stock language: never an exact count above the "last units" threshold. */
export type Availability = "disponible" | "ultimas" | "agotado";

export const LAST_UNITS_THRESHOLD = 3;
export const MAX_QTY_PER_LINE = 10;
export const MAX_CART_LINES = 30;

export function availabilityOf(units: number): Availability {
  if (units <= 0) return "agotado";
  return units <= LAST_UNITS_THRESHOLD ? "ultimas" : "disponible";
}

export const AVAILABILITY_LABEL: Readonly<Record<Availability, string>> = {
  disponible: "Disponible",
  ultimas: "Últimas unidades",
  agotado: "Agotado",
};

/** "Quedan 2" only for the last units; "+10" is the most a buyer ever learns about a pile of stock. */
export function availabilityDetail(units: number): string {
  if (units <= 0) return "Agotado";
  if (units <= LAST_UNITS_THRESHOLD) return units === 1 ? "Queda 1 par" : `Quedan ${units} pares`;
  return units >= MAX_QTY_PER_LINE ? "Disponible (+10)" : "Disponible";
}
