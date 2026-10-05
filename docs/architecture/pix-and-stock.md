# Pix Lifecycle and Stock Reservation

## 1. Stock Concurrency Model

The inventory system prevents overselling under concurrent checkout traffic by combining database-level integrity constraints with atomic batch execution.

### 1.1 Schema Invariants

Stock is tracked with physical inventory and reserved quantities in `produtos`:

```sql
ALTER TABLE produtos ADD COLUMN estoque INTEGER NOT NULL DEFAULT 0 CHECK (estoque >= 0);
ALTER TABLE produtos ADD COLUMN estoque_reservado INTEGER NOT NULL DEFAULT 0 CHECK (estoque_reservado >= 0 AND estoque_reservado <= estoque);
```

- **Physical Stock (`estoque`)**: Total quantity of units physically present in inventory.
- **Reserved Stock (`estoque_reservado`)**: Quantity temporarily locked by active, pending orders.
- **Available Stock**: Calculated dynamically as:
  ```sql
  MAX(0, estoque - estoque_reservado)
  ```
- **Structural Integrity Constraint**: The SQLite engine enforces `CHECK (estoque_reservado >= 0 AND estoque_reservado <= estoque)`. Any database mutation that attempts to increment `estoque_reservado` beyond `estoque` is rejected at the engine level.

---

## 2. Stock Reservation Mechanics

### 2.1 Checkout Reservation (`functions/api/checkout.ts`)

During customer checkout, the reservation is issued within the primary database batch:

```sql
UPDATE produtos
SET estoque_reservado = estoque_reservado + ?,
    atualizado_em = CURRENT_TIMESTAMP
WHERE id = ?;
```

- **Constraint Enforcement**: If competing checkouts contest the last remaining inventory, the first transaction to commit reserves the units. The subsequent transaction causes `estoque_reservado > estoque`, triggering an immediate SQLite `CHECK constraint failed` error.
- **Batch Rollback**: Because the update executes inside `env.DB.batch()`, the constraint failure causes an atomic rollback of the entire batch (preventing order creation, payment insertion, and partial reservations).
- **Graceful Error Handling**: The application layer catches the constraint error and returns an HTTP `409 Conflict` indicating insufficient stock.

---

## 3. Reservation Lifecycle

An order progresses through well-defined reservation states:

```
[Customer Checkout]
       |
       v (Batch Update with CHECK guard)
[estoque_reservado += qty] ---> Order: PENDENTE (with reserva_expira_em)
       |
       +-----------------------+-----------------------+
       |                       |                       |
       v (Payment Confirmed)   v (Timeout / Expired)   v (Order Cancelled)
[baixarEstoquePedido]   [liberarReservaPedido]  [liberarReservaPedido]
       |                       |                       |
       v                       v                       v
estoque -= qty          estoque_reservado -= qty estoque_reservado -= qty
estoque_reservado -= qty       |                       |
       |                       v                       v
       v                Order: EXPIRADO         Order: CANCELADO
Order: PAGO
```

### 3.1 Reservation Expiration

- Checkout reservations set an expiration timestamp (`reserva_expira_em`), typically 15 to 30 minutes in the future.
- Orders created manually via the administration panel set `reserva_expira_em = NULL`, representing a persistent hold that does not auto-expire.
- Scheduled or manual reconciliation sweeps identify pending orders whose expiration timestamp has passed, invoking `liberarReservaPedido` (`functions/lib/stock.ts`) to decrement `estoque_reservado` back to available inventory.

### 3.2 Physical Deduction (`baixarEstoquePedido`)

- When an order reaches authoritative `PAGO` status, `baixarEstoquePedido` converts the temporary hold into a permanent physical deduction.
- Each controlled line item in `pedido_itens` is updated to `estoque_estado = 'BAIXADO'`.
- The corresponding product row is updated:
  ```sql
  UPDATE produtos
  SET estoque = estoque - ?,
      estoque_reservado = estoque_reservado - ?,
      disponivel = CASE ... END,
      atualizado_em = CURRENT_TIMESTAMP
  WHERE id = ?;
  ```
- This conversion is idempotent: if an order is already marked as `BAIXADO`, repeated calls act as a no-op.

---

## 4. Payment Gateway Integration (Mercado Pago)

The authoritative payment gateway for Pix and online transactions is **Mercado Pago** (`/v1/payments`).

### 4.1 In-Memory Reference Verification (`paymentSync`)

Incoming webhooks from payment providers are unauthenticated network notifications that can be delayed, repeated, or spoofed. The application implements an in-memory runtime verification pattern:

1. **Webhook Notification**:
   - The webhook endpoint (`functions/api/webhooks/mercadopago.ts`) receives the event and extracts the external payment ID (`data.id`).
   - Webhooks do not directly mutate order or ledger status.
2. **Authoritative Fetch**:
   - The worker executes an authenticated HTTPS `GET /v1/payments/{id}` call to the Mercado Pago API via `fetchMpPayment` (`functions/lib/paymentSync/client.ts`).
3. **Runtime WeakSet Attestation**:
   - When `fetchMpPayment` successfully parses and freezes the response object, it registers the object reference in a module-scoped `WeakSet`:
     ```ts
     const MP_GET_VERIFIED = Symbol("MP_GET_VERIFIED");
     const verifiedMpResponses = new WeakSet<MpPaymentResponse>();
     ```
   - Downstream reconciliation functions verify membership via `isVerifiedMpResponse(mp)`.
   - This in-memory barrier ensures within the V8 runtime isolate that only responses produced by direct, authenticated GET calls can trigger payment settlement and stock conversion.

### 4.2 Handling Gateway Failures (`ENVIO_INCONCLUSIVO`)

When initiating payments or refunds:

- **Network Timeouts & 5xx Responses**:
  - If a network transport failure, socket timeout, or HTTP 5xx error occurs while sending an operation to the payment provider, the operation is set to `fase='ENVIO_INCONCLUSIVO'` in `pedido_operacoes`.
  - The system **does not** cancel the order or release reserved stock on an inconclusive result.
  - The hold is preserved until an authoritative webhook arrives or an administrative reconciliation sweep confirms the definitive status with the provider API.
