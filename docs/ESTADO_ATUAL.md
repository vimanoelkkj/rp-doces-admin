# R&P Doces — Estado atual da engenharia

> Documento de passagem de contexto para trabalhos no backend e no domínio.
>
> Leia este arquivo e o `README.md` antes de alterar qualquer lógica relacionada
> a pagamentos, financeiro, estoque, reservas, pedidos ou itens de pedidos.

---

## Branch autoritativa

A branch autoritativa do rebuild é:

`rebuild-from-scratch`

A `main` representa o sistema histórico e não deve ser usada como fonte de
verdade para o rebuild.

---

# Regra central do projeto

**O Figma manda no pixel. O backend manda nos dados.**

- O Figma/React atual é a fonte de verdade visual do frontend.
- O backend e o domínio são a fonte de verdade dos dados e regras de negócio.
- Não reconstruir o frontend usando a implementação histórica como referência visual.
- Não alterar invariantes do domínio como efeito colateral de outra tarefa.
- Não expandir silenciosamente o escopo de uma correção.

---

# Stack

- React
- Vite
- TypeScript
- Cloudflare Pages
- Cloudflare Functions
- Cloudflare D1
- Cloudflare R2
- Mercado Pago
- Wrangler

O rebuild utiliza a Payments API do Mercado Pago.

Não migrar para a Orders API como parte de trabalhos não relacionados.

---

# Modelo financeiro

Os fatos financeiros vivem no ledger.

Estruturas principais:

- `pedido_pagamentos`
- `pedido_pagamento_alocacoes`
- `pedido_reembolsos`

`pedidos.status_pagamento` é uma projeção derivada.

Ele não é a fonte autoritativa do fato financeiro.

Estados agregados:

- `PENDENTE`
- `PARCIAL`
- `PAGO`

Regra conceitual:

- líquido confirmado <= 0 → `PENDENTE`
- 0 < líquido confirmado < total do pedido → `PARCIAL`
- líquido confirmado >= total do pedido → `PAGO`

Fatos financeiros confirmados nunca devem ser escondidos, removidos ou
reescritos apenas para fazer o pedido parecer consistente.

## Overpayment

Overpayment continua sendo um fato financeiro real.

Exemplo:

Se um pedido de R$ 50 possui dois Pix e ambos forem realmente pagos, o ledger
deve preservar R$ 100 recebidos.

Não ignorar silenciosamente um pagamento para fazer o total parecer correto.

O tratamento operacional de overpayment permanece dívida separada.

---

# Autoridade financeira do Mercado Pago

Uma cobrança Pix localmente expirada somente pode realizar:

`EXPIRADO -> PAGO`

quando existir uma resposta GET autoritativa e verificada do Mercado Pago.

Não possuem autoridade financeira suficiente isoladamente:

- relógio local;
- payload do webhook;
- `mp_status` persistido;
- `mp_status_detail`;
- estado antigo do banco;
- estado exibido pelo frontend.

O webhook identifica o recurso.

O payload recebido pelo webhook não deve, sozinho, estabelecer a verdade
financeira necessária para recuperar um pagamento expirado.

---

# Invariante de PAGO

`PAGO` não deve regredir devido a operações posteriores atrasadas ou falhas.

Depois que um fato financeiro foi persistido de forma durável, uma falha na
atualização de estado derivado não deve fazer a API fingir que o fato
financeiro falhou.

O estado derivado deve permanecer recuperável por reconciliação.

---

# Pix substituído

Um Pix substituído continua financeiramente reconciliável.

Criar um sucessor não significa que a cobrança anterior deixou de poder
receber dinheiro no Mercado Pago.

Portanto:

- não transformar automaticamente o Pix anterior em CANCELADO;
- não ignorar pagamento posterior do Pix anterior;
- preservar `substitui_pagamento_id`;
- permitir que original e sucessor sejam reconciliados independentemente.

Se original e sucessor forem realmente pagos, ambos permanecem fatos
financeiros.

O eventual excesso é tratado como overpayment.

---

# Estoque e reservas

A reserva pertence ao **PEDIDO**.

Ela nunca pertence a uma tentativa Pix individual.

Estados relevantes:

- `ATIVA`
- `LIBERADA`
- `CONVERTIDA`

Qualquer pagamento do mesmo pedido com:

`metodo = 'PIX_MP' AND status = 'PENDENTE'`

mantém a reserva do pedido.

Isso inclui:

- Pix SITE;
- Pix ADMIN;
- Pix original substituído;
- Pix sucessor;
- Pix parcial/aditivo;
- Pix sem `mp_payment_id`;
- Pix sem QR;
- Pix cujo prazo local já venceu, mas cujo ledger continua `PENDENTE`.

Placeholders locais que não sejam `PIX_MP` não contam como cobrança remota
Pix viva.

`PARCIAL` mantém a reserva.

A baixa física de estoque deve acontecer no máximo uma vez.

Pedido/itens já convertidos fisicamente não devem voltar ao estado normal de
reserva.

A reconciliação financeira genérica não possui autoridade para liberar
reservas.

---

# B3 — Convergência da reconciliação financeira

**STATUS: RESOLVIDO**

Commit:

`ff8d8d7`

Mensagem:

`rp-doces: make financial reconciliation convergent`

## Propriedades

- projeção financeira reconstruída a partir do ledger;
- retries reconciliam mesmo quando nenhuma nova transição financeira ocorre;
- baixa de estoque revalida o financeiro dentro da transação;
- recuperação administrativa encontra ledger `PAGO` com pedido ainda
  projetado como `PENDENTE`;
- depois que pagamento/reembolso administrativo é persistido, falhas posteriores
  de reconciliação ou leitura de saldo não transformam o fato persistido em
  falha financeira;
- estados derivados permanecem recuperáveis.

## Regra importante

B3 é reconciliação financeira genérica.

Não adicionar liberação de reserva ao reconciliador financeiro genérico.

---

# B2 — Recuperação verificada de Pix expirado

**STATUS: RESOLVIDO**

Commit:

`c3279d4`

Mensagem:

`rp-doces: recover verified payments after local Pix expiration`

## Propriedades

`EXPIRADO -> PAGO` somente ocorre após GET autoritativo e verificado do
Mercado Pago.

O mecanismo de autoridade é privado ao fluxo de GET verificado.

Objetos clonados, literais ou dados vindos diretamente do webhook não devem
obter essa autoridade.

Outras propriedades:

- relógio local não possui autoridade financeira;
- webhook não promove sozinho `EXPIRADO -> PAGO`;
- polling consulta Mercado Pago;
- polling pode consultar pagamento já `EXPIRADO`;
- timeout/5xx não inventa rejeição;
- Pix substituído continua reconciliável;
- pagamento tardio depois de `LIBERADA` pode readquirir estoque conforme as
  regras existentes;
- baixa física continua acontecendo no máximo uma vez.

## Frontend

Timer chegando a zero não significa automaticamente pagamento recusado.

O estado passa a ser inconclusivo e o polling continua.

O frontend não deve afirmar com certeza que nenhum valor foi cobrado apenas
porque o timer local expirou.

---

# B4 — Segurança da reserva com múltiplos Pix

**STATUS: RESOLVIDO**

Commit presente na branch atual.

## Problema original

Quando vários Pix coexistiam para o mesmo pedido, terminalizar uma tentativa
como `CANCELADO` ou `EXPIRADO` podia liberar a reserva inteira mesmo existindo
outro `PIX_MP/PENDENTE`.

Também existia corrida inversa:

1. criação ADMIN lê reserva `ATIVA`;
2. outra operação libera a reserva;
3. criação continua supondo que não precisa reservar;
4. novo Pix nasce `PENDENTE` sem reserva.

## Implementação

`liberarReservaPedido` agora revalida dentro do mesmo batch da liberação:

- projeção financeira;
- reserva `ATIVA`;
- ausência de baixa física;
- elegibilidade financeira;
- ausência de qualquer `PIX_MP/PENDENTE`.

O mesmo predicado protege:

- decrementos de `estoque_reservado`;
- alteração final da reserva para `LIBERADA`.

A criação/regeneração ADMIN decide aquisição/readquisição de reserva
atomicamente.

Se a liberação vencer:

- criação tenta readquirir exatamente uma vez;
- falta de estoque causa rollback;
- nenhum POST ao Mercado Pago deve ocorrer após falha de readquisição.

Se criação vencer:

- o novo `PIX_MP/PENDENTE` impede a liberação.

## Finalização repetível

Tentativas persistidas como:

- `CANCELADO`
- `EXPIRADO`

podem repetir a tentativa segura de liberação mesmo quando:

- o estado já era igual;
- o CAS foi perdido;
- nenhuma nova transição financeira ocorreu.

Isso não altera a autoridade financeira do B2.

## POST tardio

Respostas tardias dos POSTs SITE/ADMIN somente podem escrever `FALHOU`
enquanto a tentativa ainda estiver `PENDENTE`.

Uma resposta tardia não pode sobrescrever um `PAGO` já persistido.

## Validação

A revisão adversarial independente aprovou B4.

Suíte final no momento da revisão:

- 127/127 testes;
- build aprovado;
- `git diff --check` aprovado;
- nenhum novo erro no type-check das Functions.

Os únicos erros conhecidos do baseline eram:

- `auth.ts:59` — TS2345
- `auth.ts:87` — TS2322

---

# Dívida residual aceita do B4

Existe uma janela estreita entre:

1. persistir estado terminal;
2. executar a transação separada que libera a reserva.

Se houver falha de infraestrutura nesse intervalo, a reserva pode permanecer
`ATIVA`.

Casos conhecidos:

- `CANCELADO` pode depender de novo evento/retry;
- `EXPIRADO` com `mp_payment_id` pode ser recuperado pelo sweep financeiro
  existente;
- `EXPIRADO` sem `mp_payment_id` pode não possuir recuperação automática;
- cadeias exclusivamente `FALHOU` podem continuar retendo reserva conforme a
  política existente.

Essa janela foi classificada como dívida operacional aceitável para o primeiro
go-live.

Não criar novo sweep/cron silenciosamente ao trabalhar em outra tarefa.

---

# B1 — Edição destrutiva dos itens do pedido

**STATUS: INVESTIGADO, NÃO IMPLEMENTADO**

Este é o blocker atual.

Endpoint:

`functions/api/admin/pedidos/[id]/itens.ts`

## Problema

O algoritmo atual essencialmente executa:

1. DELETE de todos os itens antigos;
2. INSERT dos novos itens;
3. UPDATE do total do pedido.

O batch é transacional.

Porém, a operação inteira é semanticamente destrutiva.

O endpoint atualmente aceita muito mais estados do que deveria.

Foi confirmado que pode aceitar pedidos:

- `NOVO`;
- `PREPARANDO`;
- `PRONTO`;
- `CANCELADO`;
- `PENDENTE`;
- `PARCIAL`;
- `PAGO`;
- com Pix vivo;
- com pagamentos terminalizados;
- com allocations;
- com refunds;
- com reserva `ATIVA`;
- com reserva `LIBERADA`;
- com reserva `CONVERTIDA`;
- com baixa física já realizada.

O guard histórico bloqueava essencialmente `ENTREGUE`.

---

# O que o DELETE+INSERT destrói

A FK entre `pedido_pagamento_alocacoes` e `pedido_itens` utiliza
`ON DELETE CASCADE`.

Portanto, excluir um item pode apagar suas alocações financeiras.

A edição destrutiva também pode perder ou invalidar:

- ID do item;
- produto histórico;
- quantidade histórica;
- preço histórico;
- valor histórico;
- `criado_em`;
- `adicionado_por_usuario_id`;
- `adicionado_em`;
- `estoque_baixado_em` por item;
- allocations financeiras.

Enquanto isso:

- `pedido_pagamentos` sobrevive;
- `pedido_reembolsos` sobrevive;
- total do pedido muda;
- `status_pagamento` pode permanecer antigo;
- reserva pode permanecer no estado anterior;
- marca global de baixa pode permanecer;
- estoque físico não acompanha automaticamente a alteração;
- estoque reservado não acompanha automaticamente a alteração.

---

# Reprodução confirmada do B1

Exemplo reproduzido:

## Antes

- quantidade: 2
- total: R$ 100
- recebido: R$ 100
- `status_pagamento = PAGO`
- 1 allocation
- item ID 1
- baixa física do item preenchida
- reserva `CONVERTIDA`
- estoque físico 8

## Edição

Alteração de 2 para 5 unidades.

## Depois

- quantidade: 5
- total: R$ 250
- recebido: R$ 100
- `status_pagamento` ainda podia permanecer `PAGO`
- allocations: 0
- novo item ID
- `estoque_baixado_em` do novo item = NULL
- marca global de baixa do pedido permanece
- reserva permanece `CONVERTIDA`
- estoque físico continua 8

B3 pode posteriormente corrigir a projeção financeira para `PARCIAL`.

B3 não consegue reconstruir:

- allocation apagada;
- identidade antiga do item;
- histórico físico destruído.

---

# Outros cenários reproduzidos no B1

Também foram confirmados:

- redução de quantidade após pagamento;
- troca de produto após pagamento;
- aumento com reserva ativa;
- redução com reserva ativa;
- interferência em reserva compartilhada do produto;
- reserva liberada seguida de aprovação tardia;
- refund integral;
- ADMIN `A_COMBINAR`;
- pedido `CANCELADO`.

Um pedido aparentemente virgem também não foi considerado seguro sob
concorrência.

---

# Corrida com materialização legada

Foi reproduzida uma TOCTOU importante:

1. pedido aparentemente virgem;
2. materialização legada lê total antigo;
3. execução é pausada;
4. editor altera total e itens;
5. materialização retoma;
6. pagamento legado nasce usando o valor antigo;
7. allocations são criadas sobre os itens novos.

Portanto, simplesmente verificar:

- `PENDENTE`;
- ausência de ledger;
- ausência de reserva;

antes da edição não prova segurança.

Uma checagem anterior ao DELETE também não resolve todas as ordens de
concorrência.

---

# Contenção aprovada para B1

Para o primeiro go-live, não implementar agora o editor incremental
definitivo.

A menor contenção segura é:

**bloquear toda edição destrutiva de itens server-side.**

Fluxo conceitual:

1. autenticar;
2. validar ID/payload;
3. confirmar existência do pedido;
4. retornar conflito;
5. executar ZERO escritas de domínio.

Resposta sugerida:

HTTP `409`

```json
{
  "error": "A edição de itens está temporariamente indisponível. Nenhuma alteração foi salva.",
  "code": "EDICAO_ITENS_BLOQUEADA"
}
```

Para qualquer pedido existente e requisição válida, a autorização da edição
destrutiva deve ser falsa.

Manter:

autenticação existente;
400 para ID/payload inválido;
404 para pedido inexistente;
409 para edição bloqueada.

Não depender do frontend.

Não chamar reconciliadores, materialização legada ou helpers de estoque para
decidir essa negativa.

Nenhuma transação destrutiva deve ser executada.

Escopo previsto da implementação B1

Arquivos esperados:

functions/api/admin/pedidos/[id]/itens.ts
tests/helpers/b3.mjs
tests/b1.test.mjs
README.md, caso seja necessário sincronizar documentação

Nenhuma migration é esperada.

Não alterar:

B2;
B3;
B4;
ledger;
estoque;
reserva;
política financeira.
Testes B1

A implementação deve provar bloqueio em cenários como:

pedido aparentemente virgem;
PENDENTE + ATIVA;
PIX_MP/PENDENTE;
PARCIAL;
PAGO com baixa;
PAGO aguardando baixa;
allocations existentes;
refund existente;
reserva LIBERADA;
reserva CONVERTIDA;
ENTREGUE;
CANCELADO;
ADMIN A_COMBINAR;
chamada direta à API.

Para cada edição bloqueada verificar:

HTTP 409;
código estável;
pedido inalterado;
itens inalterados;
pagamentos inalterados;
allocations inalteradas;
refunds inalterados;
reserva inalterada;
estoque físico inalterado;
estoque reservado inalterado.

Também testar concorrência com operações financeiras e de estoque.

A edição bloqueada nunca deve produzir escrita de domínio.

Próximo blocker: A1

Depois da contenção B1:

A1 — identidade estável/idempotência das operações

Existem riscos conhecidos de retry criar operações logicamente duplicadas.

Pontos importantes:

pagamento manual ADMIN;
refund;
checkout SITE.

Pagamento manual e refund são particularmente sensíveis porque um retry pode
criar um novo fato financeiro real enquanto ainda existir saldo disponível.

Não resolver A1 acidentalmente durante B1.

B5 — Cutover do D1 de produção

Produção contém dados reais e históricos.

Nunca executar cegamente as migrations do rebuild contra o D1 remoto.

Migrations que reconstruam tabelas podem interagir perigosamente com FKs e
ON DELETE CASCADE.

PRAGMA defer_foreign_keys=ON não deve ser tratado como proteção contra
cascades causados por reconstrução/drop de tabelas.

O cutover de produção exige etapa própria:

backup/export do D1 de produção;
inspeção do schema remoto real;
inspeção do histórico real de migrations;
comparação produção × rebuild;
migration de compatibilidade/upgrade;
nenhuma limpeza destrutiva;
preservação dos pedidos históricos;
preservação dos fatos financeiros históricos;
verificação de que dados antigos continuam consultáveis;
análise de rollback;
somente depois autorização explícita para operação remota.

Rollback de código Cloudflare não equivale a rollback do D1.

Não acessar D1 remoto durante tarefas não relacionadas.

Dívidas deliberadas

As seguintes dívidas são conhecidas e não devem ser resolvidas silenciosamente
como efeito colateral:

A1 — idempotência;
overpayment;
refund → retorno de estoque;
cadeias exclusivamente FALHOU;
ciclo de vida de reserva em PARCIAL;
janela residual B4;
editor incremental de itens;
histórico/correções de itens;
evolução futura de comanda.
Comanda futura

Não existe necessidade comprovada de criar uma nova tabela comanda agora.

pedidos pode continuar representando a sessão/comanda enquanto isso for
compatível com o domínio.

Direção desejada no futuro:

pedido/comanda pode ser reaberto explicitamente;
PAGO significa que o total atual está coberto, não que a entidade morreu;
adicionar novos itens pode transformar PAGO -> PARCIAL;
novo pagamento pode retornar PARCIAL -> PAGO;
alterações devem preservar histórico;
não utilizar DELETE+INSERT destrutivo.

Exemplo conceitual:

total R$ 60;
recebido R$ 60;
PAGO;
adiciona R$ 15;
total R$ 75;
recebido R$ 60;
PARCIAL;
recebe R$ 15;
PAGO.

O editor futuro deve ser incremental.

Direção do editor incremental futuro

Requisitos prováveis:

preservar IDs dos itens;
preservar auditoria;
adição explícita;
remoção/correção explícita;
preservar allocations históricas;
ajustar reserva por diferença;
coordenar concorrência com pagamentos;
coordenar concorrência com estoque;
definir comportamento de itens parcialmente pagos;
preservar histórico de baixa física;
não falsificar fatos financeiros anteriores.

Não implementar isso durante a contenção B1.

Regras de trabalho para agentes

Antes de alterar backend/domínio:

leia README.md;
leia docs/ESTADO-ATUAL.md;
investigue o código atual;
investigue migrations relevantes;
confirme branch/HEAD/status;
não confie cegamente neste documento se o código atual o contradizer;
se houver divergência, reporte antes de alterar comportamento.

Para trabalhos críticos:

investigação → plano → aprovação → implementação → testes → revisão adversarial → commit

Não ampliar escopo silenciosamente.

Não enfraquecer testes apenas para fazer uma implementação passar.

Em lógica concorrente, testes precisam forçar interleavings relevantes usando
hooks, barreiras ou mecanismo determinístico equivalente.

Executar duas Promises sem controlar a ordem não constitui prova suficiente de
segurança concorrente.

Regras de Git e produção

Formato dos commits:

rp-doces: <mensagem>

Nunca adicionar:

Co-Authored-By

Não fazer push sem autorização explícita.

Não fazer deploy sem autorização explícita.

Não acessar ou alterar D1 remoto sem autorização explícita e revisão separada.

Não fazer merge do rebuild para main apenas porque os testes locais passaram.

Estado resumido
Resolvidos
B3 — convergência financeira
B2 — recuperação verificada de Pix expirado
B4 — segurança de reserva com múltiplos Pix
Atual
B1 — investigado
contenção definida
implementação pendente
Depois
implementar e revisar contenção B1;
A1 — idempotência;
revisão final focada do fluxo de primeira compra;
B5 — planejamento e execução segura do cutover do D1;
smoke tests de produção;
primeiro go-live.
