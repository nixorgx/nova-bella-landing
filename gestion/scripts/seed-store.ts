import { createHash, randomBytes } from "node:crypto";
import QRCode from "qrcode";
import sharp from "sharp";
import { Client } from "pg";
import { applyUserContext } from "../src/lib/db-context";
import { getOrderTokenSecret } from "../src/lib/env";
import { processProductImage, processProof, processQr } from "../src/features/store/images";
import { deriveOrderToken, hashOrderToken } from "../src/features/store/order-token";
import { say } from "./lib/log";

/**
 * Demo data for the online store (Etapa 2): published models with ABSTRACT generated pictures (soft color
 * blocks with the model name, clearly marked "Imagen demostrativa": they do not pretend to be photographs),
 * delivery zones, a pickup point, a placeholder payment QR marked DEMO and orders in every state, created
 * through the real functions. Demo only: `db:bootstrap` (production) never calls this. SEED_STORE=false skips it.
 * Idempotent: images/settings are repaired, orders are created once.
 */
type Row<T> = { rows: T[] };

const PUBLISHED = ["Alba", "Illimani", "Urbano", "Altiplano", "Colegial", "Wawa"];
const DEMO_WHATSAPP = "59170000000";
const FONT = "Georgia, 'Times New Roman', serif";

function withDatabase(raw: string | undefined, adminUrl: string, name: string): string {
  if (!raw) throw new Error(`Falta ${name} (necesaria para sembrar la tienda).`);
  const url = new URL(raw);
  url.pathname = new URL(adminUrl).pathname;
  return url.toString();
}

function shade(hex: string, factor: number): string {
  const n = parseInt(hex.slice(1), 16);
  const channel = (shift: number) => {
    const value = (n >> shift) & 255;
    const mixed = factor >= 0 ? value + (255 - value) * factor : value * (1 + factor);
    return Math.max(0, Math.min(255, Math.round(mixed)));
  };
  return `#${[16, 8, 0].map((s) => channel(s).toString(16).padStart(2, "0")).join("")}`;
}

const escapeXml = (text: string) => text.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Four abstract compositions (arch, orbs, split, stack) rotated per model; color per variant. */
function artwork(model: string, line: string, colorName: string | null, hex: string, variant: number): string {
  const base = shade(hex, 0.78);
  const mid = shade(hex, 0.35);
  const deep = shade(hex, -0.25);
  const W = 900;
  const H = 1125;
  const shapes = [
    `<rect width="${W}" height="${H}" fill="${base}"/>
     <path d="M170 900V470a280 280 0 0 1 560 0v430Z" fill="${hex}"/>
     <path d="M250 900V490a200 200 0 0 1 400 0v410Z" fill="${mid}" opacity=".7"/>
     <circle cx="690" cy="250" r="78" fill="#b99256" opacity=".9"/>
     <rect x="0" y="900" width="${W}" height="${H - 900}" fill="${deep}" opacity=".18"/>`,
    `<rect width="${W}" height="${H}" fill="${base}"/>
     <circle cx="330" cy="470" r="260" fill="${hex}"/>
     <circle cx="560" cy="600" r="210" fill="${mid}" opacity=".75"/>
     <circle cx="640" cy="260" r="64" fill="#b99256" opacity=".9"/>
     <rect y="860" width="${W}" height="3" fill="${deep}" opacity=".35"/>`,
    `<rect width="${W}" height="${H}" fill="${base}"/>
     <polygon points="0,0 ${W},0 0,720" fill="${mid}" opacity=".8"/>
     <rect x="150" y="360" width="600" height="440" rx="36" fill="${hex}"/>
     <rect x="150" y="690" width="600" height="110" rx="0" fill="${deep}" opacity=".35"/>
     <circle cx="700" cy="230" r="60" fill="#b99256" opacity=".9"/>`,
    `<rect width="${W}" height="${H}" fill="${base}"/>
     <rect x="130" y="300" width="640" height="150" rx="75" fill="${hex}"/>
     <rect x="200" y="480" width="560" height="150" rx="75" fill="${mid}"/>
     <rect x="100" y="660" width="600" height="150" rx="75" fill="${deep}" opacity=".75"/>
     <circle cx="720" cy="200" r="58" fill="#b99256" opacity=".9"/>`,
  ];
  const label = colorName ? `${colorName}` : line;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    ${shapes[variant % shapes.length]}
    <text x="70" y="975" font-family="${FONT}" font-size="86" font-weight="700" fill="#2a1722">${escapeXml(model)}</text>
    <text x="74" y="1030" font-family="${FONT}" font-size="34" fill="#2a1722" opacity=".78">${escapeXml(label)}</text>
    <text x="74" y="1085" font-family="Arial, Helvetica, sans-serif" font-size="22" letter-spacing="3" fill="#2a1722" opacity=".6">IMAGEN DEMOSTRATIVA</text>
  </svg>`;
}

async function renderArtwork(svg: string): Promise<Buffer> {
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function seedImages(client: Client): Promise<void> {
  const models = (await client.query(
    "select id, name, (select name from product_lines l where l.id = m.line_id) as line from models m where name = any($1::text[]) order by name",
    [PUBLISHED],
  )) as Row<{ id: string; name: string; line: string }>;
  const admin = (await client.query("select id from users where role = 'superadmin' limit 1")) as Row<{ id: string }>;
  let index = 0;
  for (const model of models.rows) {
    index += 1;
    const have = (await client.query("select count(*)::int as n from model_images where model_id = $1", [model.id])) as Row<{ n: number }>;
    if (have.rows[0].n > 0) continue;
    const colors = (await client.query(
      `select distinct c.id, c.name, c.hex from variants v join colors c on c.id = v.color_id
        where v.model_id = $1 order by c.name`,
      [model.id],
    )) as Row<{ id: string; name: string; hex: string | null }>;
    const plan = [
      { colorId: null as string | null, colorName: null as string | null, hex: colors.rows[0]?.hex ?? "#d98aa3" },
      ...colors.rows.map((c) => ({ colorId: c.id, colorName: c.name, hex: c.hex ?? "#d98aa3" })),
    ];
    let position = 0;
    for (const item of plan) {
      const set = await processProductImage(await renderArtwork(artwork(model.name, model.line, item.colorName, item.hex, index + position)));
      await client.query(
        `insert into model_images (model_id, color_id, position, alt, full_bytes, full_width, full_height,
           thumb_bytes, thumb_width, thumb_height, etag, created_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          model.id, item.colorId, position,
          `${model.name}${item.colorName ? `, ${item.colorName}` : ""} (imagen demostrativa)`,
          set.full.bytes, set.full.width, set.full.height, set.thumb.bytes, set.thumb.width, set.thumb.height, set.etag, admin.rows[0]?.id ?? null,
        ],
      );
      position += 1;
    }
  }
}

async function seedQr(client: Client): Promise<void> {
  const exists = (await client.query("select 1 from store_assets where key = 'payment_qr'")) as Row<unknown>;
  if (exists.rows.length > 0) return;
  const qr = await QRCode.toBuffer("DEMO NovaBella - QR de demostracion, NO es un pago real", { width: 520, margin: 2, errorCorrectionLevel: "M" });
  const label = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="720">
    <rect width="640" height="720" fill="#fff"/>
    <text x="320" y="64" text-anchor="middle" font-family="${FONT}" font-size="40" font-weight="700" fill="#6e2447">NovaBella · QR DEMO</text>
    <text x="320" y="672" text-anchor="middle" font-family="Arial, sans-serif" font-size="24" fill="#a1232d">NO ES UN QR DE PAGO REAL</text>
  </svg>`);
  const canvas = await sharp(label).composite([{ input: qr, left: 60, top: 100 }]).png().toBuffer();
  const processed = await processQr(canvas);
  await client.query(
    "insert into store_assets (key, bytes, etag) values ('payment_qr', $1, $2) on conflict (key) do nothing",
    [processed.image.bytes, processed.etag],
  );
}

async function seedSettings(client: Client): Promise<void> {
  const branch = (await client.query("select id from branches where active order by created_at limit 1")) as Row<{ id: string }>;
  const set = (key: string, value: string) =>
    client.query("insert into app_settings (key, value) values ($1, $2) on conflict (key) do update set value = excluded.value, updated_at = now()", [key, value]);
  await client.query("update models set published_online = true where name = any($1::text[])", [PUBLISHED]);
  await set("store_open", "true");
  await set("store_whatsapp", DEMO_WHATSAPP);
  if (branch.rows[0]) await set("store_branch_id", branch.rows[0].id);
  await set("store_bank_instructions", "DEMO · Banco de ejemplo, cuenta 000-000000-0 a nombre de NovaBella. Este QR es de demostración: no realice ningún pago.");
  await set("store_policy_exchange", "Cambios de talla o modelo dentro de los 7 días, con el producto sin uso y su comprobante.");
  await set("store_policy_shipping", "Entregas en 24 a 48 horas hábiles dentro de la ciudad. El recojo en tienda es gratis.");
  const zones: ReadonlyArray<readonly [string, string, number, number]> = [
    ["Santa Cruz · ciudad", "Dentro del segundo anillo y alrededores", 15, 1],
    ["Santa Cruz · provincias", "Warnes, Cotoca, La Guardia y similares", 35, 2],
    ["Otros departamentos", "Envío por transporte; coordinamos por WhatsApp", 60, 3],
  ];
  for (const [name, description, fee, order] of zones) {
    await client.query(
      "insert into store_delivery_zones (name, description, fee, sort_order) values ($1, $2, $3, $4) on conflict ((lower(name))) do nothing",
      [name, description, fee, order],
    );
  }
  if (branch.rows[0]) {
    await client.query(
      `insert into store_pickup_points (branch_id, label, address, hours) values ($1, 'Tienda Central', 'Av. Demo 123, Santa Cruz', 'Lun a Sáb 10:00 a 19:00')
       on conflict (branch_id) do nothing`,
      [branch.rows[0].id],
    );
  }
}

interface DemoOrder {
  readonly key: string;
  readonly name: string;
  readonly phone: string;
  readonly payment: "qr" | "contra_entrega";
  readonly fulfillment: "delivery" | "pickup";
  readonly invoice?: boolean;
  readonly lines: number;
  /** What the team did with it afterwards. */
  readonly final: "pendiente" | "revision" | "confirmado" | "en_camino" | "listo" | "entregado" | "cancelado";
}

const ORDERS: readonly DemoOrder[] = [
  { key: "seed-demo-pending-0001", name: "Lucía Antelo", phone: "70011001", payment: "qr", fulfillment: "delivery", lines: 1, final: "pendiente" },
  { key: "seed-demo-review-00002", name: "Rosa Vargas", phone: "70011002", payment: "qr", fulfillment: "delivery", lines: 2, final: "revision" },
  { key: "seed-demo-confirm-0003", name: "Camila Rojas", phone: "70011003", payment: "qr", fulfillment: "pickup", invoice: true, lines: 1, final: "confirmado" },
  { key: "seed-demo-shipping-004", name: "Daniela Suárez", phone: "70011004", payment: "contra_entrega", fulfillment: "delivery", lines: 2, final: "en_camino" },
  { key: "seed-demo-ready-000005", name: "Andrea Montaño", phone: "70011005", payment: "contra_entrega", fulfillment: "pickup", lines: 1, final: "listo" },
  { key: "seed-demo-done-0000006", name: "Valeria Peña", phone: "70011006", payment: "qr", fulfillment: "delivery", lines: 1, final: "entregado" },
  { key: "seed-demo-cancel-00007", name: "Sofía Cuéllar", phone: "70011007", payment: "qr", fulfillment: "delivery", lines: 1, final: "cancelado" },
];

async function seedOrders(adminUrl: string, owner: Client): Promise<void> {
  const existing = (await owner.query("select count(*)::int as n from web_orders")) as Row<{ n: number }>;
  if (existing.rows[0].n > 0) return;
  const admin = (await owner.query("select id from users where role = 'superadmin' limit 1")) as Row<{ id: string }>;
  const zone = (await owner.query("select id from store_delivery_zones order by sort_order limit 1")) as Row<{ id: string }>;
  const pickup = (await owner.query("select id from store_pickup_points limit 1")) as Row<{ id: string }>;
  const variants = (await owner.query(
    `select v.id from variants v join models m on m.id = v.model_id
       join stock_levels sl on sl.variant_id = v.id
      where m.published_online and v.active and sl.qty >= 4 order by v.sku limit 16`,
  )) as Row<{ id: string }>;
  if (!zone.rows[0] || !pickup.rows[0] || variants.rows.length < 8 || !admin.rows[0]) return;

  const pub = new Client({ connectionString: withDatabase(process.env.DATABASE_URL_PUBLIC, adminUrl, "DATABASE_URL_PUBLIC") });
  const sup = new Client({ connectionString: withDatabase(process.env.DATABASE_URL_SUPERADMIN, adminUrl, "DATABASE_URL_SUPERADMIN") });
  await pub.connect();
  await sup.connect();
  try {
    let cursor = 0;
    for (const demo of ORDERS) {
      const items = Array.from({ length: demo.lines }, () => ({ variant_id: variants.rows[cursor++ % variants.rows.length].id, qty: 1 }));
      // Fixed keys make the demo links reproducible for local e2e; SEED_STORE_RANDOM_KEYS=true (deployed demos) appends
      // randomness so nobody who read this repository can open the demo orders.
      const key = process.env.SEED_STORE_RANDOM_KEYS === "true" ? `${demo.key}-${randomBytes(12).toString("hex")}` : demo.key;
      const token = deriveOrderToken(key, getOrderTokenSecret());
      const payload = {
        idempotency_key: createHash("sha256").update(key).digest("hex"),
        name: demo.name,
        phone: demo.phone,
        email: "",
        payment_method: demo.payment,
        fulfillment: demo.fulfillment,
        zone_id: demo.fulfillment === "delivery" ? zone.rows[0].id : "",
        address: demo.fulfillment === "delivery" ? "Calle Demo 45, Barrio Jardín" : "",
        reference: demo.fulfillment === "delivery" ? "Portón verde, frente a la farmacia" : "",
        pickup_id: demo.fulfillment === "pickup" ? pickup.rows[0].id : "",
        wants_invoice: String(Boolean(demo.invoice)),
        invoice_nit: demo.invoice ? "1020304050" : "",
        invoice_name: demo.invoice ? demo.name : "",
        notes: "",
        items,
      };
      const created = (await pub.query("select * from public_create_order($1::jsonb, $2)", [JSON.stringify(payload), hashOrderToken(token)])) as Row<{ order_code: string }>;
      const code = created.rows[0].order_code;
      const order = (await owner.query("select id, total from web_orders where code = $1", [code])) as Row<{ id: string; total: string }>;
      const orderId = order.rows[0].id;

      if (demo.payment === "qr" && demo.final !== "pendiente" && demo.final !== "cancelado") {
        const proof = await processProof(
          await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="720" height="960"><rect width="720" height="960" fill="#fafafa"/>
            <text x="360" y="150" text-anchor="middle" font-family="Arial" font-size="40" font-weight="700" fill="#333">COMPROBANTE DEMO</text>
            <text x="360" y="260" text-anchor="middle" font-family="Arial" font-size="30" fill="#555">Pedido ${code}</text>
            <text x="360" y="380" text-anchor="middle" font-family="Arial" font-size="64" font-weight="700" fill="#111">Bs ${order.rows[0].total}</text>
            <text x="360" y="480" text-anchor="middle" font-family="Arial" font-size="26" fill="#777">Imagen de demostración</text></svg>`)).png().toBuffer(),
        );
        await pub.query("select public_order_attach_proof($1, $2, $3, $4)", [hashOrderToken(token), proof.image.bytes, proof.etag, "DEMO-0001234"]);
      }

      if (demo.final === "pendiente" || demo.final === "revision") continue;
      await sup.query("begin");
      try {
        await applyUserContext(sup, { userId: admin.rows[0].id, role: "superadmin", branchId: null });
        if (demo.final === "cancelado") {
          await sup.query("select web_order_cancel($1, $2)", [orderId, "El cliente no pagó a tiempo (demo)"]);
        } else {
          await sup.query("select web_order_confirm($1)", [orderId]);
          if (demo.final === "en_camino") await sup.query("select web_order_set_status($1, 'en_camino')", [orderId]);
          if (demo.final === "listo") await sup.query("select web_order_set_status($1, 'listo_para_recoger')", [orderId]);
          if (demo.final === "entregado") {
            await sup.query("select web_order_set_status($1, 'en_camino')", [orderId]);
            await sup.query("select web_order_set_status($1, 'entregado')", [orderId]);
          }
        }
        await sup.query("commit");
      } catch (error) {
        await sup.query("rollback").catch(() => undefined);
        throw error;
      }
    }
  } finally {
    await pub.end();
    await sup.end();
  }
}

export async function seedStore(adminUrl: string, owner: Client): Promise<void> {
  if (process.env.SEED_STORE === "false") return;
  await seedSettings(owner);
  await seedImages(owner);
  await seedQr(owner);
  await seedOrders(adminUrl, owner);
  say(`seed tienda lista: modelos publicados con imágenes demostrativas, zonas, QR DEMO y pedidos en cada estado.`);
}
