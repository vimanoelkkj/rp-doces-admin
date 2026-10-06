# R&P Doces — Backup e restore do D1

Procedimento para exportar o banco, **provar que o export restaura** e restaurar em ambiente descartável.
Complementa `docs/ROLLBACK.md` (incidentes) e `docs/architecture/database-migrations.md` (migrations).

> **Estado:** tudo que está marcado como _validado_ foi executado em D1 **local** (Wrangler 3.114.17, banco criado
> pelas migrations reais do repositório) e é coberto por `tests/d1-backup-restore.test.mjs`. O export do banco **remoto de
> produção** e qualquer restore em produção **nunca foram executados** por este repositório: estão documentados
> abaixo e dependem de credencial e de decisão humana.

## Regras

1. O script `scripts/d1-backup.mjs` **só opera em D1 local**. Ele recusa `--remote`/`--preview` e remove
   `CLOUDFLARE_*` do ambiente do Wrangler. Não existe modo "remoto" nele.
2. **Nunca restaure sobre o banco de produção.** Restaurar produção é decisão humana e segue a seção C de
   `docs/ROLLBACK.md` (Time Travel primeiro; dinheiro e pagamentos já movimentados não voltam).
3. **O dump contém dados pessoais e credenciais**: nome, WhatsApp e e-mail de clientes, hashes de senha de
   administradores, sessões e inscrições de push. Trate como segredo: pasta restrita, disco cifrado, nada em chat,
   issue ou commit. `backups/` já está no `.gitignore` (`backup*/`). Apague os dumps de teste depois de usar.
4. Um backup só vale depois de `verify` verde. Backup nunca verificado é só um arquivo.

## O que existe

| Peça                                    | Para quê                                                                               |
| --------------------------------------- | -------------------------------------------------------------------------------------- |
| `scripts/d1-backup.mjs`                 | CLI: `backup`, `verify`, `restore`, `normalize`.                                       |
| `scripts/d1-verify.mjs`                 | A verificação (restaura num D1 local descartável e confere o resultado).               |
| `scripts/d1-local.mjs`                  | Wrangler sempre `--local`, pasta de trabalho, normalização e restore do dump.          |
| `tests/d1-backup-restore.test.mjs`      | Ciclo completo com as migrations reais: backup, verify, restore idêntico, dumps ruins. |
| Time Travel (`wrangler d1 time-travel`) | Recuperação por ponto no tempo no próprio D1 (30 dias no plano pago, 7 no gratuito).   |

Time Travel continua sendo o primeiro recurso para desfazer algo no banco. O export SQL serve para cópia fora da
plataforma, auditoria e restore em um banco novo.

## 1. Backup do banco local (validado)

```bash
# D1 local do repositório (o mesmo de `npm run pages:dev`); roda a verificação no final
node scripts/d1-backup.mjs backup
# destino e pasta de trabalho explícitos
node scripts/d1-backup.mjs backup --dir <pasta-com-.wrangler/state> --out backups/meu.sql
```

Gera `backups/d1-local-AAAAMMDD-HHMMSS.sql` e `.sql.sha256`. Não sobrescreve arquivo existente. Use `--no-verify`
para pular a verificação (não recomendado).

## 2. Backup do banco de produção (NÃO executado aqui)

Exige credencial da Cloudflare e é uma operação sobre o banco real. Só leitura, mas a Cloudflare documenta que o
export remoto pode afetar a disponibilidade do banco enquanto roda: confira a página "Import and export data" do D1
antes de executar em horário de movimento (não verificado aqui). O `CLOUDFLARE_D1_READ_TOKEN` do Migration Guard foi
criado só para `SELECT`; não presuma que ele serve para exportar.

```bash
# 1) Somente leitura: anote o bookmark atual do Time Travel
npx wrangler d1 time-travel info rp-doces-db

# 2) Export SQL (esquema + dados) do banco REMOTO
npx wrangler d1 export rp-doces-db --remote --output backups/d1-prod-AAAAMMDD-HHMMSS.sql

# 3) Checksum (qualquer sistema com Node)
node -e "const c=require('crypto'),f=require('fs'),p=require('path');const a=process.argv[1];f.writeFileSync(a+'.sha256',c.createHash('sha256').update(f.readFileSync(a)).digest('hex')+'  '+p.basename(a)+'\n')" backups/d1-prod-AAAAMMDD-HHMMSS.sql

# 4) Provar que o dump restaura: tudo local, sem tocar produção
node scripts/d1-backup.mjs verify backups/d1-prod-AAAAMMDD-HHMMSS.sql
```

Rode o passo 4 **com o checkout do commit que está em produção** (ou mais novo): a verificação compara as
migrations do banco com `migrations/`. Compare a linha `contagem` do relatório com `SELECT COUNT(*)` das tabelas
principais em produção (somente leitura) para confirmar que o dump está completo.

Limite conhecido: o formato do dump remoto não foi comparado com o local. Se `verify` falhar em um dump remoto, a
causa mais provável é diferença de formato; trate como achado, não como backup válido.

## 3. Verificar e restaurar em ambiente descartável (validado)

```bash
# Restaura num D1 local temporário (apagado no fim) e confere. --keep mantém a pasta para inspeção.
node scripts/d1-backup.mjs verify backups/meu.sql [--keep]

# Restaura numa pasta sem D1, como banco local persistente
node scripts/d1-backup.mjs restore backups/meu.sql --dir C:/tmp/d1-restaurado
```

`verify` roda, nesta ordem (código de saída 1 se qualquer item for **FALHA**; **AVISO** e **INFO** não reprovam):

| Item            | O que confere                                                                                          |
| --------------- | ------------------------------------------------------------------------------------------------------ |
| `arquivo`       | Não está vazio; se existir `.sha256`, o hash confere.                                                  |
| `restauração`   | O dump importa limpo (inclui a checagem de chave estrangeira no commit).                               |
| `migrations`    | `d1_migrations` legível e reconhecida: sem lacuna, duplicata, ordem trocada ou migration desconhecida. |
| `integridade`   | `PRAGMA quick_check` e `foreign_key_check` limpos.                                                     |
| `schema`        | Todas as tabelas, índices, triggers e colunas das migrations aplicadas existem.                        |
| `autoincrement` | `sqlite_sequence` não ficou atrás do maior id (ids reutilizados colidiriam com pagamentos do MP).      |
| `constraints`   | CHECK de estoque, CHECK de valor do pagamento, FOREIGN KEY, UNIQUE e um trigger continuam rejeitando.  |
| `contagem`      | Informativo: linhas por tabela. Migration do repositório ainda não aplicada no backup vira AVISO.      |

Resultado esperado (banco com todas as migrations do repositório): `Resultado: OK`, cerca de 8 s.

`restore` recusa pasta que já tenha D1 local. Não há opção para sobrescrever: apague a pasta de propósito.

## 4. Restaurar em produção (NÃO automatizado, NÃO executado)

Decisão humana, depois de `docs/ROLLBACK.md` seção C. Nunca importe por cima do banco em uso. O caminho seguro é um
**banco novo**:

1. `node scripts/d1-backup.mjs verify <dump>` verde.
2. `node scripts/d1-backup.mjs normalize <dump> --out restore.sql` (o dump do Wrangler precisa dessa ordem, ver
   "Achados"). **Use o arquivo normalizado**, não o dump cru.
3. `npx wrangler d1 create <novo-nome>` e `npx wrangler d1 execute <novo-nome> --remote --file restore.sql`.
4. Confira o novo banco com `SELECT` (contagens, `d1_migrations`) e só então avalie trocar o `database_id` no
   `wrangler.toml` por um deploy normal (PR, CI, Migration Guard).

Nenhum desses passos remotos foi testado. Reconcilie pedidos e pagamentos com o Mercado Pago depois de qualquer
restore: o banco volta, o dinheiro não.

## Achados do levantamento (versão 3.114.17)

- **O dump cru do Wrangler não restaura neste schema.** Ele lista as tabelas na ordem de criação; `pedidos` foi
  recriada por migration e fica depois das filhas, então `INSERT INTO "pedido_pagamentos"` falha com
  `no such table: main.pedidos`. `normalize`/`verify`/`restore` sobem os `CREATE TABLE` para o topo. Com isso,
  `export(restore(export(db)))` é idêntico byte a byte ao primeiro export (coberto pelo teste).
- `wrangler d1 export` **não aceita `--persist-to`**: o estado local é `<pasta do wrangler.toml>/.wrangler/state`.
  Por isso o script trabalha com uma pasta que tem o próprio `wrangler.toml` (ID de banco falso, nunca o de produção).
- O D1 **não autoriza `PRAGMA integrity_check`** (`SQLITE_AUTH`); `quick_check` e `foreign_key_check` funcionam.
- O D1 **limita os termos de `UNION ALL`** (`too many terms in compound SELECT`): uma instrução por tabela.
- **Windows:** os arquivos do D1 local têm nome de 64 caracteres; com o caminho acima de 259 o Wrangler falha com
  `internal error; reference = ...`, sem dizer o motivo. O script avisa; use uma pasta curta (`C:/tmp/d1`).
  Vale também para `wrangler pages dev` se o repositório estiver numa pasta muito funda.
- O Wrangler instalado avisa que existe a v4. Subir de versão está fora deste escopo.

## Manutenção

- O exercício operacional local de preparação da v1.0 aplicou todas as migrations atuais, usou a fixture sintética
  do teste existente, detectou alterações controladas e recuperou dados, histórico, schema e sequências. O export
  restaurado foi idêntico byte a byte ao backup, inclusive em um segundo restore independente. Checksum divergente
  e tentativa de sobrescrever D1 existente foram recusados. Esta evidência não valida restore remoto nem produção.

- As sondas de `constraints` (em `scripts/d1-verify.mjs`) inserem linhas nas tabelas `produtos`, `pedido_pagamentos`,
  `pedidos`, `pedido_itens` e `usuarios_admin`. Se uma migration futura exigir uma coluna nova nessas tabelas, a sonda
  falha por "outro motivo" e o teste acusa: ajuste o `INSERT` da sonda.
- `tests/d1-backup-restore.test.mjs` leva cerca de 35 s (aplica todas as migrations com o Wrangler). Roda nas fatias
  normais do CI.
- Para agendar backup de produção (CI ou cron) é preciso um token com permissão de exportar e um destino cifrado:
  decisão pendente, nada foi configurado.
