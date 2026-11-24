-- 013: indexes for search and reporting.
--
-- The trigram indexes are built on the SAME folded expression the search queries use
-- (lower + accent folding, see src/features/catalog/variant-query.ts), otherwise the
-- planner could not use them for `like '%text%'`.

create extension if not exists pg_trgm with schema public;

create index variants_sku_trgm_idx on variants using gin
  ((translate(lower(coalesce(sku, '')), 'áéíóúüñ', 'aeiouun')) gin_trgm_ops);
create index models_name_trgm_idx on models using gin
  ((translate(lower(coalesce(name, '')), 'áéíóúüñ', 'aeiouun')) gin_trgm_ops);
create index customers_name_trgm_idx on customers using gin
  ((translate(lower(coalesce(name, '')), 'áéíóúüñ', 'aeiouun')) gin_trgm_ops);

create index sales_cash_session_idx on sales (cash_session_id);
create index sales_seller_idx on sales (seller_id);
create index sales_created_idx on sales (created_at);
create index customers_phone_idx on customers (phone);
