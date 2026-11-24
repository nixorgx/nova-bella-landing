import type { SessionPayload } from "@/lib/auth/session";
import { withUser } from "@/lib/db";

export interface StoreSettings {
  readonly open: boolean;
  readonly whatsapp: string;
  readonly branchId: string;
  readonly bankInstructions: string;
  readonly policyExchange: string;
  readonly policyShipping: string;
}

export interface ZoneRow { readonly id: string; readonly name: string; readonly description: string | null; readonly fee: string; readonly active: boolean; readonly sortOrder: number }
export interface PickupRow { readonly id: string; readonly branchId: string; readonly branchName: string; readonly label: string; readonly address: string | null; readonly hours: string | null; readonly active: boolean }
export interface BranchOption { readonly id: string; readonly name: string }

export interface StoreAdminData {
  readonly settings: StoreSettings;
  readonly zones: readonly ZoneRow[];
  readonly pickup: readonly PickupRow[];
  readonly branches: readonly BranchOption[];
  readonly hasQr: boolean;
  readonly published: number;
  readonly readyToPublish: number;
}

export async function getStoreAdminData(session: SessionPayload): Promise<StoreAdminData> {
  return withUser(session, async (c) => {
    const settings = Object.fromEntries(
      (await c.query<{ key: string; value: string | null }>("select key, value from app_settings where key like 'store\\_%'")).rows.map((r) => [r.key, r.value ?? ""]),
    );
    const zones = await c.query("select id, name, description, fee::text, active, sort_order from store_delivery_zones order by sort_order, name");
    const pickup = await c.query(
      `select p.id, p.branch_id, b.name as branch_name, p.label, p.address, p.hours, p.active
         from store_pickup_points p join branches b on b.id = p.branch_id order by p.sort_order, p.label`,
    );
    const branches = await c.query("select id, name from branches where active order by name");
    const qr = await c.query("select 1 from store_assets where key = 'payment_qr'");
    const counts = await c.query<{ published: number; ready: number }>(
      `select (count(*) filter (where published_online))::int as published,
              (count(*) filter (where not published_online and active and base_sale_price > 0
                and exists (select 1 from variants v where v.model_id = models.id and v.active)))::int as ready
         from models`,
    );
    return {
      settings: {
        open: settings.store_open === "true",
        whatsapp: settings.store_whatsapp ?? "",
        branchId: settings.store_branch_id ?? "",
        bankInstructions: settings.store_bank_instructions ?? "",
        policyExchange: settings.store_policy_exchange ?? "",
        policyShipping: settings.store_policy_shipping ?? "",
      },
      zones: zones.rows.map((r) => ({ id: r.id, name: r.name, description: r.description, fee: r.fee, active: r.active, sortOrder: r.sort_order })),
      pickup: pickup.rows.map((r) => ({ id: r.id, branchId: r.branch_id, branchName: r.branch_name, label: r.label, address: r.address, hours: r.hours, active: r.active })),
      branches: branches.rows.map((r) => ({ id: r.id, name: r.name })),
      hasQr: qr.rows.length > 0,
      published: counts.rows[0].published,
      readyToPublish: counts.rows[0].ready,
    };
  });
}

export interface ModelPhoto { readonly id: string; readonly colorId: string | null; readonly colorName: string | null; readonly position: number; readonly alt: string | null; readonly width: number; readonly height: number }

export async function listModelPhotos(session: SessionPayload, modelId: string): Promise<ModelPhoto[]> {
  const { rows } = await withUser(session, (c) =>
    c.query(
      `select i.id, i.color_id, co.name as color_name, i.position, i.alt, i.thumb_width, i.thumb_height
         from model_images i left join colors co on co.id = i.color_id
        where i.model_id = $1 order by i.position, i.created_at`,
      [modelId],
    ),
  );
  return rows.map((r) => ({ id: r.id, colorId: r.color_id, colorName: r.color_name, position: r.position, alt: r.alt, width: r.thumb_width, height: r.thumb_height }));
}

export async function getAdminThumb(session: SessionPayload, id: string): Promise<{ bytes: Buffer; etag: string } | null> {
  const { rows } = await withUser(session, (c) => c.query<{ bytes: Buffer; etag: string }>("select thumb_bytes as bytes, etag || 't' as etag from model_images where id = $1", [id]));
  return rows[0] ?? null;
}

export async function listModelColors(session: SessionPayload, modelId: string): Promise<{ id: string; name: string }[]> {
  const { rows } = await withUser(session, (c) =>
    c.query<{ id: string; name: string }>(
      "select distinct c.id, c.name from variants v join colors c on c.id = v.color_id where v.model_id = $1 order by c.name",
      [modelId],
    ),
  );
  return rows;
}
