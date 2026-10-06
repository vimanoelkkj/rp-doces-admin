# R&P Doces — Checklist de release

Procedimento para publicar uma versão na produção (Cloudflare Pages). Estado esperado da produção:
[PRODUCTION-CHECKLIST](PRODUCTION-CHECKLIST.md). Incidente e rollback: [ROLLBACK](ROLLBACK.md). Backup do banco:
[BACKUP-RESTORE](BACKUP-RESTORE.md).

**Como usar:** copie este arquivo para o PR ou a issue da release, marque os itens e preencha o
[registro](#registro). Itens **[AUTO]** são feitos pelo pipeline (`.github/workflows/ci.yml`): você acompanha e
confirma. Itens **[MANUAL]** são seus.

## Como a publicação acontece

| Etapa                                                                                                                                                                                                      | Quem   |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Migrations remotas (se houver), **antes** do push                                                                                                                                                          | MANUAL |
| Push na `main` (ou merge de PR) dispara o CI: `checks` (typecheck e build), `tests` (10 fatias), `e2e` e o agregado `CI`                                                                                   | AUTO   |
| Job `deploy` (push na `main`, `CI` verde, `DEPLOY_ENABLED=true`): confere que o commit ainda é a `main`, `npm ci`, Migration Guard, `npm run build`, `wrangler pages deploy`, verificação pelo SHA e smoke | AUTO   |
| Confirmação do SHA, validação manual curta, tag e notas                                                                                                                                                    | MANUAL |

PRs, o agendamento (06h UTC) e o disparo manual rodam o CI, mas **não publicam**.

## 1. Preparação

- [ ] **[MANUAL]** `main` limpa e alinhada: `git status --short` vazio; `git fetch origin && git status -sb` sem
      divergência inesperada; `git rev-parse --short HEAD` é o commit a publicar.
- [ ] **[MANUAL]** Nenhum deploy rodando ou na fila (GitHub > Actions > CI) e nenhum incidente aberto.
- [ ] **[MANUAL]** `DEPLOY_ENABLED` é `true`: `gh variable list --repo vimanoelkkj/rp-doces-admin`. Com `false`, o CI
      fica verde e **nada é publicado**.
- [ ] **[MANUAL]** [PRODUCTION-CHECKLIST](PRODUCTION-CHECKLIST.md) em dia, principalmente secrets, migrations e backup.

## 2. Qualidade (local, antes do push)

O CI repete tudo; rodar antes evita um ciclo de falha.

- [ ] **[MANUAL]** `npx prettier --check <arquivos que você alterou>`. Nunca na raiz (`.`).
- [ ] **[MANUAL]** `npm run lint` (Biome; informativo, não bloqueia): sem aviso novo nos arquivos que você tocou; não use
      `--write`.
- [ ] **[MANUAL]** `npm run typecheck`.
- [ ] **[MANUAL]** `npm run build` (inclui o typecheck).
- [ ] **[MANUAL]** Testes direcionados dos módulos alterados: `node --test tests/<arquivo>.test.mjs`. A suíte completa
      (`npm test`) é o CI que roda, em 10 fatias; localmente leva dezenas de minutos.
- [ ] **[MANUAL]** `npm audit --omit=dev`: vulnerabilidades high/critical de produção bloqueiam release; moderadas
      exigem triagem e aceitação documentada quando aplicável. Para a v1.0, conferir a
      [aceitação de risco do React Router](architecture/dependency-risk-acceptance.md) e seus critérios de reavaliação.
- [ ] **[MANUAL]** `git diff --check` e revisão do diff: sem tokens, `.dev.vars`, dumps nem `backups/`.

## 3. Migrations

Só se `git diff --name-only origin/main..HEAD -- migrations/` listar arquivos. Sem migration nova, marque N/A.

- [ ] **[AUTO]** CI: `tests/check-d1-migrations.test.mjs` (numeração contínua, marcadores de schema, só `SELECT`).
- [ ] **[MANUAL]** Revisão: aditiva; nada de editar, renomear ou apagar migration já aplicada; recriação de tabela segue
      [database-migrations](architecture/database-migrations.md) §3.
- [ ] **[MANUAL]** Compatibilidade: o código **antigo** continua funcionando no schema **novo**
      ([ROLLBACK](ROLLBACK.md) §4, tabela)? Se não, o rollback do código deixa de ser possível: decida antes.
- [ ] **[MANUAL]** **Backup antes de mudança de schema.** Obrigatório (regra deste checklist) se a migration tem `DROP`,
      `RENAME`, recriação de tabela, `UPDATE` ou `INSERT ... SELECT` em dados, ou novo `CHECK`, `UNIQUE` ou trigger;
      recomendado nas demais:
  1. `npx wrangler d1 time-travel info rp-doces-db` e anote o bookmark.
  2. Export de produção e `node scripts/d1-backup.mjs verify <dump>` com `Resultado: OK`
     ([BACKUP-RESTORE](BACKUP-RESTORE.md) §2).
- [ ] **[MANUAL]** Aplicar **antes** do push: `npx wrangler d1 migrations apply rp-doces-db --remote`. Uma pessoa, no
      próprio terminal (o hook `.claude/hooks/guard-d1-remote.mjs` bloqueia o agente). Sem isso o Guard bloqueia o deploy.
- [ ] **[MANUAL]** Confirmar com `npm run db:migrations:check` (precisa de `CLOUDFLARE_D1_READ_TOKEN` e
      `CLOUDFLARE_ACCOUNT_ID`): "Migrations D1 em dia". O Guard repete a conferência no deploy.

## 4. Versionamento, commit e tag

Versão preparada: `1.0.0` em `package.json` e `package-lock.json`, com notas em
[CHANGELOG.md](../CHANGELOG.md). A tag semântica será `v1.0.0`; a preparação não cria tag nem GitHub Release.
O deployment continua identificado pelo **SHA** (`wrangler pages deploy --commit-hash`).

- [ ] **[MANUAL]** Versão `1.0.0` consistente no manifesto e lockfile; CHANGELOG revisado, com data real de publicação
      preenchida somente depois da confirmação da release.
- [ ] **[MANUAL]** `CI` e `Dependency audit` verdes no SHA da release; nenhuma high/critical de produção e riscos
      moderados triados conforme a [aceitação documentada](architecture/dependency-risk-acceptance.md).
- [ ] **[MANUAL]** D1 sem migrations pendentes; backup verificado e exercício local de restore validado. A prova local
      não substitui a conferência do backup de produção exigida no [PRODUCTION-CHECKLIST](PRODUCTION-CHECKLIST.md).
- [ ] **[MANUAL]** Deployment saudável de rollback identificado, compatibilidade com D1 conferida e smoke pós-deploy
      previsto para o SHA publicado.

- [ ] **[MANUAL]** Mensagem no padrão do histórico: `rp-doces: <descrição curta>`, sem `Co-Authored-By`.
- [ ] **[MANUAL]** Caminho até a `main`: PR com CI verde e revisão, depois merge ([ROLLBACK](ROLLBACK.md) §7 usa PR para
      correções). Push direto só por decisão do responsável.
- [ ] **[MANUAL, após autorização de publicação]** Criar a tag anotada `v1.0.0` no SHA publicado, depois do smoke verde:
      `git tag -a v1.0.0 <sha> -m "R&P Doces v1.0.0"` e `git push origin v1.0.0`. Não executar durante a preparação.

## 5. Deploy

- [ ] **[AUTO]** Push na `main` dispara o CI e depois o `deploy`. Acompanhe em GitHub > Actions > CI ou com
      `gh run list --repo vimanoelkkj/rp-doces-admin --workflow CI --branch main --limit 3`.
- [ ] **[AUTO]** CI verde no commit: o job agregado `CI` é sucesso. Fatia vermelha, cancelada ou pulada reprova.
- [ ] **[AUTO]** O job `deploy` conclui gate, Guard, build, publicação, verificação e smoke; o resumo mostra
      "Publicado em produção".
- [ ] **[MANUAL]** Não reexecute às cegas: falha depois do upload é o cenário B do [ROLLBACK](ROLLBACK.md). "Deploy
      ignorado: commit superado" significa que a `main` avançou e nada foi publicado por essa execução; acompanhe a
      execução do commit mais novo.

## 6. Confirmação do SHA publicado

- [ ] **[AUTO]** Passo "Verificar deployment": pela API da Cloudflare, existe deployment de **produção** com o SHA
      completo e `deploy:success` (espera até 180 s).
- [ ] **[MANUAL]** Conferir à mão:
      `npx wrangler pages deployment list --project-name rp-doces --environment production`. A linha mais recente tem
      Source igual a `git rev-parse --short=7 HEAD` e sucesso; ignore as linhas "Idle". O site não expõe o SHA.

## 7. Smoke pós-deploy

- [ ] **[AUTO]** Passo "Smoke test pós-deploy (somente leitura)" verde. O que ele cobre:
      [PRODUCTION-CHECKLIST](PRODUCTION-CHECKLIST.md#11-smoke-pós-deploy).
- [ ] **[MANUAL]** Para repetir fora do pipeline: `npm run smoke:prod` termina com exit 0.

## 8. Validação manual curta

Cerca de 10 minutos, só leitura:

- [ ] **[MANUAL]** Home carrega com imagens; `/cardapio` lista produtos; abra o detalhe de um produto.
- [ ] **[MANUAL]** Carrinho: adicionar e remover um item, só no navegador. **Não finalize pedido.**
- [ ] **[MANUAL]** Admin: login; Pedidos (lista e detalhe de um pedido existente); Produtos (lista, sem salvar).
- [ ] **[MANUAL]** DevTools (Console e Network) nessas telas: sem erro novo e sem 5xx em `/api/*`.

Valide também conforme o que o release tocou:

| O release mexeu em                      | Valide também                                                                                                                                                                                                                                                              |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Checkout, Pix, ledger, estoque, webhook | Um pedido existente `PAGO` continua `PAGO`; os reembolsos continuam listados com os mesmos valores; o estoque do admin bate com o cardápio. Se mudou a integração com o Mercado Pago, o [checklist de go-live](../README.md#checklist-de-produção-go-live-do-mercado-pago) |
| Imagens ou R2                           | Uma imagem do catálogo abre (200, `image/*`): comando no checklist pós-recuperação do [ROLLBACK](ROLLBACK.md#checklist-pós-recuperação)                                                                                                                                    |
| Push ou notificações                    | [PRODUCTION-CHECKLIST](PRODUCTION-CHECKLIST.md#5-vapid-e-push)                                                                                                                                                                                                             |
| Login, papéis, admin                    | Login; `/api/admin/pedidos` sem sessão = `401` (o smoke cobre); OWNER x ADMIN                                                                                                                                                                                              |
| Migrations                              | `npm run db:migrations:check` e as telas que leem as tabelas alteradas                                                                                                                                                                                                     |

A versão completa, só leitura, é o [checklist pós-recuperação](ROLLBACK.md#checklist-pós-recuperação) do ROLLBACK.

## 9. Rollback, se necessário

Quando: o smoke ou a validação manual falhou, ou há erro em pedido ou pagamento. Não improvise: [ROLLBACK](ROLLBACK.md).

1. **Pause** novos deploys: `gh variable set DEPLOY_ENABLED --body false --repo vimanoelkkj/rp-doces-admin` (§1).
2. **Identifique** o SHA no ar e o último deployment saudável (§2 e §3).
3. **Confira a compatibilidade** do alvo com o schema atual (§4). Incompatível: não restaure; siga o cenário C (corrigir
   para frente).
4. **Restaure** pelo painel (§5) e **valide** (§6 e checklist pós-recuperação).
5. Corrija com `git revert` via PR e só então reative `DEPLOY_ENABLED` (§7).

- [ ] **[MANUAL]** Registre alvo, motivo e resultado nas notas da release.

## 10. Release notes

Fonte das mudanças: [CHANGELOG.md](../CHANGELOG.md). Registro operacional: comentário no PR ou na issue da release;
GitHub Release somente após autorização de publicação.
Modelo:

```text
Release v1.0.0 — <sha7>
- Publicado em AAAA-MM-DD HH:MM (BRT) por <nome> · Execução: <link do Actions>
- Mudanças (git log --oneline <sha-anterior>..<sha>):
  - ...
- Migrations: nenhuma | 00NN_nome.sql (aplicada em AAAA-MM-DD, antes do deploy)
- Backup antes do schema: bookmark Time Travel <id> · export <arquivo> (verify OK) | N/A
- Validações: CI verde (<link>) · smoke automático OK · validação manual curta OK
- Riscos e observações: ...
- Rollback: alvo <sha-anterior-saudável> (compatível com o schema: sim | não)
```

## 11. Bloqueadores de release

Não publique, ou pare, se qualquer item for verdadeiro:

- `CI` vermelho, cancelado ou pulado; `typecheck` ou `build` falhando.
- Vulnerabilidade high/critical de produção; vulnerabilidade moderada sem triagem e, quando aplicável, sem aceitação
  de risco documentada para a release.
- Migration pendente, desconhecida, com lacuna ou duplicada; migration editada depois de aplicada ou arquivo apagado.
- Mudança de schema sem backup verificado e sem bookmark do Time Travel anotado.
- Mudança em dinheiro, estoque ou idempotência (`functions/lib/ledger`, `pix`, `paymentSync`, `stock.ts`,
  `operacoes.ts`, `functions/api/checkout.ts`, webhook) sem os testes de concorrência verdes e revisão específica.
- Secret ausente (o gate ou o Guard falha) ou `DEPLOY_ENABLED` diferente do pretendido.
- Incidente aberto ou outro deploy em andamento.
- Token, `.dev.vars`, dump ou `backups/` no diff.
- Depois do deploy: smoke falhando ou SHA não confirmado. Trate como rollback (seção 9).

## 12. Não fazer

- `git push --force` na `main`; reescrever histórico.
- `npm audit fix --force`: atualizações de dependências exigem revisão e validação separadas.
- Editar, renomear ou apagar arquivo de `migrations/`; desfazer migration com SQL manual.
- Aplicar migration remota depois do deploy, sem revisão ou sem o backup exigido na seção 3.
- `wrangler pages deploy` de pasta local: fica fora do pipeline, sem CI nem Guard.
- Reexecutar workflow antigo como "rollback": o gate o marca como superado.
- `prettier --write .`: só nos arquivos que você alterou.
- `wrangler d1 time-travel restore`, `DROP` ou `DELETE` por conta própria.
- Usar os Diagnósticos (Pix real, pedido de teste) como validação de rotina.
- Reativar `DEPLOY_ENABLED` antes de a correção estar na `main`.
- Colar tokens em chat, issue ou commit; commitar dumps.

## Registro

| Campo                              | Valor               |
| ---------------------------------- | ------------------- |
| Data e responsável                 |                     |
| SHA publicado (7 caracteres) e tag |                     |
| Execução do Actions                |                     |
| Migrations aplicadas               |                     |
| Backup (bookmark, arquivo, verify) |                     |
| Smoke automático                   | OK / falha          |
| Validação manual curta             | OK / falha          |
| Rollback                           | não / alvo e motivo |
