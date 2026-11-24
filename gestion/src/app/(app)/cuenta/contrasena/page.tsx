import type { Metadata } from "next";
import { PageHead } from "@/components/ui/PageHead";
import { requireSessionUser } from "@/lib/auth/guards";
import { ChangePasswordForm } from "@/features/account/ChangePasswordForm";

export const metadata: Metadata = { title: "Cambiar mi contraseña" };

export default async function ChangePasswordPage() {
  const user = await requireSessionUser();
  return (
    <div className="page page--narrow">
      <PageHead
        eyebrow="Mi cuenta"
        title="Cambiar mi contraseña"
        description={`Cuenta de ${user.fullName}. Necesita su contraseña actual para confirmar que es usted.`}
      />
      {user.mustChangePassword ? (
        <p className="notice notice--warn" role="status">
          Una administradora le asignó una contraseña temporal. Elija una nueva para seguir usando el sistema.
        </p>
      ) : null}
      <section className="panel" aria-labelledby="change-title">
        <div className="panel__head">
          <h2 id="change-title">Elija una clave nueva</h2>
        </div>
        <div className="panel__body">
          <ChangePasswordForm username={user.username} />
        </div>
      </section>
      <section className="panel" aria-labelledby="change-notes">
        <div className="panel__head">
          <h2 id="change-notes">Qué pasa al cambiarla</h2>
        </div>
        <div className="panel__body">
          <ul className="plain-list plain-list--notes">
            <li>Las sesiones abiertas en otros aparatos se cierran; esta sigue activa.</li>
            <li>La contraseña nueva debe ser distinta de la actual y tener 12 caracteres o más.</li>
            <li>Si la olvida, {user.role === "superadmin" ? "la administración técnica puede restablecerla con el comando documentado." : "pida a la administradora que la restablezca desde Usuarios."}</li>
          </ul>
        </div>
      </section>
    </div>
  );
}
