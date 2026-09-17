# A1 — Investigação de idempotência

> Investigação concluída em 17/09/2026.
>
> Este documento preserva as evidências e reproduções já realizadas para evitar
> repetição desnecessária de investigação em sessões futuras.
>
> IMPORTANTE:
> - não refazer esta investigação do zero;
> - usar as reproduções abaixo como baseline já estabelecido;
> - antes de gastar contexto reproduzindo cenários, verificar se a implementação
>   atual realmente divergiu deste documento;
> - este documento registra o estado ANTES da implementação A1;
> - o estado corrente do projeto continua documentado em `docs/ESTADO_ATUAL.md`.
>
> Branch investigada: `rebuild-from-scratch`
> HEAD investigado: `0e388efc9a545b3895d51524e7b821db6400aa4b`


**A1 é reproduzível hoje.** A mesma intenção pode gerar dois pagamentos manuais, dois refunds parciais, dois pedidos ADMIN já pagos ou dois checkouts com cobranças Pix distintas. Os guards atuais protegem saldo e estoque, mas não preservam a identidade da operação.

A investigação terminou sem implementação.

## 1. ESTADO ATUAL

Li integralmente `README.md` e `docs/ESTADO_ATUAL.md` antes da investigação.

| Verificação | Resultado |
|---|---|
| Repositório | `C:\Users\vitormanoel\dev\rp-doces` |
| Branch | `rebuild-from-scratch` |
| HEAD | `0e388efc9a545b3895d51524e7b821db6400aa4b` |
| Upstream | `origin/rebuild-from-scratch` |
| Ahead/behind | `0 / 0`, considerando a referência local, sem fetch |
| Working tree | Limpo antes e depois |
| `git diff --check` | Sem problemas |

Commits recentes:

```text
0e388ef bloqueia edicao destrutiva de itens
0e0924f documenta estado atual da engenharia
50d8cfd protect reservations across concurrent Pix attempts
c3279d4 recover verified payments after local Pix expiration
ff8d8d7 make financial reconciliation convergent
dc37147 update README closing Pix administrativo step 9
660651b wire admin Pix generation and regeneration UI
40d034e add admin Pix regeneration with atomic successor guard
```

**Divergência documental:** B1 já está commitado no HEAD atual. `ESTADO_ATUAL.md` ainda o descreve como alteração sem commit.

Nenhum arquivo do repositório foi alterado. Não houve commit, push, deploy, acesso ao D1 remoto ou uso de `--remote`.

## 2. WRITERS MAPEADOS

Os cinco writers de criação expostos por POST geram identidade aleatória **no servidor, a cada chamada**. Nenhum aceita uma chave de operação estável do cliente.

| Endpoint / origem | Helper e método financeiro | Escritas de criação | Identidade atual | Retry e concorrência |
|---|---|---|---|---|
| `POST /api/checkout` — SITE | `handleCheckout`; `PIX_MP` | Pedido, itens, pagamento pendente, alocações, reserva e POST MP | UUID para `idempotency_key` e outro para `token_publico` | Repetição cria outro conjunto completo, havendo estoque |
| `POST /api/admin/pedidos` — MANUAL / ADMIN | Handler; `DINHEIRO`, `CARTAO`, `PIX_EXTERNO`, `A_COMBINAR` | Pedido, itens, pagamento, alocações e reserva; baixa se nasce pago | Dois UUIDs; pedido e pagamento compartilham a mesma key | Repete inclusive pedido já pago; proteção de estoque não deduplica intenção |
| `POST /api/admin/pedidos/:id/pagamentos` — ADMIN | `registerAdminPayment`; métodos manuais | Pagamento `PAGO` e alocações; cancela placeholders locais elegíveis | UUID novo por chamada | Duas operações passam se ambas couberem no saldo |
| `POST /api/admin/pedidos/:id/reembolsos` — MANUAL | `registerManualRefund`; métodos manuais | Reembolso `REEMBOLSADO` | UUID novo por chamada | Duas devoluções parciais passam se couberem no reembolsável |
| `POST /api/admin/pedidos/:id/pix` — ADMIN | `createAdminPixCharge`; `PIX_MP` | Pagamento pendente, alocações, aquisição condicional de reserva e POST MP | UUID novo; usado também como referência externa | Parciais podem duplicar; capacidade e sucessor vivo restringem alguns casos |
| `GET /api/pedido` e `GET /api/pedido-status` — legado | `refreshPedidoStatus` → `resolveLedgerPaymentId` → `ensureLegacyPaymentMaterialized` | Pagamento legado e alocações | Key persistida do pedido; fallback `legacy:<pedidoId>` | Identidade estável, `INSERT OR IGNORE` e UNIQUE protegem materialização repetida |

Fontes principais: [checkout.ts](/C:/Users/vitormanoel/dev/rp-doces/functions/api/checkout.ts:121), [criação ADMIN](/C:/Users/vitormanoel/dev/rp-doces/functions/api/admin/pedidos.ts:330), [pagamento manual](/C:/Users/vitormanoel/dev/rp-doces/functions/lib/comandaLedger.ts:658), [refund](/C:/Users/vitormanoel/dev/rp-doces/functions/lib/comandaLedger.ts:832), [Pix ADMIN](/C:/Users/vitormanoel/dev/rp-doces/functions/lib/comandaPix.ts:188).

Também existem writers de **confirmação e estado derivado**, sem criação de nova cobrança:

- Webhook MP, polling público e reconciliação de `GET /api/admin/pedidos`: atualizam uma tentativa existente por `syncPaymentFromMp`.
- `reconcilePedidoAfterFinancialChange`: recalcula o financeiro e pode executar baixa.
- `baixarEstoquePedido`: converte a reserva ou baixa estoque após liberação, preservando as marcas de baixa.
- `liberarReservaPedido`: libera reserva com os guards B4; também é chamado pelo cancelamento ADMIN e pelos tratamentos de falha.
- `liberarReservasVencidasLocalmente`: expira tentativas SITE elegíveis e passa pelo fluxo de finalização.

**Reserva não tem tabela própria:** seus estados ficam em `pedidos` e sua quantidade agregada em `produtos.estoque_reservado`. Sua identidade é a do pedido.

**Constraints relevantes**

| Estrutura | Proteção efetiva |
|---|---|
| `pedidos` | UNIQUE em `token_publico`, `idempotency_key` e `mp_payment_id` |
| `pedido_pagamentos` | UNIQUE parcial em `idempotency_key` não nula e em `mp_order_id` não nulo |
| `pedido_pagamentos.mp_payment_id` | **Índice comum; não é UNIQUE** |
| `pedido_pagamento_alocacoes` | UNIQUE `(pagamento_id, pedido_item_id)` |
| `pedido_reembolsos` | UNIQUE `idempotency_key`; permite vários refunds por pagamento |
| `produtos` | CHECK de estoque não negativo e reserva entre zero e estoque |

Os UNIQUEs de alocação impedem repetir a mesma associação. Não impedem que **dois pagamentos diferentes** aloquem dinheiro ao mesmo item.

FKs relevantes:

- Itens, pagamentos e reembolsos dependem de pedidos com `ON DELETE CASCADE`.
- Alocações dependem de pagamento e item com `CASCADE`.
- Reembolso depende de pagamento com `CASCADE`.
- `substitui_pagamento_id` usa `SET NULL`.
- Referências a administradores e a produto histórico usam `SET NULL`.

Os índices de consulta cobrem pedido/status/data dos pagamentos; pagamento/item das alocações; pedido/status/data e pagamento/status dos refunds; estados operacionais dos pedidos; e vencimento de reserva ativa. Eles não identificam intenção.

Fontes: [migration 0008](/C:/Users/vitormanoel/dev/rp-doces/migrations/0008_ledger_pagamentos.sql:16), [0009](/C:/Users/vitormanoel/dev/rp-doces/migrations/0009_reembolsos.sql:13), [0010](/C:/Users/vitormanoel/dev/rp-doces/migrations/0010_pedido_pagamentos_mp_payment_id_index.sql:1) e [0011](/C:/Users/vitormanoel/dev/rp-doces/migrations/0011_pedidos_reserva_ativa_index.sql:1).

## 3. REPRODUÇÕES EMPÍRICAS

Executei **38 cenários de investigação**, com:

- Código atual do projeto empacotado em memória.
- D1 local descartável via Miniflare/workerd, criado pelas migrations.
- Constraints e rollback reais do D1 local.
- Barreiras antes da escrita para controlar concorrência.
- Falhas injetadas antes/depois de persistência.
- Mercado Pago simulado, sem credenciais reais.
- Componentes React reais em JSDOM nos três cenários de UI.

As dependências do harness foram instaladas fora do repositório. Não foram acrescentados testes ou endpoints ao projeto.

Nos cenários financeiros, a referência principal foi pedido/pagamento de **R$ 100**.

| Cenário | Resultado observado |
|---|---|
| Pagamento de R$ 30 repetido sequencialmente | `201 + 201`; dois IDs; R$ 60 confirmados |
| Dois pagamentos de R$ 30 concorrentes, leituras anteriores à escrita | `201 + 201`; dois fatos |
| Retry cego após resposta de pagamento perdida | Segundo fato de R$ 30 |
| Pagamento integral de R$ 100 seguido de retry | `201 + 409`; um fato |
| Dois pagamentos integrais concorrentes | Um sucesso e um conflito; um fato |
| Refund de R$ 30 sequencial ou concorrente | Dois refunds; R$ 60 devolvidos no ledger |
| Retry cego após resposta de refund perdida | Segundo refund |
| Refund integral sequencial ou concorrente | Um sucesso e um conflito; um refund |
| Refund R$ 30, depois R$ 50, depois retry dos R$ 30 | Terceiro recusado; restavam R$ 20 |
| D1 confirma pagamento, mas sua resposta é perdida | API devolve `409`; retry cria segundo fato |
| D1 confirma refund, mas sua resposta é perdida | API devolve `500`; retry cria segundo refund |
| Checkout idêntico sequencial ou concorrente | Dois pedidos, pagamentos pendentes, reservas e POSTs MP |
| Checkout interrompido após persistência inicial | Pedido original permanece; retry cria outro |
| Timeout do POST MP | Tentativa original pendente; retry usa outra key |
| MP responde sucesso, mas gravação local seguinte falha | Retry cria outro pedido e faz outro POST |
| Dois checkouts disputando a última unidade livre | Um sucesso; outro rollback; apenas um POST MP |
| Pedido ADMIN já pago repetido | Dois pedidos pagos e duas baixas correspondentes |
| Pix ADMIN parcial repetido | Duas tentativas e dois POSTs; uma reserva por pedido |
| Regeneração repetida com sucessor vivo | Apenas um sucessor |
| Retry da regeneração após sucessor expirar | Novo sucessor e novo POST |
| Materialização legada concorrente | Um pagamento e uma alocação |
| Mesmo `mp_payment_id` inserido em duas linhas do ledger | Banco aceita; resolução do webhook retorna ambiguidade |
| Duas cobranças SITE distintas aprovadas no simulador | Dois pagamentos confirmados; repetir uma aprovação não cria terceiro fato |

**Limite da evidência:** provei o comportamento do aplicativo, do D1 local e das chamadas que ele emite. Não executei testes contra o provedor real. As aprovações e os timeouts externos foram simulados.

## 4. PAGAMENTO MANUAL

**Vulnerável quando o retry ainda cabe no saldo.**

O fluxo atual:

1. Lê comanda e restrições.
2. Calcula alocações.
3. Gera UUID novo.
4. Insere pagamento condicionado ao saldo agregado no instante da escrita.
5. Insere alocações no mesmo batch.
6. Reconcilia pelo B3.

A condição atômica limita o valor total registrado, mas aceita duas parcelas iguais enquanto houver capacidade.

Exemplo comprovado:

```text
Pedido: R$ 100
Intenção: registrar R$ 30 uma vez

Primeira chamada: pagamento 2, R$ 30
Retry:           pagamento 3, R$ 30

Resultado: R$ 60 confirmados
```

Depois de quitar o pedido, o retry normalmente encontra saldo insuficiente. Isso evita outro lançamento naquele estado, mas **não recupera o sucesso anterior**.

B3 protege falhas de reconciliação depois de um fato reconhecidamente persistido. Não resolve resposta HTTP perdida nem perda da confirmação do próprio batch D1. Esta última foi reproduzida.

Há outro caminho obrigatório no escopo financeiro: `POST /api/admin/pedidos` com `statusPagamento=PAGO`. Como cria outro pedido, ele contorna naturalmente o limite financeiro do pedido anterior.

**Não existe cobrança externa de cartão/dinheiro nesses handlers.** A duplicação comprovada é de fatos financeiros confirmados, com possível efeito operacional e físico; não de débito automático em banco ou adquirente.

## 5. REFUND

**Refund parcial é vulnerável à mesma repetição.**

O `INSERT ... SELECT ... WHERE` recalcula atomicamente:

```text
valor do pagamento − refunds confirmados
```

Isso impede ultrapassar o total reembolsável, mas não distingue repetição de nova devolução legítima.

- Parcial com saldo suficiente: duplica.
- Integral repetido: o segundo encontra saldo zero.
- Parcial após mudança de saldo: aceita ou rejeita conforme o saldo atual.
- Resposta perdida: não existe recuperação pelo identificador original.
- Concorrência: o limite monetário funciona; a identidade continua ausente.

**Não foram encontradas chamadas externas de refund.** `PIX_MP` é recusado nesse fluxo, e o teste confirmou zero chamadas externas.

Portanto, hoje ele pode registrar duas devoluções como concluídas. Não há evidência de que o servidor execute duas transferências reais automaticamente. Uma integração futura com refund MP precisará preservar a mesma identidade também no provedor.

## 6. CHECKOUT SITE

**Impacto: combinação de duplicação operacional e criação de cobranças distintas.**

Uma nova chamada pode criar:

- Outro pedido e token público.
- Outra tentativa `PIX_MP/PENDENTE`.
- Outras alocações.
- Outra reserva de estoque.
- Outro POST ao MP com outra key e referência.

Criar duas cobranças Pix não significa que ambas foram pagas. Se o comprador pagar os dois códigos, os dois recebimentos poderão ser confirmados. Essa consequência foi exercitada com duas aprovações simuladas.

A baixa “no máximo uma vez” continua verdadeira **por pedido**. Dois pedidos duplicados podem baixar estoque separadamente.

**Frontend**

Em [AguardandoPagamento.tsx](/C:/Users/vitormanoel/dev/rp-doces/src/pages/AguardandoPagamento.tsx:71), a montagem dispara o POST sem identidade persistida. O cleanup aborta a requisição do navegador, mas não desfaz uma transação que o servidor já aceitou.

Resultados com componentes reais:

| Situação | Resultado |
|---|---|
| Dois submits no mesmo ciclo React | Um POST naquele cenário |
| Desmontar e remontar com o mesmo estado de navegação | Dois POSTs e dois pedidos |
| StrictMode de desenvolvimento, com primeira chamada já aceita antes do abort | Dois POSTs e dois pedidos |

Logo, não afirmo que todo double click produz duplicação. A ausência de proteção aparece quando duas requisições chegam ao servidor, inclusive por remontagem ou retry.

Persistir apenas o carrinho não resolve: ele representa produtos desejados, não a identidade de uma finalização.

## 7. MERCADO PAGO

| Campo | Uso atual | O que efetivamente protege |
|---|---|---|
| `client_request_id` | Ausente dos endpoints, helpers, frontend e migrations | Nada atualmente; foi ignorado nas reproduções |
| `idempotency_key` local | UUID por chamada, exceto materialização legada | Unicidade da tentativa técnica |
| `X-Idempotency-Key` | Enviado nos POSTs SITE e ADMIN | Deduplicação no provedor quando a mesma key é reutilizada conforme seu contrato |
| `external_reference` SITE | `token_publico` | Correlação do webhook com pedido/tentativa SITE |
| `external_reference` ADMIN | Key da tentativa | Correlação inequívoca com tentativa ADMIN |
| `mp_payment_id` | Identificador devolvido pelo MP | Resolução e validação da tentativa remota existente |
| `mp_order_id` | Existe no schema, com UNIQUE | Não participa desses fluxos Payments API |

A documentação oficial da **Payments API** exige `X-Idempotency-Key` e o descreve como proteção contra repetição de pagamentos. O aplicativo envia esse header, mas troca seu valor ao repetir a operação local. [Documentação Pix](https://www.mercadopago.com.br/developers/pt/docs/checkout-api-payments/integration-configuration/integrate-pix), [criação de pagamento](https://www.mercadopago.com.br/developers/pt/reference/online-payments/checkout-api-payments/create-payment/post).

A referência externa é usada para identificar a origem da transação; não substitui a chave de idempotência. No código, ela é usada para resolver o pagamento, sem impedir novos POSTs. [Campos oficiais de relatório](https://www.mercadopago.com.br/developers/en/docs/checkout-pro-preferences/additional-content/reports/released-money/report-use).

**Evidências locais importantes:**

- Mesmo body e mesma chave enviada pelo cliente produziram keys MP diferentes.
- UNIQUEs locais rejeitaram keys repetidas quando inseridas diretamente no D1.
- `pedido_pagamentos.mp_payment_id` repetido foi aceito; o webhook detectou ambiguidade.
- Simulei o provedor devolvendo o **mesmo recurso** em dois checkouts: o segundo falhou no UNIQUE de `pedidos.mp_payment_id`, mas seu pedido e reserva já estavam persistidos.

Portanto, **corrigir apenas o header MP não corrige a duplicação local**.

Não validei empiricamente retenção temporal da key, replay tardio ou respostas concorrentes do MP real. Não proponho assumir deduplicação externa por prazo ilimitado.

## 8. CONCORRÊNCIA / TOCTOU

As barreiras fizeram ambas as chamadas concluírem suas leituras antes de liberar as escritas.

**Proteções existentes comprovadas:**

- Pagamento: limite agregado reavaliado no `INSERT`.
- Refund: saldo reembolsável reavaliado no `INSERT`.
- Checkout: CHECK de estoque derruba todo o batch.
- Pix ADMIN: capacidade e sucessor vivo reavaliados na escrita.
- Materialização legada: key estável e UNIQUE.
- Alocações: UNIQUE por pagamento/item.

**Lacuna A1:** não existe um predicado atômico equivalente a “esta intenção já foi executada”. As duas chamadas possuem UUIDs distintos e são aceitas como operações independentes.

Também confirmei uma dívida concorrente já reconhecida no código:

```text
Dois itens de R$ 50
Dois pagamentos concorrentes de R$ 40

Total confirmado: R$ 80 — dentro do limite do pedido
Alocado ao primeiro item: R$ 80 — acima de seus R$ 50
Alocado ao segundo item: R$ 0
```

Uma key compartilhada resolve isso para **retries da mesma intenção**. Não resolve a distribuição entre duas intenções legítimas com keys distintas.

Outro detalhe: na regeneração Pix concorrente, o perdedor teve rollback por `NOT NULL` das alocações. O helper propagou a exceção; o endpoint a trata como erro interno. Há proteção contra segundo sucessor, mas não replay bem-sucedido do primeiro resultado.

## 9. DEFINIÇÃO DE IDENTIDADE LÓGICA

**Mesma operação significa a mesma intenção iniciada pelo usuário, identificada antes da primeira tentativa de envio.**

| Operação | Identidade proposta | Conteúdo vinculado à identidade |
|---|---|---|
| Pagamento manual | Uma intenção de registrar um recebimento | Pedido, método, valor e observação normalizada |
| Refund manual | Uma intenção de registrar uma devolução | Pedido, pagamento original, valor e motivo |
| Checkout | Uma intenção de finalizar uma compra | Itens/quantidades, cliente e recado; preços resolvidos pelo servidor e congelados |
| Pedido ADMIN | Uma intenção de criar uma venda | Itens, cliente, método e condição inicial de pagamento |
| Pix ADMIN | Uma intenção de emitir uma cobrança | Pedido, valor solicitado ou modo automático, e eventual `substituiId` |
| Regeneração | Uma intenção de substituir determinada tentativa | Tentativa anterior e parâmetros da substituição |

Regras necessárias:

- Retry mantém a key.
- Nova intenção recebe outra key, mesmo com dados iguais.
- Mesma key com conteúdo incompatível retorna conflito.
- Não deduplicar por valor, horário, WhatsApp ou hash do carrinho.
- Hash serve para detectar alteração do conteúdo vinculado à key, não para identificar sozinho uma intenção.
- A key deve ser vinculada ao escopo e ao solicitante; não concede autorização por si só.
- Depois de timeout ou resultado ambíguo, não gerar outra key automaticamente.
- Pix expirado ou pedido pago não autorizam reinterpretar o retry como nova intenção.

Para valor Pix automático, o primeiro processamento congela o valor escolhido. Retry não recalcula uma cobrança diferente com a mesma key porque a capacidade mudou.

## 10. MATRIZ DE SOLUÇÕES

As opções são componentes combináveis.

| Opção | Retry sequencial / resposta perdida | Concorrência | Crash antes/depois da persistência | MP | Migration / API e frontend |
|---|---|---|---|---|---|
| **A. Key no frontend, persistida** | Preserva identidade, mas depende do servidor reconhecer | Sozinha não protege | Sobrevive ao reload se persistida; não prova resultado servidor | Precisa chegar à tentativa MP | Sem migration por si; muda cliente e contrato |
| **B. Operation key no início do fluxo** | Boa se existir antes do primeiro envio e for recuperável | Depende de claim atômico | Geração só no servidor durante POST repete o problema; obtenção prévia exige protocolo de recuperação | Pode ancorar a key MP | Cliente gera sem endpoint extra; emissão server-side pode exigir armazenamento/API |
| **C. UNIQUE no banco** | Impede segunda linha com mesma identidade; precisa retornar a primeira | Proteção atômica | Batch com fato permite distinguir commit de rollback por releitura | Não cobre sozinho efeito externo | Já existe nas tabelas principais; novos campos exigem migration |
| **D. Tabela de operações** | Guarda payload original, referências e resultado | UNIQUE + transação/CAS | Representa fases e permite recuperação; registro separado do fato sem atomicidade seria insuficiente | Guarda key e payload remoto original | Migration aditiva e integração dos writers |
| **E. Reutilizar campos existentes** | Suficiente para pagamento/refund se comparar dados persistidos e retornar o mesmo fato | UNIQUE existente resolve disputa | Fato e alocações no batch; após falha ambígua, reler por key | Sozinha não fornece todos os dados/fases para retomar POST MP | Pode dispensar migration no recorte manual; exige contrato de key |
| **F. Cliente + banco + provedor** | Cobre a intenção de ponta a ponta | Claim local atômico e mesma identidade remota | Separa fato local, envio externo e confirmação; mantém ambiguidade explícita | Usa a mesma key e conteúdo original | Recomendação para cobertura completa; frontend/API e uma migration aditiva |

**Compatibilidade com B2/B3/B4**

Todas precisam respeitar:

- B2 continua sendo a autoridade para aprovação após expiração.
- B3 continua reconstruindo estados derivados a partir dos fatos.
- B4 continua decidindo reserva por pedido.
- Retry não cria sucessor Pix, não cancela original, não renova reserva por conveniência.
- Novas keys continuam permitindo pagamentos aditivos e refunds parciais legítimos.

Rejeito como solução: `SELECT` antes do `INSERT` sem UNIQUE/claim atômico; bloqueio de botão; UNIQUE por pedido; UNIQUE por valor; ou UNIQUE por pagamento reembolsado.

## 11. MENOR SOLUÇÃO SEGURA RECOMENDADA

**Para cobrir A1 nos writers atuais, recomendo F, com uma tabela pequena de operações e reutilização dos UNIQUEs existentes.**

Não proponho um framework genérico de jobs. A tabela precisa somente preservar:

- Key, tipo de operação e escopo do solicitante.
- Payload canônico ou fingerprint versionado.
- IDs do pedido/pagamento/refund resultantes.
- Resultado imutável da criação.
- Para MP: key, corpo original e fase de envio/resultado.

**Operações exclusivamente locais**

1. Autenticar e validar formato.
2. Procurar a operação existente antes dos guards dependentes do estado atual.
3. Se existir, comparar payload e devolver o mesmo fato.
4. Se for nova, executar claim e fato no mesmo batch.
5. A disputa de UNIQUE aborta o batch perdedor; ele relê a vencedora.
6. Reconciliar pelo B3 sem recriar o fato.

Não usar `INSERT OR IGNORE` para o claim e continuar executando os demais efeitos indiscriminadamente.

**Operações com MP**

1. Persistir operação, pedido/tentativa, alocações, reserva e conteúdo original do POST atomicamente.
2. Eleger por CAS quem pode iniciar o envio.
3. Requisições duplicadas recuperam o resultado ou recebem “em processamento”.
4. Se já houver ID MP, recuperar pelo fluxo verificado existente.
5. Timeout, falha de transporte ou sucesso remoto sem confirmação local mantêm a mesma operação.
6. Não criar outro pedido, tentativa ou key como recuperação.

Uma retomada de POST precisa preservar inclusive `date_of_expiration`, referência, valor e dados do pagador. Hoje parte desse conteúdo nasce em memória e só é persistida depois do sucesso.

**Limite conservador para o primeiro go-live:** quando não for possível provar se o POST ocorreu, manter a operação inconclusiva e permitir reconciliação/intervenção. Reenvio automático externo só deve ser habilitado dentro de condições de idempotência do MP verificadas e testadas. Segurança pode exigir deixar uma operação pendente; não exige inventar outra cobrança.

**Alternativa menor, com escopo limitado:** pagamento e refund manuais podem ser corrigidos sem migration, reutilizando `idempotency_key`, comparando os dados persistidos e recuperando o mesmo ID. É uma solução válida para esses endpoints. Não fecha A1 do sistema inteiro, especialmente criação ADMIN já paga e checkout.

## 12. ARQUIVOS / MIGRATIONS QUE SERIAM ALTERADOS

Para a recomendação completa:

| Área | Arquivos previstos |
|---|---|
| Contrato e persistência de operações | Novo helper específico em `functions/lib/` |
| Migration | Nova `0012_...sql` aditiva para operações/idempotência |
| Pagamento e refund | `functions/lib/comandaLedger.ts` e endpoints `pagamentos.ts` / `reembolsos.ts` |
| Checkout | `functions/api/checkout.ts` |
| Pedido ADMIN | `functions/api/admin/pedidos.ts` |
| Pix ADMIN | `functions/lib/comandaPix.ts` e endpoint `pix.ts` |
| Fluxo SITE | `src/pages/Checkout.tsx` e `AguardandoPagamento.tsx` |
| Fluxos ADMIN existentes | `NovoPedidoModal.tsx` e `PedidoDetalheModal.tsx` |
| Verificação | Novos testes A1; extensão pontual do harness se necessária |
| Documentação | `README.md` e `docs/ESTADO_ATUAL.md` |

Não encontrei UI atual chamando os endpoints de pagamento manual e refund. Seus consumidores diretos também precisarão enviar key. Criar uma nova tela de refund não é requisito do A1.

**Sem migration:** reuso dos campos de key existentes para o recorte manual.

**Com migration:** registro explícito de payload original, fingerprint e fases de operação/provedor na solução completa.

Não recomendo reconstruir tabelas financeiras nem modificar migrations antigas. Tornar `mp_payment_id` UNIQUE no ledger seria uma decisão separada, precedida de auditoria histórica; não é necessário para substituir a identidade por intenção.

## 13. PLANO DE TESTES

| Teste futuro | Invariante esperada |
|---|---|
| Mesma key + mesmo payload | Mesmo ID; uma única criação financeira |
| Mesma key + payload diferente | Conflito estável; nenhuma escrita adicional |
| Keys diferentes + mesmo payload | Duas intenções permitidas se os guards de domínio aceitarem |
| Mesma key concorrente | Uma operação vencedora; demais recuperam resultado ou estado pendente |
| Resposta HTTP perdida + retry | Mesmo fato, pedido e reserva |
| Falha antes do batch | Nenhum efeito parcial; retry pode executar |
| Commit concluído + resposta D1 perdida | Releitura encontra operação persistida; não cria outra |
| Falha de reconciliação após persistência | Sucesso financeiro preservado; B3 recupera derivados |
| Provider timeout | Mesma tentativa; estado ambíguo; nenhuma key nova |
| Provider sucesso + gravação local perdida | Reconciliação associa o mesmo recurso remoto |
| Retry após pedido virar PAGO/encerrado | Recupera operação anterior antes de tentar aplicar novamente |
| Retry de refund após saldo mudar | Mesmo refund original, sem consumir novo saldo |
| Retry de regeneração após sucessor expirar | Mesmo sucessor original; nova regeneração exige nova intenção |
| Reload/remontagem/abort | Cliente preserva a key e recupera a operação |
| Última unidade em disputa | Rollback completo do perdedor; nenhum POST indevido |
| Mesmo MP ID em evento repetido | Um fato confirmado; baixa física única por pedido |

As barreiras devem controlar leitura, entrada no batch, commit, chamada MP e gravação da resposta.

Asserções devem contar separadamente:

- Operações lógicas.
- Linhas e somas confirmadas do ledger.
- Refunds e líquido.
- Pedidos, itens e alocações.
- Quantidade reservada e baixada.
- POSTs enviados.
- Recursos distintos criados pelo simulador MP.

**Duas respostas de sucesso com o mesmo ID podem ser corretas. Dois IDs financeiros para a mesma key não são.** Da mesma forma, dois envios externos com a mesma key não equivalem automaticamente a dois recursos financeiros.

## 14. RISCOS E DÍVIDAS RESIDUAIS

**Prioridade técnica para o primeiro go-live**

| Operação | Classificação |
|---|---|
| Pagamento manual ADMIN | Bloqueador se permanecer habilitado: duplica fato confirmado sem nova ação financeira externa |
| Refund ADMIN | Bloqueador se permanecer habilitado: duplica devolução registrada |
| Checkout SITE | Menor criticidade direta que os anteriores, mas duplica pedidos, estoque reservado e cobranças pagáveis; recomendo corrigir antes da primeira compra pública |

Checkout poderia ser aceito como dívida operacional consciente em um lançamento restrito, reconhecendo explicitamente reserva duplicada, pedidos órfãos e possibilidade de dois Pix pagos. **Não o classificaria como “apenas lixo operacional”.**

A ausência de UI não desabilita um endpoint. Adiar pagamento/refund exige contenção server-side, não expectativa de uso cuidadoso.

Dois writers encontrados devem acompanhar a decisão:

- **Pedido ADMIN já pago:** mesma prioridade de pagamento manual.
- **Pix ADMIN parcial/aditivo:** duplica cobrança; não deve ser declarado protegido apenas porque a UI usa valor integral.

**Achados adicionais**

1. **POST MP não-2xx é tratado como recusa definitiva.** Um HTTP 500 simulado levou a `FALHOU` e liberação da reserva no SITE. Isso é diferente do tratamento cuidadoso do GET B2. A recuperação de criação precisa distinguir falha ambígua de rejeição comprovada; não deve ampliar silenciosamente a matriz B2.
2. **Waterfall entre intenções distintas continua não serializável por item.** Foi reproduzida e deve permanecer visível como dívida separada.
3. **Regeneração concorrente pode devolver 500 ao perdedor**, embora faça rollback e impeça segundo sucessor.
4. **O comentário da migration 0010 sobre NULL não justifica ausência de UNIQUE.** Um índice UNIQUE parcial pode excluir NULL. A ausência atual de unicidade foi confirmada no D1.
5. Operação remota sem ID pode depender de webhook/intervenção; o sweep financeiro existente exige `mp_payment_id`.
6. Nenhuma validação foi feita sobre dados ou schema do D1 de produção.

Permanecem fora da correção de identidade: tratamento de overpayment real, refund automático MP, reposição de estoque por refund, editor incremental, evolução de comanda, novo sweep/cron, janela residual B4 e cutover B5.

## 15. PLANO DE IMPLEMENTAÇÃO PROPOSTO

1. **Fixar o contrato A1:** nome e escopo da key, normalização, conflito por payload diferente, replay e estado inconclusivo.
2. **Adicionar persistência de operação:** migration aditiva, atomicidade com fatos e preservação das identidades históricas.
3. **Fechar os lançamentos locais:** pagamento, refund e criação ADMIN, incluindo pedido que nasce pago.
4. **Fechar checkout e Pix ADMIN:** key persistida pelo cliente, snapshot do POST e recuperação da mesma tentativa.
5. **Tratar ambiguidade na criação MP:** separar falhas de transporte/servidor das recusas comprovadas, mantendo B2/B3/B4.
6. **Executar testes determinísticos A1 e regressões existentes**, incluindo HTTP local e ciclo real dos componentes.
7. **Apresentar diff e evidências para revisão**, antes de qualquer commit, push ou deploy.

Respostas finais:

- **A1 é reproduzível hoje?** Sim, sequencialmente, sob concorrência controlada e após falhas simuladas.
- **Quais operações podem duplicar dinheiro?** Pagamento manual, pedido ADMIN já pago e refund parcial duplicam fatos financeiros confirmados. SITE/Pix ADMIN podem criar cobranças distintas que geram dois recebimentos se ambas forem pagas. Não foi demonstrado débito ou refund externo automático duplicado.
- **Quais podem duplicar apenas estado/pedido/reserva?** Pedido ADMIN pendente; checkout interrompido antes do POST; e checkouts/cobranças adicionais que nunca forem pagos.
- **Existe solução pequena e segura para o primeiro go-live?** Sim. O núcleo manual admite correção pequena; cobertura completa exige identidade durável também para criação de pedidos e Pix.
- **Exige migration?** Para a recomendação completa, sim: uma migration aditiva. Para pagamento/refund manuais isoladamente, não.
- **Exige frontend?** Sim, nos fluxos existentes, para criar e preservar a identidade antes do envio. Consumidores diretos dos endpoints também precisam do contrato.
- **Exige mudança no protocolo MP?** Mantém Payments API, endpoints e header existentes. Muda o ciclo de vida da key, a preservação do payload e a recuperação; não exige Orders API.
- **O que fica fora do A1?** As dívidas de domínio listadas na seção 14, sem apagar ou ocultar fatos históricos.

**Nenhuma implementação realizada. Aguardo aprovação do plano.**

A limpeza da pasta temporária de dependências foi bloqueada pela política automática, sem justificativa específica adicional. Ela permaneceu fora do repositório, em `%TEMP%\rp-doces-a1-deps-09c81f1157864e99a63baf92be1e2f37`.