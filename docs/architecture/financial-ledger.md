# Financial Ledger Architecture

## 1. Principles and Invariants

The financial domain in RP Doces operates on ledger principles: historical payment receipts and disbursements are recorded as discrete facts. Financial positions are derived dynamically rather than updated over historical records.

### 1.1 Integer Cents (`*_centavos`)

All monetary values in the codebase, database schema, APIs, and client-side calculations are represented as integer cents (`INTEGER` in SQLite, `number` in TypeScript constrained to integer domain):

```sql
valor_centavos INTEGER NOT NULL CHECK (valor_centavos > 0)
```

- **Database Level**: Schema definitions enforce `INTEGER NOT NULL` and `CHECK (valor_centavos > 0)`.
- **Application Level**: Floating-point types (`REAL`, `FLOAT`) are avoided by convention. TypeScript interfaces represent currency in integer cents.
- **Presentation Level**: Display formatting (converting integer cents to BRL currency strings) occurs strictly at the UI boundary using `Intl.NumberFormat`.
- **Rounding Rule**: Intermediate calculations requiring division (such as itemized discounts or partial allocations) apply explicit integer rounding rules (`Math.round` or floor/ceil cascades) to ensure cent conservation.

---

## 2. Ledger Schema Structure

The financial state of an order is distributed across dedicated ledger tables:

```
+--------------------------+
|         pedidos          |
|--------------------------|
| id (PK, INTEGER)         |
| valor_total_centavos     |
| status_pagamento         |
+------------+-------------+
             |
             | 1:N
             +-------------------------------+
             |                               |
             v                               v
+----------------------------+     +----------------------------+
|     pedido_pagamentos      |     |     pedido_reembolsos      |
|----------------------------|     |----------------------------|
| id (PK, INTEGER)           |     | id (PK, INTEGER)           |
| pedido_id (FK)             |     | pedido_id (FK)             |
| metodo (CHECK enum)        |     | pagamento_id (FK)          |
| valor_centavos             |     | origem (CHECK enum)        |
| status (CHECK enum)        |     | metodo (CHECK enum)        |
| mp_payment_id (INDEX)      |     | valor_centavos             |
| idempotency_key (UNIQUE)   |     | status (CHECK enum)        |
| criado_em, atualizado_em   |     | mp_refund_id               |
| pago_em, cancelado_em      |     | idempotency_key (UNIQUE)   |
+-------------+--------------+     | motivo, criado_em          |
              |                    +----------------------------+
              | 1:N
              v
+------------------------------+
|  pedido_pagamento_alocacoes  |
|------------------------------|
| id (PK, INTEGER)             |
| pagamento_id (FK)            |
| pedido_item_id (FK)          |
| valor_centavos               |
| criado_em                    |
+------------------------------+
```

### 2.1 Immutability and Lifecycle of Payments (`pedido_pagamentos`)

- **Lifecycle Transitions**: Rows in `pedido_pagamentos` are created with `status = 'PENDENTE'` and advance through their lifecycle (`PAGO`, `CANCELADO`, `EXPIRADO`, `FALHOU`).
- **Accounting Immutability**: By application convention, once a payment row reaches a settled state (`PAGO`), its incoming monetary amount (`valor_centavos`) is never reduced or edited in place.
- **Refund Segregation**: Monetary reductions, cancellations, and customer reimbursements do not overwrite the original payment row; they are written as discrete, additive entries in `pedido_reembolsos`.

### 2.2 Additive Refunds (`pedido_reembolsos`)

- Refunds represent discrete outbound financial events tied directly to a specific parent payment.
- Attributes include `pedido_id`, `pagamento_id`, `valor_centavos`, `origem` (`'MERCADO_PAGO'` | `'MANUAL'`), `status` (`'PENDENTE'` | `'REEMBOLSADO'` | `'FALHOU'`), and a unique `idempotency_key`.
- Multiple partial refunds can reference the same payment up to the total received amount.

### 2.3 Proportional Payment Allocation (`pedido_pagamento_alocacoes`)

- When an order containing multiple items is paid, the payment is mapped to individual items via `pedido_pagamento_alocacoes`.
- This allocation records the exact distribution of settled funds across line items, enabling item-level cancellation, substitution, and refund tracking without ambiguous revenue attribution.

---

## 3. Dynamic Aggregation Model

To avoid data anomalies resulting from mutable balance columns, net order balance and settlement status are projected dynamically from ledger rows:

```sql
SELECT
  p.id,
  p.valor_total_centavos,
  COALESCE(SUM(pg.valor_centavos), 0) AS total_pago_centavos,
  COALESCE(SUM(rb.valor_centavos), 0) AS total_reembolsado_centavos,
  (COALESCE(SUM(pg.valor_centavos), 0) - COALESCE(SUM(rb.valor_centavos), 0)) AS saldo_liquido_centavos
FROM pedidos p
LEFT JOIN pedido_pagamentos pg
  ON pg.pedido_id = p.id AND pg.status = 'PAGO'
LEFT JOIN pedido_reembolsos rb
  ON rb.pedido_id = p.id AND rb.status = 'REEMBOLSADO'
WHERE p.id = ?
GROUP BY p.id;
```

- An order is settled when `saldo_liquido_centavos >= p.valor_total_centavos`.
- Overpayments or partial balances are surfaced transparently from the difference between aggregate credits and debits.

---

## 4. Idempotency Protocol (A1 Pattern)

Financial mutations (order creation, payment registration, refund requests) avoid duplicate writes under retries and network duplication via the A1 idempotency pattern.

### 4.1 Client Key Generation (`src/lib/operationKey.ts`)

1. The client generates an `operationKey` (UUID v4 or stable formatted string matching `^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$`) prior to the first network transmission.
2. The request transmits both `operationKey` and the payload to the API endpoint.
3. The server computes `fingerprint(payload)` from `functions/lib/operacaoIdentity.ts`. Its format is `<version>:<canonical JSON>`, currently `1:<canonical JSON>` (`FINGERPRINT_VERSAO = 1`). The private `canonical` helper recursively sorts object keys, omits object properties whose value is `undefined`, and preserves array order. Other values follow `JSON.stringify` semantics, including `null` and `undefined` in arrays.

Each caller selects the fields passed to `fingerprint(payload)`; the helper does not select fields or automatically include the entire request. For example, checkout includes sorted item ID/quantity pairs, `nome`, `whatsapp`, and `recado`, but excludes server-resolved prices. The operation key and type/scope/actor checks are separate from this payload identity.

The fingerprint is a deterministic, canonical, versioned payload identity used to detect incompatible reuse of the same operation key. It is not a hash, signature, HMAC, authentication mechanism, or cryptographic protection against tampering. Deduplication uses the operation key: identical payloads with different keys remain distinct operations.

### 4.2 Server-Side Execution and Replay Handling (`pedido_operacoes`)

The database maintains an authoritative operation ledger (`migrations/0012_operacoes_idempotencia.sql`):

```sql
CREATE TABLE pedido_operacoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  operation_key TEXT NOT NULL,
  tipo TEXT NOT NULL,
  escopo TEXT NOT NULL,
  ator_usuario_id INTEGER,
  fingerprint_versao INTEGER NOT NULL,
  fingerprint TEXT NOT NULL,
  fase TEXT NOT NULL DEFAULT 'LOCAL_CRIADA',
  pedido_id INTEGER,
  pagamento_id INTEGER,
  reembolso_id INTEGER,
  resultado TEXT,
  erro TEXT,
  mp_idempotency_key TEXT,
  mp_request TEXT,
  mp_payment_id TEXT,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (pedido_id) REFERENCES pedidos(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX uq_pedido_operacoes_key ON pedido_operacoes(operation_key);
```

### 4.3 Atomic Batch Claim Protocol

1. **Atomic Ingestion**: The creation of local business records (e.g., `pedidos`, `pedido_pagamentos`) and the operation claim (`pedido_operacoes` with `fase='LOCAL_CRIADA'`) are executed together in a single `env.DB.batch()` transaction.
2. **Race Resolution**:
   - If two identical requests race, one batch succeeds and claims the unique index `uq_pedido_operacoes_key`.
   - The competing request fails with a unique constraint violation on `operation_key`, triggering an automatic rollback of its entire batch.
3. **Replay Flow**:
   - On conflict, the handler fetches the existing operation via `buscarOperacao`.
   - `conflitoOperacao` checks compatibility in order: type (`OPERACAO_CONFLITO_TIPO`), scope and actor (`OPERACAO_CONFLITO_ESCOPO`), then fingerprint version and exact string (`OPERACAO_CONFLITO_PAYLOAD`).
   - If all checks match, the server safely replays the outcome (e.g., via `replayCheckout`).
   - Incompatible reuse returns HTTP `409 Conflict`, blocking conflicting mutation attempts. A different fingerprint version is also a payload conflict, never an equivalent payload.
