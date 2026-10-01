# Architecture Overview

## 1. System Topology

The RP Doces application is structured as an edge-native web application deployed on Cloudflare Pages and Pages Functions, utilizing Cloudflare D1 (serverless SQLite) for transactional persistence and Cloudflare R2 for asset storage.

```
+-------------------------------------------------------------------+
|                         Client Layer                              |
|   Vite + React (SPA) + Tailwind CSS + Lucide React                |
|   State: Local storage / Client-side stores                      |
+---------------------------------+---------------------------------+
                                  |
                                  | HTTPS / JSON
                                  v
+---------------------------------+---------------------------------+
|                   Cloudflare Pages Functions                      |
|                      Edge API (/api/*)                            |
|                                                                   |
|   Routing & Middleware:                                           |
|     - Request contextualization (functions/api/...)               |
|     - Auth verification (session cookies / token checks)          |
|                                                                   |
|   Domain Services (functions/lib/):                               |
|     - paymentSync: Gateway reconciliation (Mercado Pago)          |
|     - stock.ts: Reservation & physical deduction logic            |
|     - ledger/: Financial ledger projections & allocations         |
|     - operacoes.ts: Operation lifecycle & idempotency keys        |
|     - D1 Native Bindings (env.DB): Batch transactional execution  |
+-------------------+-------------------------------+---------------+
                    |                               |
                    v                               v
+-------------------+---------------+   +-----------+---------------+
|          Cloudflare D1            |   |       Cloudflare R2       |
|    (Distributed SQLite Engine)    |   |     (Object Storage)      |
|                                   |   |                           |
|   - Financial Ledger Tables       |   |   - Catalog Images        |
|   - Inventory & Reservations      |   |   - Static Media Assets   |
|   - Orders & Operation Tracking   |   +---------------------------+
+-----------------------------------+
```

---

## 2. Layers and Boundaries

### 2.1 Client Application (`src/`)
- Single-page application built with React and TypeScript.
- Communicates with `/api/*` endpoints via JSON payloads.
- Implements idempotent transaction request patterns by generating client-side operation keys (`operationKey`) and tracking client-side state.

### 2.2 Edge Functions & API Endpoints (`functions/api/`)
- Serverless request handlers running on Cloudflare Workers/Pages Functions runtime.
- Enforces input validation on incoming parameters before initiating persistence operations.
- Isolates public checkout flows from administrative management interfaces.
- Translates incoming webhooks and client actions into atomic transactional batches executed via `env.DB.batch()`.

### 2.3 Domain Logic Layer (`functions/lib/`)
- Encapsulates state transitions, financial calculations, and inventory operations.
- Pure functions and deterministic domain modules that take database bindings and domain models as inputs.
- Contains gateway clients and data synchronizers responsible for validating third-party provider responses.

### 2.4 Persistence Layer (`migrations/` and Cloudflare D1)
- Relational schema managed via sequential SQL migration scripts (`migrations/*.sql`).
- Relies on SQLite constraints (`CHECK`, `FOREIGN KEY`, `UNIQUE`) to enforce referential and business invariants at the database engine level.

---

## 3. Trust Boundaries and Security Model

1. **Client Untrusted Boundary**:
   - The browser is treated as an untrusted environment.
   - Prices, inventory levels, order totals, and payment status are recalculated and verified authoritatively on the server.
   - Client-provided amounts are validated against catalog data at the moment of reservation.

2. **Database Integrity Boundary**:
   - Structural invariants are enforced via SQLite constraints (`CHECK` conditions on inventory levels, `FOREIGN KEY` references on line items, `UNIQUE` constraints on payment and operation keys).
   - Atomic multi-table updates are executed using `env.DB.batch()`, guaranteeing all-or-nothing execution for the statement batch.

3. **External Gateway Boundary**:
   - Third-party webhook payloads are treated as unverified hints.
   - Gateway status updates require authoritative query verification against the provider API before applying state mutations to local ledger tables.

---

## 4. Key Design Invariants and Enforcement Levels

- **Monetary Precision**: All monetary values are represented and stored as integer cents (`*_centavos` as `INTEGER` in SQLite, `number` in TypeScript within safe integer bounds). Floating-point values for currency are prohibited by architectural convention and code review.
- **Append-Only Financial Ledger**: Once settled, recorded payment facts are treated as immutable by the application. State reversals, adjustments, and refunds are recorded as additive rows in `pedido_reembolsos` rather than destructive edits to original payments.
- **Stock Reservation Protection**: Overselling is prevented by structural database constraints (`CHECK (estoque_reservado >= 0 AND estoque_reservado <= estoque)`) combined with atomic batch updates in Cloudflare D1.
- **Idempotent Operations**: Mutations accept an operation key that prevents double-processing under network retries or concurrent submissions via unique database indexing and transactional replay checks.
