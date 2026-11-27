import { redirect } from "next/navigation";
import { LANDING_CATALOG_URL } from "@/lib/landing-links";

/** The public catalog lives on the NovaBella landing; commerce subroutes stay here. */
export default function StoreHome() {
  redirect(LANDING_CATALOG_URL);
}
