# Exclusão auditável de pedido

“Excluir pedido” cria uma anulação independente de arquivamento, cancelamento
de item e estorno. A opção fica no menu ⋮ do detalhe. A confirmação exige uma
escolha de estoque; o motivo é opcional, com até 300 caracteres.

## Persistência e concorrência

Aplicar a migration **0022** depois da 0021 e antes de disponibilizar o código.
Ela adiciona `pedido_anulacoes` e triggers; não reescreve dados históricos nem
altera enums existentes. Nenhum comando remoto foi executado nesta implementação.

`POST /api/admin/pedidos/:id/anulacao` aceita somente `devolverEstoque` e `motivo`.
Verifica mesma origem antes da sessão/banco. O backend captura total, bruto,
reembolsos, líquido, usuário e estados originais de todos os itens no próprio SQL.

Um único `DB.batch` insere a anulação, aplica estoque quando solicitado, deriva
a projeção física existente e fecha a trava `efetivada`. O valor zero dessa trava
existe apenas durante a transação. O UNIQUE de `pedido_id` garante um vencedor;
falhas revertem todo o batch. Retries devolvem a anulação original, mesmo se a
segunda requisição enviar outra escolha de estoque.

Após efetivar, triggers recusam escritas no pedido e nas suas entidades de
histórico. Isso também protege operações que passaram pela autorização antes de
uma anulação concorrente. As rotinas de recuperação/estoque ignoram anulados.

## Estoque e Mercado Pago

Ao devolver, somente itens `ATIVO`/`TROCA_PENDENTE` são elegíveis:
`BAIXADO` vira `REPOSTO`; `RESERVADO` vira `LIBERADO`. Os demais estados e itens
`CANCELADO`, inclusive origens históricas de trocas, permanecem intactos.
Ao manter, produtos, estados físicos e projeções não são alterados.

Recebimentos `PIX_MP/PAGO` precisam estar integralmente cobertos por estornos
confirmados do próprio pagamento, com origem Mercado Pago e identificador remoto.
Refund manual não comprova estorno MP. Cobranças MP pendentes, expirações locais
sem encerramento definitivo, envios inconclusivos e refunds em processamento
também bloqueiam a anulação. O endpoint não chama o provedor nem cria refunds.

## Consultas revisadas

O predicado compartilhado `pedidoValidoSql` exclui anulados de:

- Listagens, buscas, paginação e contadores de todas as abas normais e arquivadas.
- Recebimentos do dia, bruto, reembolsos e líquido da loja.
- Saldo a receber, pagamentos pendentes, comandas abertas e fila de preparo.
- Pedidos recentes, ranking de produtos vendidos e notificações operacionais.
- Consulta pública por token e seleção de divergências para reconciliação.

Consultas financeiras por pedido preservam seus valores históricos. A auditoria
continua acessível no detalhe autenticado (`/admin/pedidos?pedido=<id>`) e em
`GET /api/admin/pedidos/:id/historico`, com o evento `PEDIDO_ANULADO` baseado na
fotografia persistida. O detalhe mostra a anulação e todos os itens, sem ações
mutantes. Não há restauração da anulação nesta operação.

## Validação local

`tests/admin-order-void.test.mjs` cobre preservação de dinheiro/alocações,
agregados e reload, estados físicos, trocas, idempotência, concorrência, rollback,
MP, autenticação, imutabilidade e migration sobre banco representativo 0016–0021
com `PRAGMA foreign_key_check` vazio. `tests/comanda-viva-ui.test.mjs` cobre a
confirmação, duplo clique, bloqueio MP, atualização sem F5 e modo histórico.
