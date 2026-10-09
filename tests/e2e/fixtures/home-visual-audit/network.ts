import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import type { BrowserContext, Route } from "@playwright/test";

export const AUDIT_ORIGIN = "http://127.0.0.1:5173";
export const FIXTURE_VERSION = "home-visual-audit-v1";
const fontFiles = ["fraunces.ttf", "fraunces-italic.ttf", "manrope.ttf"];
const repoRoot = new URL("../../../../", import.meta.url);
const fonts = new Map(
  fontFiles.map(name => [name, readFileSync(new URL(`./fonts/${name}`, import.meta.url))])
);
const images = ["hero-cake.webp", "story-image.webp"].map(name =>
  readFileSync(new URL(`../../../../public/images/${name}`, import.meta.url))
);
const fontCss = fontFiles
  .map(
    (name, index) =>
      `@font-face {font-family:'${index === 2 ? "Manrope" : "Fraunces"}';
    font-style:${index === 1 ? "italic" : "normal"}; font-weight:${index === 2 ? "200 800" : "100 900"};
    src:url('${AUDIT_ORIGIN}/__audit/fonts/${name}') format('truetype'); font-display:block;}`
  )
  .join("\n");

export const fixtureHashes = [
  ...fonts,
  ...images.map((bytes, i) => [`image-${i}`, bytes] as const)
].map(([name, bytes]) => ({ name, sha256: createHash("sha256").update(bytes).digest("hex") }));

export const products = Array.from({ length: 5 }, (_, index) => ({
  id: index + 1,
  nome: `Audit product ${index + 1}`,
  categoria: "bolos",
  categoria_nome: "Bolos",
  descricao: "Synthetic audit fixture",
  preco_centavos: 1500,
  destaque: 0,
  ordem: index,
  estoque: 10,
  estoque_reservado: 0,
  image_key: `audit-${index}`
}));

const config = {
  days: ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"].map((label, index) => ({
    label,
    active: index > 0 && index < 6
  })),
  openTime: "09:00",
  closeTime: "20:00",
  localName: "Audit Salon",
  address: "Synthetic address 123, Campinas",
  mapsLink: "https://example.invalid/audit-map",
  deliveryStatus: "unavailable",
  whatsapp: "(11) 99999-0000",
  defaultMessage: "Synthetic audit message"
};

export type AuditRequest = {
  method: string;
  url: string;
  action: "mocked" | "local-asset" | "blocked";
};

export async function fulfillLocalAsset(
  route: Route,
  record: (action: AuditRequest["action"]) => void
) {
  // Browser redirects after continue() bypass routing; inspect the response without following them.
  const response = await route.fetch({ maxRedirects: 0, maxRetries: 0 });
  if (response.status() >= 300 && response.status() < 400) {
    record("blocked");
    return route.abort("blockedbyclient");
  }
  record("local-asset");
  await route.fulfill({ response });
}

export async function isolateHomeAudit(context: BrowserContext) {
  const requests: AuditRequest[] = [];
  // HMR sockets have no role in a static visual audit; never connect them to a server.
  await context.routeWebSocket("**/*", socket => {
    const url = new URL(socket.url());
    const isHmr = url.origin === AUDIT_ORIGIN.replace("http:", "ws:") && url.pathname === "/";
    requests.push({ method: "WEBSOCKET", url: url.href, action: isHmr ? "mocked" : "blocked" });
    socket.close();
  });
  await context.route("**/*", async route => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const record = (action: AuditRequest["action"]) =>
      requests.push({ method, url: url.href, action });
    const mock = async (options: Parameters<typeof route.fulfill>[0]) => {
      record("mocked");
      await route.fulfill(options);
    };
    if (
      request.isNavigationRequest() &&
      (method !== "GET" || url.origin !== AUDIT_ORIGIN || url.pathname !== "/" || url.search)
    ) {
      record("blocked");
      return route.abort("blockedbyclient");
    }
    if (
      method === "GET" &&
      url.origin === "https://fonts.googleapis.com" &&
      url.pathname === "/css2"
    ) {
      return mock({ contentType: "text/css", body: fontCss });
    }
    if (url.origin === AUDIT_ORIGIN && !url.search) {
      if (method === "POST" && url.pathname === "/api/reservas/reconciliar") {
        return mock({ json: { ok: true } });
      }
      if (method === "GET") {
        if (url.pathname === "/api/produtos") return mock({ json: { produtos: products } });
        if (url.pathname === "/api/config") return mock({ json: { config } });
        const image = url.pathname.match(/^\/api\/images\/audit-([0-4])$/);
        if (image) return mock({ contentType: "image/webp", body: images[Number(image[1]) % 2] });
        const font = fonts.get(url.pathname.replace(/^\/__audit\/fonts\//, ""));
        if (font && url.pathname.startsWith("/__audit/fonts/")) {
          return mock({ contentType: "font/ttf", body: font });
        }
      }
    }
    const isModule =
      /^\/(?:src|shared|node_modules\/\.vite\/deps)\/[\w./@-]+\.(?:tsx?|jsx?|css)$/.test(
        url.pathname
      ) && existsSync(new URL(`.${url.pathname}`, repoRoot));
    const isAsset = [
      "/",
      "/node_modules/vite/dist/client/env.mjs",
      "/favicon.svg",
      "/@vite/client",
      "/@react-refresh",
      "/images/hero-cake.webp",
      "/images/story-image.webp"
    ].includes(url.pathname);
    if (method === "GET" && url.origin === AUDIT_ORIGIN && (isModule || (isAsset && !url.search))) {
      return fulfillLocalAsset(route, record);
    }
    record("blocked");
    await route.abort("blockedbyclient");
  });
  return requests;
}
