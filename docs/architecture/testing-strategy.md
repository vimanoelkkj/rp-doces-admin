# Testing Strategy and Quality Gates

## 1. Test Harness Philosophy

The testing architecture for RP Doces is designed around high execution speed, deterministic concurrency verification, and minimal external test dependencies.

### 1.1 Core Tooling

- **Native Test Runner**: Tests use the Node.js native test runner (`node --test`) with standard assertions (`node:assert/strict`).
- **File Format**: Test suites are authored as ES modules (`tests/*.test.mjs`).
- **Fast Execution**: Tests avoid heavy browser automation for core business logic, executing in-memory against local Cloudflare Workers edge simulations.

---

## 2. In-Memory D1 Emulation with Miniflare

Cloudflare D1 runs SQLite on Cloudflare Workers edge nodes. To test database interactions accurately without hitting remote Cloudflare infrastructure, test suites run Miniflare (`tests/helpers/b3.mjs`):

```js
import { Miniflare } from "miniflare";

// Test bridge worker running directly in workerd
const bridge = `export default {
  async fetch(request, env) {
    const { statements } = await request.json();
    try {
      const results = await env.DB.batch(
        statements.map(s => env.DB.prepare(s.sql).bind(...s.args))
      );
      return Response.json({ results });
    } catch (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }
  }
};`;

const mf = new Miniflare({
  modules: true,
  script: bridge,
  cf: false,
  d1Databases: ["DB"],
  d1Persist: false
});
```

### 2.1 Dynamic Module Bundling

- Application source modules in `functions/` are bundled into memory using `esbuild` at the start of the test run.
- This allows testing real TypeScript production routes with native D1 batch semantics without building disk artifacts.

### 2.2 Full Migration Application

- Before executing test assertions, the test fixture loads and executes all SQL migrations from `migrations/*.sql` in alphabetical order.
- Statements and trigger bodies are extracted and executed against the in-memory D1 database, ensuring test cases run against the complete production schema.

---

## 3. Concurrency and Race Condition Testing

Edge environments frequently encounter concurrent requests attempting to access the same inventory or order. The test suite employs deterministic synchronization hooks rather than arbitrary timeouts.

### 3.1 Deterministic Database Hooks

To simulate race conditions reliably (such as two checkouts competing for the last available item or conflicting idempotency keys):

1. The test fixture provides a hook mechanism on the database wrapper (`db.hook`).
2. Two requests are initiated in flight simultaneously (`ambas(req1, req2)`).
3. The hook pauses execution of the first request after its read phase, allowing the second request to advance.
4. When the barrier releases, both requests attempt their atomic batch writes simultaneously, testing SQLite `CHECK` constraints, unique key collisions, and rollback behavior deterministically.

---

## 4. Test Suite Organization

1. **Idempotency & Operations (`tests/a1.test.mjs`)**:
   - Asserts that replaying identical operation keys returns cached outcomes without duplicate mutations.
   - Tests that reusing keys with modified payloads returns HTTP `409 Conflict`.
2. **Payment Reconciliations & Ledger (`tests/b1*.test.mjs`, `tests/b2*.test.mjs`, `tests/b3*.test.mjs`)**:
   - Validates webhook processing, Mercado Pago GET reconciliation, and refund handling.
   - Asserts that order settlements, partial payments, and refund lines conserve monetary amounts.
3. **Inventory & Order Management (`tests/comanda-viva-*.test.mjs`, `tests/stock*.test.mjs`)**:
   - Validates reservation holds, physical deductions upon payment confirmation, and cancellation releases.
4. **Migration & Schema Linting (`tests/check-d1-migrations.test.mjs`)**:
   - Verifies migration numbering continuity, schema markers, and read-only query safety.

---

## 5. Quality Verification Gates

Prior to merging changes or deploying:

- **Migration Continuity**: Run `node --test tests/check-d1-migrations.test.mjs` to verify migration integrity.
- **Type Checking**: Run `npm run typecheck` to verify TypeScript strictness across `src/` and `functions/`.
- **Automated Test Suite**: Run `node --test tests/*.test.mjs` to execute domain, integration, and UI tests.
