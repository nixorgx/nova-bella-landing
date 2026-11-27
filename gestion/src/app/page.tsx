import { redirect } from "next/navigation";
import { LANDING_URL } from "@/lib/landing-links";

/** Fallback for environments where the proxy is not applied. */
export default function Home() {
  redirect(LANDING_URL);
}
