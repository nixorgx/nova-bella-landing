-- 008: catalog management (Fase 2).
-- Colors and sizes can be deactivated like lines and models, and the superadmin can
-- delete catalog entries that nothing references yet. Foreign keys (variants ->
-- models/colors/sizes, models -> product_lines) still block deleting anything in use.

alter table colors add column active boolean not null default true;
alter table sizes  add column active boolean not null default true;

grant delete on product_lines, models, colors, sizes to app_superadmin;
