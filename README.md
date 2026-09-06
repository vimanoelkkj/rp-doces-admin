# R&P Doces

Aplicação da R&P Doces com storefront, painel administrativo, backend e aplicativo Android nativo.

## Estrutura

- `public/` storefront e assets públicos
- `admin/` painel administrativo React + Vite + TypeScript
- `apps/android/` aplicativo Android nativo em Kotlin/Compose
- `functions/` Pages Functions e APIs
- `migrations/` migrações do D1
- `scripts/` rotinas de build, backup, validação e deploy
- `tests/` testes do backend e da infraestrutura web

O painel administrativo oficial é publicado em `/admin/`.

## Desenvolvimento

### Raiz / storefront / backend

```bash
npm ci
npm test
npm run dev
```

### Admin

```bash
cd admin
npm ci
npm run dev
```

### Android

```powershell
cd apps\android
.\gradlew.bat installDebug
```

## Produção

Antes do deploy, instale as dependências da raiz e do Admin:

```bash
npm ci
cd admin
npm ci
cd ..
npm run deploy:production
```

O script de produção valida a branch `main`, o working tree, os testes da raiz, os testes e o build do Admin antes de publicar `public/` no Cloudflare Pages.

## Infraestrutura

- Cloudflare Pages para o site e o painel
- Pages Functions para as APIs
- D1 para persistência
- R2 para imagens e arquivos
- Mercado Pago para os fluxos de pagamento configurados no projeto

Segredos e credenciais ficam no ambiente de produção e nunca devem ser enviados ao navegador nem versionados no repositório.
