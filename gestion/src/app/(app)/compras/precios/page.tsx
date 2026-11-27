import type { Metadata } from "next";
import Link from "next/link";
import { PageHead } from "@/components/ui/PageHead";
import { requireRole, toSession } from "@/lib/auth/guards";
import { one, type RawSearchParams } from "@/lib/search-params";
import { listModelCosts } from "@/features/purchases/model-costs";
import { getPricingSettings } from "@/features/settings/pricing-settings";
import { PriceSuggestions } from "@/features/purchases/ui/PriceSuggestions";
import { PricingSettingsForm } from "@/features/purchases/ui/PricingSettingsForm";

export const metadata: Metadata = { title: "Precios y margen" };

export default async function PricingPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const user = await requireRole("superadmin");
  const session = toSession(user);
  const onlyLow = one((await searchParams).bajo) === "1";
  const [models, settings] = await Promise.all([listModelCosts(session), getPricingSettings(session)]);

  return (
    <div className="page">
      <PageHead eyebrow="Ingreso de mercadería" title="Precios y margen" description="Compare el precio de cada modelo con su costo actual. Las sugerencias nunca se aplican solas." />
      <div className="users-layout">
        <section className="panel panel--cost" aria-labelledby="sugg-title">
          <div className="panel__head">
            <h2 id="sugg-title">Precio sugerido por modelo</h2>
            <Link href={onlyLow ? "/compras/precios" : "/compras/precios?bajo=1"} className="btn btn--small btn--quiet" aria-pressed={onlyLow}>
              {onlyLow ? "Ver todos" : "Solo bajo el margen"}
            </Link>
          </div>
          <PriceSuggestions models={models} targetMarginPct={settings.targetMarginPct} onlyBelowTarget={onlyLow} />
        </section>
        <section className="panel" aria-labelledby="policy-title">
          <div className="panel__head"><h2 id="policy-title">Políticas de precio</h2></div>
          <div className="panel__body">
            <PricingSettingsForm targetMarginPct={settings.targetMarginPct} maxDiscountPct={settings.maxDiscountPct} />
          </div>
        </section>
      </div>
    </div>
  );
}
