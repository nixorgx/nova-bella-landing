import { AppShell } from "@/components/shell/AppShell";
import "@/styles/shell.css";
import "@/styles/catalog.css";
import "@/styles/labels.css";
import "@/styles/purchases.css";
import "@/styles/pos.css";
import "@/styles/ticket.css";
import "@/styles/charts.css";
import "@/styles/reports.css";
import "@/styles/exchange.css";
import "@/styles/orders.css";

// No Suspense fallback around the shell on purpose: with a fallback the browser first paints
// "Cargando…" and the real page (the LCP element) only appears after the streamed chunk and the
// JS that swaps it in run, which under throttling pushed LCP to ~2.8 s. Sending the finished
// document at once is both faster to the LCP and simpler. Slow sections keep their own loading.tsx.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
