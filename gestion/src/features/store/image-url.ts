/** Client-safe URL builder for store images (public-data.ts pulls in the database driver). */
export function imageUrl(id: string, size: "thumb" | "full" = "full"): string {
  return `/tienda/img/${id}${size === "thumb" ? "?t=1" : ""}`;
}
