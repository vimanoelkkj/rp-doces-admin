import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { STAGING_D1_ID } from "./check-staging-config.mjs";

const ACCOUNT = "7d8a62a0e64b693184975560c7cb788d";
const PROJECT = "rp-doces-staging";

export function validateRemoteProject(project, { publishedSha } = {}) {
  assert.equal(project?.name, PROJECT);
  assert.equal(project?.production_branch, "staging");
  const config = project?.deployment_configs?.production;
  assert.deepEqual(Object.keys(config?.d1_databases ?? {}), ["DB"]);
  assert.equal(config.d1_databases.DB.id, STAGING_D1_ID);
  if (publishedSha) {
    assert.match(publishedSha, /^[0-9a-f]{40}$/);
    const active = project.canonical_deployment;
    assert.equal(active?.project_name, PROJECT);
    assert.equal(active?.environment, "production"); // Production slot of the staging project.
    assert.equal(active?.deployment_trigger?.metadata?.branch, "staging");
    assert.equal(active?.deployment_trigger?.metadata?.commit_hash, publishedSha);
    assert.equal(active?.latest_stage?.status, "success");
    assert.equal(active?.env_vars?.APP_ENV?.value, "staging");
    assert.equal(active?.env_vars?.MP_TEST_MODE?.value, "orders_pix");
  }
}

export async function verifyRemoteProject(env, fetcher = fetch) {
  assert.equal(env.CLOUDFLARE_ACCOUNT_ID, ACCOUNT);
  assert.equal(env.PAGES_PROJECT, PROJECT);
  assert.ok(env.CLOUDFLARE_API_TOKEN, "Staging Pages credential required");
  const response = await fetcher(
    `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/pages/projects/${PROJECT}`,
    {
      headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` },
      signal: AbortSignal.timeout(15000)
    }
  );
  assert.equal(response.status, 200, "Staging project read failed");
  const body = await response.json();
  assert.equal(body.success, true, "Staging project read unsuccessful");
  validateRemoteProject(body.result, { publishedSha: env.STAGING_PUBLISHED_SHA });
  // The API reports current project configuration, not an immutable deployment
  // binding snapshot. This is an operational gate, not runtime D1 attestation.
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    await verifyRemoteProject(process.env);
    console.log("Remote staging project D1 configuration verified (not runtime attestation).");
  } catch {
    // The project response may include secrets. Never print it or assertion details.
    console.error("STAGING_REMOTE_ISOLATION_UNVERIFIED: publication/smoke must stop.");
    process.exitCode = 1;
  }
}
