# Retrospectiva — Produtos V2

Avaliação após o primeiro checkpoint de uso real em produção. O objetivo é medir se a nova base ficou mais previsível, não justificar a migração depois do fato.

- [x] **O código ficou mais previsível?**
  - Sim. Contratos de API, schemas, estado do formulário e componentes ficaram mais explícitos, e mudanças recentes puderam ser feitas de forma localizada.

- [x] **Bugs de UI diminuíram?**
  - Sim no estado atual. Durante a construção apareceram diferenças de comportamento e detalhes visuais, mas os fluxos validados em produção ficaram estáveis.

- [x] **Corrigir bugs ficou mais simples?**
  - Sim. Problemas como dirty state de preço, recarga com alterações pendentes, persistência parcial e navegação híbrida tiveram pontos de correção bem delimitados.

- [x] **O CSS deixou de interferir em outras áreas?**
  - Sim. CSS Modules manteve os estilos de Produtos, login e componentes isolados, sem depender de seletores globais do Admin legado.

- [x] **Mobile ficou mais confiável?**
  - Sim no checkpoint atual. Layout, navegação inferior, modais, login e identificação visual da V2 foram testados e ajustados para mobile.

- [x] **O fluxo de estado está fácil de entender?**
  - Sim. Edição, salvamento, imagem pendente, dirty state, autenticação e menus possuem estados explícitos em vez de depender de manipulação direta do DOM.

- [x] **Uma pequena feature exige mexer em menos lugares?**
  - Em geral, sim. O marcador V2, por exemplo, foi adicionado sem alterar lógica; o gerenciador de categorias também entrou como componente isolado usando contratos já existentes.

- [x] **Houve regressões que não existiam no Vanilla?**
  - Sim durante o desenvolvimento. Exemplos: dirty state do MoneyInput, proxy local capturando `/admin-v2/` e o primeiro login V2 não reproduzindo o fluxo completo da V1. Todas foram identificadas e corrigidas antes de fechar este checkpoint.

- [x] **O custo de React + TypeScript compensou?**
  - Até este checkpoint, sim. Houve custo inicial de estrutura e tipagem, mas a previsibilidade, o isolamento e a facilidade para evoluir os fluxos compensaram no módulo de Produtos.

## Validação do checkpoint

Foram validados em produção:

- login por usuário e senha;
- biometria/passkey;
- identificação visual da V2 no login, mobile e título da aba;
- listagem, criação e edição de produtos;
- estoque, promoções, arquivamento e restauração;
- upload, recorte e remoção de imagem;
- criação e uso de categorias;
- proteção contra perda de alterações pendentes;
- navegação híbrida entre Produtos V2 e as páginas ainda mantidas no Admin atual.

## Decisão

- [x] **Continuar a migração do Admin**
- [ ] Manter apenas Produtos em React
- [ ] Abandonar V2 e permanecer no Vanilla

A continuação deve permanecer incremental. Migrar um módulo por vez, preservar o Admin atual como fallback durante a transição e só adicionar funcionalidades quando houver uma necessidade real observada.
