# R&P Doces

Loja online da R&P Doces com área administrativa.

## Stack

- React + TypeScript + Vite (frontend)
- Cloudflare Pages + Functions (backend)
- Cloudflare D1 (banco de dados)
- Cloudflare R2 (imagens de produtos)
- Mercado Pago (pagamentos via Pix)

## Estrutura

```
src/          frontend (storefront + admin)
functions/    Cloudflare Functions (API)
migrations/   migrations do D1, numeradas e incrementais
```

## Desenvolvimento local

```bash
npm install
npm run dev
```

Build de produção:

```bash
npm run build
```

Preview local via Wrangler (Cloudflare Pages):

```bash
npm run build
npx wrangler pages dev dist
```
