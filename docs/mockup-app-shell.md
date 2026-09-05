# Integração do novo shell visual

A branch `feat/mockup-app-shell` aplica uma nova camada visual ao storefront público sem substituir o backend, o admin ou o fluxo de checkout já existente.

## O que foi preservado

- `/api/products` e produtos do D1
- carrinho atual e sincronização de estoque
- checkout Pix em `/api/checkout/pix`
- acompanhamento de pedidos
- painel em `/admin/`
- PWA e demais assets públicos

## O que mudou

- nova camada `public/assets/css/app-shell.css`
- novo comportamento `public/assets/js/app-shell.js`
- `store-config.js` passa a carregar essa camada
- no mobile, a navegação inferior vira uma barra flutuante de carrinho quando há itens
- o modal existente de carrinho/checkout recebe visual de bottom sheet, inspirado nos mockups

## Observação

A ideia é evoluir o visual por etapas, reaproveitando a lógica de produção já existente. Os mockups são usados como referência de aparência e comportamento, não como bundles HTML independentes.
