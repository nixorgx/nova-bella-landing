import type { Metadata } from "next";
import { CashDetailPage } from "@/features/cash/ui/CashDetailPage";

export const metadata: Metadata = { title: "Detalle de caja" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <CashDetailPage rawId={(await params).id} backHref="/ventas/caja" backLabel="Volver a mi caja" />;
}
