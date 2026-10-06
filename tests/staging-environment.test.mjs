import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync, execFileSync } from "node:child_process";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import test from "node:test";
import { yaml } from "playwright-core/lib/utilsBundle";
import { build } from "esbuild";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  readConfigs,
  validateStaging,
  STAGING_D1_PLACEHOLDER
} from "../scripts/check-staging-config.mjs";
import { main as checkMigrations, assertReadOnly } from "../scripts/check-d1-migrations.mjs";
import { parseConfig as smokeConfig } from "../scripts/smoke-production.mjs";

const expression = value => `\${{ ${value} }}`;
const cloudflareSecrets = [
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_API_TOKEN",
  "CLOUDFLARE_D1_READ_TOKEN"
];
function secretReferences(job) {
  const strings = value =>
    typeof value === "string"
      ? [value]
      : value && typeof value === "object"
        ? Object.values(value).flatMap(strings)
        : [];
  const source = strings(job).join("\n");
  return [
    ...new Set(
      [...source.matchAll(/\bsecrets\s*(?:\.\s*|\[\s*['"])([A-Z0-9_]+)/g)].map(match => match[1])
    )
  ].sort();
}
const configs = readConfigs();
const document = yaml.parseDocument(readFileSync(".github/workflows/ci.yml", "utf8"));
assert.deepEqual(document.errors, [], "Workflow must be valid YAML");
const workflow = document.toJS();
const uuid = "11111111-2222-4333-8444-555555555555";
const provisioned = () => {
  const copy = structuredClone(configs);
  for (const config of [copy.pages, copy.worker]) config.d1_databases[0].database_id = uuid;
  return copy;
};

function workflowContract(w) {
  assert.deepEqual(w.on.push.branches, ["main", "staging"]);
  assert.equal(w.concurrency, undefined);
  // Freeze the entire existing production job semantically, independent of YAML formatting/comments.
  assert.equal(
    createHash("sha256").update(JSON.stringify(w.jobs.deploy)).digest("hex"),
    "486abd8eff6a4e0b37fbf25577d2929d4019ca6de318a7483162ef6738b930c2"
  );
  assert.deepEqual(w.jobs.tests.strategy.matrix.shard, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.deepEqual(w.jobs["ci-status"].needs, ["checks", "tests", "e2e"]);
  assert.deepEqual(secretReferences(w.jobs.deploy), [...cloudflareSecrets].sort());
  for (const env of [w.env, w.jobs.deploy.env, ...w.jobs.deploy.steps.map(step => step.env)]) {
    assert.notEqual(env?.VITE_APP_ENV, "staging", "Production must not enable the staging badge");
  }
  const job = w.jobs["deploy-staging"];
  assert.deepEqual(secretReferences(job), cloudflareSecrets.map(name => `STAGING_${name}`).sort());
  assert.equal(job.if, "github.event_name == 'push' && github.ref == 'refs/heads/staging'");
  assert.equal(job.needs, "ci-status");
  assert.equal(job.environment, "staging");
  assert.deepEqual(job.concurrency, { group: "deploy-staging", "cancel-in-progress": false });
  assert.equal(job.env.PAGES_PROJECT, "rp-doces-staging");
  assert.equal(job.env.CLOUDFLARE_API_TOKEN, expression("secrets.STAGING_CLOUDFLARE_API_TOKEN"));
  assert.equal(job.env.CLOUDFLARE_ACCOUNT_ID, expression("secrets.STAGING_CLOUDFLARE_ACCOUNT_ID"));
  assert.equal(
    job.env.STAGING_URL,
    expression("vars.STAGING_URL || 'https://rp-doces-staging.pages.dev'")
  );
  const steps = job.steps;
  const gate = steps.find(step => step.id === "gate");
  assert.deepEqual(gate.env, {
    STAGING_DEPLOY_ENABLED: expression("vars.STAGING_DEPLOY_ENABLED"),
    STAGING_CLOUDFLARE_D1_READ_TOKEN: expression("secrets.STAGING_CLOUDFLARE_D1_READ_TOKEN")
  });
  for (const name of [
    "CLOUDFLARE_API_TOKEN",
    "CLOUDFLARE_ACCOUNT_ID",
    "STAGING_CLOUDFLARE_D1_READ_TOKEN"
  ]) {
    assert.ok(gate.run.includes(`[ -z "$${name}" ]`), `Missing ${name} must fail early`);
  }
  const credentialsGuard = gate.run.indexOf('if [ -z "$CLOUDFLARE_API_TOKEN" ]');
  const headLookup = gate.run.indexOf("git ls-remote");
  assert.ok(credentialsGuard >= 0 && credentialsGuard < headLookup);
  assert.match(gate.run.slice(credentialsGuard, headLookup), /exit 1/);
  assert.match(gate.run, /if \[ "\$STAGING_DEPLOY_ENABLED" != "true" \]/);
  assert.match(gate.run, /git ls-remote origin refs\/heads\/staging/);
  assert.ok(
    gate.run.indexOf("$STAGING_DEPLOY_ENABLED") < gate.run.indexOf("$CLOUDFLARE_API_TOKEN")
  );
  const isolation = steps.find(step => step.id === "isolation");
  assert.equal(isolation.run, "node scripts/check-staging-config.mjs --require-provisioned");
  const guard = steps.find(step => step.run === "node scripts/check-d1-migrations.mjs");
  assert.deepEqual(guard.env, {
    CLOUDFLARE_D1_READ_TOKEN: expression("secrets.STAGING_CLOUDFLARE_D1_READ_TOKEN"),
    CLOUDFLARE_API_TOKEN: "",
    WRANGLER_TOML: "wrangler.staging.toml",
    D1_DATABASE_ID: expression("steps.isolation.outputs.database_id")
  });
  const buildStep = steps.find(step => step.run === "npm run build");
  assert.deepEqual(buildStep.env, { VITE_APP_ENV: "staging" });
  const publish = steps.find(step => step.id === "publish");
  assert.match(publish.run, /git ls-remote origin refs\/heads\/staging/);
  assert.match(publish.run, /cp wrangler\.staging\.toml wrangler\.toml/);
  assert.match(publish.run, /--project-name "\$PAGES_PROJECT"/);
  assert.match(publish.run, /--branch staging/);
  assert.match(publish.run, /--commit-hash "\$GITHUB_SHA"/);
  const uploadCommands = publish.run
    .split("\n")
    .filter(line => !line.trim().startsWith("#"))
    .join("\n");
  assert.doesNotMatch(uploadCommands, /--config|--env/);
  assert.ok(
    publish.run.indexOf("cp wrangler.staging.toml") <
      publish.run.indexOf("npx wrangler pages deploy")
  );
  assert.ok(
    publish.run.indexOf("deployed=true") > publish.run.indexOf("npx wrangler pages deploy")
  );
  const verify = steps.find(step => step.name === "Verificar deployment");
  assert.match(verify.run, /\$PAGES_PROJECT\/deployments\?env=production/);
  assert.match(verify.run, /commit_hash == \$sha/);
  assert.match(verify.run, /latest_stage.status == "success"/);
  const smoke = steps.find(step => step.run === "node scripts/smoke-production.mjs");
  assert.deepEqual(smoke.env, { SMOKE_BASE_URL: expression("env.STAGING_URL") });
  for (const step of [isolation, guard, buildStep, publish]) {
    assert.equal(step.if, "steps.gate.outputs.publish == 'true'");
  }
  for (const step of [verify, smoke]) {
    assert.equal(step.if, "steps.publish.outputs.deployed == 'true'");
  }
  const install = steps.find(step => step.run === "npm ci");
  const order = [gate, install, isolation, guard, buildStep, publish, verify, smoke].map(step =>
    steps.indexOf(step)
  );
  assert.deepEqual(
    order,
    [...order].sort((a, b) => a - b)
  );
  assert.doesNotMatch(
    steps.map(step => step.run || "").join("\n"),
    /migrations apply|d1 execute|secret (?:put|bulk)|DEPLOY_ENABLED(?!["\w])/
  );
}

test("staging config parses and isolates every binding", () => {
  assert.equal(validateStaging(configs), STAGING_D1_PLACEHOLDER);
  assert.equal(validateStaging(provisioned(), { requireProvisioned: true }), uuid);
  assert.throws(() => validateStaging(configs, { requireProvisioned: true }), {
    name: "AssertionError"
  });
});
test("workflow preserves production and isolates staging deployment", () =>
  workflowContract(workflow));
test("enabled staging fails before any external action when a secret is missing", async t => {
  const dir = mkdtempSync(join(tmpdir(), "rp-staging-gate-"));
  t.after(() => {
    assert.equal(dirname(dir), tmpdir());
    rmSync(dir, { recursive: true, force: true });
  });
  const bash =
    process.platform === "win32"
      ? resolve(
          execFileSync("git", ["--exec-path"], { encoding: "utf8" }).trim(),
          "../../..",
          "bin/bash.exe"
        )
      : "bash";
  const gate = workflow.jobs["deploy-staging"].steps.find(step => step.id === "gate");
  for (const missing of [
    "CLOUDFLARE_ACCOUNT_ID",
    "CLOUDFLARE_API_TOKEN",
    "STAGING_CLOUDFLARE_D1_READ_TOKEN"
  ]) {
    await t.test(missing, () => {
      const summary = join(dir, "summary");
      writeFileSync(summary, "");
      const result = spawnSync(
        bash,
        [
          "--noprofile",
          "--norc",
          "-c",
          `git() { echo HEAD_LOOKUP_CALLED >> "$GITHUB_STEP_SUMMARY"; };\n${gate.run}`
        ],
        {
          cwd: dir,
          encoding: "utf8",
          env: {
            PATH: process.env.PATH,
            SystemRoot: process.env.SystemRoot,
            HOME: dir,
            BASH_ENV: "",
            ENV: "",
            STAGING_DEPLOY_ENABLED: "true",
            CLOUDFLARE_ACCOUNT_ID: "synthetic-staging-account",
            CLOUDFLARE_API_TOKEN: "synthetic-staging-deploy-token",
            STAGING_CLOUDFLARE_D1_READ_TOKEN: "synthetic-staging-read-token",
            CLOUDFLARE_D1_READ_TOKEN: "synthetic-generic-token-must-not-be-a-fallback",
            GITHUB_OUTPUT: join(dir, "output"),
            GITHUB_STEP_SUMMARY: summary,
            [missing]: ""
          }
        }
      );
      assert.ifError(result.error);
      assert.equal(result.status, 1, result.stdout + result.stderr);
      assert.match(result.stdout, /STAGING_CLOUDFLARE/);
      assert.doesNotMatch(readFileSync(summary, "utf8"), /HEAD_LOOKUP_CALLED/);
    });
  }
});
test("staging smoke URL is explicit and cannot fall back to production", () => {
  for (const url of ["https://rp-doces-staging.pages.dev", "https://staging.rpdoces.com.br"]) {
    validateStaging(configs, { url });
    assert.equal(smokeConfig([], { SMOKE_BASE_URL: url }).baseUrl, url);
  }
  for (const url of [
    "https://rpdoces.com.br",
    "https://rp-doces.pages.dev",
    "http://rp-doces-staging.pages.dev",
    "https://rp-doces-staging.pages.dev?token=x",
    "https://user:pass@rp-doces-staging.pages.dev"
  ]) {
    assert.throws(() => validateStaging(configs, { url }), { name: "AssertionError" });
  }
});

test("real migration guard queries only the explicit staging D1 and only reads", async t => {
  const dir = mkdtempSync(join(tmpdir(), "rp-staging-guard-"));
  t.after(() => {
    assert.equal(dirname(dir), tmpdir());
    rmSync(dir, { recursive: true, force: true });
  });
  writeFileSync(join(dir, "0001_init.sql"), "SELECT 1;");
  const toml = join(dir, "wrangler.staging.toml");
  writeFileSync(toml, `[[d1_databases]]\ndatabase_id = "${uuid}"\n`);
  const requests = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    requests.push(String(url));
    const payload = JSON.parse(options.body);
    for (const stmt of payload.batch ?? [payload]) assertReadOnly(stmt.sql);
    return Response.json({
      success: true,
      result: [
        { success: true, results: [{ id: 1, name: "0001_init.sql", applied_at: "2026-01-01" }] }
      ]
    });
  });
  const env = {
    CLOUDFLARE_D1_READ_TOKEN: "synthetic-read-token",
    CLOUDFLARE_ACCOUNT_ID: "synthetic-account",
    CLOUDFLARE_API_TOKEN: "",
    WRANGLER_TOML: toml,
    D1_DATABASE_ID: validateStaging(provisioned(), { requireProvisioned: true }),
    MIGRATIONS_DIR: dir,
    CF_API_BASE: "https://cloudflare.example.invalid"
  };
  const contract = async settings => {
    requests.length = 0;
    assert.equal((await checkMigrations(settings)).ok, true);
    assert.ok(requests.length > 0);
    for (const url of requests)
      assert.equal(
        url,
        `https://cloudflare.example.invalid/accounts/synthetic-account/d1/database/${uuid}/query`
      );
  };
  await contract(env);
  await contract({ ...env, D1_DATABASE_ID: undefined }); // Explicit staging TOML fallback.
  await t.test("negative control: production D1 supplied to migration guard", async () => {
    await assert.rejects(
      contract({ ...env, D1_DATABASE_ID: configs.production.d1_databases[0].database_id }),
      { name: "AssertionError" }
    );
  });
});

for (const [name, mutate] of [
  [
    "production D1 ID",
    c => {
      c.pages.d1_databases[0].database_id = c.production.d1_databases[0].database_id;
    }
  ],
  [
    "production DB name",
    c => {
      c.worker.d1_databases[0].database_name = "rp-doces-db";
    }
  ],
  [
    "production Pages",
    c => {
      c.pages.name = "rp-doces";
    }
  ],
  [
    "production producer Queue",
    c => {
      c.pages.queues.producers[0].queue = "rp-doces-push";
    }
  ],
  [
    "production consumer Queue",
    c => {
      c.worker.queues.consumers[0].queue = "rp-doces-push";
    }
  ],
  [
    "production Worker",
    c => {
      c.worker.name = "rp-doces-push";
    }
  ],
  [
    "production bootstrap",
    c => {
      c.bootstrap.name = "rp-doces-push";
    }
  ],
  [
    "production R2",
    c => {
      c.pages.r2_buckets[0].bucket_name = "rp-doces-images";
    }
  ],
  [
    "mismatched Worker D1",
    c => {
      c.worker.d1_databases[0].database_id = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    }
  ],
  [
    "active bootstrap cron",
    c => {
      c.bootstrap.triggers.crons = ["* * * * *"];
    }
  ]
]) {
  test(`config negative control: ${name}`, () => {
    const c = provisioned();
    mutate(c);
    assert.throws(() => validateStaging(c), { name: "AssertionError" });
  });
}

for (const [name, mutate] of [
  ...cloudflareSecrets.map(name => [
    `generic secret ${name} in staging`,
    w => {
      w.jobs["deploy-staging"].env.LEAK = expression(`secrets.${name}`);
    }
  ]),
  [
    "production secret fallback",
    w => {
      w.jobs["deploy-staging"].env.CLOUDFLARE_API_TOKEN = expression(
        "secrets.STAGING_CLOUDFLARE_API_TOKEN || secrets.CLOUDFLARE_API_TOKEN"
      );
    }
  ],
  [
    "generic secret through indexed lookup",
    w => {
      w.jobs["deploy-staging"].env.LEAK = expression('secrets["CLOUDFLARE_API_TOKEN"]');
    }
  ],
  [
    "missing early read-token guard",
    w => {
      const gate = w.jobs["deploy-staging"].steps.find(step => step.id === "gate");
      const anchor = ' || [ -z "$STAGING_CLOUDFLARE_D1_READ_TOKEN" ]';
      assert.ok(gate.run.includes(anchor));
      gate.run = gate.run.replace(anchor, "");
    }
  ],
  [
    "missing staging build flag",
    w => {
      delete w.jobs["deploy-staging"].steps.find(step => step.run === "npm run build").env
        .VITE_APP_ENV;
    }
  ],
  [
    "staging flag in production build",
    w => {
      w.jobs.deploy.steps.find(step => step.run === "npm run build").env = {
        VITE_APP_ENV: "staging"
      };
    }
  ],
  [
    "staging secret in production",
    w => {
      w.jobs.deploy.env.CLOUDFLARE_API_TOKEN = expression("secrets.STAGING_CLOUDFLARE_API_TOKEN");
    }
  ]
]) {
  test(`isolation negative control: ${name}`, () => {
    const w = structuredClone(workflow);
    mutate(w);
    assert.throws(() => workflowContract(w), { name: "AssertionError" });
  });
}

for (const [name, mutate] of [
  [
    "deploy staging from main",
    j => {
      j.if = "github.event_name == 'push' && github.ref == 'refs/heads/main'";
    }
  ],
  [
    "production environment secrets",
    j => {
      j.environment = "production";
    }
  ],
  [
    "production project",
    j => {
      j.env.PAGES_PROJECT = "rp-doces";
    }
  ],
  [
    "production enable switch",
    j => {
      j.steps.find(s => s.id === "gate").env.STAGING_DEPLOY_ENABLED =
        expression("vars.DEPLOY_ENABLED");
    }
  ],
  [
    "migration guard fallback",
    j => {
      delete j.steps.find(s => s.run === "node scripts/check-d1-migrations.mjs").env.WRANGLER_TOML;
    }
  ],
  [
    "wrong migration D1",
    j => {
      j.steps.find(s => s.run === "node scripts/check-d1-migrations.mjs").env.D1_DATABASE_ID =
        configs.production.d1_databases[0].database_id;
    }
  ],
  [
    "automatic migrations",
    j => {
      j.steps.push({ run: "npx wrangler d1 migrations apply DB --remote" });
    }
  ],
  [
    "production config on upload",
    j => {
      const s = j.steps.find(s => s.id === "publish");
      s.run = s.run.replace("cp wrangler.staging.toml wrangler.toml", "true");
    }
  ],
  [
    "production smoke URL",
    j => {
      j.env.STAGING_URL = "https://rpdoces.com.br";
    }
  ],
  [
    "bypass CI",
    j => {
      j.needs = "checks";
    }
  ],
  [
    "ungated upload",
    j => {
      delete j.steps.find(s => s.id === "publish").if;
    }
  ]
]) {
  test(`workflow negative control: ${name}`, () => {
    const w = structuredClone(workflow);
    mutate(w.jobs["deploy-staging"]);
    assert.throws(() => workflowContract(w), { name: "AssertionError" });
  });
}

async function indicator(env) {
  const bundle = await build({
    entryPoints: ["src/admin/components/StagingIndicator.tsx"],
    bundle: true,
    write: false,
    platform: "node",
    format: "cjs",
    jsx: "automatic",
    external: ["react", "react/jsx-runtime"],
    define: { "import.meta.env": JSON.stringify(env) }
  });
  const module = { exports: {} };
  new Function("require", "module", "exports", bundle.outputFiles[0].text)(
    createRequire(import.meta.url),
    module,
    module.exports
  );
  return renderToStaticMarkup(createElement(module.exports.default));
}
test("real indicator renders accessible staging badge only with the explicit flag", async () => {
  const html = await indicator({ VITE_APP_ENV: "staging" });
  assert.match(html, />STAGING<\/span>/);
  assert.match(html, /aria-label="Ambiente de testes: staging"/);
  for (const env of [
    {},
    { VITE_APP_ENV: "production" },
    { VITE_APP_ENV: "preview" },
    { VITE_APP_ENV: "STAGING" }
  ]) {
    assert.equal(await indicator(env), "");
  }
  assert.match(
    readFileSync("src/admin/components/AdminLayout.tsx", "utf8"),
    /<StagingIndicator\s*\/>/
  );
});
