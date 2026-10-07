import assert from "node:assert/strict";
import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { experimental_readRawConfig } from "wrangler";

export const STAGING_D1_PLACEHOLDER = "STAGING_D1_ID_REPLACE_AFTER_CREATE";

export function readConfigs() {
  const read = config => experimental_readRawConfig({ config }).rawConfig;
  return {
    production: read("wrangler.toml"),
    productionWorker: read("wrangler.push.toml"),
    pages: read("wrangler.staging.toml"),
    worker: read("wrangler.push.staging.toml"),
    bootstrap: read("wrangler.push.staging.bootstrap.toml")
  };
}

// Local config only. No credentials, D1 requests or provisioning.
export function validateStaging(configs, { requireProvisioned = false, url } = {}) {
  const { production, productionWorker, pages, worker, bootstrap } = configs;
  assert.equal(pages.vars?.MP_TEST_MODE, "orders_pix");
  for (const config of [production, productionWorker]) {
    assert.equal(config.vars?.MP_TEST_MODE, undefined, "Production must not enable Pix test mode");
    for (const env of Object.values(config.env ?? {})) {
      assert.equal(
        env.vars?.MP_TEST_MODE,
        undefined,
        "Production environments must not enable Pix test mode"
      );
    }
  }
  const forbidden = new Set([
    production.name,
    productionWorker.name,
    production.d1_databases[0].database_name,
    production.d1_databases[0].database_id,
    production.r2_buckets[0].bucket_name,
    production.queues.producers[0].queue
  ]);
  const rejectProduction = value => {
    if (typeof value === "string")
      assert.ok(!forbidden.has(value), "Production resource is forbidden");
    else if (value && typeof value === "object") Object.values(value).forEach(rejectProduction);
  };
  for (const config of [pages, worker, bootstrap]) {
    rejectProduction(config);
    assert.equal(config.compatibility_date, production.compatibility_date);
    assert.deepEqual(config.compatibility_flags, production.compatibility_flags);
    assert.equal(config.env, undefined, "Staging must not inherit environment bindings");
  }
  assert.equal(pages.name, "rp-doces-staging");
  assert.equal(pages.pages_build_output_dir, production.pages_build_output_dir);
  assert.deepEqual(pages.queues, {
    producers: [{ binding: "PUSH_QUEUE", queue: "rp-doces-push-staging" }]
  });
  assert.deepEqual(pages.r2_buckets, [
    { binding: "PRODUCT_IMAGES", bucket_name: "rp-doces-images-staging" }
  ]);
  for (const config of [pages, worker]) {
    assert.equal(config.d1_databases.length, 1);
    const db = config.d1_databases[0];
    assert.equal(db.binding, "DB");
    assert.equal(db.database_name, "rp-doces-db-staging");
    assert.equal(db.migrations_dir, "migrations");
    assert.notEqual(
      db.database_id,
      production.d1_databases[0].database_id,
      "Production D1 is forbidden"
    );
    assert.ok(
      (!requireProvisioned && db.database_id === STAGING_D1_PLACEHOLDER) ||
        /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(db.database_id),
      "Provision staging D1 and replace its placeholder before deploying"
    );
  }
  assert.deepEqual(worker.d1_databases, pages.d1_databases);
  assert.equal(worker.name, "rp-doces-push-staging");
  assert.equal(worker.main, productionWorker.main);
  assert.equal(worker.workers_dev, false);
  assert.deepEqual(worker.queues, {
    consumers: [
      { queue: "rp-doces-push-staging", max_batch_size: 1, max_batch_timeout: 1, max_retries: 3 }
    ]
  });
  assert.deepEqual(worker.triggers, productionWorker.triggers);
  assert.equal(bootstrap.name, worker.name);
  assert.equal(bootstrap.main, "workers/push-bootstrap.ts");
  assert.equal(bootstrap.workers_dev, false);
  assert.deepEqual(bootstrap.triggers, { crons: [] });
  for (const field of ["d1_databases", "queues", "r2_buckets", "routes"]) {
    assert.equal(bootstrap[field], undefined, `Bootstrap must not have ${field}`);
  }
  if (url !== undefined) {
    const parsed = new URL(url);
    assert.equal(parsed.protocol, "https:");
    assert.ok(
      ["rp-doces-staging.pages.dev", "staging.rpdoces.com.br"].includes(parsed.hostname),
      "Staging smoke must never target production"
    );
    assert.equal(
      parsed.origin,
      url,
      "STAGING_URL must be an origin without credentials, path or query"
    );
  }
  return pages.d1_databases[0].database_id;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const databaseId = validateStaging(readConfigs(), {
    requireProvisioned: process.argv.includes("--require-provisioned"),
    url: process.env.STAGING_URL
  });
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `database_id=${databaseId}\n`);
  }
  console.log("Staging resource isolation verified.");
}
