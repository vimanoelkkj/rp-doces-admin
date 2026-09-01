# Retrospectiva — Produtos V2

Avaliar após uso operacional real por tempo suficiente para observar manutenção, regressões e comportamento no dia a dia.

O checkpoint técnico abaixo registra apenas o que já foi exercitado em produção. Ele **não substitui esta retrospectiva** e não deve ser usado sozinho para justificar a continuação da migração.

## Perguntas para uso real

- [ ] O código ficou mais previsível?
- [ ] Bugs de UI diminuíram?
- [ ] Corrigir bugs ficou mais simples?
- [ ] O CSS deixou de interferir em outras áreas?
- [ ] Mobile ficou mais confiável?
- [ ] O fluxo de estado está fácil de entender?
- [ ] Uma pequena feature exige mexer em menos lugares?
- [ ] Houve regressões que não existiam no Vanilla?
- [ ] O custo de React + TypeScript compensou?

Essas respostas permanecem em aberto até haver experiência operacional suficiente para comparar a V2 com o Admin Vanilla sem confundir qualidade de implementação com qualidade percebida no uso contínuo.

## Checkpoint técnico já validado

Durante desenvolvimento, testes manuais e smoke tests em produção, foram exercitados com sucesso:

- login por usuário e senha;
- biometria/passkey;
- identificação visual da V2;
- listagem, criação e edição de produtos;
- estoque e promoções;
- arquivamento e restauração de produtos;
- upload, recorte e remoção de imagem;
- criação e uso de categorias;
- proteção contra perda de alterações pendentes;
- navegação híbrida entre módulos V2 e o Admin atual.

Também ocorreram regressões durante a implementação, entre elas dirty state do MoneyInput, configuração do proxy local e paridade inicial incompleta do login. Elas foram corrigidas antes do checkpoint, mas continuam relevantes para a avaliação futura.

## Decisão

- [ ] Continuar a migração do Admin
- [ ] Manter apenas Produtos em React
- [ ] Abandonar V2 e permanecer no Vanilla

**Status atual:** migração incremental em avaliação. Dashboard e a preparação de Pedidos podem continuar como experimentos controlados, mantendo o Admin atual como fallback. A decisão arquitetural definitiva só deve ser marcada após uso operacional real suficiente.
