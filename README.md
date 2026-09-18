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
migrations/   migrations do D1, numeradas e incrementais (0001 → 0012 hoje)
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

Matriz de transição do pagamento individual: `PENDENTE → PAGO/CANCELADO/EXPIRADO` permitido. Após B2, `EXPIRADO → PAGO` também é permitido exclusivamente com resposta verificada do GET MP; os demais terminais não mudam. Guards na escrita protegem contra expiração/aprovação concorrentes; igualdade de estado continua idempotente.

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

## B3 — Reconciliação financeira repetível

`reconcilePedidoAfterFinancialChange` converge por pedido a partir do ledger real: projeta o líquido em SQL no instante da escrita e tenta a baixa somente quando o agregado é `PAGO`. O resultado distingue situação financeira de pendências físicas. A transação de estoque revalida o líquido, preserva as marcações de baixa e propaga falhas inesperadas para permitir retry; refund não repõe estoque.

Webhook/sincronização e polling repetem a reconciliação mesmo sem nova transição. No GET administrativo, `reconcilePedidosDivergentes` substitui `reconciliarPagosSemBaixa`: procura divergências financeiras e pedidos pagos sem baixa, em lotes de quatro, antes da expiração local. Não depende de `mp_payment_id` nem materializa pedidos sem ledger. A matriz de transição (B2), política de liberação (B4), edição de itens (B1) e idempotência de requisições (A1) permanecem fora desta correção.

Após a persistência de pagamento/reembolso administrativo, falhas de reconciliação ou leitura de saldo preservam a resposta de sucesso com o ID gravado. Os campos derivados opcionais são omitidos nessa falha, sem inventar valores. O log identifica pedido, operação e fato financeiro persistido; a recuperação oportunista continua responsável pela divergência. Erros anteriores à persistência mantêm o tratamento existente. Isso não implementa idempotência de requisições (A1).

Regressões B3: código de produção e D1 local descartável via Miniflare, com respostas do MP simuladas. Os schemas são criados a partir das migrations existentes, sem acessar D1 remoto ou a base local de desenvolvimento. A suíte cobre falhas parciais, concorrência, rollback, pagamento parcial, refund, reserva liberada, respostas administrativas após persistência e os caminhos de recuperação. Usa `miniflare` e `esbuild` já presentes na árvore de dependências do Wrangler. A expectativa que preservava o B2 antigo foi substituída, separando a regressão B4 em outro teste.

## B2 — Aprovação autoritativa após expiração operacional

`EXPIRADO` não comprova ausência de pagamento. `fetchMpPayment` faz GET autenticado, valida o ID retornado e produz uma resposta imutável com marca de tipo privada e identidade verificada em memória (referência fraca, sem cache financeiro). `syncPaymentFromMp` recusa snapshots fabricados ou cópias alteradas. Payload de webhook, relógio e `mp_status` persistido não autorizam aprovação. Somente esse GET permite `EXPIRADO → PAGO`; `CANCELADO`, `FALHOU` e `REEMBOLSADO` continuam protegidos. `refunded`/`charged_back` continuam sem suporte de lançamento automático.

O UPDATE de aprovação revalida `PENDENTE/EXPIRADO` e a identidade MP dentro da escrita, inclusive quando a expiração venceu entre SELECT e UPDATE. Fallbacks do webhook aceitam expirados, recusam ambiguidades/associações conflitantes e confirmam a associação após o CAS. O polling identifica a tentativa SITE, reconcilia pelo B3, consulta MP antes da expiração local e responde o estado persistido. Agregado `PARCIAL/PAGO` não impede consultar outra tentativa elegível. Pix ADMIN substituído continua reconciliável: dois approved registram os dois fatos, sem cap/refund automático nem dupla baixa (overpayment permanece dívida).

GET MP tem um único timeout de 5 segundos (`MP_PAYMENT_GET_TIMEOUT_MS`), incluindo corpo da resposta; não havia helper/configuração anterior. Timeout/HTTP não-2xx não criam rejeição financeira: o prazo local ainda pode encerrar operacionalmente o QR, sem bloquear approved posterior. A varredura da listagem admin inclui `PENDENTE/EXPIRADO`, SITE e ADMIN, com no máximo 4 candidatos por chamada, throttle de 15 segundos adquirido atomicamente antes do GET, sem recursão/paginação/corte por idade. Falhas são isoladas e também respeitam throttle. A expiração de reservas continua local e restrita a SITE, com a política B4 intacta.

No SITE, timer zero ou resposta `EXPIRADO` mantém mensagem inconclusiva e polling, desabilita o QR vencido e oferece o acompanhamento existente. Não dispara novo checkout nem navega para falha. Polls não se sobrepõem; respostas após saída são ignoradas. Layout, CSS e animações existentes foram preservados; a tela de falha não afirma mais que nenhum valor foi cobrado.

`npm test` roda as suítes B2/B3 com `node:test`. O cenário de timer/effects/navegação monta os componentes reais com React DOM e `jsdom` (somente devDependency), pois o harness financeiro não possuía DOM e testes de helpers/SSR não exercitariam essa corrida. A verificação visual em navegador é separada desses testes de comportamento.

## B4 — Reserva por pedido com múltiplos Pix

`liberarReservaPedido` revalida a projeção financeira no mesmo batch dos decrementos e do flip para `LIBERADA`. Todos usam o mesmo predicado: reserva `ATIVA`, ausência de marcas de baixa no pedido/itens, líquido zero (`PENDENTE`) e nenhum `PIX_MP/PENDENTE` do pedido. A retenção inclui SITE/ADMIN, substituídos, sucessores, Pix aditivos, tentativas sem ID remoto/QR e prazo vencido ainda não terminalizado no ledger. Placeholders locais não-PIX_MP não contam. `PARCIAL` continua retendo reserva; refund não repõe estoque.

Geração/regeneração ADMIN sempre prepara a aquisição condicional no batch: uma leitura anterior de `ATIVA` não permite criar Pix sem reserva caso uma liberação vença a corrida. Readquisição ocorre uma única vez, sujeita às constraints de estoque, junto com pagamento/alocações; falta de estoque reverte tudo antes do POST MP. Reserva ativa não tem incremento/TTL duplicado e reserva convertida ou estoque baixado não são reabertos. Guards de capacidade/substituição permanecem. Escritas de `FALHOU` por recusa de POST SITE/ADMIN agora exigem `PENDENTE`, preservando terminalizações concorrentes.

`paymentSync` finaliza a tentativa pelo estado persistido após reconciliar. `PIX_MP/CANCELADO` e `PIX_MP/EXPIRADO` repetem a tentativa de liberação mesmo em igualdade de estado ou CAS perdido; falha transacional deixa log e é propagada para permitir retry. A matriz/autoridade B2 e a reconciliação genérica B3 não mudaram. Cancelamento operacional não terminaliza cobranças Pix e também respeita a retenção por Pix pendente.

Depois da revisão adversarial final, o cancelamento passou a ser **recusado** (`409 / PEDIDO_COM_PIX_PENDENTE`) enquanto existir qualquer `PIX_MP/PENDENTE` do pedido — SITE ou ADMIN, substituído ou sucessor, com ou sem `mp_payment_id` (inclui `ENVIO_INCONCLUSIVO`). Sem isso, cancelar com cobrança viva e receber o pagamento depois terminava em `CANCELADO` + `PAGO` + estoque baixado: nada corrompido, mas um estado operacional indefensável. A recusa é avaliada dentro do próprio `UPDATE`, com o mesmo predicado do B4, então criação de Pix, webhook ou recuperação concorrentes não cabem entre a decisão e a escrita. Pix terminalizado (`EXPIRADO`/`FALHOU`/`CANCELADO`/`PAGO`) não bloqueia, o guard financeiro de líquido continua decidindo o resto, e nada da cobrança é alterado pela recusa. Janela remanescente conhecida: o guard financeiro ainda é um `SELECT` anterior ao `UPDATE`, então uma aprovação que caia exatamente nesse intervalo de milissegundos ainda permite `CANCELADO` + `PAGO` (coberto e documentado em `tests/cancelamento-pix.test.mjs`).

**Limites deliberados, demonstrados em testes:** não foi criado sweep de liberações. Se houver interrupção após gravar `CANCELADO` e antes de liberar, o B3 não encontra divergência financeira e o sweep financeiro não seleciona `CANCELADO`; polling público retorna cedo nesse estado. A reserva pode ficar presa sem novo webhook/retry explícito. `EXPIRADO` com ID remoto pode ser retentado pelo sweep financeiro existente; sem ID remoto, também pode permanecer preso até retry explícito (o sweep local só seleciona `PENDENTE`). Repetir a finalização recupera ambos sem novo pagamento. Compensação ADMIN por `FALHOU` continua restrita à operação que adquiriu a reserva: se A adquiriu, B compartilhou, A falhou enquanto B estava pendente e depois B também falhou, a reserva pode permanecer ativa. Cadeias somente `FALHOU` continuam dívida separada.

Regressões em `tests/b4.test.mjs`: A–H, concorrência com hooks/barreiras determinísticos, rollback, criação versus liberação, POST tardio, compensação, retries e limites de recuperação. O teste antigo que fixava a política B4 defeituosa foi alterado deliberadamente; a garantia de que o reconciliador genérico nunca libera foi preservada como teste separado.

## B1 — Contenção da edição destrutiva de itens

`PUT /api/admin/pedidos/:id/itens` preserva autenticação, valida ID/payload
(inclusive JSON `null`) e consulta somente a existência do pedido. Entradas
inválidas retornam `400`, pedido inexistente retorna `404` e todo pedido
existente com requisição válida retorna `409 / EDICAO_ITENS_BLOQUEADA`:
"A edição de itens está temporariamente indisponível. Nenhuma alteração foi salva."

O caminho de DELETE/INSERT/UPDATE foi removido. O endpoint não consulta catálogo,
financeiro ou estoque para decidir a negativa, não chama materialização ou
reconciliação e não realiza escritas de domínio. Isso também vale para
`ENTREGUE`, `CANCELADO` e pedidos aparentemente virgens. O frontend existente
exibe a mensagem retornada, sem mudança visual.

`tests/b1.test.mjs` acrescenta 65 verificações com o endpoint real, D1 local
descartável, snapshots integrais e observação separada das consultas do editor.
Doze cenários concorrentes controlam duas ordens para materialização legada,
pagamento manual, refund, baixa física, liberação e aprovação MP tardia simulada;
as alterações legítimas dessas operações são verificadas separadamente.
Validação local: 192/192 testes, build e diff check aprovados; type-check das
Functions conserva somente os dois erros anteriores de `auth.ts` (59 TS2345,
87 TS2322). Os 21 testes HTTP via Wrangler Pages usaram configuração e D1
temporários locais; exports completos antes/depois permaneceram idênticos.
Editor incremental e idempotência A1 continuam trabalhos separados.

## A1 — Identidade lógica estável das operações (idempotência)

A investigação pré-implementação está preservada em
`docs/investigacoes/A1-IDEMPOTENCIA.md` (HEAD `0e388ef`, 38 cenários
reproduzidos). Ela descreve o estado **anterior** a esta correção: cada POST
gerava uma identidade nova no servidor, então retry, timeout, abort,
remontagem, reload, resposta HTTP perdida ou concorrência podiam transformar
a mesma intenção em duas operações.

**Contrato.** Toda operação de escrita financeira/criação passa a exigir uma
`operationKey` criada pelo **cliente antes do primeiro envio**. A key é
estável durante retries da mesma intenção, diferente para uma intenção nova,
vinculada a tipo/escopo/ator e independente de valor, horário, WhatsApp ou
hash do carrinho. Junto dela vai um **fingerprint canônico versionado** do
conteúdo, que existe só para detectar reutilização *incompatível* da mesma
key — nunca para deduplicar por payload (duas intenções diferentes podem ter
payload idêntico e continuam sendo duas operações legítimas).

- mesma key + mesmo payload → mesma operação, mesmo resultado lógico;
- mesma key + payload incompatível → `409` estável, zero escrita financeira;
- key nova → intenção nova, sujeita aos guards normais do domínio.

Endpoints cobertos: `POST /api/checkout`, `POST /api/admin/pedidos`,
`POST /api/admin/pedidos/:id/pagamentos`, `.../reembolsos` e `.../pix`
(geração e regeneração).

**Persistência.** Migration aditiva `0012_operacoes_idempotencia.sql`, uma
tabela (`pedido_operacoes`) com `UNIQUE(operation_key)`. Nenhuma tabela
financeira foi reconstruída, nenhuma migration antiga foi alterada, nenhum
histórico foi reescrito. Ela guarda key, tipo, escopo/ator, fingerprint
versionado, pedido/pagamento/reembolso resultantes, resultado para replay,
identidade da tentativa MP (`mp_idempotency_key`, `mp_request`,
`mp_payment_id`) e a **fase** que distingue operação local criada, envio
remoto inconclusivo, recurso remoto conhecido, concluída e recusada. Não é
framework de jobs, não tem cron nem sweep novo.

**Atomicidade.** O claim é o último statement do MESMO batch do fato, e é
`INSERT ... SELECT` condicionado à existência do fato (resolvido pelas chaves
derivadas). Se o guard de domínio recusou a escrita, a fonte não devolve
linha e nenhuma operação é registrada — nunca sobra claim órfão. Nunca
`INSERT OR IGNORE` seguindo com os efeitos como se o claim tivesse sido
adquirido. As identidades técnicas passam a ser **derivadas** da key
(`a1:<key>`, `a1:<key>:pag`, `a1:<key>:ref`, `a1:<key>:mp`), o que transforma
os UNIQUEs já existentes de `pedidos.idempotency_key`,
`pedido_pagamentos.idempotency_key` e `pedido_reembolsos.idempotency_key`
numa segunda proteção atômica independente da tabela de operações. Na disputa
pela mesma key, o batch do perdedor é revertido inteiro e ele **relê a
vencedora** em vez de devolver um erro que convidaria a criar um segundo
fato. `token_publico` continua aleatório de propósito: é identificador
público de acompanhamento e não pode ser derivável de uma key.

**Lookup antes dos guards de estado.** Cada writer procura a operação pela
key ANTES dos guards que dependem do estado atual. É isso que permite
recuperar um sucesso anterior cuja resposta HTTP se perdeu: o pedido pode ter
virado `PAGO`, o saldo reembolsável pode ter mudado, o estoque pode não
permitir mais criar um pedido igual, e o retry ainda recupera a operação
original em vez de ser reinterpretado como uma tentativa nova contra o estado
novo. Replay de operação local é reconstruído a partir das linhas
persistidas; operações MP usam o snapshot de resultado com fallback para as
linhas.

**Ambiguidade do POST ao Mercado Pago** (achado da investigação, corrigido
só no necessário para o A1): `functions/lib/mpPost.ts` separa
`RECUSA_DEFINITIVA` (4xx de negócio) de `AMBIGUO` (transporte, timeout, 408,
429, 5xx, 2xx sem `id` utilizável). Antes, qualquer não-2xx gravava `FALHOU`
e liberava reserva — uma rejeição inventada. Agora o resultado ambíguo mantém
a operação inconclusiva e recuperável: ledger continua `PENDENTE`, reserva
intacta, `fase='ENVIO_INCONCLUSIVO'`, **nenhuma** key nova, nenhum pedido
novo, nenhuma tentativa nova, nenhum reenvio automático, nenhum sucesso nem
rejeição inventados. Um retry da mesma key devolve `OPERACAO_EM_PROCESSAMENTO`
com o pedido que já existe. A recusa comprovada continua gravando `FALHOU` +
liberação (guards B4 intactos) e fica terminal: o retry devolve a mesma
recusa sem novo POST. Permanecemos na **Payments API**; a matriz de transição
e a autoridade do GET verificado (B2) não mudaram. Um prazo explícito de 20s
foi adicionado ao POST justamente para que um envio pendurado termine como
ambíguo recuperável.

**Frontend (apenas funcional; zero mudança de layout/CSS).**
`src/lib/operationKey.ts` cria e preserva a identidade. No site, a key nasce
no submit de `Checkout.tsx` (nova finalização explícita = key nova) e é
preservada em `sessionStorage` + `useRef` por `AguardandoPagamento.tsx`, de
modo que retry, abort, remontagem e StrictMode reaproveitem a MESMA
identidade; `OPERACAO_EM_PROCESSAMENTO` leva para o acompanhamento do pedido
que já existe, nunca dispara outro checkout. No admin, `NovoPedidoModal`
mantém a key enquanto o conteúdo do formulário for o mesmo (conteúdo alterado
= intenção nova = key nova) e `PedidoDetalheModal` guarda uma key por
intenção de cobrança (`novo` / `regen:<id>`), preservando-a no caminho
ambíguo e descartando-a quando a ação se resolve. Nenhuma tela nova foi
criada para os endpoints de pagamento/refund.

**Testes.** `tests/a1.test.mjs` (40 verificações) não repete a investigação —
prova a correção, com código real, D1 local descartável criado pelas
migrations e provedor simulado. Cobre replay, conflito de payload/tipo/escopo,
keys distintas ainda aditivas, concorrência com barreira determinística
(pagamento, refund, pedido ADMIN, checkout, Pix, regeneração), falha antes da
persistência, commit concluído com resposta perdida, timeout/5xx/2xx ilegível
do MP, recurso remoto conhecido com falha local posterior, disputa da última
unidade e as regressões B1/B2/B3/B4.

## Blockers de go-live (B-1, B-2, B-3) — resolvidos

Depois do A1, uma triagem das dívidas restantes definiu o menor conjunto de
correções necessário para aceitar o primeiro pedido real com segurança
financeira, de estoque e operacional. Foram três, cada uma num commit próprio.

### B-1 — Pedido MANUAL/PENDENTE visível + política de reserva do balcão

A listagem administrativa filtrava só `status_pagamento IN ('PARCIAL','PAGO')`
nas três queries (contagem, página e contadores das abas). Como o default do
"Novo pedido" é `DINHEIRO`/`PENDENTE`, **o caminho principal do balcão criava
um pedido invisível** — com estoque reservado e sem nenhuma outra tela por onde
alcançá-lo: detalhe, troca de status, pagamento manual e geração de Pix ficavam
inacessíveis exatamente para os pedidos que mais precisavam deles.

Um predicado único (`PEDIDOS_OPERACIONAIS_SQL`) passou a alimentar as três
queries: `status_pagamento IN ('PARCIAL','PAGO') OR origem_pedido = 'MANUAL'`.
Pedido de balcão é compromisso real assumido pela operadora, então entra
independente do status financeiro. Pedido SITE `PENDENTE` continua
deliberadamente fora — é carrinho não pago, não compromisso — e entra quando
vira `PARCIAL`/`PAGO`, como sempre.

**Política de reserva decidida explicitamente:** a reserva do pedido MANUAL
nasce `ATIVA` com `reserva_expira_em` NULL e **não expira sozinha**. Expirar
automaticamente seria o comportamento errado — venderia o doce recém-prometido
no balcão. Por isso `liberarReservasVencidasLocalmente` continua restrita a
`origem='SITE'` e nenhum cron/sweep foi criado. O que torna isso seguro é a
liberação explícita que já existe e segue protegida pelo B4: cancelar libera
(placeholder local não é `PIX_MP/PENDENTE`), pagar converte em baixa física. O
defeito nunca foi a falta de TTL — era a invisibilidade.

Sem migration e sem mudança de frontend (`formatarFinanceiro` já tratava
`PENDENTE`).

### B-2 — Registro manual de estorno de `PIX_MP`

`METODOS_MANUAIS_REEMBOLSAVEIS` excluía `PIX_MP` e o guard de cancelamento
exige líquido zero ("Faça o estorno antes de cancelar"). Resultado: cliente
paga Pix, desiste, a operadora devolve o dinheiro por fora — e o pedido ficava
`PAGO` para sempre, impossível de cancelar ou estornar, recuperável só com SQL
direto no banco.

`PIX_MP` passou a ser **registrável**, o que **não** significa chamar a API de
refund do Mercado Pago (segue fora de escopo; nenhuma chamada remota acontece
neste caminho). `origem='MANUAL'` é deliberado: descreve quem criou o fato — o
operador, não uma integração. O estorno continua sendo um fato novo e
independente: o pagamento original nunca é mutado, allocations são preservadas,
teto reembolsável e projeção B3 seguem valendo, e **estoque não é reposto**.

`refunded`/`charged_back` foram investigados e **deliberadamente não
sincronizados**: `mapMpStatus` devolve `null` para os dois, então o GET
verificado apenas registra o status bruto e nunca inventa uma devolução.

Sem migration.

### B-3 — Recuperação de `ENVIO_INCONCLUSIVO`

O A1 criou a fase `ENVIO_INCONCLUSIVO` (timeout, transporte, 408/429/5xx, 2xx
sem `id` utilizável) — mas ela era **estado morto**: nada no código a lia. Sem
`mp_payment_id`, `reconcilePendingPixPayments` não seleciona a tentativa e o
polling público não consulta o provedor, então a única recuperação era o
webhook. Se ele não chegasse, uma cobrança realmente criada e realmente paga
nunca seria descoberta.

**Contrato confirmado na documentação oficial da Mercado Pago antes de escrever
código:** `GET /v1/payments/search` é read-only, exige `sort` e `criteria`,
aceita `external_reference` como filtro, responde
`{paging:{total,limit,offset}, results:[...]}`, devolve **200 com `results`
vazio** quando não há correspondência, limite padrão 30, e cobre os **últimos
doze meses**.

`functions/lib/mpSearch.ts` faz a observação read-only e **só propõe um id** —
nunca tem autoridade financeira. A orquestração
(`paymentSync.ts::recuperarOperacoesInconclusivas`) encadeia os mecanismos que
já existiam, sem duplicar lógica financeira:

```
busca read-only (propõe id)
  → fetchMpPayment      (ÚNICA fonte de autoridade financeira — B2)
  → resolveWebhookPayment (associação guardada por CAS, sem duplicar)
  → syncPaymentFromMp   (matriz de transição + reconciliação B3 + B4)
```

Invariante central: uma operação inconclusiva pode significar que o provedor
não criou nada **ou** que criou e perdemos a resposta. A recuperação nunca
assume nenhuma das duas. Zero resultados **não** produz `FALHOU`/`CANCELADO` nem
libera reserva; múltiplos candidatos **não** são resolvidos arbitrariamente
(ficam visíveis para intervenção); falha de observação não é rejeição e é
repetível. Nunca faz POST, nunca gera identidade nova, nunca cria pedido,
tentativa ou fato financeiro.

Achado durante os testes: a seleção inicial exigia `status='PENDENTE'`, o que
abandonaria o caso mais caro — cobrança criada, paga, e com prazo local vencido
antes de descobrirmos. Passou a aceitar `PENDENTE, EXPIRADO`, coerente com os
fallbacks do webhook e com `reconcilePendingPixPayments`; a promoção
`EXPIRADO → PAGO` continua exigindo autoridade do GET verificado (B2).

Dispara na reconciliação oportunista do `GET /api/admin/pedidos`, em lote de 4
com throttle de 60s adquirido antes de qualquer chamada externa — **sem cron,
sem infraestrutura de jobs**. O caso deixou de ser cego: `GET /pedidos/:id`
expõe `operacoesInconclusivas` e o detalhe administrativo mostra um aviso
reusando o bloco já existente. Sem migration.

## O que falta

Caminho mínimo até o **primeiro pedido real**. Os três blockers de código estão
feitos; o que resta não é código de domínio, com uma exceção opcional.

1. **Revisão adversarial final única** — do fluxo completo (A1 + B1/B2/B3/B4 +
   B-1/B-2/B-3), uma vez só. É a próxima etapa.
2. **Webhook do MP em produção** — configurar `MP_WEBHOOK_SECRET` no Cloudflare
   Pages real e cadastrar a URL pública no app do Mercado Pago. Hoje, sem o
   segredo, `webhooks/mercadopago.ts` devolve **503 para todo evento**. Zero
   código; validar com evento real do MP em ambiente de teste primeiro.
3. **B5 — cutover seguro do D1 de produção.** Etapa própria e **blocker de
   deploy**: as migrations `0006`, `0007` e `0008` fazem `DROP TABLE` em
   `pedidos` e `pedido_itens` com rebuild. Aplicar a cadeia contra o D1 real
   **destruiria pedidos e itens históricos**, com cascades para ledger e
   reembolsos. `PRAGMA defer_foreign_keys=ON` não protege contra isso. Exige:
   backup/export, inspeção do schema remoto e do histórico real de migrations,
   comparação produção × rebuild, auditoria de duplicatas de `mp_payment_id`
   (decide o UNIQUE), **migration de compatibilidade em vez do replay das
   rebuilds**, plano de rollback (rollback de código Cloudflare ≠ rollback de
   D1) e smoke pós-cutover. Nunca misturar com correção de domínio.
4. **Backup verificado** de produção, depois **cutover**, depois **deploy**.
5. **Smoke de produção** — incluindo evento real de webhook e um Pix de valor
   mínimo ponta a ponta.
6. **Primeiro pedido real.**

Opcional antes do go-live, barato e não bloqueante: exibir os valores no badge
financeiro quando `pagoCentavos > totalCentavos` (hoje um overpayment aparece
igual a um pagamento exato — ver dívidas) e um diálogo mínimo de estorno no
admin, caso estorno precise ser rotina desde o primeiro dia.

Evolução de produto, explicitamente fora do caminho crítico:

- **Comanda como balcão de atendimento** — reabrir comanda fechada pra adicionar item depois da entrega, lançamentos incrementais sem falsificar histórico, possivelmente consolidar novas compras da mesma cliente no mesmo dia numa comanda só (identidade por WhatsApp normalizado, nunca nome), exclusão/arquivamento seguro. Investigação própria antes de codar — não é puxadinho de nenhum passo anterior.
- **Refund automático via Mercado Pago** — diferente do B-2, que só *registra* um estorno já feito por fora; produção integra refund direto na API do MP.
- **Exchange / correções de item** (`pedido_item_correcoes`) — trocar produto de pedido já pago, com reembolso parcial e reforço/baixa de estoque.
- **Editor incremental de itens** — B1 mantém a edição destrutiva bloqueada com `409`.

## Dívidas conhecidas (documentadas, não esquecer)

Blockers (não são dívidas — impedem o go-live, ver "O que falta"):

- **Webhook do MP não está plugado em produção de verdade**: código pronto (Passo 6), falta configurar `MP_WEBHOOK_SECRET` no Cloudflare Pages real e cadastrar a URL pública no app do Mercado Pago. **Sem o segredo o endpoint devolve 503 para todo evento.** Depois do B-3 a recuperação read-only é um segundo caminho independente, mas o webhook continua sendo o mais rápido.
- **B5 — cutover do D1**: `0006`/`0007`/`0008` fazem `DROP TABLE` em `pedidos`/`pedido_itens`. Ver "O que falta".

Dívidas aceitas para o primeiro go-live:

- **Overpayment**: o ledger preserva corretamente todos os fatos (nada é apagado ou ignorado), a baixa física continua acontecendo no máximo uma vez e a reserva `CONVERTIDA` não é reaberta. Porém `formatarFinanceiro` só exibe valores quando o status é `PARCIAL` — um pedido de R$ 50 que recebeu R$ 100 aparece como "✓ Pago · Pix", igual a um pagamento exato. O excedente vem correto na API (`pagoCentavos`) e **não é renderizado**. Exige a operadora regenerar Pix *e* a cliente pagar os dois. Mitigação barata descrita em "O que falta"; tratamento operacional de crédito continua não construído.
- **`pedido_pagamentos.mp_payment_id` sem UNIQUE** (migration 0010 cria índice comum): o A1 eliminou o caminho realista de duas linhas locais para o mesmo pagamento remoto (uma key ⇒ uma linha, `X-Idempotency-Key` derivada e estável), e todos os leitores falham em segurança — `resolveWebhookPayment` devolve `ambiguous` sem decidir, `applyLedgerTransition` exige exatamente uma linha vinculada e lança em divergência, e o UPDATE de aprovação repete o `NOT EXISTS` dentro da escrita. `pedidos.mp_payment_id` *é* UNIQUE e protege o caminho SITE. O que resta é auditoria de duplicatas **históricas** em produção: assunto do B5, não código.
- **Sem UI de estorno**: o backend existe (Passo 5, ampliado no B-2 para `PIX_MP`), mas não há dialog no admin ligando "cancelar" → "reembolsar" — chamada direta ao endpoint, que depois do A1 exige gerar uma `operationKey`.
- **`PARCIAL` + Pix expirado**: reserva de estoque fica presa até ação manual (Passo 7, decisão consciente) — vale também para Pix administrativo (Passo 9), política mantida idêntica, não redesenhada.
- **Waterfall entre duas intenções legítimas distintas** não é serializável por item: o teto agregado do pedido (`SUM(PAGO) <= total`) continua garantido, só a atribuição por item pode ficar torta. O caso perigoso (retry) foi resolvido pelo A1.
- **Janela residual B4**: falha de infra entre persistir o estado terminal e liberar a reserva pode deixá-la `ATIVA`; repetir a finalização recupera, e o sweep financeiro cobre `EXPIRADO` com `mp_payment_id`.
- **Refund não repõe estoque** (deliberado): ajuste manual pela tela de produtos.
- **Perdedor de corrida em operação MP** recebe `OPERACAO_EM_PROCESSAMENTO` em vez do sucesso: correto (não inventa resultado); impacto só de UX, e o retry posterior devolve a operação persistida.
- **Expiração local de reservas (`liberarReservasVencidasLocalmente`) só cobre `origem='SITE'`** — decisão reafirmada no B-1 para o pedido MANUAL (ver política lá). A varredura financeira `reconcilePendingPixPayments` já consulta SITE e ADMIN, inclusive expirados após B2, e o B-3 cobre as tentativas sem `mp_payment_id`. B4 protege outros Pix pendentes. Criar sweep de liberações continua sendo trabalho separado.
- **UI do Pix administrativo (v1, decisões de escopo, não limitações do backend)**: não oferece criar um Pix aditivo extra quando já há Pix vivos (só regenerar os existentes); não tem campo de valor customizado no "Gerar Pix" (sempre a capacidade cheia).
- **Imports circulares** (`comandaLedger.ts` ↔ `pedidoReconcile.ts`, `paymentSync.ts` ↔ `stock.ts`): funcionam (confirmado no bundler do wrangler, não só no `tsc`), mas são dívida arquitetural — quebrar via módulo-folha compartilhado se crescerem.
- **Wrangler 3.114 desatualizado** (avisa para migrar ao 4.x); `pages dev` não aceita `--config`, o que obriga a trocar o `wrangler.toml` temporariamente em smokes locais.

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
0012_operacoes_idempotencia.sql                pedido_operacoes (identidade lógica/idempotência A1)
```
