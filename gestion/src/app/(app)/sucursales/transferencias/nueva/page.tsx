import type { Metadata } from "next";
import { PageHead } from "@/components/ui/PageHead";
import { requireRole, toSession } from "@/lib/auth/guards";
import { listBranchOptions } from "@/features/branches/queries";
import { TransferForm } from "@/features/transfers/ui/TransferForm";

export const metadata: Metadata = { title: "Nueva transferencia" };

export default async function NewTransferPage() {
  const user = await requireRole("superadmin");
  const branches = await listBranchOptions(toSession(user));
  return (
    <div className="page page--wide">
      <PageHead
        eyebrow="Sucursales"
        title="Nueva transferencia"
        description="Mueva pares de una sucursal a otra. El stock sale y entra en una sola operación; si algo falla, no se mueve nada."
      />
      <TransferForm branches={branches.map(({ id, name }) => ({ id, name }))} />
    </div>
  );
}
