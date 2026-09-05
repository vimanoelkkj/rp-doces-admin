# Status da implementação

## Concluído nesta etapa

- camada visual mobile-first inspirada nos mockups;
- carregamento seguro via `store-config.js`;
- barra de carrinho flutuante no mobile usando o carrinho já existente;
- reaproveitamento do modal existente como bottom sheet;
- preservação do catálogo dinâmico, D1, estoque, admin e checkout Pix.

## Próximas etapas

- aproximar hero e cabeçalho ainda mais do mockup final;
- revisar campos do checkout mantendo compatibilidade com a API atual;
- implementar estado visual de pagamento aprovado/não aprovado/cancelamento sem duplicar lógica de backend;
- validar o fluxo em preview Cloudflare antes de mergear em `main`.
