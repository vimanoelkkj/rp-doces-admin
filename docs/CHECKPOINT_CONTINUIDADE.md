# R&P Doces — checkpoint de continuidade

> Documento operacional para retomar o projeto sem depender do histórico de
> conversa. Leia este arquivo antes de `README.md` e `docs/ESTADO_ATUAL.md`
> quando houver divergência sobre o estado posterior ao B5: esses dois arquivos
> ainda contêm trechos históricos que descrevem o B5 como pendente e o A1 como
> não commitado.

## Resumo executivo

- Repositório: `https://github.com/vimanoelkkj/rp-doces-admin`
- Branch autoritativa: `rebuild-from-scratch`
- Upstream: `production/rebuild-from-scratch`
- Base verificada antes deste documento:
  `b0bdf774f08a107045abb8a3a01d6545f5f4ac6b`
- Último commit funcional:
  `rp-doces: fix human test findings`
- Este arquivo deve estar no commit:
  `rp-doces: document continuation checkpoint`
- Estado verificado depois do commit deste documento: branch limpa, um commit
  à frente e zero atrás do upstream local.
- O B5 production schema cutover já foi concluído. Não reaplicar.
- Os commits funcionais até `b0bdf77` passaram a constar no upstream durante
  este checkpoint; o commit deste documento permanece local. Nenhum deploy do
  rebuild foi realizado ou identificado nesta sessão.
- **Segunda rodada humana encerrada (Fase 5.4).** HUMAN-12, HUMAN-14,
  HUMAN-15 e HUMAN-17 foram aprovados no reteste manual do proprietário;
  HUMAN-16 ficou aprovado tecnicamente. Commit funcional da rodada:
  `bf23857f3b5316dbb72a0838b14178ecd13a6acf`.
- **A migration `0014_notificacao_leituras.sql` existe, mas produção NÃO a
  possui.** Antes de qualquer deploy é obrigatória uma etapa separada e
  explicitamente autorizada de compatibilidade aditiva. Ver seção 2.
- **Divergência detectada ao fechar este checkpoint:** esta sessão nunca
  executou `git push`, mas ao reconferir o estado antes de finalizar o
  documento, `origin/rebuild-from-scratch` já continha `bf23857` mais dois
  commits adicionais — `eef745a` (`make admin responsive`) e `297b9d9`
  (`add floating mobile bottom navigation`), ambos do mesmo autor do
  repositório, só CSS/layout do admin (responsividade e navegação inferior
  mobile), sem tocar `functions/`, `shared/` ou migrations. Padrão já
  registrado neste checkpoint antes (avanço do upstream por processo
  paralelo). HEAD local passou a ser `297b9d9` por fast-forward, sem
  divergência nem reescrita de histórico; `bf23857` permanece intacto na
  cadeia. Suíte revalidada nesse HEAD: 345/345, build e diff-check
  aprovados. Nenhum push, deploy ou escrita em produção foi feito por esta
  sessão.

O hash do commit que contém este próprio arquivo não pode ser gravado dentro
dele sem tornar o commit autorreferente. Ao retomar, obtenha o HEAD atual com:

```powershell
git rev-parse HEAD
git show -s --format="%H%n%s" HEAD
```

## 1. Estado Git atual

Estado verificado logo após o reteste humano da Fase 5.4, quando o commit
funcional era o topo local:

| Item | Estado verificado |
| --- | --- |
| Branch | `rebuild-from-scratch` |
| HEAD | `bf23857f3b5316dbb72a0838b14178ecd13a6acf` |
| Commit | `rp-doces: implement post-test improvements` |
| Upstream | `origin/rebuild-from-scratch` |
| Ahead/behind | `1 / 0` |
| Working tree | limpa |
| `npm test` | 341/341 |
| `npm run build` | aprovado |
| `git diff --check` | aprovado |
| Push de `bf23857` por esta sessão | **não realizado** |
| Deploy | **não realizado** |

**Reconferido ao fechar este checkpoint (estado mais atual e autoritativo):**

| Item | Estado verificado |
| --- | --- |
| Branch | `rebuild-from-scratch` |
| HEAD | `297b9d94452e2191abc00649045c3023a281f70f` |
| Commit | `rp-doces: add floating mobile bottom navigation` |
| Commits à frente de `bf23857` na mesma linha | `eef745a` (`make admin responsive`), `297b9d9` (`add floating mobile bottom navigation`) — só CSS/layout do admin, sem tocar `functions/`, `shared/` ou migrations |
| Upstream | `origin/rebuild-from-scratch` (já contém os três commits) |
| Ahead/behind | `0 / 0` |
| Working tree | limpa (após o commit deste checkpoint) |
| `npm test` neste HEAD | 345/345 |
| `npm run build` | aprovado |
| `git diff --check` | aprovado |
| Push de `bf23857`/`eef745a`/`297b9d9` por esta sessão | **não realizado** — chegaram ao upstream por processo externo/paralelo, mesmo padrão já registrado abaixo para `ac06e5d → b0bdf77` |
| Deploy | **não realizado** por esta sessão |

`bf23857` permanece intacto e sem reescrita na cadeia; o avanço foi só
fast-forward. Nenhuma investigação adicional das duas mudanças
responsivas foi feita nesta rodada — elas pertencem a outra frente de
trabalho (UI mobile do admin), fora do escopo HUMAN-12/14/15/16/17.

O histórico abaixo descreve a inspeção anterior (Fase 5.3) e é mantido como
registro; o upstream passou a ser `origin/rebuild-from-scratch`.

Estado diretamente verificado antes da criação deste documento:

| Item | Estado verificado |
| --- | --- |
| Branch | `rebuild-from-scratch` |
| HEAD base | `b0bdf774f08a107045abb8a3a01d6545f5f4ac6b` |
| Último commit funcional | `rp-doces: fix human test findings` |
| Upstream | `production/rebuild-from-scratch` |
| Ahead/behind no início deste documento | `ahead 2`, `behind 0` |
| Upstream ao final | `b0bdf774f08a107045abb8a3a01d6545f5f4ac6b` |
| Ahead/behind depois do commit | `ahead 1`, `behind 0` |
| Working tree antes deste documento | limpa |
| Push por este trabalho/Codex | não realizado |
| Deploy do rebuild | não realizado |

No início da inspeção, os dois commits funcionais locais ainda apareciam como
não enviados:

1. `a7f0506ab45dd00c59be0c80987182e72e1e00e9` —
   `rp-doces: preserve production security headers`
2. `b0bdf774f08a107045abb8a3a01d6545f5f4ac6b` —
   `rp-doces: fix human test findings`

Durante o checkpoint, a referência local
`production/rebuild-from-scratch` avançou de `ac06e5d` para `b0bdf77`. O
reflog registra `update by push` em `2026-09-18 09:55:43 -0300`. Este trabalho
não executou `git push`; portanto, o avanço veio de outro processo ou do
usuário em paralelo. O estado final passa a ter somente o commit deste
documento não enviado, com `ahead 1` e `behind 0`.

Comandos para reconfirmar:

```powershell
git branch --show-current
git rev-parse HEAD
git status --short --branch
git branch -vv
git rev-parse --abbrev-ref --symbolic-full-name '@{upstream}'
git rev-list --left-right --count '@{upstream}...HEAD'
git log '@{upstream}..HEAD' --format='%H`t%s'
git diff --check
```

O `ahead/behind` foi verificado contra a referência remota armazenada
localmente. Este trabalho não fez `fetch`, push ou mutação remota. Como a
referência mudou durante a execução, não é correto afirmar que nenhum push
existiu: houve um push concorrente que publicou até `b0bdf77`.

## 2. Estado de produção e B5

### Identidade do D1 de produção

| Campo | Valor |
| --- | --- |
| Database name | `rp-doces-db` |
| Database UUID | `c2e15599-3d68-4801-9a1c-96a84977dd7c` |
| Binding | `DB` |

Esses valores continuam presentes em `wrangler.toml`.

### Estado do cutover

O B5 production schema cutover foi concluído. O script especial
`scripts/b5-production-compat.sql` foi aplicado uma única vez ao D1 real e a
validação pós-cutover aprovou 13/13 verificações. Os dados históricos foram
preservados; a mudança foi aditiva no schema.

Não reconfirmar isso com escrita remota. O checkpoint atual não acessou o D1
remoto. A evidência operacional anterior e os artefatos locais são o registro
do cutover concluído.

> [!CAUTION]
> **NUNCA executar `wrangler d1 migrations apply --remote`.**
>
> As migrations normais `0001` a `0014` pertencem a bancos novos e não devem
> ser aplicadas à produção histórica. Em especial, `0006`, `0007` e `0008`
> reconstruiriam tabelas com risco de cascata destrutiva. A `0013` também não
> deve ser aplicada à produção, onde as colunas legadas já existem.

### Migration 0014 — pendência obrigatória antes do deploy

`migrations/0014_notificacao_leituras.sql` foi criada na Fase 5.4 para o
HUMAN-14. Situação atual:

- criada no repositório e **testada somente em D1 LOCAL isolado**
  (`.wrangler/human-test-f54`, com `--local --persist-to`);
- **NÃO aplicada em produção**;
- **produção NÃO possui a tabela `notificacao_leituras`**.

Consequência prática: se o rebuild for publicado antes dessa adaptação, a
página de Notificações e o badge falharão em produção, porque a tabela de
estado de leitura não existe lá. Os demais fluxos não dependem dela.

Antes do deploy é obrigatória uma **etapa separada e explicitamente
autorizada** de compatibilidade aditiva, na mesma cautela do B5: script
próprio (no molde de `scripts/b5-production-compat.sql`), revisão,
validação e autorização explícita. Não usar o fluxo normal de migrations
contra o D1 remoto, e não criar esse script sem autorização.

A migration é puramente aditiva (`CREATE TABLE` + dois índices, sem tocar
tabela existente), então o rollback é `DROP TABLE` sem perda de dado de
domínio — só estado de leitura.

Regras permanentes:

- não reaplicar o B5;
- não usar o fluxo normal de migrations contra o D1 remoto;
- não inserir, atualizar, excluir, criar, alterar ou remover objetos remotos
  sem autorização explícita e fase operacional própria;
- não manipular `d1_migrations`;
- não corrigir dados históricos como efeito colateral;
- rollback de código Cloudflare não equivale a rollback do D1.

### Backup pré-B5

Arquivo preservado fora do Git:

```text
C:\Users\zZzZz\Projetos\rp-doces-backups\backup-pre-b5.sql
```

Verificado neste checkpoint:

- tamanho: `126127` bytes;
- SHA-256:
  `f24a0781dd4a482cdc2660a8ef727a4a9b3096c4d8e56b1895f7ab9109b4c117`.

Não modificar, substituir, mover ou imprimir o conteúdo desse backup. Ele
contém dados reais e pode conter PII.

Comando seguro para verificar novamente sem ler o conteúdo:

```powershell
Get-Item 'C:\Users\zZzZz\Projetos\rp-doces-backups\backup-pre-b5.sql' |
  Select-Object FullName, Length, LastWriteTime
Get-FileHash -Algorithm SHA256 `
  'C:\Users\zZzZz\Projetos\rp-doces-backups\backup-pre-b5.sql'
```

## 3. Trabalho concluído

### B1 — contenção da edição destrutiva de itens

O endpoint de edição de itens permanece bloqueado server-side com
`409 EDICAO_ITENS_BLOQUEADA`. A Fase 5.3 também desabilitou antecipadamente
os controles da UI. Não reabrir o editor destrutivo: a implementação futura
precisa ser incremental e preservar IDs, auditoria, allocations, reserva,
estoque e concorrência.

### B2 — recuperação verificada de Pix expirado

`EXPIRADO -> PAGO` só ocorre com GET autoritativo e verificado do Mercado
Pago. Relógio local, webhook bruto e snapshots persistidos não possuem essa
autoridade isoladamente.

### B3 — reconciliação financeira convergente

O ledger é a verdade financeira e as projeções são reconstruíveis. Retries
recuperam falhas entre ledger, projeção e estoque, e a baixa física acontece
no máximo uma vez. Falha posterior ao commit de pagamento/reembolso
administrativo não transforma o fato financeiro persistido em erro da
operação financeira.

### B4 — reserva segura com múltiplos Pix

A reserva pertence ao pedido, não a uma tentativa Pix. Uma tentativa
`PIX_MP/PENDENTE` protege a reserva; criação e liberação concorrentes usam
guards atômicos. A janela residual entre terminalização e liberação continua
como dívida operacional aceita e não deve ganhar cron/sweep silencioso.

### A1 — idempotência das operações críticas

As operações críticas usam `operationKey` estável, fingerprint canônico e
replay seguro. Mesma key e mesmo payload recuperam a mesma operação; payload
incompatível conflita; key nova representa intenção nova. Resultado ambíguo
do POST ao Mercado Pago fica recuperável e não inventa sucesso, rejeição nem
segunda operação.

### B5 — Fase 1

Foi feita auditoria read-only do D1 real, do schema, das 36 migrations
históricas e dos dados. Ela provou que as migrations `0001..0013` do rebuild
não podiam ser reproduzidas em produção e definiu a necessidade de um script
de compatibilidade separado.

### B5 — Fase 2

Foram criados e revisados o script aditivo
`scripts/b5-production-compat.sql`, a validação
`scripts/b5-production-validate.sql`, a compatibilidade das colunas legadas e
o laboratório local que prova preservação. A revisão terminou com 297/297
testes e sem BLOCKER/HIGH.

### B5 — Fase 3

Foi exportado o backup real pré-B5, restaurado em clone D1, aplicado o B5 no
clone e executado smoke do rebuild. A validação deu 13/13, os fingerprints de
dados permaneceram iguais e a reaplicação no clone escreveu zero linhas.

### B5 — Fase 4

O script especial B5 foi aplicado uma vez ao D1 real correto. A validação
pós-cutover aprovou 13/13; dados, contagens e integridade permaneceram
inalterados, enquanto o schema ganhou `pedido_operacoes` e cinco índices.
Não houve deploy nessa fase.

### Fase 5 — auditoria pré-deploy

A auditoria confirmou o cutover, revisou build, Functions, bindings, Mercado
Pago e superfície de produção, e encontrou um blocker de preservação dos
headers de segurança do Pages. Nenhum deploy foi realizado.

### Fase 5.1 — blocker de headers

Foram adicionados `public/_headers` e `public/_redirects`, preservando CSP e
compatibilidade de `/admin-v2` no artefato Vite. Commit
`a7f0506ab45dd00c59be0c80987182e72e1e00e9`. Ao final deste checkpoint, o
commit consta no upstream local por causa do push concorrente. Nenhum deploy
foi realizado ou identificado nesta sessão.

### Fase 5.2 — primeiro laboratório humano

Foi preparado ambiente local com D1/R2 locais e Mercado Pago inerte. A fase
não alterou código nem criou commit. O laboratório permitiu a primeira rodada
de uso humano sem tocar produção.

### Fase 5.3 — correções da primeira rodada humana

Foram corrigidos HUMAN-01, 02/05, 03, 04, 06, 07, 08, 09, 11 e 13, com
regressões automatizadas. Resultado final: 306/306 testes, build aprovado,
111 módulos Vite e `git diff --check` aprovado. Commit
`b0bdf774f08a107045abb8a3a01d6545f5f4ac6b`.

Não refazer essas investigações sem evidência de regressão. Preserve as
invariantes B1/B2/B3/B4/A1 e o cutover B5.

### Fase 5.4 — HUMAN-12/14/15/16/17

Commit funcional: `bf23857f3b5316dbb72a0838b14178ecd13a6acf` —
`rp-doces: implement post-test improvements`. 34 arquivos, 341/341 testes,
build aprovado, `git diff --check` aprovado, type-check das Functions sem
erros novos além do baseline de `auth.ts`.

O código exportado pelo Figma foi usado como especificação auxiliar. Nenhum
componente dele foi copiado, nenhum componente existente foi substituído,
nenhum segundo design system foi introduzido.

**HUMAN-12 — promoção.** A regra de vigência passou a ser única, em
`shared/promocao.ts`, importada pelo backend e pelo catálogo (mesmo padrão
de `shared/whatsapp.ts`), com `promocao_ativa` como fonte única de
ativação. Cinco estados: desligada, sem preço, futura, vigente e expirada.
A expiração é consequência de avaliar a regra a cada leitura — não existe
cron. Datas persistidas em ISO UTC (`Z`), com parser que também aceita o
formato do SQLite como UTC. O admin passou a persistir
`preco_promocional_centavos`, `promocao_inicio` e `promocao_fim`; antes só
gravava o booleano. Sem migration: as colunas existem desde 0001/0005.
Checkout e criação manual continuam autoridade do preço.

**HUMAN-14 — notificações.** Ver seção própria abaixo.

**HUMAN-15.** O ícone da prévia da loja deixou de ser um retângulo com
faixa (lia-se como cartão) e passou a ser o balão com o fone. Só o desenho
mudou.

**HUMAN-16.** `.nped-btn-remove` não tinha override no tema escuro e
herdava fundo branco. Ganhou base dark derivada do `.nped-close` já
aprovado, hover destrutivo próprio e `focus-visible` nos dois temas. Alvo
clicável, `type="button"` e `disabled` preservados. **B1 intacto.**

**HUMAN-17.** O CSS estilizava `input[type="text"]` e o HUMAN-04 mudou o
campo para `type="tel"`, nos dois arquivos de tema. `tel` foi incluído.
Máscara, `inputMode`, `maxLength`, validação e normalização intactos.

**Flakiness do A1 diagnosticada e resolvida.** A falha intermitente
registrada na Fase 5.3 reapareceu e foi capturada: nos testes de
concorrência com a mesma operation key, o perdedor da corrida tem DOIS
desfechos legítimos — `409 OPERACAO_EM_PROCESSAMENTO` se reler antes de a
vencedora concluir o POST, ou sucesso com replay apontando para a mesma
operação se reler depois. O teste fixava um dos desfechos, o que é assumir
um timing. As asserções passaram a aceitar ambos, mantendo integral o
invariante forte (um pedido, uma tentativa, uma operação, um POST, uma
reserva). **Era defeito do teste, não do código.** Depois da correção:
12/12 execuções isoladas e várias suítes completas estáveis.

### Fase 5.4 — HUMAN-14, arquitetura das notificações

Nenhuma notificação é materializada. Cada uma é **derivada na leitura** de
um fato que já existe no domínio; só o estado de leitura é persistido. Isso
evita criar uma segunda verdade que poderia divergir do ledger/estoque.

Eventos implementados e formação das chaves:

| Evento | Fato de origem | Chave |
| --- | --- | --- |
| Pedido aguardando preparo | `pedidos` com `status_pedido='NOVO'` e o recorte operacional do B-1 (`PARCIAL`/`PAGO` ou `MANUAL`) | `pedido:<id>:novo` |
| Pagamento confirmado | `pedido_pagamentos` com `status='PAGO'` e `pago_em` | `pagamento:<id>:pago` |
| Estoque baixo/esgotado | `produtos` ativos com `estoque - estoque_reservado <= 3` | `estoque:<id>:baixo` / `estoque:<id>:esgotado` |
| Cobrança sem confirmação do MP | `pedido_operacoes` no mesmo predicado da recuperação read-only do B-3 | `operacao:<operation_key>` |

Propriedades: carrinho não pago do site não notifica; o nível faz parte da
chave do estoque, então marcar "baixo" não esconde o "esgotado" posterior;
quando o fato muda, a notificação deixa de ser derivada e some sozinha.

Leitura: `INSERT OR IGNORE` contra `UNIQUE(usuario_id, chave)` — idempotente
e por operador. "Marcar todas" é resolvido no servidor, derivando de novo,
sem confiar na lista que o cliente está vendo. Só chaves deriváveis agora
podem ser marcadas.

Badge: o item **Notificações** da barra lateral passou a exibir a contagem
real de não lidas. Atualização por eventos naturais (montagem, `focus`,
`visibilitychange`) com dedupe — sem polling e sem realtime.

Rota: `/admin/notificacoes` já existia no menu e não tinha destino; agora é
a superfície real, dentro do layout administrativo atual. Nenhum header com
sino foi criado. Ações contextuais levam ao pedido exato via
`?pedido=<id>`, ou a `/admin/produtos` no caso de estoque.

## 4. Primeira rodada de teste humano

“Retestado pelo proprietário” é conservador: somente fatos explicitamente
observados no reteste estão marcados como confirmados. Testes automatizados
não substituem essa coluna.

| ID | Problema | Situação atual | Implementado? | Retestado pelo proprietário? | Próximo passo |
| --- | --- | --- | --- | --- | --- |
| HUMAN-01 | Dropdown deslocava/redimensionava o modal e criava overflow. | `PortalDropdown` renderiza a lista em portal fixo, com scroll próprio. | Sim, Fase 5.3. | Confirmação final não registrada. | Repetir o gesto no modal e confirmar ausência de layout shift/scrollbar. |
| HUMAN-02 | Status divergia entre detalhe, lista e contadores. | Mapeamentos, filtros e contadores usam os mesmos estados canônicos; mutação atualiza a lista. | Sim, junto com HUMAN-05. | Confirmação final não registrada. | Retestar mudança/cancelamento sem F5. |
| HUMAN-03 | UI prometia edição de itens que o B1 recusava. | Controles mutantes e salvar estão desabilitados; aviso aparece antecipadamente. B1 permanece. | Sim. | Confirmação final não registrada. | Confirmar clareza do aviso; não reabrir B1. |
| HUMAN-04 | WhatsApp aceitava letras e conteúdo inválido. | Máscara e validação brasileira compartilhadas no frontend/backend; persistência só com dígitos. | Sim. | Parcial: o reteste revelou a regressão visual HUMAN-17. | Preservar a regra funcional e corrigir somente o estilo em HUMAN-17. |
| HUMAN-05 | Pedido novo aparecia como “Em produção”. | Estado inicial é `NOVO`; `PREPARANDO` exige ação operacional explícita; pagamento não avança operação. | Sim, junto com HUMAN-02. | Confirmação final não registrada. | Retestar `NOVO -> PREPARANDO` manualmente. |
| HUMAN-06 | Background rolava com modal aberto. | `useAdminModal` aplica scroll lock compartilhado e restaura posição/estilos. | Sim. | Confirmação final não registrada. | Retestar os modais em página longa e diferentes larguras. |
| HUMAN-07 | Preço aceitava texto arbitrário. | Máscara BRL e conversão determinística para centavos. | Sim. | Confirmação final não registrada. | Retestar digitação, colagem e valores grandes. |
| HUMAN-08 | Drag de dentro para o backdrop fechava o modal. | Fechamento exige pointerdown, pointerup e click genuínos no backdrop. | Sim. | Confirmação final não registrada. | Repetir os dois sentidos de drag e clique externo real. |
| HUMAN-09 | Estoque só aceitava `-/+`. | Centro editável pelo teclado, apenas inteiro não negativo, sem spinner nativo. | Sim. | Confirmação final não registrada. | Retestar Ctrl+A, vazio, letras, decimal e botões. |
| HUMAN-10 | Não existe backup/reversão da imagem anterior. | Upload troca `image_key` após gravar o novo R2 e apaga o antigo em best effort; há janelas de objetos órfãos e nenhum versionamento. | Não. | Não se aplica. | Melhoria arquitetural futura; não é blocker imediato salvo nova decisão. |
| HUMAN-11 | Catálogo aberto não refletia disponibilidade sem F5. | Revalida ao montar, recuperar foco ou visibility, com dedupe e sem polling. | Sim. | Confirmação final não registrada. | Retestar admin e catálogo em abas separadas. |
| HUMAN-12 | Promoção sem configuração de preço/agendamento. | Regra única em `shared/promocao.ts`; modal persiste preço promocional e agendamento; card mostra preço riscado e selo. | Sim, Fase 5.4. | **Sim — APROVADO.** Vigente aparece no card com selo e riscado; desligar remove na hora; religar recupera a configuração salva; pedido manual usou o preço promocional (normal R$ 40,00, promocional R$ 29,90, pedido criado por R$ 29,90). | Encerrado. |
| HUMAN-13 | Sete dias apareciam como “Seg a Dom”. | Admin mostra `Todos os dias: 09h00 às 20h00`; site público ainda usa texto fixo independente. | Sim no admin. | Confirmação final não registrada. | Retestar sete dias e subconjuntos; tratar integração pública em escopo próprio. |
| HUMAN-14 | Notificações abre área vazia. | Rota real, eventos derivados de fatos existentes, leitura persistida em `notificacao_leituras`, badge real, marcar uma/todas. | Sim, Fase 5.4. | **Sim — APROVADO.** Página renderiza; não lidas têm indicador; badge reflete a quantidade; clicar marca como lida, reduz o badge na hora, navega para Pedidos e abre o pedido; o estado lido persiste ao voltar; "Marcar todas" limpa indicadores, zera o badge e fica sem efeito quando não há não lidas. | Encerrado. Falta só a compatibilidade da 0014 em produção (seção 2). |
| HUMAN-15 | Ícone de WhatsApp no preview parece cartão. | Balão com fone; tamanho, stroke, cor e alinhamento preservados. | Sim, Fase 5.4. | **Sim — APROVADO** visualmente. | Encerrado. |
| HUMAN-16 | Botões X de remover item destoam no dark mode. | Base dark derivada do `.nped-close`, hover destrutivo próprio e `focus-visible` nos dois temas. | Sim, Fase 5.4. | **Aprovado TECNICAMENTE.** Não foi possível observar o botão habilitado porque o B1 continua corretamente bloqueando a edição destrutiva. B1 **não** deve ser afrouxado para permitir inspeção visual. A validação automatizada é o critério desta fase. | Encerrado sob esse critério. Reavaliar visualmente só quando/se existir editor incremental. |
| HUMAN-17 | WhatsApp ficou branco/nativo e inconsistente no modal de venda manual. | `input[type="tel"]` incluído nos dois temas; comportamento do HUMAN-04 intacto. | Sim, Fase 5.4. | **Sim — APROVADO.** Visual igual aos demais inputs no dark; máscara e validação funcionam; número brasileiro inválido recusado; número válido permitiu criar o pedido normalmente. | Encerrado. |

## 4.1 Pendências registradas na Fase 5.4 (não implementadas nesta rodada)

Registradas para decisão futura, sem correção automática:

- **A. Badge hardcoded `4` no item Pedidos da barra lateral.** Era resíduo do
  mock inicial do design (commit `0f3b88c`, "telas navegáveis com os dados
  mockados do design"), sem semântica definida (quantos? novos? em
  produção?). **Atualização:** o commit concorrente `eef745a`
  (`make admin responsive`, fora desta rodada) removeu esse valor fixo ao
  reescrever `AdminSidebar.tsx`; hoje só o item Notificações recebe um
  badge, e é o valor real de não lidas. Pendência tecnicamente resolvida
  como efeito colateral de outra frente de trabalho, não desta fase — sem
  decisão explícita sobre o que (se algo) o item Pedidos deveria exibir.
- **B. Categorias públicas hardcoded em `Cardapio.tsx`.** A lista de
  categorias do cardápio público é fixa no código
  (`["Todos", "Bolos no pote", "Mini pudins"]`), descoberta durante o
  laboratório local: produtos cadastrados em categorias fora dessa lista
  ficam ocultos do cardápio, mesmo disponíveis e com estoque. Não corrigida
  nesta rodada — fora do escopo HUMAN-12/14/15/16/17.

## 5. Responsabilidades e autoridade

**FIGMA MANDA NO VISUAL. BACKEND MANDA NOS DADOS. CLAUDE/CODEX IMPLEMENTA
COMPORTAMENTO E ARQUITETURA.**

- Design, aparência e UX visual: Figma.
- Regras de domínio, persistência, concorrência e comportamento técnico:
  Claude/Codex, respeitando o backend como autoridade dos dados.
- Questão híbrida: Figma decide a aparência primeiro; Claude/Codex implementa
  depois, 1:1.
- Claude/Codex não deve inventar redesign para resolver problema visual.
- Bug puramente técnico não deve ser enviado ao Figma.
- Mudança visual já definida pelo design existente, como HUMAN-17, pode ser
  implementada de modo cirúrgico sem novo desenho.

## 6. Fila Figma

O pacote deve conter alterações cirúrgicas, sem redesenhar páginas e
preservando a identidade visual atual.

### HUMAN-12 — configuração de promoção

- Problema: existe checkbox, mas não há configuração completa nem uma regra
  visível para preço e período.
- Estado atual: schema contém `preco_promocional_centavos`,
  `promocao_inicio`, `promocao_fim` e `promocao_ativa`; admin só edita o
  booleano; catálogo/cálculo usam preço e datas sem consultar o booleano.
- Comportamento desejado: configurar ativação, preço promocional, início, fim,
  estado sem agendamento, estado agendado e feedback de validação.
- Restrições: manter centavos no backend, definir uma fonte única de ativação e
  não inventar regra financeira durante a implementação visual.
- Entrega esperada do Figma: estados do formulário, hierarquia, mensagens,
  comportamento de campos opcionais e representação do produto promocional.

### HUMAN-14 — painel/modal de notificações

- Problema: link leva a área vazia e elementos aparentam funcionalidade que não
  existe.
- Estado atual: sem backend, tabela, polling, eventos ou sons; badge fixo;
  botões de diagnóstico sem handler.
- Comportamento desejado: definir o menor painel/modal útil, conteúdo, estados
  vazio/lido/não lido, badge e ações.
- Restrições: não projetar push, service worker ou sistema grande antes de
  existir necessidade aprovada.
- Entrega esperada do Figma: superfície escolhida, estados, interações,
  prioridade das informações e comportamento responsivo.

### HUMAN-15 — ícone de WhatsApp

- Problema: ícone atual parece cartão.
- Estado atual: nenhuma alteração aplicada.
- Comportamento desejado: leitura inequívoca como WhatsApp no preview da loja.
- Restrições: preservar tamanho, alinhamento e linguagem visual ao redor.
- Entrega esperada do Figma: asset/ícone exato e estados necessários.

### HUMAN-16 — remover item no dark mode

- Problema: X branco/quadrado destoa do modal.
- Estado atual: nenhuma alteração aplicada.
- Comportamento desejado: remoção visualmente coerente e semanticamente
  destrutiva.
- Restrições: usar o X de fechar modal já aprovado como referência, adaptando
  normal, hover, focus e disabled sem confundir fechar com remover.
- Entrega esperada do Figma: tokens/cores/bordas/estados e aplicação desktop e
  mobile.

## 7. Fila Claude/Codex

Ordem atual:

1. **HUMAN-17:** corrigir somente a aparência do input WhatsApp no modal
   “Registrar venda manual”. Preservar `type="tel"`, máscara, `inputMode`,
   `maxLength`, validação frontend/backend e normalização. Usar o input Cliente
   como referência visual existente.
2. Após aprovação do Figma, implementar HUMAN-12, HUMAN-14, HUMAN-15 e
   HUMAN-16 exatamente conforme as especificações aprovadas.
3. Manter HUMAN-10 como melhoria arquitetural futura. Não transformar a tarefa
   em sistema amplo de versionamento sem decisão específica.

Ao iniciar qualquer item, confirmar branch, HEAD e working tree; ler este
checkpoint; investigar o código atual; propor plano quando houver arquitetura
ou regra nova; e limitar o diff ao achado autorizado.

## 8. Estado de testes e reteste humano

Último checkpoint técnico da Fase 5.3:

- baseline anterior: 297/297;
- final: 306/306;
- `npm run build`: aprovado;
- Vite: 111 módulos transformados;
- `git diff --check`: aprovado;
- Functions: nenhum erro novo na checagem direcionada; permanecem os erros de
  baseline `functions/lib/auth.ts:59` (TS2345) e `:87` (TS2322).

Esses resultados pertencem ao commit `b0bdf77`. O documento atual não altera
código funcional e não exige repetir a suíte. Toda implementação futura deve
rodar novamente:

```powershell
npm test
npm run build
git diff --check
```

A validação humana ainda não está encerrada. Depois do próximo lote:

- repetir cada achado corrigido;
- procurar regressões visuais;
- testar todos os modais afetados;
- verificar `NOVO -> Em produção` somente por ação explícita;
- verificar máscaras e colagem;
- verificar estoque por teclado e botões;
- verificar catálogo sem F5;
- verificar promoção quando implementada;
- verificar notificações quando implementadas.

Os modais/loading do fluxo Pix ainda não foram validados no fluxo financeiro
real. Testes automatizados verdes não autorizam go-live.

## 9. Laboratório local e Mercado Pago

Na data deste checkpoint, o laboratório da Fase 5.3 ainda respondia em:

```text
https://127.0.0.1:8788
```

O processo é ligado à sessão e não deve ser presumido ativo numa retomada. O
estado local persistido usado foi `.wrangler/human-test-f53`, com D1 e R2
simulados. Artefatos `.wrangler` são locais/ignorados e não fazem parte do
checkpoint Git.

Comando usado para servir o build de forma inerte:

```powershell
npx.cmd wrangler pages dev dist `
  --ip 127.0.0.1 `
  --port 8788 `
  --local-protocol https `
  --persist-to .wrangler/human-test-f53 `
  --binding MP_ACCESS_TOKEN=DISABLED_FOR_HUMAN_TEST `
  --binding MP_TEST_PAYER_EMAIL=human-test@localhost.invalid `
  --binding MP_WEBHOOK_SECRET=DISABLED_FOR_HUMAN_TEST
```

Não adicionar `--remote`. A credencial temporária do admin local não é
registrada neste arquivo nem no Git; ela deve ser recriada/resetada somente no
D1 local se a sessão anterior não estiver disponível.

Durante o teste humano comum, **não disparar**:

- “Pedir agora” quando isso confirmar o checkout;
- “Gerar Pix”;
- “Regenerar Pix”;
- “Pix real de diagnóstico”.

Mercado Pago permanece fora do laboratório humano. O fluxo real será validado
em fase posterior, com autorização explícita, valor mínimo, webhook real e
roteiro controlado.

## 10. Sequência recomendada para continuar

1. Abrir `docs/CHECKPOINT_CONTINUIDADE.md`.
2. Confirmar Git, HEAD, upstream, ahead/behind e working tree.
3. Resolver no Figma o pacote HUMAN-12, HUMAN-14, HUMAN-15 e HUMAN-16.
4. Obter aprovação explícita do proprietário para o Figma.
5. Claude/Codex implementar HUMAN-17 e as especificações aprovadas do Figma.
6. Rodar suíte completa, build e `git diff --check`.
7. Preparar laboratório local isolado, com MP inerte e sem `--remote`.
8. Fazer nova rodada de reteste humano.
9. Corrigir regressões encontradas em escopos separados.
10. Repetir checkpoint pré-deploy.
11. Confirmar explicitamente o estado de push.
12. Fazer push somente com autorização explícita.
13. Fazer deploy somente com autorização separada.
14. Executar smoke read-only em produção.
15. Executar smoke financeiro Pix mínimo e controlado.
16. Validar webhook real.
17. Só então acompanhar o primeiro pedido real.

## 11. Não fazer ao retomar

> [!WARNING]
> **NÃO:**
>
> - reaplicar o B5;
> - rodar migrations remotas normais;
> - tocar produção durante desenvolvimento;
> - fazer push automaticamente;
> - fazer deploy automaticamente;
> - implementar Pix durante correções visuais;
> - reabrir B1 sem decisão arquitetural explícita;
> - transformar HUMAN-10 em sistema amplo de versionamento;
> - construir sistema grande de notificações antes do Figma;
> - alterar visual fora da autoridade do Figma;
> - considerar testes automatizados substitutos do teste humano;
> - corrigir dívidas B2/B3/B4/A1 como efeito colateral;
> - alterar `d1_migrations` ou substituir o backup pré-B5.

Operações proibidas até autorização explícita:

- qualquer push;
- qualquer deploy;
- escrita no D1 ou R2 de produção;
- alteração de Pages, Cloudflare, DNS, domínio, secrets ou bindings remotos;
- POST/refund/Pix ou outra mutação no Mercado Pago;
- configuração ou disparo de webhook real;
- pedido sintético ou smoke mutante em produção.

Ao encontrar divergência entre este checkpoint e o código/HEAD, pare e
investigue. O código atual e os fatos Git vencem descrições históricas; uma
divergência de produção exige fase read-only própria antes de qualquer ação.
