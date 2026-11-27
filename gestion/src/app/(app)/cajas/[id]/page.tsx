import type { Metadata } from "next";
import { requireRole } from "@/lib/auth/guards";
import { CashDetailPage } from "@/features/cash/ui/CashDetailPage";

export const metadata: Metadata = { title: "Detalle de caja" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  await requireRole("superadmin");
  return <CashDetailPage rawId={(await params).id} backHref="/cajas" backLabel="Volver a las cajas" />;
}
