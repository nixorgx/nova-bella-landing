/**
 * A sale belongs to a cash session's books while it is completed, and also when it was voided AFTER
 * the session closed (the drawer was already counted with that money in it). Voids made while the
 * session is still open take the sale out. Uses the alias `cs` for cash_sessions and `s` for sales.
 */
export const SALE_COUNTS_IN_SESSION = "(s.status = 'completed' or s.voided_at > cs.closed_at)";

/**
 * One row per cash session with every aggregate the cash screens and the Excel export need.
 * Money is returned as text (numeric) so nothing goes through float. Callers append `where ...`.
 */
export const SESSION_REPORT_SELECT = `
  select cs.id, cs.branch_id, b.name as branch_name, cs.opened_by, td.full_name as opened_by_name,
         cs.opened_at, cs.opening_amount::text as opening_amount, cs.closed_at, cs.closing_amount::text as closing_amount,
         sl.count as sales_count, sl.total::text as sales_total,
         pay.efectivo::text as pay_efectivo, pay.qr::text as pay_qr,
         pay.transferencia::text as pay_transferencia, pay.tarjeta::text as pay_tarjeta,
         ex.count as exchange_count,
         ex.efectivo::text as ex_efectivo, ex.qr::text as ex_qr,
         ex.transferencia::text as ex_transferencia, ex.tarjeta::text as ex_tarjeta,
         vd.count as void_count, vd.total::text as void_total
    from cash_sessions cs
    join branches b on b.id = cs.branch_id
    left join team_directory() td on td.id = cs.opened_by
    left join lateral (
      select count(*)::int as count, coalesce(sum(s.total), 0) as total
        from sales s where s.cash_session_id = cs.id and ${SALE_COUNTS_IN_SESSION}
    ) sl on true
    left join lateral (
      select coalesce(sum(p.amount) filter (where p.method = 'efectivo'), 0) as efectivo,
             coalesce(sum(p.amount) filter (where p.method = 'qr'), 0) as qr,
             coalesce(sum(p.amount) filter (where p.method = 'transferencia'), 0) as transferencia,
             coalesce(sum(p.amount) filter (where p.method = 'tarjeta'), 0) as tarjeta
        from sale_payments p join sales s on s.id = p.sale_id
       where s.cash_session_id = cs.id and ${SALE_COUNTS_IN_SESSION}
    ) pay on true
    left join lateral (
      select count(*)::int as count,
             coalesce(sum(e.price_diff) filter (where e.payment_method = 'efectivo'), 0) as efectivo,
             coalesce(sum(e.price_diff) filter (where e.payment_method = 'qr'), 0) as qr,
             coalesce(sum(e.price_diff) filter (where e.payment_method = 'transferencia'), 0) as transferencia,
             coalesce(sum(e.price_diff) filter (where e.payment_method = 'tarjeta'), 0) as tarjeta
        from exchanges e where e.cash_session_id = cs.id
    ) ex on true
    left join lateral (
      select count(*)::int as count, coalesce(sum(s.total), 0) as total
        from sales s where s.cash_session_id = cs.id and s.status = 'voided'
    ) vd on true`;
