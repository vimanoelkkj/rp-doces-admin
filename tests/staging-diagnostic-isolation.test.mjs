import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { yaml } from "playwright-core/lib/utilsBundle";
import {
  validateRemoteProject,
  verifyRemoteProject
} from "../scripts/check-staging-deployment.mjs";
import { readConfigs, validateStaging, STAGING_D1_ID } from "../scripts/check-staging-config.mjs";

const sha = "a".repeat(40);
const project = () => ({
  name: "rp-doces-staging",
  production_branch: "staging",
  deployment_configs: { production: { d1_databases: { DB: { id: STAGING_D1_ID } } } },
  canonical_deployment: {
    project_name: "rp-doces-staging",
    environment: "production",
    deployment_trigger: { metadata: { branch: "staging", commit_hash: sha } },
    latest_stage: { status: "success" },
    env_vars: { APP_ENV: { value: "staging" }, MP_TEST_MODE: { value: "orders_pix" } }
  }
});

test("local config gate requires exact staging D1 and environment", () => {
  validateStaging(readConfigs(), { requireProvisioned: true });
  for (const mutate of [
    c => {
      c.pages.d1_databases[0].database_id = c.worker.d1_databases[0].database_id = "a".repeat(36);
    },
    c => {
      delete c.pages.vars.APP_ENV;
    },
    c => {
      c.pages.name = "other-staging";
    }
  ]) {
    const configs = readConfigs();
    mutate(configs);
    assert.throws(() => validateStaging(configs, { requireProvisioned: true }));
  }
});

test("remote project gate checks current binding, slot, branch and active SHA", () => {
  validateRemoteProject(project());
  validateRemoteProject(project(), { publishedSha: sha });
});

for (const [label, mutate] of [
  [
    "project",
    p => {
      p.name = "other";
    }
  ],
  [
    "destination branch",
    p => {
      p.production_branch = "main";
    }
  ],
  [
    "missing config",
    p => {
      delete p.deployment_configs;
    }
  ],
  [
    "D1 UUID",
    p => {
      p.deployment_configs.production.d1_databases.DB.id = "other";
    }
  ],
  [
    "additional binding",
    p => {
      p.deployment_configs.production.d1_databases.OTHER = { id: STAGING_D1_ID };
    }
  ],
  [
    "active project",
    p => {
      p.canonical_deployment.project_name = "other";
    }
  ],
  [
    "preview slot",
    p => {
      p.canonical_deployment.environment = "preview";
    }
  ],
  [
    "active branch",
    p => {
      p.canonical_deployment.deployment_trigger.metadata.branch = "main";
    }
  ],
  [
    "active SHA",
    p => {
      p.canonical_deployment.deployment_trigger.metadata.commit_hash = "b".repeat(40);
    }
  ],
  [
    "failed deployment",
    p => {
      p.canonical_deployment.latest_stage.status = "failure";
    }
  ],
  [
    "missing marker",
    p => {
      delete p.canonical_deployment.env_vars.APP_ENV;
    }
  ],
  [
    "wrong test mode",
    p => {
      p.canonical_deployment.env_vars.MP_TEST_MODE.value = "other";
    }
  ]
]) {
  test(`remote verification fails closed for ${label}`, () => {
    const p = project();
    mutate(p);
    assert.throws(() => validateRemoteProject(p, { publishedSha: sha }));
  });
}

test("remote gate performs one official Cloudflare GET and never queries D1", async () => {
  let calls = 0;
  const env = {
    CLOUDFLARE_ACCOUNT_ID: "7d8a62a0e64b693184975560c7cb788d",
    PAGES_PROJECT: "rp-doces-staging",
    CLOUDFLARE_API_TOKEN: "synthetic",
    STAGING_PUBLISHED_SHA: sha
  };
  const fetcher = async (url, options) => {
    calls++;
    assert.equal(
      url,
      `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/pages/projects/rp-doces-staging`
    );
    assert.equal(options.method ?? "GET", "GET");
    return Response.json({ success: true, result: project() });
  };
  await verifyRemoteProject(env, fetcher);
  assert.equal(calls, 1);
  await assert.rejects(verifyRemoteProject({ ...env, CLOUDFLARE_ACCOUNT_ID: "other" }, fetcher));
  assert.equal(calls, 1);
  await assert.rejects(verifyRemoteProject(env, async () => new Response(null, { status: 403 })));
  await assert.rejects(verifyRemoteProject(env, async () => Response.json({ success: false })));
  await assert.rejects(
    verifyRemoteProject(env, async () => {
      throw new Error("timeout");
    })
  );
});

test("workflow gates remote configuration before upload and active state before smoke", () => {
  const workflow = yaml.parse(readFileSync(".github/workflows/ci.yml", "utf8"));
  const job = workflow.jobs["deploy-staging"];
  const steps = job.steps;
  const remote = steps
    .map((s, i) => (s.run === "node scripts/check-staging-deployment.mjs" ? i : -1))
    .filter(i => i >= 0);
  const upload = steps.findIndex(s => s.id === "publish");
  const smoke = steps.findIndex(s => s.run === "node scripts/smoke-production.mjs");
  assert.equal(remote.length, 2);
  assert.ok(remote[0] < upload && remote[1] > upload && remote[1] < smoke);
  assert.equal(steps[remote[0]].if, "steps.gate.outputs.publish == 'true'");
  assert.equal(steps[remote[1]].if, "steps.publish.outputs.deployed == 'true'");
  assert.equal(steps[remote[1]].env.STAGING_PUBLISHED_SHA, `\${{ github.sha }}`);
  assert.equal(job.environment, "staging");
  assert.equal(job.if, "github.event_name == 'push' && github.ref == 'refs/heads/staging'");
});
