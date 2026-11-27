import path from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { config as loadDotenv } from "dotenv";

// Specs reach the database directly for a few assertions (owner login, tests only).
loadDotenv({ path: path.join(__dirname, ".env.local"), quiet: true });

const port = Number(process.env.E2E_PORT ?? 3100);

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: { baseURL: `http://localhost:${port}`, trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] }, testIgnore: /\.mobile\.spec\.ts/ },
    // `*.mobile.spec.ts` (store buyer journeys) and the old responsive sweep run on a phone profile
    { name: "mobile", use: { ...devices["Pixel 7"] }, testMatch: /(responsive|\.mobile)\.spec\.ts/ },
  ],
  webServer: {
    command: `npm run start -- -p ${port}`,
    url: `http://localhost:${port}/login`,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
