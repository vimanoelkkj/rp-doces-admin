# R&P Doces

Estrutura:

- `public/` site público
- `public/admin/` painel administrativo
- `functions/` Pages Functions / API
- `migrations/002_admin.sql` tabelas de autenticação e coluna `emoji`

## Antes do primeiro deploy com Functions

1. Execute `migrations/002_admin.sql` no Console do D1 `rp-doces-db`.
2. Em Pages > rp-doces > Settings > Variables and secrets, crie um **Secret** chamado `SETUP_KEY`.
   Use uma chave forte e temporária.
3. O binding D1 `DB -> rp-doces-db` já deve permanecer configurado no dashboard.
4. No PC:
   - `npm install`
   - `npx wrangler login`
   - `npm run deploy`
5. Acesse `/admin/`. Como ainda não existe administrador, aparecerá a primeira configuração.
6. Crie sua conta usando a mesma `SETUP_KEY`.
7. Depois crie as outras duas contas pelo painel.

## Recuperação de senha

- Um administrador logado pode redefinir a senha de outro administrador.
- O fluxo de token por e-mail já está implementado.
- Para o envio automático funcionar, configure futuramente o binding `EMAIL` e a variável `EMAIL_FROM`.
  Isso pode ser feito quando o domínio próprio estiver no Cloudflare Email Service.
