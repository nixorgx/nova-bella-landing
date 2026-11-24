import { inRangeSql, ownerSql } from "./scope";

/**
 * Every pair that changed hands in the period, as +/- lines per variant (parameters $1..$4, see scope.ts):
 *   - each line of a completed sale  : +qty, +qty * price charged
 *   - each exchange, returned pair   : -qty, -qty * price that was paid for it
 *   - each exchange, replacement pair: +qty, +(what was paid for the returned pair + the difference)
 * so units and revenue of a model/size are NET of exchanges, and sum(revenue) = sales + differences.
 * With `withCost` the cost snapshot (superadmin tables) is added; sellers can never run that variant.
 */
export function movementLinesSql(withCost: boolean): string {
  const cost = (saleCost: string, returnedCost: string, newCost: string) =>
    withCost ? { sale: `, ${saleCost} as cost`, returned: `, ${returnedCost} as cost`, next: `, ${newCost} as cost` } : { sale: "", returned: "", next: "" };
  const c = cost(
    "si.qty * coalesce(sic.unit_cost_bs, 0)",
    "-e.qty * coalesce(ec.returned_unit_cost_bs, 0)",
    "e.qty * coalesce(ec.new_unit_cost_bs, 0)",
  );
  const saleCostJoin = withCost ? "left join sale_item_costs sic on sic.sale_item_id = si.id" : "";
  const exchangeCostJoin = withCost ? "left join exchange_costs ec on ec.exchange_id = e.id" : "";
  return `
    select si.variant_id, si.qty::bigint as units, si.qty * si.final_price as revenue${c.sale}
      from sale_items si join sales s on s.id = si.sale_id ${saleCostJoin}
     where s.status = 'completed' and ${inRangeSql("s.created_at")} and ${ownerSql("s.branch_id", "s.seller_id")}
    union all
    select e.returned_variant_id, -e.qty::bigint, -e.qty * coalesce(e.returned_unit_price, 0)${c.returned}
      from exchanges e join sales s on s.id = e.original_sale_id ${exchangeCostJoin}
     where s.status = 'completed' and ${inRangeSql("e.created_at")} and ${ownerSql("e.branch_id", "s.seller_id")}
    union all
    select e.new_variant_id, e.qty::bigint, e.qty * coalesce(e.returned_unit_price, 0) + e.price_diff${c.next}
      from exchanges e join sales s on s.id = e.original_sale_id ${exchangeCostJoin}
     where s.status = 'completed' and ${inRangeSql("e.created_at")} and ${ownerSql("e.branch_id", "s.seller_id")}`;
}
