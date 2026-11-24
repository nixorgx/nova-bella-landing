import type { Metadata } from "next";
import { PageHead } from "@/components/ui/PageHead";
import { requireRole, toSession } from "@/lib/auth/guards";
import { todayKey } from "@/lib/format";
import { listBranchOptions } from "@/features/branches/queries";
import { listSuppliers } from "@/features/purchases/batches";
import { getLatestRate } from "@/features/purchases/rates";
import { PurchaseForm } from "@/features/purchases/ui/PurchaseForm";

export const metadata: Metadata = { title: "Nuevo lote" };

export default async function NewBatchPage() {
  const user = await requireRole("superadmin");
  const session = toSession(user);
  const [branches, suppliers, latestRate] = await Promise.all([
    listBranchOptions(session),
    listSuppliers(session),
    getLatestRate(session),
  ]);
  return (
    <div className="page page--wide">
      <PageHead
        eyebrow="Ingreso de mercadería"
        title="Nuevo lote"
        description="Escanee los productos, cargue cantidad y costo en USD: el costo en Bs se calcula al instante."
      />
      <PurchaseForm
        branches={branches.map((b) => ({ id: b.id, name: b.name }))}
        suppliers={suppliers}
        latestRate={latestRate}
        today={todayKey()}
      />
    </div>
  );
}
