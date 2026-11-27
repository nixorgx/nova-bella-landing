import path from "node:path";
import type { NextConfig } from "next";
import { strictTransportSecurity } from "./src/lib/security/csp";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // camera is allowed for same-origin barcode scanning (later phases)
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
];

const hsts = strictTransportSecurity(process.env.NODE_ENV === "production");
if (hsts) securityHeaders.push({ key: "Strict-Transport-Security", value: hsts });

// The Content-Security-Policy is per request (nonce) and therefore lives in src/proxy.ts.
const nextConfig: NextConfig = {
  // Cache Components / partial prerendering are OFF on purpose: a nonce-based CSP needs every
  // document rendered per request (a prerendered static shell cannot carry a per-request
  // nonce, see node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md).
  // Nothing here used `use cache`: every page depends on the signed-in user.
  poweredByHeader: false,
  experimental: {
    // Image uploads (payment proofs, product photos, the QR) are server actions: the default 1 MB would reject a phone
    // photo. 4.4 MB leaves room for the multipart overhead of a 4 MB file and stays under Vercel's 4.5 MB request cap.
    serverActions: { bodySizeLimit: "4.4mb" },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  turbopack: {
    root: path.resolve(__dirname),
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
