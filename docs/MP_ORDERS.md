# Migração para Mercado Pago Orders (Cutover)

## Escopo e autoridade

Novas cobranças Pix utilizam `POST /v1/orders`; leituras autoritativas utilizam `GET /v1/orders/{ORD}`. Buscas utilizam `GET /v1/orders`, cancelamentos utilizam `POST /v1/orders/{ORD}/cancel` e reembolsos utilizam `POST /v1/orders/{ORD}/refund`. O endpoint de webhook permanece `/api/webhooks/mercadopago`, recebendo o evento **Order** do Mercado Pago (`type=order`) sob o protocolo HMAC já existente. Os endpoints da Payments API foram completamente removidos do código ativo, incluindo diagnósticos, polling, sweeps e rotinas de recuperação.

`pedido_pagamentos.mp_order_id` armazena o identificador ORD e `mp_payment_id` armazena a transação PAY. O índice parcial único de ORD e a amarração contábil (ledger) já existentes são suficientes; nenhuma migration ou coluna adicional de reembolso é necessária. Intenções de reembolso obtêm o ORD a partir da relação com o pagamento existente e validam a identidade do PAY antes do envio. Identificadores de reembolso (REF) são persistidos de forma independente dos pagamentos.

A autoridade imutável `VerifiedMpOrder` é emitida exclusivamente pelo cliente de GET da Orders API e registrada em um `WeakSet` privado. Respostas de POST/search e objetos clonados não adquirem essa autoridade. Os nomes de compatibilidade `fetchMpPayment` e `MpPaymentResponse` apontam para este novo contrato; eles não chamam a Payments API.

## Diferenças de protocolo e payload (Wire differences)

- `type=online`, `processing_mode=automatic`, exatamente uma transação `pix/bank_transfer`.
- Valores monetários são formatados como **strings** decimais, com exatamente duas casas decimais derivadas de centavos inteiros, sem divisão por ponto flutuante. Tanto o total da ordem quanto o valor da transação precisam coincidir com o pagamento local antes da aprovação. O campo `paid_amount` é retido para diagnóstico, mas não é assumido como valor bruto: os exemplos oficiais da documentação indicam valores líquidos.
- `expiration_time=PT30M` é o único campo de validade enviado e preserva a duração inicial já praticada; `date_of_expiration` (herdado da Payments API) não é enviado, pois os guias de Pix e boleto da Orders API documentam apenas `expiration_time`. O prazo limite de recuperação (A1) é `pedido_operacoes.criado_em` somado a essa duração (parser ISO 8601 estrito, até 30 dias); um `mp_request` legado com `date_of_expiration` absoluto continua sendo lido primeiro. Uma expiração absoluta retornada pela API tem precedência; caso contrário, a data remota `created_date` somada à duração retornada fornece a expiração. Nenhum relógio local estabelece autoridade financeira.
- O mapeador reconhece explicitamente `action_required/waiting_transfer`, `processed/accredited`, `canceled`, `expired` e `refunded`. Estados desconhecidos são fechados para aprovação (_fail-closed_). Capturas divergentes entre o nó raiz e a transação permanecem inconclusivas. O campo persistido `mp_status` retém o vocabulário de compatibilidade exigido pelas travas SQL existentes; os status originais da Orders API são preservados no snapshot verificado.
- Nenhuma exigência de moeda foi criada. `country_code` aceita `BR` e `BRA` como Brasil por meio de uma validação compartilhada única. Valores ausentes, nulos ou vazios não bloqueiam o fluxo; outros valores não vazios resultam em `INTEGRIDADE_MP:PAIS_DIVERGENTE`. Todas as outras proteções de identidade, valor, método e status permanecem inalteradas.
- Apenas a configuração de Pages no ambiente de staging define a variável não secreta de servidor `MP_TEST_MODE=orders_pix`. Ela seleciona `test_user_br@testuser.com` e `APRO` para o simulador oficial de Pix no checkout, admin e diagnósticos. Em produção/padrão, os dados reais do pagador são preservados; não há inferência por formato de token, hostname ou flags do Vite. Essa variável não seleciona credenciais nem dispara requisições para sandbox externo.
- Referências externas (`external_reference`) contendo caracteres fora de letras, números, hífen e sublinhado, ou que excedam o limite documentado de 64 caracteres, utilizam uma representação determinística em SHA-256, persistida em `pedido_operacoes.mp_request` antes do envio. Chaves A1 e chaves locais de idempotência de pagamento permanecem inalteradas. A API Checkout Orders aceita cabeçalhos de até 128 caracteres; chaves remotas derivadas que excedam esse limite também são representadas por SHA-256 determinístico e persistidas antes do envio. Chaves já dentro do limite do cabeçalho mantêm seu valor exato. Referências de diagnóstico preservam o namespace permitido `ADMIN_DIAG_PIX_`.
- A busca utiliza uma janela fixa que vai desde 5 minutos antes da criação da operação até 1 hora depois. Uma página incompleta é considerada indisponível, e não um candidato único. Zero resultados significa ausência observada, não recusa; múltiplos resultados são tratados como ambíguos. As políticas existentes de CAS, controle de taxa (throttle), tamanho de lote e TTL com margem de segurança permanecem ativas.
- HTTP 402 pode descrever uma ordem criada com transações que falharam; 409/423 podem descrever conflitos de concorrência/idempotência. Todos permanecem ambíguos, assim como timeouts, falhas de rede e erros 408/429/5xx. Recusas de validação mantêm sua classificação existente.
- Reembolsos totais não enviam corpo na requisição. Reembolsos parciais enviam `{ "transactions": [{ "id": "PAY...", "amount": "1.00" }] }`. A recuperação de um REF conhecido consulta a ordem e exige a correspondência exata de REF, PAY e valor; valores iguais nunca identificam intenções distintas de reembolso. Antes do envio, um GET mapeia todos os IDs de REF e persiste essa linha de base (baseline), juntamente com ORD e PAY, em `pedido_operacoes.resultado` sob CAS. O campo imutável `mp_request` é preservado intacto. A associação exige exatamente um novo REF compatível fora do conjunto original da baseline. Dessa forma, múltiplos reembolsos de mesmo valor podem ser liquidados separadamente. Envios desconhecidos em um mesmo PAY retêm a janela de associação; múltiplos novos REFs compatíveis permanecem inconclusivos com alerta operacional emitido. Retentativas nunca renovam a linha de base nem selecionam arbitrariamente o primeiro ou último reembolso.
- Retentativas de reembolso que recebam 409 (incluindo `idempotency_key_already_used`) mantêm a mesma chave remota e reconciliam via GET na Orders API contra a linha de base persistida. Um REF compatível e único é materializado apenas uma vez; evidências insuficientes mantêm o estado inconclusivo com a capacidade reservada e alerta operacional disparado.
- Uma confirmação (ACK) de cancelamento nunca autoriza a operação B. A regeneração consulta a operação A de forma autoritativa antes que sua sucessora seja criada. Tetos financeiros, concessão de envio (dispatch lease), proteção contra replay, contabilidade separada de reembolsos, projeções de reserva e rollback de lote permanecem rigorosamente preservados.
- Notificações com `type=order` e assinatura HMAC válida cujo `data.id` não tem o formato `ORD...` (o simulador oficial do Mercado Pago usa um id fictício, como `123456`) respondem 200 sem GET e sem efeito; a assinatura continua sendo validada antes desse guard. A assinatura vale para o manifest oficial (`data.id` como recebido) e, só para `data.id` no formato `ORD...`, também para o mesmo manifest com `data.id` em minúsculas, que é como o sandbox do Orders assina (comprovado em staging); nenhuma outra variante é aceita. Uma falha de assinatura (401) registra apenas um diagnóstico estrutural temporário (presença de `x-signature`, `x-request-id`, `ts` e `v1`, origem, tamanho, formato e caixa do `data.id`, partes do manifest), nunca valores.

Os campos da resposta para o frontend permanecem inalterados. Diagnósticos não possuem linha de pagamento persistida no banco: o campo opaco existente `mpPaymentId` trafega no formato `ORD...:PAY...` de ponta a ponta pela interface sem alterações. Esse envelope exclusivo de diagnóstico é interpretado e validado no servidor; a coluna `mp_payment_id` no banco de dados armazena sempre apenas o identificador PAY.

## Pré-requisitos para o Cutover

Esta branch não realiza deploy, provisionamento, migração remota de banco, configuração de credenciais ou pagamentos reais. Antes de um cutover aprovado separadamente, todas as cobranças da Payments API legada e intenções pendentes de reembolso sob a integração antiga devem ser esgotadas e reconciliadas. IDs numéricos legados de PAY não podem ser convertidos em IDs ORD. Registros sem identificador ORD operam em modo fail-closed; reembolsos permanecem inconclusivos em vez de serem enviados para um recurso presumido.

A expiração local também se recusa a liberar reservas de pagamentos legados conhecidos sem um ORD consultável; a perda da capacidade de consultar a Payments API não constitui evidência de não pagamento. Tais registros exigem reconciliação explícita prévia. Registros legados são excluídos dos lotes limitados de expiração e reconciliação da Orders API, não causando starvation de novas ordens ORD elegíveis. O sweep de expiração grava uma marcação de diagnóstico uma única vez e emite um alerta limitado `MP_LEGACY_CUTOVER_BLOCKED` sem alterar o status do pagamento legado ou liberar sua reserva. Reembolsos despachados anteriormente sem baseline persistida e sem REF conhecido também operam em fail-closed para reconciliação manual.

Não realize deploy sobre operações legadas não resolvidas nem introduza mecanismos não documentados de fallback para a Payments API. Preserve os registros históricos e os fatos contábeis/financeiros.

Configure a assinatura de eventos de Order exclusivamente em um ambiente de testes isolado e homologado. Confirme o suporte da conta a Orders/Pix/reembolso e as políticas de credenciais de sandbox: a documentação oficial de busca indica que credenciais de teste não são suportadas nessa rota e recomenda usuários de teste. Esta implementação não lê nem seleciona credenciais reais. Não contorne limitações de sandbox utilizando tokens de produção ou dinheiro real.

## Contratos oficiais

- [Criar ordem (Create order)](https://www.mercadopago.com.br/developers/en/reference/online-payments/checkout-api/create-order/post)
- [Consultar ordem (Get order)](https://www.mercadopago.com.br/developers/en/reference/online-payments/checkout-api/get-order/get)
- [Buscar ordens (Search orders)](https://www.mercadopago.com.br/developers/en/reference/online-payments/checkout-api/search-order/get)
- [Cancelar ordem (Cancel order)](https://www.mercadopago.com.br/developers/en/reference/online-payments/checkout-api/cancel-order/post)
- [Reembolsar ordem (Refund order)](https://www.mercadopago.com.br/developers/en/reference/online-payments/checkout-api/refund-order/post)
- [Pix](https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/payment-integration/websites/pix)
- [Notificações (Webhooks)](https://www.mercadopago.com.br/developers/en/docs/checkout-api-orders/notifications)
- [Erros de integração do Checkout Orders](https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/payment-management/integration-errors/api)

## Registro de validação local

- Antes das alterações de produção: 169/169 testes passaram nos seis arquivos legados cobrindo A1, recuperação B3, integridade, reembolso, cancelamento e recuperação de reembolso (61,19 s).
- Após a migração: 974/974 testes passaram em 37 arquivos direcionados (318,75 s), com zero falhas, pulos ou cancelamentos. O novo arquivo `mp-orders.test.mjs` possui 48 testes, incluindo nove controles negativos comportamentais independentes. Âncoras de mutação devem existir e a compilação deve ter sucesso antes que uma asserção conte como detecção.
- Checagens de tipo (typecheck) do frontend e das functions, build, Biome, Prettier e `git diff --check` passaram sem erros. Nenhum arquivo inesperado de zero bytes foi gerado; apenas o `.gitkeep` já existente da migration.
- Nenhum `npm test` completo, pagamento remoto, injeção de credenciais, secrets, deploy, migração remota ou commit foi realizado. A validação em sandbox do provedor permanece pendente.

## Verificação pós-auditoria

O defeito de reembolso com valores idênticos foi reproduzido com duas intenções distintas antes da correção: REFA se materializava enquanto a segunda intenção permanecia inconclusiva. A regressão agora exige que REFA e REFB se materializem em suas respectivas intenções, incluindo recuperação por REF conhecido e replay. A linha de base une os IDs observados remotamente com os REFs conhecidos/materializados localmente.

Validação direcionada final: 442/442 testes em 14 arquivos, zero falhas/pulos/cancelamentos (142,81 s). O novo arquivo de auditoria possui 25 testes, incluindo quatro mutantes comportamentais; um mutante de no-op no webhook e dois controles negativos de configuração também foram adicionados. Após a rejeição de frames de baseline incompletos ou inválidos, os três arquivos de Orders e reembolso foram reexecutados: 108/108 passaram (36,87 s), sem falhas ou pulos. Checagens de tipo do frontend e functions, build, checagem do Biome em 21 arquivos, Prettier nos arquivos suportados, validação de provisionamento da configuração de staging e checagens de diff e arquivos de zero bytes passaram. Nenhuma suíte completa, credenciais reais, secrets, deploy, migração remota ou commit foi realizado.

Arquivos de teste afetados:

- `tests/mp-orders.test.mjs`
- `tests/mp-orders-audit.test.mjs`
- `tests/comanda-viva-mp-refund-recovery.test.mjs`
- `tests/pix-mp-refund-excl-mutua-assimetrica.test.mjs`
- `tests/comanda-viva-add-item.test.mjs`
- `tests/b4.test.mjs`
- `tests/admin-order-void-estorno.test.mjs`
- `tests/anulacao-pix-pendente.test.mjs`
- `tests/payment-sync-integrity.test.mjs`
- `tests/admin-diagnosticos.test.mjs`
- `tests/operational-alerts.test.mjs`
- `tests/mp-pagamento-estorno-timeout.test.mjs`
- `tests/staging-environment.test.mjs`
- `tests/item-exchange-refactor-harness.test.mjs`

## Pontos de integração e arquivos

| Ponto de integração legado            | Integração Orders correspondente                                                      |
| ------------------------------------- | ------------------------------------------------------------------------------------- |
| Criação em `mpPost.ts`                | POST da Orders API com referência persistida, chave estável e snapshot não verificado |
| Autoridade em `paymentSync/client.ts` | Fachada de compatibilidade para GET verificado em `mp/orders/client.ts`               |
| Busca de recuperação em `mpSearch.ts` | Busca limitada em Orders seguida de GET autoritativo                                  |
| `mpRefund.ts` e `mpRefundIntent.ts`   | Endpoint de reembolso em ORD, transação PAY e identidade independente de REF          |
| Cancelamento em `mpPost.ts`           | POST de cancelamento em ORD seguido de GET autoritativo nos chamadores                |
| Webhook, polling e sweeps             | Evento de Order, consulta em ORD e proteções financeiras compartilhadas inalteradas   |
| Diagnósticos administrativos          | Criação/leitura/reembolso em Orders com tráfego opaco de identidade ida-e-volta       |

Arquivos novos e modificados (sem migrations):

### Produção

- `functions/api/admin/diagnosticos/pix-reembolso.ts`
- `functions/api/admin/diagnosticos/pix-status.ts`
- `functions/api/admin/diagnosticos/pix.ts`
- `functions/api/checkout.ts`
- `functions/api/webhooks/mercadopago.ts`
- `functions/lib/comandaPix.ts`
- `functions/lib/ledger/legacy.ts`
- `functions/lib/mp/orders/client.ts`
- `functions/lib/mp/orders/diagnosticId.ts`
- `functions/lib/mp/orders/status.ts`
- `functions/lib/mp/orders/types.ts`
- `functions/lib/mpPost.ts`
- `functions/lib/mpRefund.ts`
- `functions/lib/mpRefundIntent.ts`
- `functions/lib/mpSearch.ts`
- `functions/lib/operacoes.ts`
- `functions/lib/operationalAlert.ts`
- `functions/lib/paymentSync.ts`
- `functions/lib/paymentSync/client.ts`
- `functions/lib/paymentSync/inconclusiveRecovery.ts`
- `functions/lib/paymentSync/ledgerSync.ts`
- `functions/lib/paymentSync/status.ts`
- `functions/lib/paymentSync/sweeps.ts`
- `functions/lib/paymentSync/webhook.ts`
- `functions/lib/pedidoAnulacao.ts`
- `functions/lib/pedidoStatus.ts`
- `functions/lib/pix/adminCharge.ts`
- `functions/lib/pix/adminRegenerate.ts`
- `src/lib/aguardandoPagamento.ts`

### Testes e fixtures

- `tests/a1.test.mjs`
- `tests/admin-delivered-pix.test.mjs`
- `tests/admin-diagnosticos.test.mjs`
- `tests/admin-order-void-estorno.test.mjs`
- `tests/admin-push-v2.test.mjs`
- `tests/anulacao-pix-pendente.test.mjs`
- `tests/b1.test.mjs`
- `tests/b2-refund-pix.test.mjs`
- `tests/b2.test.mjs`
- `tests/b3-recuperacao.test.mjs`
- `tests/b3.test.mjs`
- `tests/b4.test.mjs`
- `tests/cancelamento-pix.test.mjs`
- `tests/checkout-rate-limit.test.mjs`
- `tests/comanda-viva-add-item.test.mjs`
- `tests/comanda-viva-mp-refund-recovery.test.mjs`
- `tests/financial-coverage-lineage.test.mjs`
- `tests/helpers/b3.mjs`
- `tests/helpers/mp-orders.mjs`
- `tests/item-exchange-refactor-harness.test.mjs`
- `tests/mp-busca-timeout.test.mjs`
- `tests/mp-corpo-travado-fluxos.test.mjs`
- `tests/mp-orders-audit.test.mjs`
- `tests/mp-orders.test.mjs`
- `tests/mp-pagamento-estorno-timeout.test.mjs`
- `tests/operational-alerts.test.mjs`
- `tests/payment-sync-integrity.test.mjs`
- `tests/pix-mp-refund-excl-mutua-assimetrica.test.mjs`
- `tests/public-pedido-reconcile.test.mjs`
- `tests/push-outbox.test.mjs`
- `tests/r3-hardening.test.mjs`
- `tests/staging-environment.test.mjs`

### Configuração e scripts

- `scripts/check-staging-config.mjs`
- `wrangler.staging.toml`

### Documentação

- `README.md`
- `docs/MP_ORDERS.md`
- `docs/STAGING.md`
- `docs/architecture/pix-and-stock.md`
