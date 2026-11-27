import type { SessionPayload } from "@/lib/auth/session";
import { withUser } from "@/lib/db";
import { dec, toMoney } from "@/lib/money";
import { checkOverride, computeExchangeDiff, netOfLines, settlementOf, type SettlementDirection } from "./price-diff";
import { readReturnableLines } from "./queries";
import type { ExchangePreviewInput } from "./schemas";

export interface PreviewLine {
  readonly returnedVariantId: string;
  readonly newVariantId: string;
  readonly qty: number;
  readonly paidUnit: string | null;
  readonly newPrice: string | null;
  /** Computed with the same rule as the database; null when the line cannot be priced. */
  readonly diff: string | null;
  readonly newLabel: string | null;
  readonly newStock: number | null;
  readonly issue: string | null;
}

export interface ExchangePreview {
  readonly lines: readonly PreviewLine[];
  readonly net: string;
  readonly direction: SettlementDirection;
  readonly amount: string;
  /** True when at least one line moves money: a payment method is then mandatory. */
  readonly needsMethod: boolean;
  readonly canConfirm: boolean;
}

interface NewVariantRow {
  id: string;
  price: string;
  label: string;
  stock: number;
}

function issueFor(
  line: ExchangePreviewInput["lines"][number],
  remaining: number | undefined,
  next: NewVariantRow | undefined,
  used: number,
): string | null {
  if (remaining === undefined) return "Este producto no pertenece a la venta.";
  if (line.returnedVariantId === line.newVariantId) return "El producto nuevo debe ser distinto al devuelto.";
  if (line.qty > remaining) {
    return remaining === 0 ? "Este producto ya se cambió por completo." : `Solo quedan ${remaining} por cambiar de este producto.`;
  }
  if (!next) return "El producto nuevo no existe o está inactivo.";
  if (next.stock < used) return `Stock insuficiente de ${next.label} (disponible ${next.stock}).`;
  return null;
}

/**
 * Prices an exchange on the SERVER with the same rule create_exchange applies, so the screen can
 * never show a number the database will not use. Nothing is written.
 */
export async function previewExchange(session: SessionPayload, input: ExchangePreviewInput): Promise<ExchangePreview> {
  return withUser(session, async (client) => {
    const returnable = new Map((await readReturnableLines(client, input.saleId)).map((l) => [l.variantId, l]));
    const ids = [...new Set(input.lines.map((l) => l.newVariantId))];
    const found = await client.query<NewVariantRow>(
      `select v.id, m.base_sale_price::text as price,
              m.name || ' ' || c.name || ' talla ' || z.label as label,
              coalesce((select sum(sl.qty) from stock_levels sl
                         where sl.variant_id = v.id and sl.branch_id = (select branch_id from sales where id = $2)), 0)::int as stock
         from variants v join models m on m.id = v.model_id join colors c on c.id = v.color_id
         join sizes z on z.id = v.size_id
        where v.id = any($1::uuid[]) and v.active and m.active`,
      [ids, input.saleId],
    );
    const variants = new Map(found.rows.map((row) => [row.id, row]));
    const wanted = new Map<string, number>();
    const lines = input.lines.map((line): PreviewLine => {
      const source = returnable.get(line.returnedVariantId);
      const next = variants.get(line.newVariantId);
      const used = (wanted.get(line.newVariantId) ?? 0) + line.qty;
      wanted.set(line.newVariantId, used);
      let issue = issueFor(line, source?.remaining, next, used);
      const diff = source && next ? computeExchangeDiff({ paidUnit: source.paidUnit, newPrice: next.price, qty: line.qty }) : null;
      let applied = diff;
      if (!issue && session.role === "superadmin" && line.priceDiffOverride !== undefined && source && next) {
        issue = checkOverride({ diff: line.priceDiffOverride, paidUnit: source.paidUnit, newPrice: next.price, qty: line.qty });
        applied = issue ? diff : toMoney(line.priceDiffOverride);
      }
      return {
        returnedVariantId: line.returnedVariantId,
        newVariantId: line.newVariantId,
        qty: line.qty,
        paidUnit: source?.paidUnit ?? null,
        newPrice: next?.price ?? null,
        diff: applied,
        newLabel: next?.label ?? null,
        newStock: next?.stock ?? null,
        issue,
      };
    });
    const priced = lines.every((l) => l.diff !== null);
    const net = netOfLines(lines.map((l) => l.diff ?? "0"));
    const settlement = settlementOf(net);
    return {
      lines,
      net,
      direction: settlement.direction,
      amount: settlement.amount,
      needsMethod: lines.some((l) => l.diff !== null && !dec(l.diff).isZero()),
      canConfirm: priced && lines.every((l) => l.issue === null),
    };
  });
}
