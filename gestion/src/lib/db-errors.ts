/** Postgres error shape we care about. */
interface PgLikeError {
  readonly code?: string;
  readonly message?: string;
  readonly constraint?: string;
}

const GENERIC_MESSAGE = "Ocurrio un error inesperado. Intente nuevamente.";

function asPgError(error: unknown): PgLikeError {
  return typeof error === "object" && error !== null ? (error as PgLikeError) : {};
}

/** True for errors raised on purpose by our RPC functions (SQLSTATE class 'IN'). */
export function isDomainError(error: unknown): boolean {
  return /^IN\d{3}$/.test(asPgError(error).code ?? "");
}

/** Maps any database error to a Spanish message that is safe to show to the user. */
export function friendlyDbMessage(error: unknown): string {
  const pg = asPgError(error);
  if (isDomainError(error) && pg.message) return pg.message;
  switch (pg.code) {
    case "23505":
      return "Ya existe un registro con esos datos.";
    case "23503":
      return "El registro esta relacionado con otros datos.";
    case "23514":
      return "Alguno de los valores no es valido.";
    case "42501":
      return "No tiene permiso para realizar esta operacion.";
    case "22P02":
      return "Alguno de los valores tiene un formato invalido.";
    default:
      return GENERIC_MESSAGE;
  }
}
