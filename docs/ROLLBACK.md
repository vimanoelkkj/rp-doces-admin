# R&P Doces — Rollback e recuperação

Guia para o operador durante um incidente em produção. Leia "Regras" e "Mapa" antes de agir.

> Limite conhecido: o campo `canonical_deployment` (seção 2, via API) vem da documentação da Cloudflare e **não** foi
> conferido ao vivo (a credencial de sessão local não autenticou nesse endpoint); confirme pelo painel na primeira vez.
>
> Estado deste documento: os comandos de **leitura** foram executados contra a produção real
> (2026-09-26). Os procedimentos que **alteram** algo (pausar, restaurar versão, trocar secret,
> restaurar banco) foram revisados contra a documentação da Cloudflare e conferidos por simulação,
> mas **nunca foram executados em produção**. Ao usá-los pela primeira vez, siga o passo a passo
> com calma e registre o resultado aqui.

## Regras

1. **Pausar publicações não desfaz nada.** `DEPLOY_ENABLED=false` só impede _novos_ deploys. O que já
   está no ar continua no ar.
2. **Restaurar uma versão não desfaz o banco.** O rollback do Pages troca o deployment ativo. O D1
   continua no schema atual. Migrations aplicadas ficam aplicadas.
3. **Nunca execute migration reversa, `DROP`, `DELETE` ou `wrangler d1 time-travel restore` por
   conta própria.** O banco tem pedidos, pagamentos Pix e reembolsos reais. Qualquer recuperação de
   banco exige avaliação específica antes (seção C).
4. **Nunca use `git push --force` na `main`.** Correção permanente = novo commit (`git revert`)
   revisado por PR, passando pelo CI.
5. **Nunca apague arquivos de `migrations/` num revert.** O Migration Guard bloqueia o deploy se o banco
   remoto tiver migrations que o commit não tem (histórico "desatualizado").
6. Não cole tokens em chats, issues, commits nem logs. Use os nomes das variáveis, nunca os valores.

## Mapa: como o pipeline funciona

Arquivo: `.github/workflows/ci.yml`.

| Pergunta                              | Resposta                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Qual commit é publicado?**          | Só o commit de um `push` na `main` (`GITHUB_SHA`), depois do check agregado `CI` verde (`needs: ci-status`). PRs, agendamento (cron 06h UTC) e disparo manual **não** publicam.                                                                                                                                                                                                                        |
| **Como `DEPLOY_ENABLED` controla?**   | O job `deploy` tem `if: ... && vars.DEPLOY_ENABLED == 'true'`. Como é avaliado antes do job existir, precisa ser **variável de repositório** (Settings > Secrets and variables > Actions > Variables), não de environment. Valor diferente de `true` (ou ausente) = job `deploy` pulado; o `CI` continua verde. Não interrompe um deploy já em andamento.                                              |
| **Verificação do HEAD**               | O passo "Conferir credenciais e se o commit ainda é a main" compara `git ls-remote origin refs/heads/main` com `GITHUB_SHA`. Se a `main` já avançou, o commit é "superado" e nada é publicado. Repete a checagem logo antes do `wrangler pages deploy`. Um deploy por vez (`concurrency: deploy-production`, sem cancelar o que está rodando).                                                         |
| **D1 Migration Guard**                | Antes do build, `scripts/check-d1-migrations.mjs` faz só `SELECT` no D1 remoto com `CLOUDFLARE_D1_READ_TOKEN`. Bloqueia se houver migration pendente, lacuna, migration remota desconhecida para o commit, duplicata, ordem trocada ou schema da última migration ausente, ou se a Cloudflare/credencial falhar. **Nunca aplica migrations.** Migrations são aplicadas manualmente, _antes_ do deploy. |
| **Verificação pós-upload**            | O passo "Verificar deployment" consulta a API de deployments e exige um deployment de **produção** com o SHA completo e `deploy:success`; depois faz fumaça em `/` e `/api/produtos`.                                                                                                                                                                                                                  |
| **Publicação pela Git da Cloudflare** | Desativada. Só o GitHub Actions publica (`wrangler pages deploy dist --commit-hash $GITHUB_SHA`).                                                                                                                                                                                                                                                                                                      |

### Limitações ao restaurar uma versão anterior

- **Só deployments de produção com sucesso** são alvo de rollback; preview e deployments com falha, não.
- A documentação da Cloudflare **não afirma** o que o rollback faz com Pages Functions, bindings
  (`DB`, `PRODUCT_IMAGES`), variáveis e secrets. Não presuma que voltam junto: trate isso como
  **não garantido** e valide depois (seção "Validar"). Documentação também diz que mudança de binding só vale
  após novo deployment.
- **D1 não volta junto.** Código antigo rodando num schema novo pode quebrar (colunas `NOT NULL`, triggers e
  `CHECK` novos, tabelas renomeadas).
- A listagem de deployments tem **dois registros por commit**: o real (`success`) e um "Idle" (resquício
  da integração Git antiga). **Nunca faça rollback para o "Idle".**
- Re-executar o workflow de um commit antigo **não é um rollback**: o gate o marca "superado" (a `main`
  já avançou) e, se não estivesse, o Guard bloquearia porque o banco tem migrations que aquele commit
  não conhece.
- O site não expõe o SHA publicado. A fonte de verdade é a API/painel da Cloudflare.

## Incidente: sequência rápida

1. **Pause** novos deploys (seção 1).
2. **Identifique** o SHA no ar e o último deployment saudável (seções 2 e 3).
3. **Confira compatibilidade** do alvo com o D1 atual (seção 4). Se incompatível, vá à seção C, não restaure.
4. **Restaure** pelo painel (seção 5).
5. **Valide** (seção 6 e checklist).
6. Corrija no Git por **commit de reversão** via PR; só então **reative** (seção 7).

---

## 1. Pausar novos deployments (não restaura nada)

Painel: GitHub > repositório `vimanoelkkj/rp-doces-admin` > Settings > Secrets and variables > Actions >
Variables > `DEPLOY_ENABLED` > valor `false`.

Ou pela CLI (`gh`, autenticado com permissão de administrador do repositório):

```bash
gh variable set DEPLOY_ENABLED --body false --repo vimanoelkkj/rp-doces-admin
gh variable list --repo vimanoelkkj/rp-doces-admin   # confira: DEPLOY_ENABLED false
```

Depois:

- Veja se há deploy **em andamento ou na fila** (Actions > CI > job "Deploy produção"). Um deploy já
  iniciado termina; um pendente na fila do `concurrency` também pode rodar. Se for um deploy indesejado,
  cancele a execução em Actions (Cancel workflow). Cancelar durante o upload pode deixar deployment
  incompleto; confira a lista de deployments depois (seção 2).
- Execuções de CI que ainda não chegaram ao job `deploy` passam a pulá-lo.

## 2. Identificar o SHA atualmente publicado

Fonte de verdade: painel Cloudflare > Workers & Pages > `rp-doces` > Deployments. O deployment marcado
como **Production/active** mostra o commit.

Pela CLI (somente leitura; precisa de `wrangler login` ou de `CLOUDFLARE_API_TOKEN` com Pages Read):

```bash
npx wrangler pages deployment list --project-name rp-doces --environment production
```

A coluna **Source** mostra os 7 primeiros caracteres do commit; a mais recente vem primeiro. Ignore linhas
"Idle" (registro Git antigo).

Pela API (mostra o deployment de produção ativo; exige `Pages Read` ou `Pages Write`):

```bash
curl -sS -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/pages/projects/rp-doces" \
  | jq '.result.canonical_deployment | {id, commit: .deployment_trigger.metadata.commit_hash, stage: .latest_stage}'
```

Compare com a `main`: `git fetch origin && git rev-parse origin/main`. Se forem diferentes, a produção
não está na `main` (por rollback, deploy pausado, falha ou deploy em andamento).

## 3. Localizar o último deployment saudável

1. Liste os deployments de produção (comando da seção 2). Candidatos: linhas com Status de sucesso
   (não "Idle", não falha).
2. Pelo painel, abra o deployment candidato e confira: status **Success** e o commit esperado. Anote o
   **ID do deployment** e o **SHA completo** (`git rev-parse <sha7>`).
3. "Saudável" = comprovadamente no ar sem o problema. Prefira o deployment **imediatamente anterior**
   ao que introduziu o problema; use `git log --oneline` para mapear commit -> mudança.

## 4. Conferir se a versão anterior é compatível com o D1 atual

Alvo = SHA do deployment candidato (`ALVO`). Somente leitura.

```bash
# a) O que o banco remoto tem aplicado (SELECT; deve terminar em 0033_... ou a última do repositório)
npx wrangler d1 execute rp-doces-db --remote \
  --command "SELECT id, name, applied_at FROM d1_migrations ORDER BY id DESC LIMIT 5"

# b) Migrations criadas DEPOIS do alvo (as que o código antigo não conhece)
git diff --name-status ALVO..origin/main -- migrations/

# c) Trechos de risco nessas migrations
git diff ALVO..origin/main -- migrations/ | grep -E '^\+' | grep -iE 'DROP|RENAME|NOT NULL|CREATE TRIGGER|CHECK|UNIQUE|DELETE|UPDATE'
```

Se (b) estiver **vazio**: o schema é o mesmo do alvo. Restaurar é seguro do ponto de vista de banco.

Se (b) listar arquivos, **leia cada um** e classifique:

| Tipo de mudança na migration                                                 | Código antigo continua funcionando?                                  |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `CREATE TABLE` / `CREATE INDEX` novos; `ADD COLUMN` nulo ou com `DEFAULT`    | Em geral sim. Só ignora o novo.                                      |
| `ADD COLUMN ... NOT NULL` sem `DEFAULT`                                      | **Não**: `INSERT` do código antigo falha.                            |
| `CREATE TRIGGER` / `CHECK` / `UNIQUE` novos (estoque, Pix, reembolso, admin) | **Talvez não**: o código antigo pode violar a regra. Leia o gatilho. |
| `DROP`, `RENAME`, mudança de tipo                                            | **Não**.                                                             |
| Migration que transformou dados (`UPDATE`/`INSERT ... SELECT`)               | Avalie: o código antigo lê os dados no formato antigo?               |

Só restaure se **todas** forem compatíveis. Caso contrário, não restaure: vá à seção C. Em dúvida, trate
como incompatível.

Além disso, lembre que **variáveis, secrets e bindings** são configuração do projeto, não do código: se
foram alterados desde o alvo, o alvo pode rodar com configuração diferente da que tinha. Confira o painel
(Settings > Variables/Bindings) e a seção 6.

## 5. Restaurar a aplicação (mecanismos oficiais)

Faça a seção 1 antes, para um push novo não sobrescrever a restauração.

**Painel (recomendado):** Cloudflare > Workers & Pages > `rp-doces` > Deployments > deployment alvo
(produção, status sucesso) > menu `...` > **Rollback to this deployment** > confirmar. A troca é imediata.

**API (alternativa, exige `Pages Write`; use só se o painel não estiver disponível):**

```bash
curl -sS -X POST -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/pages/projects/rp-doces/deployments/$DEPLOYMENT_ID/rollback" \
  | jq '{success, errors}'
```

Notas:

- Não existe comando `wrangler` de rollback (o Wrangler só lista, cria, faz tail e apaga deployments).
- Dá para voltar à versão mais nova pelo mesmo mecanismo (rollback "para frente").
- **Não** "restaure" refazendo `wrangler pages deploy` de uma pasta local: publicaria código sem CI nem
  Guard e fora do controle do pipeline. Só como último recurso, com a decisão registrada.

## 6. Validar a recuperação

1. Confirme o SHA ativo (seção 2). Deve ser o do alvo.
2. Rode o **Checklist pós-recuperação** abaixo.
3. Acompanhe pelo menos 15 minutos: erros 5xx, falhas de login, webhook de pagamento
   (`/api/webhooks/mercadopago`), pedidos novos (deixe o cliente real fazer; não gere pedido de teste).
4. Se a validação falhar, escolha: outro deployment saudável mais antigo (volte à seção 3) ou, se o problema é o
   banco, a seção C.

## 7. Reativar os deployments com segurança

Só depois de:

- a correção estar na `main` por **PR revisado** (de preferência `git revert` do commit problemático, ver abaixo);
- o CI da correção verde;
- a produção estável no alvo restaurado, ou você ter certeza de que o próximo deploy é a correção.

Lembre: reativar **não reenvia** nada por si só. Só o **próximo push na `main`** publica. Como o alvo
restaurado é mais antigo que a `main`, a produção vai divergir da `main` até esse push; isso é esperado.

```bash
gh variable set DEPLOY_ENABLED --body true --repo vimanoelkkj/rp-doces-admin
```

Confirme no resumo da execução: "Migrations D1 em dia" e "Publicado em produção" com o SHA da correção. Depois
faça de novo o checklist.

**Correção permanente no Git (sem force push):**

```bash
git switch -c revert/<descricao> origin/main
git revert <sha-do-commit-problematico>        # cria um commit novo; para merge use: git revert -m 1 <sha>
git push -u origin revert/<descricao>          # abra PR, aguarde o CI, revise e faça o merge
```

O `git revert` **não pode remover arquivos de `migrations/`**. Se o commit problemático incluiu uma
migration já aplicada, reverta só o código e mantenha o arquivo da migration (ou trate no cenário C).
A `main` deve continuar a receber commits por PR; nunca reescreva o histórico.

---

## Cenários

### A. Deploy com problema visual ou funcional (banco intacto)

1. Seção 1 (pausar). 2. Seção 2 (SHA atual) e 3 (alvo). 3. Seção 4: `git diff ALVO..origin/main -- migrations/`
   vazio ou só aditivo e compatível. 4. Seção 5 (rollback pelo painel). 5. Seção 6. 6. Correção por revert via PR e
   seção 7.

Se o problema é só de frontend e a correção é rápida, prefira um PR de correção (o pipeline é seguro) em vez
de rollback, mantendo a pausa até o CI ficar verde.

### B. O deploy falhou depois do upload

Não reexecute às cegas.

1. Abra a execução no GitHub Actions e veja em que passo parou (upload, "Verificar deployment", fumaça).
2. Veja se o commit foi publicado:
   ```bash
   npx wrangler pages deployment list --project-name rp-doces --environment production
   ```
   (Source = SHA7 do commit e status de sucesso) ou o painel.
3. Casos:
   - **Publicado com sucesso** (falhou só na verificação/fumaça por lentidão ou rede): **não** reexecute o upload.
     Valide manualmente (checklist). Se estiver correto, o deploy está feito.
   - **Aparece, mas com falha/cancelado**: use "Re-run failed jobs" na mesma execução (só se o commit ainda for a
     `main` e o Guard passar). Reexecutar publica o mesmo SHA de novo (gera outro deployment; sem efeito no banco).
   - **Não aparece**: reexecute o job `deploy`. O gate confere se o commit ainda é a `main`.
   - **Guard bloqueou** (exit 1/2/3/4): não é falha de upload; o deploy nem começou. Veja a mensagem no log.
     Migration pendente = alguém precisa aplicá-la (ação humana); credencial = cenário D; Cloudflare fora = espere e
     reexecute.
4. Se o site ficou inconsistente (deployment parcial), trate como cenário A.

### C. Migration incompatível (código e schema não combinam)

**Não restaure o banco nem execute SQL corretivo sem avaliação específica.** Pedidos, pagamentos e reembolsos
são dados financeiros.

1. **Contenha:** seção 1 (pausar). Se o site está causando erro em pedido/pagamento, considere a página de
   manutenção/aviso por decisão humana. Não peça a clientes para repetirem pagamento.
2. **Diagnostique (só leitura):**
   - `SELECT` em `d1_migrations` e a comparação com `migrations/` (seção 4). Rode também
     `node scripts/check-d1-migrations.mjs` com o token de leitura (ele só faz `SELECT`).
   - Logs do deployment: `npx wrangler pages deployment tail --project-name rp-doces` (mostra logs de
     Functions em tempo real; somente leitura).
   - Identifique a migration e a consulta que falham (mensagem do erro D1: coluna, trigger, `CHECK`).
3. **Escolha o caminho, na ordem de preferência:**
   1. **Corrigir para frente:** commit novo, revisado, com código compatível com o schema atual, ou nova migration
      **aditiva** que conserte (nunca editar migration já aplicada). Passa pelo CI e pelo Guard.
   2. **Rollback do código** para um deployment compatível (seção 4). Só vale se o schema atual for compatível com ele.
   3. **Recuperação de banco:** último recurso, somente com aprovação explícita do responsável pelo
      negócio e do desenvolvedor.
4. **Sobre o D1 Time Travel** (`wrangler d1 time-travel info|restore`): `info` só lê. `restore` é
   **destrutivo: sobrescreve o banco no local** e cancela transações em andamento. Tudo que foi escrito depois
   do ponto de restauração (pedidos, pagamentos Pix, reembolsos, estoque) **é perdido** e, no caso dos pagamentos,
   já pode ter movimentado dinheiro no Mercado Pago. A retenção é de 30 dias (plano pago) ou 7 dias (gratuito).
   Antes de considerar:
   ```bash
   npx wrangler d1 time-travel info rp-doces-db      # somente leitura: anote o bookmark ATUAL
   ```
   O restore devolve um bookmark que permite desfazer, mas **não recupera dinheiro nem reconcilia
   pagamentos**. Exporte/inspecione antes o que existir depois do ponto (pedidos e pagamentos do período) e
   reconcile com o Mercado Pago. Isso é decisão humana.
5. **Nunca** gere migration reversa automática, nem `DROP`/`DELETE` para "limpar".

### D. Credenciais inválidas

Há dois tokens, com escopos diferentes. Secrets em GitHub > Settings > Environments > `production`.

| Secret                     | Usado por                                   | Permissão mínima                  |
| -------------------------- | ------------------------------------------- | --------------------------------- |
| `CLOUDFLARE_API_TOKEN`     | deploy do Pages e verificação do deployment | Account > Cloudflare Pages > Edit |
| `CLOUDFLARE_D1_READ_TOKEN` | somente o Migration Guard                   | Account > D1 > Read               |
| `CLOUDFLARE_ACCOUNT_ID`    | ambos                                       | (não é segredo de acesso)         |

**Identificar qual falhou:**

- Guard: o job para em "Verificar migrations D1" com "Secret CLOUDFLARE_D1_READ_TOKEN ausente" ou
  "Cloudflare recusou as credenciais (HTTP 401/403)". Exit 2.
- Deploy/verificação: "Secrets CLOUDFLARE_API_TOKEN e/ou CLOUDFLARE_ACCOUNT_ID não configurados", erro do Wrangler de
  autenticação ou "API da Cloudflare respondeu HTTP 401/403/404" em "Verificar deployment".
- Teste um token sem revelá-lo (imprime só o status; para token de usuário):
  ```bash
  curl -sS -H "Authorization: Bearer $TOKEN" https://api.cloudflare.com/client/v4/user/tokens/verify | jq '{success, status: .result.status}'
  ```
  (Token de conta: use `/accounts/$CLOUDFLARE_ACCOUNT_ID/tokens/verify`.) Leia o token de uma variável
  já definida no terminal ou de um prompt; não digite o valor na linha do comando.

**Substituir:**

1. Cloudflare > My Profile (ou Account) > API Tokens > criar token com a permissão mínima da tabela,
   restrito à conta.
2. Copie o valor **uma vez**.
3. GitHub > Settings > Environments > production > edite o secret com o mesmo nome (ou
   `gh secret set NOME --env production --repo vimanoelkkj/rp-doces-admin` e cole o valor no prompt
   interativo).
4. **Revogue** o token antigo na Cloudflare.
5. Reexecute o job `deploy` (Re-run) se o commit ainda for a `main`.

Não amplie o `CLOUDFLARE_API_TOKEN` para ler D1, nem use o de leitura para publicar. Nunca imprima nem comite valores.

### E. Publicação de um commit antigo

O pipeline já protege contra sobrescrever versão mais nova (não dependa só disso):

- Gate no início do job e nova checagem imediatamente antes do upload (`git ls-remote` da `main`).
- Só `push` na `main` publica; re-executar execução antiga vira "superado".
- Migration Guard: um commit antigo, com o banco mais novo, falha por "migrations desconhecidas".
- Fila única por `concurrency`.

Ao operar:

- **Não** reexecute execuções antigas do workflow para "voltar" versão. Use o rollback do painel.
- Pause (seção 1) antes de qualquer restauração, senão o próximo push publica por cima.
- Se um deploy antigo já foi publicado por engano: identifique o SHA (seção 2) e restaure o deployment correto
  (seção 5).

---

## Checklist pós-recuperação

Somente leitura. **Não** gere Pix real, reembolso, pedido de teste nem "Diagnósticos" que gravem eventos.

- [ ] **SHA publicado** = o esperado (seção 2), deployment com status de sucesso.
- [ ] **Home** (`/`) carrega, com imagens e sem tela em branco.
- [ ] **Cardápio**: lista os produtos, preços, categorias e imagens; abrir os detalhes de um produto.
- [ ] `curl -fsS https://rpdoces.com.br/api/produtos | jq '.produtos | length'` devolve número > 0; `/api/config` responde 200.
- [ ] **Login administrativo** funciona; `/api/auth/me` devolve o usuário logado. (Sem sessão, `/api/admin/pedidos` deve dar **401**.)
- [ ] **Admin > Produtos**: lista carrega, sem editar nem salvar.
- [ ] **Admin > Pedidos**: abre a lista e o detalhe de pedidos existentes (só leitura).
- [ ] **D1**: as telas acima carregam dados; e `npx wrangler d1 execute rp-doces-db --remote --command "SELECT COUNT(*) AS pedidos FROM pedidos"` responde (leitura).
- [ ] **R2**: uma imagem de produto abre (200, `content-type: image/*`):
      `k=$(curl -fsS https://rpdoces.com.br/api/produtos | jq -r '[.produtos[].image_key | select(.)][0]'); curl -sS -o /dev/null -w '%{http_code} %{content_type}\n' "https://rpdoces.com.br/api/images/$k"`
- [ ] **Console e rede** (DevTools, abas Console e Network) nas páginas acima: sem erros vermelhos novos e sem 5xx em `/api/*`.
- [ ] **Pix**: no admin, os pedidos existentes mostram o status de pagamento correto; nenhum pedido `PAGO` sumiu ou voltou a pendente;
      `SELECT` (leitura) de pedidos recentes bate com o painel. Não crie cobranças.
- [ ] **Reembolsos**: os reembolsos existentes (pedidos anulados/estornados) continuam listados com seus valores; não acione novo estorno.
- [ ] **Estoque**: as quantidades no admin batem com o cardápio; nenhum produto ficou negativo (leitura).
      `curl -fsS https://rpdoces.com.br/api/produtos | jq -r '.produtos[] | "\(.nome): estoque=\(.estoque) reservado=\(.estoque_reservado)"'`.
- [ ] Webhook do Mercado Pago: os eventos recentes continuam sendo recebidos (conferir logs com
      `wrangler pages deployment tail`); não reenvie notificações.

## Onde ficam os detalhes

- Pipeline: `.github/workflows/ci.yml` (jobs `checks`, `tests`, `e2e`, `ci-status`, `deploy`).
- Migration Guard: `scripts/check-d1-migrations.mjs`, teste em `tests/check-d1-migrations.test.mjs`.
- Configuração de bindings: `wrangler.toml` (`DB` = `rp-doces-db`, `PRODUCT_IMAGES` = `rp-doces-images`).
- Documentação Cloudflare: Pages > Configuration > Rollbacks; API "Pages deployment rollback";
  D1 > Time Travel.
