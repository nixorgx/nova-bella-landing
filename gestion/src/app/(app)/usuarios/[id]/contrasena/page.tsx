import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { PageHead } from "@/components/ui/PageHead";
import { requireRole } from "@/lib/auth/guards";
import { CHANGE_PASSWORD_PATH } from "@/lib/auth/routes";
import { ResetPasswordForm } from "@/features/users/ResetPasswordForm";
import { listUsers } from "@/features/users/queries";

export const metadata: Metadata = { title: "Restablecer contraseña" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ResetPasswordPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireRole("superadmin");
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  if (id === actor.id) redirect(CHANGE_PASSWORD_PATH);
  const target = (await listUsers(actor)).find((user) => user.id === id);
  if (!target) notFound();

  return (
    <div className="page page--narrow">
      <PageHead
        eyebrow="Usuarios"
        title="Restablecer contraseña"
        description={`Cuenta: ${target.username} · ${target.fullName}. Sus sesiones abiertas se cerrarán.`}
      />
      <section className="panel" aria-labelledby="reset-title">
        <div className="panel__head">
          <h2 id="reset-title">Clave para la persona</h2>
        </div>
        <div className="panel__body">
          <ResetPasswordForm userId={target.id} username={target.username} />
        </div>
      </section>
    </div>
  );
}
