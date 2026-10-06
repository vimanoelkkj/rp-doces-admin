# R&P Doces — Checklist de produção

Estado que a produção precisa ter para a loja operar com segurança: na abertura (go-live) e em revisões
periódicas. Para publicar uma versão, use o [checklist de release](RELEASE-CHECKLIST.md). Em incidente, o
[ROLLBACK](ROLLBACK.md). Backup e restore do banco: [BACKUP-RESTORE](BACKUP-RESTORE.md).

**Como usar:** copie este arquivo para a issue ou o PR da revisão, marque os itens e preencha o
[registro](#registro) no fim. O arquivo do repositório é o modelo: não commite marcações.

- **[AUTO]** o pipeline (`.github/workflows/ci.yml`) ou um script já verifica e reprova sozinho.
- **[MANUAL]** uma pessoa confere no painel ou no terminal. Tudo é só leitura, salvo onde está escrito _(escreve)_.
- Comandos `wrangler ... --remote` e `wrangler pages ...` precisam de login ou token da Cloudflare. Nunca cole token
  em chat, issue ou commit: cite só o nome da variável.

## 1. Secrets e bindings

| Onde                                  | Nome                                                             | Uso                                                                                      |
| ------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| GitHub > Environment `production`     | `CLOUDFLARE_API_TOKEN`                                           | Deploy do Pages (Account > Cloudflare Pages > Edit)                                      |
| idem                                  | `CLOUDFLARE_ACCOUNT_ID`                                          | Deploy e verificação do deployment                                                       |
| idem                                  | `CLOUDFLARE_D1_READ_TOKEN`                                       | Só o Migration Guard (Account > D1 > Read)                                               |
| GitHub > variável do repositório      | `DEPLOY_ENABLED`                                                 | `true` liga o job `deploy`                                                               |
| Cloudflare Pages `rp-doces`, produção | `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET`                           | Mercado Pago: Pix e webhook                                                              |
| idem                                  | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`                          | Web Push. `VAPID_SUBJECT` é opcional (padrão do código: `mailto:contato@rpdoces.com.br`) |
| Pages, bindings (`wrangler.toml`)     | `DB` → D1 `rp-doces-db`; `PRODUCT_IMAGES` → R2 `rp-doces-images` | Banco e imagens                                                                          |

- [ ] **[AUTO]** O job `deploy` falha cedo sem `CLOUDFLARE_API_TOKEN` ou `CLOUDFLARE_ACCOUNT_ID`, e o Migration Guard
      falha sem `CLOUDFLARE_D1_READ_TOKEN`.
- [ ] **[MANUAL]** Os três secrets do GitHub existem em Settings > Environments > `production`, com a permissão mínima
      da tabela ([ROLLBACK](ROLLBACK.md), cenário D, tem o teste de token sem revelá-lo).
- [ ] **[MANUAL]** `DEPLOY_ENABLED` tem o valor pretendido: `gh variable list --repo vimanoelkkj/rp-doces-admin`.
- [ ] **[MANUAL]** Secrets do Pages presentes (o comando lista só os nomes):
      `npx wrangler pages secret list --project-name rp-doces` mostra os quatro nomes obrigatórios acima.
- [ ] **[MANUAL]** Bindings `DB` e `PRODUCT_IMAGES` aparecem no projeto Pages (produção) e batem com o
      `wrangler.toml`. Mudança de binding só vale depois de um novo deployment.
- [ ] **[MANUAL]** Nenhum segredo versionado: `git ls-files | grep -E '(^|/)\.(dev\.vars|env)'` não imprime nada.
      `.dev.vars` é só local; tudo em `VITE_*` vai para o navegador.

## 2. D1

- [ ] **[AUTO]** O Migration Guard (job `deploy`) lê `d1_migrations` do `rp-doces-db` com o token de leitura: prova que
      o banco responde.
- [ ] **[MANUAL]** `npx wrangler d1 execute rp-doces-db --remote --command "SELECT COUNT(*) AS pedidos FROM pedidos"`
      responde.
- [ ] **[MANUAL]** `npx wrangler d1 time-travel info rp-doces-db` responde. Anote o bookmark no [registro](#registro).

## 3. R2

- [ ] **[MANUAL]** O binding `PRODUCT_IMAGES` aponta para o bucket `rp-doces-images` no projeto Pages (produção).
- [ ] **[MANUAL]** Uma imagem do catálogo abre (200 e `image/*`): o comando está no checklist pós-recuperação do
      [ROLLBACK](ROLLBACK.md#checklist-pós-recuperação) (item R2).
- [ ] **[MANUAL]** Decisão registrada sobre backup do R2: o repositório só cobre o D1 ([lacunas](#16-lacunas-conhecidas)).

## 4. Mercado Pago

- [ ] **[MANUAL]** Todos os itens do [checklist de go-live do Mercado Pago](../README.md#checklist-de-produção-go-live-do-mercado-pago)
      do README: URL `https://rpdoces.com.br/api/webhooks/mercadopago`, evento de pagamentos, chave de assinatura igual a
      `MP_WEBHOOK_SECRET`, Pix real de baixo valor, notificação respondida com `200`, pedido em `PAGO`. Sem
      `MP_WEBHOOK_SECRET` o webhook responde `503` e nada é processado.
- [ ] **[MANUAL]** _(escreve)_ Só no go-live ou depois de trocar credencial do MP: Admin > Loja > Diagnósticos
      permanentes (OWNER) gera um Pix real de R$ 0,01, verifica o pagamento e testa o estorno.
- [ ] **[MANUAL]** O webhook está cadastrado mesmo que o sistema convirja sem ele: o polling do cliente e a
      reconciliação do admin só cobrem o atraso (README §24).

## 5. VAPID e push

- [ ] **[MANUAL]** `VAPID_PUBLIC_KEY` e `VAPID_PRIVATE_KEY` presentes (seção 1). Sem a pública,
      `GET /api/admin/push/vapid-key` responde `503` ("Chave VAPID pública não configurada no servidor") e nenhum
      aparelho consegue se inscrever.
- [ ] **[MANUAL]** _(escreve)_ No domínio HTTPS, logado como admin: Admin > Notificações ativa o push neste aparelho e o
      push de teste chega.
- Sem push, a Central de Notificações do admin continua funcionando (README §25).

## 6. Domínio e HTTPS

- [ ] **[MANUAL]** `rpdoces.com.br` é domínio do projeto Pages e abre por `https://` sem aviso de certificado (painel da
      Cloudflare; o nome do menu pode variar).
- [ ] **[MANUAL]** `curl -sI http://rpdoces.com.br/` redireciona para `https://` (configuração da Cloudflare, fora do
      repositório).
- [ ] **[MANUAL]** `curl -sI https://rpdoces.com.br/` traz os cabeçalhos de `public/_headers`:
      `content-security-policy`, `x-frame-options: DENY`, `x-content-type-options: nosniff`.
- [ ] **[AUTO]** `GET /`, `/api/produtos` e `/api/config` respondem no `PRODUCTION_URL` (smoke, seção 11).
- [ ] **[MANUAL]** O admin é aberto na mesma origem que serve `/api/*`: as mutações exigem `sameOrigin` (o `Origin` ou o
      `Referer` precisa ser a origem da requisição).

## 7. Migrations aplicadas e verificadas

- [ ] **[AUTO]** Migration Guard (`scripts/check-d1-migrations.mjs`, job `deploy`, só `SELECT`): reprova com migration
      pendente, lacuna, desconhecida, duplicada, fora de ordem ou schema da última migration ausente (exit 1 a 4).
- [ ] **[MANUAL]** `npm run db:migrations:check`, com `CLOUDFLARE_D1_READ_TOKEN` e `CLOUDFLARE_ACCOUNT_ID` no ambiente,
      termina em "Migrations D1 em dia".
- [ ] **[MANUAL]**
      `npx wrangler d1 execute rp-doces-db --remote --command "SELECT id, name, applied_at FROM d1_migrations ORDER BY id DESC LIMIT 3"`:
      a mais recente é a última do repositório (`ls migrations | tail -1`).
- Regras: migrations são aplicadas à mão, antes do deploy, e nunca se edita uma já aplicada
  ([database-migrations](architecture/database-migrations.md), [ROLLBACK](ROLLBACK.md) regra 5).

## 8. Backup recente

Hoje não há agendamento e o export remoto nunca foi executado por este repositório ([BACKUP-RESTORE](BACKUP-RESTORE.md)).

- [ ] **[MANUAL]** Existe export SQL de produção, verificado e datado (`backups/d1-prod-*.sql` com `.sha256`): data
      ______. Sem export verificado, o item reprova.
- [ ] **[MANUAL]** Cadência de backup definida pelo responsável e anotada no [registro](#registro). Sugestão: antes de
      toda mudança de schema e periodicamente.
- [ ] **[MANUAL]** O arquivo está fora do repositório, em local restrito e cifrado: tem dados pessoais e hashes de senha.
- [ ] **[MANUAL]** Bookmark atual do Time Travel anotado (seção 2). Retenção: 30 dias no plano pago, 7 no gratuito.

## 9. Restore testado

- [ ] **[AUTO]** `tests/d1-backup-restore.test.mjs` roda nas fatias do CI: backup, restore e verificação em D1 local, com
      as migrations reais.
- [ ] **[MANUAL]** `node scripts/d1-backup.mjs verify <dump de produção>` termina em `Resultado: OK`; data: ______. Rode
      no checkout do commit que está em produção, ou mais novo.
- [ ] **[MANUAL]** O responsável conhece o caminho de restore em produção
      ([BACKUP-RESTORE §4](BACKUP-RESTORE.md#4-restaurar-em-produção-não-automatizado-não-executado)). Ele nunca foi
      executado.

## 10. Rollback conhecido

- [ ] **[MANUAL]** Quem opera sabe pausar o deploy (`DEPLOY_ENABLED=false`), achar o SHA no ar e o último deployment
      saudável e restaurar pelo painel ([ROLLBACK](ROLLBACK.md), seções 1 a 5).
- [ ] **[MANUAL]** Há ao menos um deployment de produção anterior com sucesso (alvo de rollback; nunca o "Idle"):
      `npx wrangler pages deployment list --project-name rp-doces --environment production`.
- Registro honesto: o rollback do Pages nunca foi executado em produção.

## 11. Smoke pós-deploy

- [ ] **[AUTO]** O job `deploy` roda `scripts/smoke-production.mjs` depois de confirmar o SHA, só com `GET`: `/` (HTML),
      asset principal (JS ou CSS), `/api/produtos` e `/api/config` com contrato válido, `/api/admin/pedidos` sem sessão
      = `401`, rota `/api/` inexistente (404 ou fallback da SPA), nenhum 5xx e nenhum stack trace ou segredo nas
      respostas.
- [ ] **[MANUAL]** `npm run smoke:prod` termina com exit 0. Padrão: `https://rpdoces.com.br`; use `SMOKE_BASE_URL` ou
      `-- --url=<url>` para outro ambiente.
- Não cobre login, checkout, webhook, R2 nem push: por isso as seções 3 a 5 e a validação manual do release.

## 12. Logs e diagnósticos

- [ ] **[MANUAL]** `npx wrangler pages deployment tail --project-name rp-doces` abre e mostra os logs das Functions em
      tempo real.
- [ ] **[AUTO]** O resumo da execução do deploy (GitHub Actions) termina em "Publicado em produção" ou
      "PUBLICAÇÃO FALHOU".
- [ ] **[MANUAL]** Admin > Notificações abre; falhas operacionais aparecem ali.
- [ ] **[MANUAL]** _(escreve)_ Admin > Loja > Diagnósticos permanentes (OWNER) só para diagnosticar: grava eventos em
      `admin_diagnostico_eventos`.
- Observabilidade externa (alertas, Logpush) não está configurada no repositório (`wrangler.toml` sem `[observability]`).

## 13. Permissões administrativas

- [ ] **[MANUAL]** Admin > Administradores (só OWNER enxerga): os ativos são pessoas atuais; desative quem saiu.
- [ ] **[MANUAL]** Existe ao menos um OWNER ativo com login testado. O banco impede desativar, rebaixar ou remover o
      último OWNER ativo (migration `0032`).
- [ ] **[MANUAL]** Só quem precisa é OWNER: OWNER gerencia administradores e roda os Diagnósticos; ADMIN não.
- [ ] **[AUTO]** `/api/admin/pedidos` sem sessão responde `401` (smoke).
- [ ] **[MANUAL]** Tokens da Cloudflare com o menor privilégio e sem reuso: `CLOUDFLARE_API_TOKEN` não lê D1 e
      `CLOUDFLARE_D1_READ_TOKEN` não publica ([ROLLBACK](ROLLBACK.md), cenário D).
- [ ] **[MANUAL]** Escrita em produção (D1 remoto, `pages deploy`, `time-travel restore`) é sempre executada por uma
      pessoa, no próprio terminal. O hook `.claude/hooks/guard-d1-remote.mjs` bloqueia o agente (Claude Code) nesses
      comandos.

## 14. Bloqueadores de produção

Não abra a loja (ou pare de operar) enquanto:

- `MP_ACCESS_TOKEN` ou `MP_WEBHOOK_SECRET` ausente, ou webhook não cadastrado e testado.
- Migration pendente, desconhecida ou com lacuna (`npm run db:migrations:check` diferente de OK).
- O smoke falha: 5xx, `/api/admin/pedidos` sem `401`, HTTPS inválido.
- Nenhum OWNER ativo, ou login do admin quebrado.
- Nenhum caminho de recuperação: Time Travel inacessível e nenhum export verificado.
- Nenhum deployment saudável anterior, ou ninguém sabe pausar o deploy.

Não bloqueiam, mas registre: VAPID ausente (push desligado), R2 sem backup, falta de observabilidade externa.

## 15. Não fazer

- Não cole nem commite tokens, `.dev.vars` ou dumps (`backups/`); nada sensível em variável `VITE_*`.
- Não rode `wrangler d1 time-travel restore`, `DROP`, `DELETE` nem migration reversa por conta própria
  ([ROLLBACK](ROLLBACK.md), regra 3).
- Não importe dump por cima do banco em uso ([BACKUP-RESTORE](BACKUP-RESTORE.md), §4).
- Não use os Diagnósticos (Pix real, pedido de teste) como checagem de rotina.
- Não amplie o `CLOUDFLARE_API_TOKEN` para ler D1 nem use o token de leitura para publicar.
- Não publique com `wrangler pages deploy` de pasta local.

## 16. Lacunas conhecidas

O que **não existe** hoje no repositório:

- Backup agendado do D1 (o export remoto nunca foi executado).
- Backup do R2.
- Observabilidade e alertas externos.
- Smoke de fluxos que escrevem (checkout, webhook), de login, de R2 e de push.
- Prova de que a branch protection exige o check `CI`: confira no GitHub (o [ROLLBACK](ROLLBACK.md) recomenda).
- Rollback do Pages e restore em produção executados de verdade.

## Registro

| Campo                                     | Valor      |
| ----------------------------------------- | ---------- |
| Data e responsável                        |            |
| SHA em produção (7 caracteres)            |            |
| `npm run db:migrations:check`             | OK / falha |
| Último export verificado (arquivo e data) |            |
| Bookmark do Time Travel                   |            |
| Pendências e decisões                     |            |
