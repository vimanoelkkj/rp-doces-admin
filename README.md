# R&P Doces — Rebuild from scratch

Loja online da R&P Doces (e-commerce + área administrativa), sendo **reconstruída do zero**, um passo pequeno e testado por vez, mantendo compatibilidade de schema com a produção real (`vimanoelkkj/rp-doces-admin`, branch `main`).

Este README serve como documento de contexto para retomar o trabalho em qualquer sessão nova do Claude — leia inteiro antes de propor qualquer mudança.

---

## Stack

- **Frontend**: React + TypeScript + Vite
- **Backend**: Cloudflare Pages Functions (`functions/api/**`)
- **Banco**: Cloudflare D1 (SQLite), migrations incrementais em `migrations/`
- **Storage de imagens**: Cloudflare R2
- **Pagamentos**: Mercado Pago — **Payments API** (`/v1/payments`), deliberadamente **não** a Orders API que a produção real usa hoje (decisão consciente, não copiar de carona)

## Estrutura

```
src/          frontend (storefront + admin)
functions/    Cloudflare Pages Functions (API)
  api/          endpoints HTTP
  lib/          lógica de negócio compartilhada (ledger, estoque, sync com MP)
migrations/   migrations do D1, numeradas e incrementais (0001 → 0011 hoje)
```

## Rodando localmente

```bash
npm install
npm run build        # tsc --noEmit && vite build → gera dist/
npm run pages:dev     # wrangler pages dev dist → serve tudo em http://127.0.0.1:8788 (frontend + /api/* + D1 local)
```

Só `npm run dev` (Vite puro) serve pra iterar rápido no frontend, mas **sem** `/api/*` funcionando (sem Functions, sem D1).

Migrations locais:

```bash
npm run db:migrate:local
```

⚠️ **Antes de subir `pages:dev`, sempre confira se não há um processo zumbi na porta**: `netstat -ano | grep "8788.*LISTENING"` — já aconteceu mais de uma vez dois processos disputando a porta e mascarando testes.

### Banco de produção (real)

O D1 remoto de produção (`rp-doces-db`) **nunca foi escrito** por este projeto — só leitura, sempre:

```bash
npx wrangler d1 execute rp-doces-db --remote --command "SELECT ..."
```

Nunca rodar `wrangler pages dev --remote` contra ele sem entender que isso faz o site local **escrever de verdade** em produção. Nunca projetar colunas com PII em queries de produção (`cliente_email`, `cliente_whatsapp`, `cliente_nome`, `token_publico`, `mp_qr_code`, `pix_copia_cola`).

---

## Regras de processo (importante para continuar o trabalho)

1. **Um commit = uma responsabilidade.** Projeto tem que ficar funcional depois de cada commit.
2. **Mensagem de commit**: `rp-doces: <mensagem>` — **sem** trailer `Co-Authored-By` (histórico foi rebasado via `git filter-branch` especificamente pra remover isso; nunca reintroduzir).
3. **Sem refactor não solicitado, sem scope creep.**
4. **Antes de qualquer feature de backend nova**: checar o schema/código real de produção (`github.com/vimanoelkkj/rp-doces-admin`, branch `main`) — leitura de código-fonte e `SELECT` no D1 real são sempre permitidos; adotar o schema real como fonte da verdade, nunca simplificar pra caber no rebuild.
5. **Ciclo de 2 fases por sub-passo**: (1) investigação + plano detalhado, apresentado pra aprovação, **sem código**; (2) só depois de aprovação explícita, implementar + testar (bateria real contra `wrangler pages dev` + D1 local, nunca só `tsc`) + reportar resultado + esperar aprovação de novo antes de commit/push.
6. Push só quando pedido explicitamente: `git push production master:rebuild-from-scratch` (remote `production` aponta pro repo real, sem PR, direto na branch).
7. Qualquer endpoint/código temporário de teste precisa ser **removido e verificado via `git status`** antes de qualquer commit.

---

## O que já foi feito

### Fundação (storefront + admin básico)

Scaffold do projeto, catálogo de produtos, carrinho (persistido em localStorage), checkout Pix, acompanhamento de pedido, estrutura do admin (dashboard, login, CRUD de produtos com upload de imagem via R2, CRUD de administradores, listagem/detalhe de pedidos, tema dark).

### Passo 2 — Reconciliação de schema `pedidos`

Schema de `pedidos` trazido para bater com produção: `status_pedido` (NOVO/PREPARANDO/PRONTO/ENTREGUE/CANCELADO), `status_comanda`, `origem_pedido`, colunas de reserva (`reserva_status/reserva_expira_em/reserva_liberada_em`, ainda dormentes na época), `arquivado`, trigger de encerramento de comanda em status terminal.

### Passo 3 — Auditoria de `pedido_itens`

`criado_em`, `estoque_baixado_em`, `adicionado_por_usuario_id`, `adicionado_em`.

### Passo 4 — Ledger financeiro (4a–4d)

- **4a**: schema do razão financeiro — `pedido_pagamentos` + `pedido_pagamento_alocacoes`, sem mudar comportamento ainda.
- **4b**: materialização lazy de pagamentos legados (lê `pedidos` antigos e projeta como se fossem uma linha de ledger, sem nunca escrever no caminho de leitura).
- **4c-1**: checkout passa a escrever no ledger em paralelo aos campos legados de `pedidos`.
- **4c-2**: `pedidos.status_pagamento` convergido para ser **só a projeção agregada** `PENDENTE | PARCIAL | PAGO` (nunca mais o status bruto de uma tentativa individual) — decisão deliberada de não copiar o vocabulário duplo/inconsistente de produção.
- **4d**: pagamentos manuais do admin (`DINHEIRO`, `CARTAO`, `PIX_EXTERNO`) com alocação em cascata (waterfall) sobre os itens, concorrência resolvida via padrão "INSERT condicional que aciona violação de constraint e derruba o batch inteiro" (sem compensação pós-commit).

### Passo 5 — Reembolsos manuais

`pedido_reembolsos` (schema idêntico ao de produção). Modelo **bruto / reembolsado / líquido**: pagamento original nunca é mutado (nunca vira `REEMBOLSADO`), reembolso é um fato independente. `recalculatePedidoStatusPagamento`, `getComandaSaldo` e o guard de cancelamento usam líquido. Reembolso restrito a métodos manuais (`DINHEIRO/CARTAO/PIX_EXTERNO`) — PIX_MP fica de fora (exige integração com o MP, fora de escopo). Bloqueio temporário: novo pagamento admin é recusado (`PEDIDO_COM_REEMBOLSO_NAO_SUPORTADO`) se já existe reembolso e ainda falta líquido a cobrir — evita que a waterfall (que não conhece reembolsos) misalocasse dinheiro.

### Passo 6 — Reconciliação server-side de pagamentos

Fecha o gap "pagamento fica PENDENTE pra sempre se o cliente fechar a aba". Três caminhos independentes convergindo num único helper (`functions/lib/paymentSync.ts::syncPaymentFromMp`):

- **Webhook** (`functions/api/webhooks/mercadopago.ts`) — validação HMAC-SHA256 timing-safe (protocolo idêntico ao de produção), nunca confia no payload (sempre busca a Payment fresca no MP antes de mutar), resolve o pagamento por `mp_payment_id` direto ou por fallback via `external_reference = token_publico` (nunca escolhe "o mais recente" entre candidatos — 0 é not-found, 1 resolve e associa, >1 é ambíguo e não decide).
- **Reconciliação oportunista do admin** (`GET /api/admin/pedidos` dispara `reconcilePendingPixPayments`, throttle 15s / lote de 4).
- **Polling do cliente** (`refreshPedidoStatus`, pré-existente, refatorado pra reusar o mesmo helper).

Matriz de transição do pagamento individual: `PENDENTE → PAGO/CANCELADO/EXPIRADO` permitido; qualquer terminal → outra coisa, recusado (idempotente, nunca regride); `REEMBOLSADO` nunca é tocado por esse caminho. CAS (compare-and-swap) contra o status lido protege contra corrida entre chamadores concorrentes.

### Passo 7 — Reserva / baixa / liberação de estoque

Fecha o gap de overselling (`checkout.ts` só _lia_ `estoque_reservado`, nunca escrevia nada). Peça central de segurança: **`CHECK (estoque_reservado >= 0 AND estoque_reservado <= estoque)`** em `produtos` (migração 0001, já existia dormente) — não é um `WHERE` manual, é a constraint do banco que derruba o `batch()` inteiro (atômico) se duas compras disputarem a última unidade.

- **Reserva**: criada no mesmo batch atômico do checkout, antes de chamar o MP. TTL em duas fases: nasce como `now + 31min` (proteção imediata), sincronizado para `date_of_expiration` real do MP `+ 1min` assim que a resposta chega.
- **Baixa**: `functions/lib/stock.ts::baixarEstoquePedido`, disparada por `functions/lib/pedidoReconcile.ts::reconcilePedidoAfterFinancialChange` — uma ponte explícita que roda depois de **qualquer** recálculo financeiro (`recalculatePedidoStatusPagamento`) e converte a reserva em baixa física só quando o agregado fecha em `PAGO`. Todos os write-paths financeiros (sync com MP, pagamento manual do admin, reembolso) passam por essa ponte — nenhum "esquece" de considerar estoque.
- **Reclamação de reserva liberada**: se a reserva já foi liberada (Pix expirou) mas o dinheiro chega depois (ex.: pagamento em dinheiro), a baixa decide **ao vivo**, via subquery correlacionada dentro do próprio `UPDATE`, se a reserva ainda está `ATIVA` — se não estiver, decrementa só `estoque` físico (nunca `estoque_reservado` de novo). Se o estoque físico já foi consumido por outra venda nesse intervalo, o `CHECK` derruba o batch, o pedido fica `PAGO` com `estoque_baixado_em = NULL` — **detectável e logado, nunca silencioso** — e uma reconciliação oportunista (`reconciliarPagosSemBaixa`) retenta em toda carga do painel admin até o estoque permitir.
- **Liberação**: `liberarReservaPedido`, chamada em três pontos (transição MP para EXPIRADO/CANCELADO, rejeição definitiva do MP no checkout, cancelamento admin) — só age se o agregado ainda está genuinamente `PENDENTE` no instante do write.
- **Sweep de reservas vencidas sem webhook/polling**: `liberarReservasVencidasLocalmente`, rodada oportunisticamente em `GET /api/admin/pedidos`, usando só `reserva_expira_em` local (sem chamar o MP).
- **Dívida deliberada**: pedido `PARCIAL` (algum pagamento já confirmado) cuja perna Pix expira **não** tem a reserva liberada automaticamente — fica presa até ação manual (cancelamento, que só é permitido com líquido=0). Decisão consciente: mais vale prender estoque do que vender de baixo do nariz de quem já pagou parte.

### Correções de frontend (2026-09-16)

- Bug do cardápio "vazio": `GET /api/produtos` devolvia `categoria` como slug cru do banco (`BOLO_NO_POTE`), mas o frontend comparava com o nome de exibição (`"Bolo no Pote"`) — nunca batia, lista ficava vazia mesmo com produtos existindo. Corrigido com `LEFT JOIN` em `categorias` devolvendo `categoria_nome`.
- Onda decorativa do cardápio vazava sobre o footer quando havia zero produtos (catálogo vazio ou filtro sem resultado) — adicionado estado vazio explícito com altura mínima compensando a proporção da onda.
- Footer usando cor de fundo diferente da página do cardápio — corrigido com override escopado (Footer é componente compartilhado por 7 páginas com fundos diferentes, não mudar globalmente).
- Transição de filtro de categoria: conteúdo tinha fade suave mas o container pulava de altura seco (arrastando o footer junto de golpe) — animação de altura implementada corretamente (cuidado: um container flex com altura fixa comprime os próprios filhos em vez de deixar vazar, então a medição de altura real precisa vir de um wrapper interno sem altura restringida, não do próprio elemento animado).
- Cores do card de produto (`ProductCard.css`) divergiam entre desktop e mobile por causa de um `@media (max-width: 768px)` que sobrescrevia cores deliberadamente — unificado para usar a paleta do desktop em ambos.

### Tela de loading do checkout (2026-09-16)

Ilustrações mascote (bolinho no pote — feliz, triste, empurrando carrinho; `src/assets/*-image.png`) enxertadas nas telas **existentes** (não substituídas — timeline/itens/resumo/WhatsApp de `PedidoConfirmado`/`PagamentoNaoAprovado` continuam intactos):

- **`AguardandoPagamento.tsx`, estado "criando"**: agora tem 2 sub-etapas visuais fake (`loadingStep` 1/2) — "Preparando seu pedido..." (bolinho+carrinho) → "Gerando pagamento..." (ícone Pix girando). É **uma única chamada de rede** (`POST /api/checkout`); a progressão é puramente estética, com tempo mínimo por etapa (`MIN_STEP_DURATION_MS`) e tempo mínimo total (`MIN_TOTAL_LOADING_MS`) garantindo que ambas apareçam mesmo com rede instantânea.
- **Novo estado "processando"** (mesmo arquivo): depois que o polling detecta que o pagamento saiu de `PENDENTE` (aprovado ou não), mostra uma transição breve (ícone de relógio, sem barra de progresso, `PROCESSANDO_DELAY_MS`) antes de navegar pro resultado — nunca substitui a tela real do QR Code, que continua aparecendo normalmente enquanto o cliente não paga.
- **`PedidoConfirmado.tsx`**: ícone de check trocado pelo bolinho feliz (bounce).
- **`PagamentoNaoAprovado.tsx`**: ícone de X trocado pelo bolinho triste (shake).
  Ainda tem que fazer alkgumas melhorias, como definir onde cada tela vai aparecer, por quanto tempo.
  Por mais que o commit esteja no repositório online, consideramos ele como commit temp, coisa que iremos averiguar mais tarde!

### Passo 8 — Criação manual de pedido pelo admin

`POST /api/admin/pedidos` (`origem_pedido='MANUAL'`): agrega itens duplicados, valida produto/preço/estoque server-side, cria pedido+itens+reserva+pagamento(+alocações) num único batch atômico — inclusive se nasce `PAGO` (`status_pagamento` escrito direto no INSERT, não via recompute posterior, pra nunca poder regredir pra `PENDENTE` por falha num passo depois). Baixa física de estoque numa chamada separada a `baixarEstoquePedido` (reuso, não duplicação). `A_COMBINAR`/`DINHEIRO`/`CARTAO`/`PIX_EXTERNO` em `PENDENTE` sempre cria um pagamento placeholder real no ledger, generalizado (não é gambiarra só pra `A_COMBINAR`).

Bug encontrado e corrigido isolado antes da feature que o expôs: `registerAdminPayment` não cancelava pagamentos `PENDENTE`/`ADMIN` pré-existentes ao registrar um pagamento manual real — ficavam órfãos ao lado do `PAGO` (mesmo bug documentado em produção). Corrigido com `substitui_pagamento_id` como trilha de auditoria; `getVirtualOrRealPayment` trocou "o mais antigo" por prioridade `PAGO > outros > CANCELADO`.

Frontend (`NovoPedidoModal.tsx`) ligado à API real sem alterar CSS/layout. Estoque exibido é o LIVRE (`estoque - estoque_reservado`), diferente do `EditarPedidoModal` (que mostra bruto porque já conta a própria reserva do pedido em edição). Regra simétrica `A_COMBINAR ↔ PAGO` no formulário: selecionar um força o outro pra combinação válida, nas duas direções.

Durante os testes apareceu `"✓ Pago (Pix)"` **hardcoded** na listagem e no detalhe do pedido (resíduo de quando só existia Pix) — motivou uma projeção financeira nova (`getFinanceiroPedido`/`getFinanceirosPorPedidos`, `{status, pagoCentavos, totalCentavos, metodosConfirmados}`) em vez de expor o ledger inteiro. `metodosConfirmados` não é `DISTINCT metodo WHERE status='PAGO'` ingênuo — cada linha só conta se sua contribuição líquida PRÓPRIA (valor menos reembolso daquele `pagamento_id` específico) ainda for positiva, testado com refund 100%, parcial e multi-pagamento com refund de uma perna só.

### Passo 9 — Pix administrativo (fechado ponta a ponta: geração, regeneração e frontend)

Fix preventivo isolado primeiro: `registerAdminPayment` agora só cancela placeholders puramente locais (`metodo != 'PIX_MP'`, nunca depende de `mp_payment_id`) — um `PIX_MP/PENDENTE` (mesmo `origem='ADMIN'`) nunca é cancelado por um pagamento manual, porque representa uma cobrança que pode estar viva no Mercado Pago e só o MP decide se ela deixou de existir. Cancela todos os placeholders locais elegíveis (nunca `LIMIT 1`, determinístico mesmo com sujeira histórica).

`POST /api/admin/pedidos/:id/pix` (`functions/lib/comandaPix.ts`) gera cobrança Pix pelo admin fora do checkout, Payments API (não Orders API de produção — decisão deliberada mantida). Peça central: `capacidadeCobravel` — **não é o mesmo que saldo financeiro devido**. Pix parciais aditivos são legítimos (produção permite), então a proteção real é "saldo devido MENOS Pix administrativos pendentes ainda ativos operacionalmente" (exclui automaticamente qualquer Pix já substituído por outro via `substitui_pagamento_id`, mesmo antes de o substituto existir — usa `substituiId` explícito na query pra isso). CAS-na-escrita idêntico ao padrão de `registerAdminPayment`: dois admins tentando consumir a mesma capacidade simultaneamente resultam em exatamente uma cobrança criada, nunca dois QR codes somando mais que o devido. **Nenhum índice único de "1 Pix pendente por pedido"** — a invariante é monetária (soma), não de cardinalidade.

`external_reference`: SITE continua usando `token_publico` (checkout.ts **intocado**); ADMIN usa o `idempotency_key` da própria tentativa (já único, já indexado) — evita a ambiguidade que `token_publico` teria assim que múltiplos Pix administrativos coexistirem no mesmo pedido. `resolveWebhookPayment` aprende os dois formatos em fallbacks paralelos independentes.

Reserva de estoque: uma reserva `ATIVA` preexistente **nunca** é recriada, liberada ou tem TTL renovado por essa operação (nem por falha do MP) — só o caso órfão (pedido SITE cujo Pix expirou/foi rejeitado antes de qualquer ação administrativa, `reserva_status='LIBERADA'`) readquire reserva atomicamente, com TTL finito próprio. Compensação em rejeição definitiva do MP só desfaz a reserva que a PRÓPRIA operação criou (rastreado via `changes` do `UPDATE` de flip, nunca assumido) — nunca uma reserva preexistente do pedido. Timeout/erro de transporte é tratado como ambíguo: nunca marca `FALHOU`, nunca libera reserva (mesmo padrão que `checkout.ts` já usa).

`pedidos.mp_payment_id`/`mp_qr_code`/etc **nunca** são gravados para Pix administrativo — esses campos são do modelo legado de 1-Pix-por-pedido do site; com múltiplos Pix administrativos possíveis, só `pedido_pagamentos` guarda essa informação por tentativa.

**Regeneração**: `substituiId` opcional em `createAdminPixCharge` — Pix B aponta `substitui_pagamento_id` pro Pix A, que **nunca** vira estado terminal enquanto ainda puder ser pago de verdade no MP (continua `PENDENTE`, reconciliável). Achado de teste corrigido antes do commit: "Pix substituído" só conta com sucessor **vivo** (`PENDENTE`/`PAGO`) — um sucessor morto (`FALHOU`/`CANCELADO`/`EXPIRADO`) libera o original pra nova tentativa (`SUCESSOR_VIVO`, constante única reaproveitada em toda leitura relacionada a substituição, nunca duas semânticas divergentes). A condição de "A ainda é substituível" é parte do `WHERE` atômico do próprio `INSERT`, não só de um pré-check — testado com 5 regenerações concorrentes do mesmo Pix, exatamente 1 sucessor criado. Cadeia A→B→C funciona (regenerar de novo usa `substituiId=B`, nunca reescreve a partir de A).

**Frontend** (`PedidoDetalheModal.tsx`): `GET /pedidos/:id` ganhou `status_comanda` e `pixAdminPendentes[]` (**lista**, nunca singular — Pix parciais aditivos coexistem legitimamente, `getPixAdminPendentesAtivos` reaproveita a mesma `SUCESSOR_VIVO`). Seção "Pagamento" ganhou "Gerar Pix" (só sem Pix vivo, comanda `ABERTA`, saldo>0) e um bloco por Pix vivo (QR/copia-cola/contador/"Regenerar"), CSS novo restrito ao namespace `pedmodal-pix-*`, sem tocar no Figma existente. Erro do `POST /pix` ganhou campo `code` estruturado (não só mensagem) pra distinguir `MERCADO_PAGO_INDISPONIVEL` (ambíguo) de forma confiável — esse erro mostra aviso diferenciado com "Atualizar pedido" em vez de convidar a um retry que poderia duplicar a cobrança. Pix com prazo do MP vencido mas ledger ainda `PENDENTE` **nunca é escondido nem tem estado inventado** pelo frontend — só o backend/reconciliação tem autoridade pra transicionar `PENDENTE → EXPIRADO`.

**Dívida documentada (não resolvida incidentalmente)**: se um Pix administrativo "substituído" for pago de verdade no Mercado Pago depois de outro já ter confirmado o mesmo pedido, isso é overpayment — `getPaidCentavos`/`getComandaSaldo` não têm proteção contra pagar mais que o total (saturam/somam sem cap). Dinheiro real excedente sem representação de "crédito" ainda. Documentado deliberadamente, não construído.

`CANCELAR_PIX` autônomo (cancelar sem gerar substituto) ficou fora de escopo: a Payments API não tem cancelamento real de Pix pendente, então essa ação só faria sentido como "esconder da UI sem substituir", semanticamente estranho sem um Pix novo — avaliar de novo quando/se fizer falta. UI também não oferece criar um Pix aditivo extra quando já há Pix vivos (só regenerar os existentes), nem valor customizado no "Gerar Pix" (sempre capacidade cheia) — decisões de escopo da v1, não limitações do backend.

---

## O que falta

Ordem sugerida (não travada — pode mudar por decisão):

1. ~~Criação manual de pedido pelo admin~~ — feito, Passo 8.
2. ~~Pix administrativo (geração, regeneração, frontend)~~ — feito, Passo 9. `CANCELAR_PIX` autônomo descartado deliberadamente (ver Passo 9).
3. **Comanda como balcão de atendimento** — reabrir comanda fechada pra adicionar item depois da entrega, lançamentos incrementais sem falsificar histórico, possivelmente consolidar novas compras da mesma cliente no mesmo dia numa comanda só (identidade por WhatsApp normalizado, nunca nome), exclusão/arquivamento seguro. Investigação própria antes de codar — não é puxadinho de nenhum passo anterior.
4. **Refund automático via Mercado Pago** — hoje só existe reembolso manual (Passo 5); produção integra refund direto na API do MP.
5. **Exchange / correções de item** (`pedido_item_correcoes`) — trocar produto de pedido já pago, com reembolso parcial e reforço/baixa de estoque.

## Dívidas conhecidas (documentadas, não esquecer)

- **Frontend do estorno**: backend de refund existe (Passo 5), mas não há dialog no admin ligando "cancelar" → "reembolsar" — fluxo manual via endpoint direto até hoje.
- **Webhook do MP não está plugado em produção de verdade**: código pronto (Passo 6), falta configurar `MP_WEBHOOK_SECRET` no Cloudflare Pages real e cadastrar a URL pública no app do Mercado Pago — até lá, só a reconciliação oportunista do admin cobre o gap em produção real.
- **`PARCIAL` + Pix expirado**: reserva de estoque fica presa até ação manual (Passo 7, decisão consciente) — vale também para Pix administrativo (Passo 9), política mantida idêntica, não redesenhada.
- **Imports circulares** (`comandaLedger.ts` ↔ `pedidoReconcile.ts`, `paymentSync.ts` ↔ `stock.ts`): funcionam (confirmado no bundler do wrangler, não só no `tsc`), mas são dívida arquitetural — quebrar via módulo-folha compartilhado se crescerem.
- **Overpayment de Pix administrativo substituído** (Passo 9): se um Pix "substituído" for pago de verdade no MP depois do substituto já ter confirmado, o ledger soma sem cap — dinheiro real excedente sem representação de crédito. Documentado, não construído.
- **Varreduras de expiração (`reconcilePendingPixPayments`/`liberarReservasVencidasLocalmente`) ainda só cobrem `origem='SITE'`** — Pix administrativo pendente que expira sem pagamento não é liberado automaticamente pelo backend; a UI já mostra isso corretamente (aviso "expiração atingida" + "Atualizar pedido" + "Regenerar"), então o gap é só de automação, não de visibilidade. Falta também decidir, ao estender isso pra `ADMIN`, que "reserva é do pedido, não do Pix individual" quando dois Pix administrativos coexistirem (não liberar a reserva do pedido só porque UM dos Pix ativos expirou, se outro ainda estiver vivo).
- **UI do Pix administrativo (v1, decisões de escopo, não limitações do backend)**: não oferece criar um Pix aditivo extra quando já há Pix vivos (só regenerar os existentes); não tem campo de valor customizado no "Gerar Pix" (sempre a capacidade cheia).

## Migrations aplicadas (ordem)

```
0001_products.sql                              produtos + estoque/estoque_reservado com CHECK
0002_orders.sql                                pedidos v1
0003_admin_products.sql
0004_admin_auth.sql
0005_categorias_e_produtos.sql                 categorias (nome de exibição) + normalização de slug
0006_pedidos_producao.sql                      pedidos reconciliado com produção (status_pedido, reserva, etc.)
0007_pedido_itens_auditoria.sql
0008_ledger_pagamentos.sql                     pedido_pagamentos + pedido_pagamento_alocacoes
0009_reembolsos.sql                            pedido_reembolsos
0010_pedido_pagamentos_mp_payment_id_index.sql índice para resolução direta do webhook
0011_pedidos_reserva_ativa_index.sql           índice para varredura de reservas vencidas
```
