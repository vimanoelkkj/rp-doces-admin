<a id="pix-lifecycle-and-stock-reservation"></a>

# Ciclo de vida do Pix e reserva de estoque

<a id="1-stock-concurrency-model"></a>

## 1. Modelo de concorrência do estoque

O sistema de estoque impede vendas acima da disponibilidade em checkouts concorrentes, combinando constraints de integridade no banco com execução atômica em batch.

<a id="11-schema-invariants"></a>

### 1.1 Invariantes do schema

O estoque físico e as quantidades reservadas são acompanhados em `produtos`:

```sql
ALTER TABLE produtos ADD COLUMN estoque INTEGER NOT NULL DEFAULT 0 CHECK (estoque >= 0);
ALTER TABLE produtos ADD COLUMN estoque_reservado INTEGER NOT NULL DEFAULT 0 CHECK (estoque_reservado >= 0 AND estoque_reservado <= estoque);
```

- **Estoque físico (`estoque`)**: quantidade total de unidades fisicamente presentes no estoque.
- **Estoque reservado (`estoque_reservado`)**: quantidade temporariamente bloqueada por pedidos ativos e pendentes.
- **Estoque disponível**: calculado dinamicamente como:
  ```sql
  MAX(0, estoque - estoque_reservado)
  ```
- **Constraint de integridade estrutural**: o motor do SQLite garante `CHECK (estoque_reservado >= 0 AND estoque_reservado <= estoque)`. Qualquer mutação que tente incrementar `estoque_reservado` acima de `estoque` é rejeitada pelo próprio motor do banco.

---

<a id="2-stock-reservation-mechanics"></a>

## 2. Mecanismos de reserva de estoque

<a id="21-checkout-reservation-functionsapicheckoutts"></a>

### 2.1 Reserva no checkout (`functions/api/checkout.ts`)

Durante o checkout do cliente, a reserva é efetuada dentro do batch principal do banco:

```sql
UPDATE produtos
SET estoque_reservado = estoque_reservado + ?,
    atualizado_em = CURRENT_TIMESTAMP
WHERE id = ?;
```

- **Garantia da constraint**: se checkouts concorrentes disputarem o último estoque disponível, a primeira transação a concluir o commit reserva as unidades. A transação seguinte faz `estoque_reservado > estoque`, provocando imediatamente o erro `CHECK constraint failed` do SQLite.
- **Rollback do batch**: como a atualização executa dentro de `env.DB.batch()`, a falha da constraint causa rollback atômico de todo o batch, impedindo criação do pedido, inserção de pagamento e reservas parciais.
- **Tratamento controlado do erro**: a camada da aplicação captura o erro de constraint e retorna HTTP `409 Conflict`, indicando estoque insuficiente.

---

<a id="3-reservation-lifecycle"></a>

## 3. Ciclo de vida da reserva

Um pedido percorre estados de reserva bem definidos:

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

<a id="31-reservation-expiration"></a>

### 3.1 Expiração da reserva

- As reservas do checkout definem um timestamp de expiração (`reserva_expira_em`), geralmente de 15 a 30 minutos no futuro.
- Pedidos criados manualmente no painel administrativo definem `reserva_expira_em = NULL`, representando uma reserva persistente que não expira automaticamente.
- Varreduras de reconciliação agendadas ou manuais identificam pedidos pendentes cujo timestamp de expiração já passou e chamam `liberarReservaPedido` (`functions/lib/stock.ts`) para decrementar `estoque_reservado`, devolvendo a quantidade à disponibilidade.

<a id="32-physical-deduction-baixarestoquepedido"></a>

### 3.2 Baixa física (`baixarEstoquePedido`)

- Quando um pedido alcança o status `PAGO` confirmado pela fonte de autoridade, `baixarEstoquePedido` converte a reserva temporária em baixa física permanente.
- Cada item controlado em `pedido_itens` é atualizado para `estoque_estado = 'BAIXADO'`.
- A linha correspondente do produto é atualizada:
  ```sql
  UPDATE produtos
  SET estoque = estoque - ?,
      estoque_reservado = estoque_reservado - ?,
      disponivel = CASE ... END,
      atualizado_em = CURRENT_TIMESTAMP
  WHERE id = ?;
  ```
- Essa conversão é idempotente: se o pedido já está marcado como `BAIXADO`, chamadas repetidas não realizam alterações (no-op).

---

<a id="4-payment-gateway-integration-mercado-pago"></a>

## 4. Integração com o gateway de pagamento (Mercado Pago)

O gateway que fornece a autoridade financeira é a **Mercado Pago Orders API** (`/v1/orders`).
`mp_order_id` identifica ORD e `mp_payment_id` identifica sua transação PAY.
Consulte [o contrato de cutover](../MP_ORDERS.md) antes de habilitar essa integração.

<a id="41-in-memory-reference-verification-paymentsync"></a>

### 4.1 Verificação de referência em memória (`paymentSync`)

Webhooks recebidos podem estar atrasados, repetidos ou falsificados. Após validar a assinatura HMAC, a aplicação implementa um padrão de verificação em memória no runtime:

1. **Notificação por webhook**:
   - O endpoint de webhook (`functions/api/webhooks/mercadopago.ts`) recebe um evento `order` e extrai a identidade ORD (`data.id`).
   - Webhooks não alteram diretamente o status do pedido nem do ledger.
2. **Consulta à fonte de autoridade**:
   - O worker executa um `GET /v1/orders/{ORD}` autenticado por `fetchMpOrder` (`functions/lib/mp/orders/client.ts`). A fachada existente `fetchMpPayment` delega a esse cliente Orders.
3. **Atestação por WeakSet no runtime**:
   - Quando `fetchMpOrder` interpreta e congela o snapshot com sucesso, registra a referência do objeto em um `WeakSet` no escopo do módulo:
     ```ts
     const verifiedOrders = new WeakSet<VerifiedMpOrder>();
     ```
   - A reconciliação posterior verifica a presença por `isVerifiedMpOrder`, também exposto como `isVerifiedMpResponse` para compatibilidade.
   - Essa barreira em memória garante, dentro do isolate do runtime V8, que apenas respostas produzidas por chamadas GET diretas e autenticadas possam acionar a liquidação do pagamento e a conversão de estoque.

<a id="42-handling-gateway-failures-envioinconclusivo"></a>

### 4.2 Tratamento de falhas do gateway (`ENVIO_INCONCLUSIVO`)

Ao iniciar pagamentos ou reembolsos:

- **Timeouts de rede e respostas 5xx**:
  - Se ocorrer falha de transporte, timeout de socket ou erro HTTP 5xx ao enviar uma operação ao provedor de pagamento, a operação é definida como `fase='ENVIO_INCONCLUSIVO'` em `pedido_operacoes`.
  - O sistema **não** cancela o pedido nem libera o estoque reservado diante de um resultado inconclusivo.
  - A reserva é preservada até chegar um webhook confirmado pela fonte de autoridade ou uma varredura administrativa de reconciliação confirmar o status definitivo pela API do provedor.
