# Ciclo de vida do Pix e reserva de estoque

## 1. Modelo de concorrência do estoque

O sistema de estoque impede vendas acima da disponibilidade em checkouts concorrentes ao combinar restrições de integridade no banco com execução atômica em lote.

### 1.1 Invariantes do schema

O estoque é acompanhado por quantidades físicas e reservadas em `produtos`:

```sql
ALTER TABLE produtos ADD COLUMN estoque INTEGER NOT NULL DEFAULT 0 CHECK (estoque >= 0);
ALTER TABLE produtos ADD COLUMN estoque_reservado INTEGER NOT NULL DEFAULT 0 CHECK (estoque_reservado >= 0 AND estoque_reservado <= estoque);
```

- **Estoque físico (`estoque`)**: quantidade total de unidades fisicamente presentes no estoque.
- **Estoque reservado (`estoque_reservado`)**: quantidade temporariamente retida por pedidos ativos e pendentes.
- **Estoque disponível**: calculado dinamicamente como:
  ```sql
  MAX(0, estoque - estoque_reservado)
  ```
- **Restrição estrutural de integridade**: o mecanismo SQLite impõe `CHECK (estoque_reservado >= 0 AND estoque_reservado <= estoque)`. Qualquer mutação que tente incrementar `estoque_reservado` acima de `estoque` é rejeitada pelo banco.

---

## 2. Funcionamento da reserva de estoque

### 2.1 Reserva no checkout (`functions/api/checkout.ts`)

Durante o checkout do cliente, a reserva é feita no lote principal do banco:

```sql
UPDATE produtos
SET estoque_reservado = estoque_reservado + ?,
    atualizado_em = CURRENT_TIMESTAMP
WHERE id = ?;
```

- **Aplicação da restrição**: se checkouts concorrentes disputarem as últimas unidades, a primeira transação confirmada reserva o estoque. A transação seguinte causa `estoque_reservado > estoque`, acionando imediatamente o erro SQLite `CHECK constraint failed`.
- **Rollback do lote**: como a atualização ocorre dentro de `env.DB.batch()`, a falha da restrição reverte atomicamente todo o lote, impedindo criação de pedido, inserção de pagamento e reservas parciais.
- **Tratamento controlado de erro**: a aplicação captura o erro de restrição e retorna HTTP `409 Conflict`, indicando estoque insuficiente.

---

## 3. Ciclo de vida da reserva

Um pedido passa por estados de reserva bem definidos:

```
[Checkout do cliente]
       |
       v (Atualização em lote protegida por CHECK)
[estoque_reservado += qty] ---> Pedido: PENDENTE (com reserva_expira_em)
       |
       +-----------------------+-----------------------+
       |                       |                       |
       v (Pagamento confirmado) v (Prazo expirado)      v (Pedido cancelado)
[baixarEstoquePedido]   [liberarReservaPedido]  [liberarReservaPedido]
       |                       |                       |
       v                       v                       v
estoque -= qty          estoque_reservado -= qty estoque_reservado -= qty
estoque_reservado -= qty       |                       |
       |                       v                       v
       v                Pedido: EXPIRADO        Pedido: CANCELADO
Pedido: PAGO
```

### 3.1 Expiração da reserva

- Reservas de checkout definem um timestamp de expiração (`reserva_expira_em`), normalmente entre 15 e 30 minutos no futuro.
- Pedidos criados manualmente pelo painel administrativo definem `reserva_expira_em = NULL`, representando uma retenção persistente que não expira automaticamente.
- Varreduras agendadas ou manuais de reconciliação identificam pedidos pendentes cujo prazo expirou e chamam `liberarReservaPedido` (`functions/lib/stock.ts`) para diminuir `estoque_reservado`, devolvendo a quantidade ao estoque disponível.

### 3.2 Baixa física (`baixarEstoquePedido`)

- Quando um pedido atinge o status autoritativo `PAGO`, `baixarEstoquePedido` converte a retenção temporária em baixa física permanente.
- Cada item controlado em `pedido_itens` é atualizado para `estoque_estado = 'BAIXADO'`.
- A linha do produto correspondente é atualizada:
  ```sql
  UPDATE produtos
  SET estoque = estoque - ?,
      estoque_reservado = estoque_reservado - ?,
      disponivel = CASE ... END,
      atualizado_em = CURRENT_TIMESTAMP
  WHERE id = ?;
  ```
- Essa conversão é idempotente: se um pedido já está marcado como `BAIXADO`, chamadas repetidas não produzem efeito.

---

## 4. Integração com o gateway de pagamentos (Mercado Pago)

O gateway autoritativo para Pix e transações online é o **Mercado Pago** (`/v1/payments`).

### 4.1 Verificação de referência em memória (`paymentSync`)

Webhooks recebidos de provedores de pagamento são notificações de rede não autenticadas que podem sofrer atrasos, repetições ou falsificação. A aplicação implementa um padrão de verificação em memória durante a execução:

1. **Notificação por webhook**:
   - O endpoint (`functions/api/webhooks/mercadopago.ts`) recebe o evento e extrai o ID externo do pagamento (`data.id`).
   - Webhooks não alteram diretamente o status do pedido ou do registro financeiro.
2. **Consulta autoritativa**:
   - O Worker executa uma chamada HTTPS autenticada `GET /v1/payments/{id}` à API do Mercado Pago por `fetchMpPayment` (`functions/lib/paymentSync/client.ts`).
3. **Atestação em execução por WeakSet**:
   - Quando `fetchMpPayment` interpreta e congela o objeto de resposta com sucesso, registra sua referência em um `WeakSet` com escopo de módulo:
     ```ts
     const MP_GET_VERIFIED = Symbol("MP_GET_VERIFIED");
     const verifiedMpResponses = new WeakSet<MpPaymentResponse>();
     ```
   - As funções posteriores de reconciliação verificam a presença do objeto por `isVerifiedMpResponse(mp)`.
   - Essa barreira em memória garante, dentro da instância isolada do V8, que somente respostas produzidas por chamadas GET diretas e autenticadas possam acionar liquidação de pagamento e conversão de estoque.

### 4.2 Tratamento de falhas do gateway (`ENVIO_INCONCLUSIVO`)

Ao iniciar pagamentos ou reembolsos:

- **Timeouts de rede e respostas 5xx**:
  - Se ocorrer falha de transporte, timeout de socket ou erro HTTP 5xx durante o envio da operação ao provedor, ela é marcada com `fase='ENVIO_INCONCLUSIVO'` em `pedido_operacoes`.
  - O sistema **não** cancela o pedido nem libera o estoque reservado diante de um resultado inconclusivo.
  - A retenção é preservada até chegar um webhook autoritativo ou uma varredura administrativa de reconciliação confirmar o status definitivo pela API do provedor.
