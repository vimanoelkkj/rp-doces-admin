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

<a id="43-unreconciled-remote-capture"></a>

### 4.3 Captura remota não conciliada (divergência de integridade)

Quando o `GET /v1/orders/{ORD}` mostra o Pix confirmado, mas a conferência de integridade (valor, referência, método, país, status da ordem e da transação) ou a matriz de transição recusa o pagamento, o ledger **não** marca o pedido como pago e **não** baixa nem libera estoque. A linha de `pedido_pagamentos` guarda `mp_status` (`approved` ou `refunded`) e o diagnóstico `INTEGRIDADE_MP:*` em `mp_status_detail`.

Esse fato persistido é a fonte da visibilidade administrativa; o log (`OPERATIONAL_ALERT`) é só telemetria:

- **Listagem:** o pedido do site entra na listagem administrativa (`capturaRemotaNaoConciliadaSql`), sempre com o status financeiro real (não pago). Não há teto: todos ficam localizáveis por página, busca e abas.
- **Notificações:** `pagamento:<id>:nao-conciliado:<approved|refunded>` (tipo `OPERACAO`, destino no pedido, motivo no texto). A chave inclui o `mp_status`: a devolução depois da captura é outro fato e volta como não lida. O texto descreve a cobrança local como aprovada ou devolvida no provedor, nunca como valor pago, porque o valor confirmado lá pode ser outro (`VALOR_DIVERGENTE`). Vai à frente da lista e fora do teto de recência, para nunca sair por antiguidade. Ordem e idade vêm de `criado_em` do pagamento, que não muda: o instante da captura no provedor só é persistido (`pago_em`) quando o ledger a aceita, e `atualizado_em` é regravado a cada repoll. Vale o limite de 12 desta fonte (as operações inconclusivas têm o seu): acima disso os mais antigos continuam na listagem e entram nas notificações conforme os primeiros forem conciliados.
- **Detalhe:** o bloco `PIX_MP_INTEGRIDADE` do pedido continua sendo o ponto de intervenção.
- **Cobrança:** enquanto o pedido tiver uma captura não conciliada, nenhuma cobrança nova nasce nele. Pagamento manual, Pix administrativo novo e regeneração de Pix respondem `409 CAPTURA_MP_NAO_CONCILIADA` (antes de qualquer claim A1 ou chamada ao Mercado Pago) e `capacidadeCobravelCentavos` vale 0, para qualquer valor, pagamento parcial ou quantidade de pagamentos; o detalhe do pedido expõe o fato como `capturaMpNaoConciliada`. A condição também está dentro do CAS de capacidade (`chargeableCapacitySql`, a mesma expressão da leitura e da escrita), então vale sob concorrência; novas regenerações estão suspensas com `409 PIX_REGENERACAO_SUSPENSA`: depois da identidade/claim A1, a operação termina `RECUSADA` antes de qualquer GET, cancelamento ou POST remoto, sem alterar pagamentos ou estoque. O claim por predecessor não congela a autorização financeira do pedido durante a rede; uma releitura antes do POST ou CAS depois dele não fecha essa corrida. Reabrir a regeneração exige autorização durável por pedido respeitada por todos os caminhos que criam cobranças ou reduzem o saldo. Replays históricos e recuperação de sucessores já criados permanecem disponíveis, sem novo POST. Falha ao gravar a recusa mantém o claim inconclusivo para observação, nunca reenvio. Esta regra não bloqueia o replay A1 de operação já concluída, a conciliação por GET verificado, a recuperação de operações inconclusivas nem os reembolsos; a anulação mantém as próprias recusas (`PIX_JA_PAGO`, `PIX_ESTADO_INVALIDO`). A cobrança volta a ser aceita sozinha quando o pagamento é conciliado. Limitação conhecida: uma captura em `CANCELADO`/`FALHOU`, ou cuja identidade no provedor diverge, não se resolve sozinha (a matriz de transição e a conferência de identidade a recusam) e o pedido segue sem aceitar cobrança; ainda não existe ação administrativa auditada para encerrar essa divergência.

Tudo some sozinho quando um GET verificado concilia o pagamento (`PAGO` ou `REEMBOLSADO`). Nada disso concede autoridade financeira.

Custo: a sondagem por pedido usa o índice parcial `idx_pedido_pagamentos_captura_nao_conciliada` (migration 0039), cujo `WHERE` precisa permanecer idêntico ao helper; sem ele o resultado é o mesmo, só mais lento (com 20 mil pedidos, `counts` lê ~188 mil linhas em vez de ~20 mil). Um teste de plano de execução trava esse acoplamento.
