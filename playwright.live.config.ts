import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e-live",
  workers: 1,
  retries: 0,
  forbidOnly: true,
  // Authenticated medical pages contain data: do not capture traces or screenshots.
  use: {
    baseURL: "http://127.0.0.1:5175",
    trace: "off",
    screenshot: "off",
    video: "off",
  },
  webServer: {
    command: "npm run dev -- --port 5175 --strictPort --mode backend",
    url: "http://127.0.0.1:5175",
    reuseExistingServer: false,
    env: {
      VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL ?? "",
      VITE_SUPABASE_ANON_KEY: process.env.VITE_SUPABASE_ANON_KEY ?? "",
    },
  },
});
