import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_APP_CONFIG,
  normalizeAppConfig
} from "../functions/lib/app-config.js";

function config() {
  return JSON.parse(JSON.stringify(DEFAULT_APP_CONFIG));
}

test("remote config aceita estado operacional padrão", () => {
  const normalized = normalizeAppConfig(config());
  assert.equal(normalized.schema_version, 1);
  assert.equal(normalized.revision, 10);
  assert.equal(normalized.poll_seconds, 30);
  assert.equal(normalized.maintenance.enabled, false);
  assert.equal(normalized.navigation.admins, true);
  assert.equal(normalized.features.orders_manual_create, true);
});

test("remote config normaliza tema, tom e ordem", () => {
  const input = config();
  input.theme = " DARK ";
  input.dashboard_banner.tone = " WARNING ";
  input.dashboard_section_order = [" ATTENTION ", "metrics", "flavors", "receivables", "recent_orders"];

  const normalized = normalizeAppConfig(input, 27);
  assert.equal(normalized.revision, 27);
  assert.equal(normalized.theme, "dark");
  assert.equal(normalized.dashboard_banner.tone, "warning");
  assert.deepEqual(normalized.dashboard_section_order, [
    "attention",
    "metrics",
    "flavors",
    "receivables",
    "recent_orders"
  ]);
});

test("remote config impede esconder toda a navegação", () => {
  const input = config();
  for (const key of Object.keys(input.navigation)) input.navigation[key] = false;
  assert.throws(() => normalizeAppConfig(input), /pelo menos uma seção/i);
});

test("remote config rejeita ordem de dashboard duplicada", () => {
  const input = config();
  input.dashboard_section_order = ["metrics", "metrics", "flavors", "receivables", "attention"];
  assert.throws(() => normalizeAppConfig(input), /ordem das seções/i);
});

test("remote config limita frequência de polling em produção", () => {
  const input = config();
  input.poll_seconds = 5;
  assert.throws(() => normalizeAppConfig(input), /intervalo de atualização/i);
});
