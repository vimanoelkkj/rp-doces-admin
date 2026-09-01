# R&P Doces Admin V2

Experimento incremental para validar uma base mais previsível no painel administrativo.

## Stack deliberadamente pequena

React + Vite + TypeScript strict + Zod + CSS Modules.

Toda dependência adicional precisa resolver um problema concreto já observado.

## Escopo inicial

Somente Produtos. O backend atual, Pages Functions, D1, R2, autenticação e Mercado Pago permanecem inalterados.

## Desenvolvimento local

Com a API local em `http://127.0.0.1:8788`:

```bash
cd admin-v2
npm install
npm run dev
```

O Vite encaminha `/api` para o Wrangler local.

## Build

```bash
npm run build
```

O build é gerado em `public/admin-v2` sem substituir o Admin atual.
