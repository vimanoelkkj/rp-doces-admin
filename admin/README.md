# R&P Doces Admin

Painel administrativo oficial da R&P Doces.

## Stack

React + Vite + TypeScript strict + Zod + CSS Modules.

O painel compartilha o mesmo backend, autenticação, D1, R2 e integrações usados pelo storefront e pelo app Android.

## Desenvolvimento local

Com a API local em `http://127.0.0.1:8788`:

```bash
cd admin
npm ci
npm run dev
```

O Vite encaminha `/api` para o Wrangler local.

## Testes

```bash
npm test
```

## Build

```bash
npm run build
```

O bundle é gerado em `public/admin/`. Essa pasta é artefato de build e não deve ser versionada.

## Produção

O deploy oficial é executado pela raiz do repositório:

```bash
npm run deploy:production
```
