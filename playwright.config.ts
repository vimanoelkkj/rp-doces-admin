import { defineConfig } from "@playwright/test";

// Portátil por padrão: sem CHROME_PATH, usa o Chromium instalado pelo
// próprio Playwright (funciona em clone limpo / CI Linux, sem depender do
// Chrome do Windows). Defina CHROME_PATH para rodar com o Chrome real:
//   $env:CHROME_PATH="C:\Program Files\Google\Chrome\Application\chrome.exe"
const CHROME_PATH = process.env.CHROME_PATH;

const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:5173";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 90_000,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [["html", { open: "never" }], ["list"]] : "list",

  use: {
    baseURL: BASE_URL,
    viewport: { width: 1440, height: 900 },
    reducedMotion: "no-preference",
    trace: "retain-on-failure",
    ...(CHROME_PATH ? { launchOptions: { executablePath: CHROME_PATH } } : {}),
  },

  // Sobe o Vite sozinho e espera responder antes dos testes. Localmente pode
  // reaproveitar um `npm run dev` já aberto; em CI sempre sobe um novo.
  webServer: {
    command: "npm run dev -- --host 127.0.0.1",
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
