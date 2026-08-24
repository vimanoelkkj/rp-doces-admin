# Runbook de Pagamentos — R&P Doces

Documento operacional para administração, diagnóstico e resolução de incidentes no fluxo financeiro e de estoque do e-commerce R&P Doces.

---

## 1. Objetivo e Arquitetura

O sistema de pagamentos e estoque do R&P Doces foi projetado sob princípios de **resiliência financeira**, **idempotência estrita**, **blindagem contra overselling** e **observabilidade sem vazamento de dados sensíveis**.

### Componentes Chave:
- **Checkout Pix**: Geração idempotente de cobranças com chave baseada em `client_request_id`, snapshot financeiro imutável e proteção por Rate Limiting atômico (D1).
- **Mercado Pago**: Integração server-side via API `/v1/orders` com validação de payload e chave de idempotência.
- **Reserva Atômica de Estoque**: Garantia relacional via `CHECK (estoque_reservado <= estoque)` e transações atômicas `env.DB.batch()` que impedem venda duplicada de itens concorrentes.
- **Webhooks**: Notificação assíncrona autenticada por assinatura HMAC-SHA256 (`x-signature`). O webhook apenas notifica; o sistema reconsulta a Order oficial no Mercado Pago de forma determinística antes de qualquer transição.
- **Reconciliação Automática**: Polling passivo em segundo plano disparado no carregamento do painel administrativo (`/api/admin/orders`) e na consulta de status pelo cliente (`/api/orders/[token]`), cobrindo atrasos ou quedas de webhooks.
- **Health Financeiro**: Endpoint read-only (`GET /api/admin/health/payments`) para diagnóstico consolidado do banco de dados em tempo real.

---

## 2. Estados Principais do Sistema

### 2.1 Status Financeiro (`status_pagamento`)
- `PENDENTE`: Cobrança Pix gerada aguardando confirmação do emissor.
- `PAGO`: Pagamento aprovado e creditado. **Status terminal protegido contra qualquer regressão**.
- `EXPIRADO`: Cobrança Pix expirada após o TTL (30 minutos) sem confirmação de pagamento.
- `CANCELADO`: Cobrança rejeitada explicitamente ou cancelada pelo gateway.
- `FALHOU`: Falha definitiva no processamento do pagamento.
- `ERRO`: Erro temporário de comunicação/gateway no momento da criação ou incerteza financeira.
- `REEMBOLSADO`: Pagamento estornado administrativamente no Mercado Pago.

### 2.2 Status da Reserva de Estoque (`reserva_status`)
- `SEM_RESERVA`: Pedidos legados ou criados sem reserva temporária.
- `ATIVA`: Unidades reservadas temporariamente (`estoque_reservado` incrementado no produto).
- `CONVERTIDA`: Pagamento confirmado (`estoque` físico e `estoque_reservado` decrementados atomicamente).
- `LIBERADA`: Reserva cancelada ou expirada (`estoque_reservado` decrementado sem afetar `estoque` físico).

### 2.3 Combinações de Estados (Matriz Operacional)

| Combinação | Classificação | Significado Operacional |
| :--- | :---: | :--- |
| `PENDENTE` + `ATIVA` | **Normal** | Cobrança Pix aberta aguardando cliente pagar dentro do TTL. |
| `PAGO` + `CONVERTIDA` | **Saudável (Final)** | Pedido pago com baixa física de estoque e reserva concluídas com sucesso. |
| `PAGO` + `ATIVA` | **Anomalia Recuperável** | Pagamento confirmado pelo gateway, mas a conversão transacional de estoque falhou temporariamente ou está em processamento. O sistema mantém a reserva para evitar venda a outro cliente. A reconciliação automática converte para `CONVERTIDA`. |
| `ERRO` + `ATIVA` | **Conservador (Fail-Safe)** | Houve erro de comunicação ou timeout no checkout após a criação da Order poder ter ocorrido no MP. A reserva é mantida preventivamente para evitar overselling até confirmação definitiva na reconciliação. |
| `EXPIRADO` + `LIBERADA` | **Saudável (Final)** | Pedido não foi pago no prazo; unidades devolvidas com segurança ao estoque disponível. |
| `CANCELADO` + `LIBERADA` | **Saudável (Final)** | Pedido cancelado e reserva liberada. |
| `REEMBOLSADO` + `CONVERTIDA` | **Saudável (Final)** | Reembolso financeiro registrado. O estoque físico não é devolvido automaticamente (requer ajuste manual de mercadoria recebida). |

---

## 3. Health Financeiro (`GET /api/admin/health/payments`)

Endpoint autenticado para verificação imediata da integridade de pagamentos e estoque.

### Status Retornados:
- `healthy`: Nenhuma anomalia ativa no banco de dados.
- `warning`: Existem reservas ativas vencidas ou pedidos em erro segurando reserva.
- `critical`: Existem pedidos pagos sem baixa de estoque confirmada ou erros com reservas há muito vencidas.

### Métricas Diagnósticas e Tolerâncias:
1. `pagos_sem_baixa_estoque`:
   - Pedidos com `status_pagamento = 'PAGO'` e `estoque_baixado_em IS NULL`.
   - **Tolerância**: Aplica margem de **2 minutos** (`pago_em <= datetime('now', '-2 minutes')`) para não disparar falso alarme durante a transição natural imediata pós-webhook.
2. `reservas_vencidas_ativas`:
   - Pedidos com `reserva_status = 'ATIVA'` e `reserva_expira_em <= datetime('now', '-5 minutes')`.
   - **Tolerância**: Aplica margem de **5 minutos** para permitir que o ciclo normal de polling/webhook libere o pedido antes de gerar alerta.
3. `erros_com_reserva_ativa`:
   - Pedidos com `status_pagamento = 'ERRO'` e `reserva_status = 'ATIVA'`.
4. `erros_com_reserva_vencida`:
   - Pedidos com `status_pagamento = 'ERRO'`, `reserva_status = 'ATIVA'` e `reserva_expira_em <= datetime('now', '-5 minutes')`.

---

## 4. Consultas Seguras em Produção (Wrangler / Cloudflare D1)

Execute consultas administrativas seguras via CLI do Cloudflare:

```bash
# Consultar pedidos PAGO sem baixa de estoque
npx wrangler d1 execute rp-doces-db --remote --command "SELECT id, status_pagamento, reserva_status, estoque_baixado_em, pago_em, atualizado_em FROM pedidos WHERE status_pagamento = 'PAGO' AND estoque_baixado_em IS NULL;"

# Consultar reservas ativas e seus prazos de expiração
npx wrangler d1 execute rp-doces-db --remote --command "SELECT id, status_pagamento, reserva_status, reserva_expira_em, atualizado_em FROM pedidos WHERE reserva_status = 'ATIVA' ORDER BY reserva_expira_em ASC LIMIT 20;"

# Consultar estado operacional de um pedido específico por ID
npx wrangler d1 execute rp-doces-db --remote --command "SELECT id, status_pagamento, reserva_status, mp_order_id, mp_status, estoque_baixado_em, reserva_expira_em FROM pedidos WHERE id = 123;"

# Consultar integridade de produtos e cotas de reserva
npx wrangler d1 execute rp-doces-db --remote --command "SELECT id, nome, estoque, estoque_reservado, (estoque - estoque_reservado) AS disponivel_real FROM produtos WHERE ativo = 1;"
```

> [!NOTE]
> **Nunca execute queries em produção que projetem colunas com dados pessoais** (`cliente_email`, `cliente_whatsapp`, `cliente_nome`, `token_publico`, `mp_qr_code`, `pix_copia_cola`).

---

## 5. Procedimentos de Resolução de Incidentes

### 5.1 Incidente: Pedido PAGO sem Baixa de Estoque (`pagos_sem_baixa_estoque > 0`)

1. **NÃO altere o estoque manualmente na tabela `produtos`**.
2. Consulte o pedido no D1 usando a query de diagnóstico por ID (Seção 4).
3. Abra a aba de pedidos do painel administrativo (`/admin/?tab=pedidos`):
   - A listagem de pedidos aciona automaticamente a rotina de reconciliação de pedidos pagos sem baixa (`reconcilePaidOrdersWithoutStock`).
4. Verifique os logs estruturados no Cloudflare Pages:
   - `payment.paid` $\rightarrow$ confirmação recebida.
   - `stock.conversion_failed` $\rightarrow$ falha transacional ou insuficiência física.
   - `reconciliation.recovered` $\rightarrow$ baixa recuperada com sucesso.
5. Se o produto realmente não possuir estoque físico suficiente para converter a reserva (ex.: perda física na cozinha):
   - Avalie o estorno do pagamento diretamente no painel do Mercado Pago.
   - Após o reembolso no MP, a sincronização atualizará o pedido para `REEMBOLSADO`.

---

### 5.2 Incidente: Reserva Vencida ainda ATIVA (`reservas_vencidas_ativas > 0`)

1. Verifique o status financeiro do pedido no D1.
2. O sistema é **fail-safe**: a reserva permanece ativa enquanto houver qualquer dúvida sobre a existência de uma cobrança aprovada no gateway.
3. Não force liberação manual de reserva se o Mercado Pago estiver instável ou fora do ar.
4. Ao restabelecer a comunicação com o gateway, a abertura do painel administrativo ou a consulta pública da página do pedido consulta o endpoint `/v1/orders/{id}` no MP:
   - Se o MP confirmar `expired` ou `canceled`, a reserva é liberada (`LIBERADA`) e o log `stock.reservation_released` é emitido.
   - Se o MP confirmar `processed`, o pedido é convertido para `PAGO` e o estoque baixado.

---

### 5.3 Incidente: Health Financeiro com Status `critical`

1. **Identifique a prioridade**:
   - 1ª Prioridade: `pagos_sem_baixa_estoque` (cliente pagou mas mercadoria não está garantida).
   - 2ª Prioridade: `erros_com_reserva_vencida` (reserva presa por falha anterior não resolvida).
2. Acesse o painel administrativo para permitir o ciclo de auto-reconciliação.
3. Consulte os logs com nível `error` filtrando por `event: "stock.conversion_failed"` ou `event: "webhook.error"`.
4. Confirme no dashboard do Mercado Pago se as transações foram efetivamente liquidadas antes de qualquer contato com o cliente.

---

### 5.4 Incidente: Webhook do Mercado Pago Falhando

1. Verifique os logs operacionais:
   - `webhook.invalid_signature`: indica que o secret `MP_WEBHOOK_SECRET` nas variáveis de ambiente do Cloudflare está incorreto ou desatualizado em relação ao configurado no painel do Mercado Pago.
   - `webhook.error`: falha de parsing ou banco de dados indisponível.
2. **Impacto mitigado**: A reconciliação sob demanda (polling na listagem administrativa e na tela de acompanhamento do cliente) atua como **segunda linha de defesa** automática. O cliente e o lojista não perdem a confirmação do pagamento.

---

### 5.5 Incidente: Notificações Web Push Falhando (`push.failed`)

- O evento `push.failed` indica que o endpoint de push do navegador do lojista retornou erro HTTP ou expirou.
- **Impacto**: Notificações push são puramente informativas e **não afetam** o status financeiro, a baixa de estoque ou a integridade do pedido.
- O lojista pode renovar a inscrição de push no painel de configurações `/admin`.

---

## 6. Segurança Operacional

Para preservar a conformidade e a segurança do e-commerce:

1. **Nunca cole chaves secretas** (`MP_ACCESS_TOKEN`, `RATE_LIMIT_SECRET`, `MP_WEBHOOK_SECRET`) em tickets de suporte, logs, issues ou chats públicos.
2. **Nunca altere manualmente contadores de `estoque_reservado`** via comandos diretos de `UPDATE` no D1 sem usar a API da aplicação.
3. **Nunca marque um pedido como `PAGO` manualmente no banco** sem que a transação esteja comprovadamente creditada na conta do Mercado Pago.
4. **Nunca delete registros da tabela `pedidos`** para "limpar" inconsistências: a rastreabilidade financeira e o histórico de auditoria dependem da permanência dos registros.

---

## 7. Checklist de Deploy em Produção

### Antes do Deploy (Validação Prévia)
- [ ] Executar suíte de testes completa localmente (`npm test` com todos os testes passando verde).
- [ ] Verificar `git status` limpo (sem arquivos modificados soltos ou não rastreados).
- [ ] Garantir que todas as migrations até a `019_estoque_reservado.sql` foram aplicadas no D1 de produção.
- [ ] Validar variáveis de ambiente configuradas no Cloudflare Pages:
  - `MP_ACCESS_TOKEN` (chave de produção do Mercado Pago)
  - `MP_WEBHOOK_SECRET` (segredo HMAC configurado no Webhook do MP)
  - `RATE_LIMIT_SECRET` (chave de alta entropia para hashing de rate limiting)
  - `APP_URL` / Domínio de produção configurado.

### Execução do Deploy
```bash
# 1. Enviar alterações para a branch principal
git push origin main

# 2. Deploy para o Cloudflare Pages
npx wrangler pages deploy public --project-name rp-doces
```

### Verificação Pós-Deploy (Smoke Tests)
- [ ] Acessar a loja pública e verificar carregamento de produtos e estoque disponível.
- [ ] Acessar o painel administrativo (`/admin`) e realizar login com sucesso.
- [ ] Verificar o endpoint de saúde: `GET /api/admin/health/payments` deve responder `200 OK` com `status: "healthy"`.
- [ ] Realizar um checkout Pix de teste e verificar geração de QR Code e chave Pix Copia e Cola.
- [ ] Testar retry idempotente (recarregar página de checkout com mesmo pedido) e verificar retorno imediato do mesmo Pix sem duplicar reserva.
- [ ] Confirmar que o `estoque_reservado` reflete a reserva ativa.
- [ ] Verificar que tentativas de compra da última unidade esgotada retornam `409 Conflict`.
- [ ] Inspecionar o Cloudflare Log Streaming e certificar-se de que **nenhum secret, token, QR Code ou PII** apareceu nos logs.
