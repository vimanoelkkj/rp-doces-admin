<a id="dependency-and-install-script-security-audit"></a>

# Auditoria de segurança de dependências e scripts de instalação

Data: 2026-10-08. Branch: `fix/dependency-security`, baseada no `origin/staging`
atualizado em `37a81ab09bc2224c4c4267e864112aa6a8303a0e`.
Ambiente: Windows, Node 24.19.0, npm 11.17.0.

Não foram realizados commit, push, merge, deploy, operação remota de banco nem
mutação de recursos Cloudflare. O código da aplicação e as migrações estão
inalterados.

<a id="ci-compatibility-review"></a>

## Revisão de compatibilidade do CI

A revisão anterior ao commit altera os dois workflows, seu contrato de regressão
e este relatório. As resoluções de dependências, a exigência de versão do npm,
a configuração estrita do npm e as recusas de hooks por versão exata da auditoria
original são preservadas.

Todos os seis jobs que usam npm agora selecionam `node-version: ">=24.19.0 <25"`
com `actions/setup-node@v7`: checks, tests, e2e, deploy de produção, deploy de
staging e auditoria de dependências. A [documentação da v7](https://github.com/actions/setup-node/tree/v7#supported-version-syntax)
suporta intervalos SemVer. [Node 24.19.0](https://nodejs.org/en/blog/release/v24.19.0)
inclui npm 11.17.0; apenas `24` poderia selecionar uma versão anterior de Node 24
em cache, com um npm incapaz de garantir a política revisada de hooks. O runtime
Node 24 da própria action não seleciona a versão do Node do projeto.

Cada job relevante imprime `node --version` e `npm --version` e rejeita npm
anterior a 11.17.0 antes da instalação ou auditoria. A verificação de deploy
mantém a mesma condição de execução de setup/install, portanto deploys pulados
não verificam um Node do sistema não selecionado. Os dois filtros de caminhos da
auditoria de dependências agora incluem `.npmrc`; alterar a política de segurança
aciona a auditoria. Nenhuma etapa de instalação foi adicionada ao job que audita
apenas o lockfile, e seus limites de vulnerabilidade permanecem inalterados.
A etapa existente de Biome não bloqueante no CI também permanece inalterada.

Verificações locais de limites confirmaram que o intervalo Node exclui 24.18.0
e 25.0.0 e inclui 24.19.0 e 24.20.0. O guard real do npm rejeita 11.16.0 e aceita
11.17.0, 11.18.0 e 12.0.0. Os dois YAML de workflow passaram na interpretação do
Prettier, e os seis jobs npm foram verificados quanto à ordem de setup e validação.
A etapa exata de verificação também passou no Git Bash do Windows com o npm
instalado e rejeitou uma versão simulada 11.16.99; isso é evidência de shell,
não execução Linux.

<a id="validation-environment-and-unresolved-linux-evidence"></a>

### Ambiente de validação e evidências Linux pendentes

O ambiente disponível é Windows com Node 24.19.0/npm 11.17.0. O WSL informa que
o subsistema não está instalado; Docker e Podman estão indisponíveis. Nenhuma
distribuição Linux nem host de containers foi instalado. Consequentemente,
instalação limpa em Linux, execução de binários nativos Linux e execução hospedada
no GitHub Actions **continuam não verificadas**. Resultados Windows não devem ser
interpretados como resultados Ubuntu 24.04. Os workflows estão configurados para
Ubuntu 24.04, mas sua execução real continua uma lacuna de verificação anterior
ao commit/release.

Uma nova cópia descartável Windows, sem node_modules, passou em
`npm ci --foreground-scripts` com as duas configurações estritas habilitadas e
todos os hooks recusados. Não apareceu aviso de script de instalação nem saída de
execução de lifecycle; a inspeção somente leitura de hooks pendentes retornou uma
lista vazia. As duas versões de esbuild (0.21.5 e 0.28.2) executaram transformações,
e os dois binários workerd (2025-07-18 e 2026-10-06) executaram `--version`.
Essa cópia limpa também passou no build de produção e em 13 testes de cutover com
rotas reais/D1 descartável. Uma sondagem temporária inicial de binário tratou
incorretamente o objeto do módulo workerd como caminho de executável; usar seu
export default resolveu o erro da sondagem, e ambos os executáveis passaram na
checagem repetida.

<a id="regression-investigation-and-review-checks"></a>

### Investigação de regressão e verificações da revisão

A execução nativa completa inicial rodou 2600 testes em 116 arquivos: 2599 passaram
e um falhou. `staging-environment.test.mjs` congela a semântica completa do job de
produção por SHA-256, portanto o intervalo Node e a verificação de versão
solicitados invalidaram o snapshot antigo. Uma comparação semântica com HEAD
confirmou que remover apenas a nova etapa de verificação e restaurar a seleção
anterior do Node produz exatamente o job original de produção; comportamento de
deploy, secrets e critérios de aprovação são preservados.

O snapshot agora congela o job revisado. Novos casos de regressão verificam os seis
jobs npm, ordem de setup/verificação/instalação, condições correspondentes de deploy,
saída explícita de versões e os dois gatilhos `.npmrc`. Executam cada guard real
do npm com 11.16.99 (rejeitado), 11.17.0 e 12.0.0 (aceitos). O arquivo afetado passou
nos 49 testes após a correção. A execução completa final passou nos 2607 testes em
116 arquivos, com os seis shards retornando saída 0. Os logs reais de execução
foram verificados para garantir cobertura de cada arquivo de teste exatamente
uma vez. Nenhuma assertion nem controle negativo foi removido. Um achado
intermediário de estilo do Biome na nova assertion foi corrigido com template literal.

| Verificação da revisão                     | Resultado                                                                                          |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| Biome                                      | Passou: 474 arquivos, sem avisos, erros nem achados informativos                                   |
| Prettier                                   | Passou nos dois workflows, teste de regressão, package.json, package-lock.json e neste relatório   |
| Typecheck frontend/Functions               | Passou                                                                                             |
| Playwright                                 | Passou: 11 testes com Chrome instalado no Windows e CHROME_PATH restrito ao processo               |
| Build de produção                          | Passou no workspace e na cópia limpa Windows                                                       |
| Testes nativos                             | Passaram: 2607 testes em 116 arquivos; falha inicial e correção da regressão documentadas acima    |
| Cobertura dos shards                       | Passou: os 116 arquivos aparecem exatamente uma vez                                                |
| Instalação limpa e binários nativos        | Passaram no Windows com npm 11.17.0; sem aprovação de hooks nem avisos de scripts de instalação    |
| Instalação, binários, build e testes Linux | Bloqueados: nenhum ambiente de execução Linux disponível                                           |
| npm audit / auditoria de produção          | Ambos saem com 1: 8 pacotes afetados no total, 2 moderados em produção; inalterado nesta revisão   |
| npm audit signatures                       | Bloqueado: saída 1/E404 na atestação do registry; inconsistência de metadados/endpoint reproduzida |
| git diff --check                           | Passou                                                                                             |

Apenas o processo Playwright omitiu NO_COLOR para evitar seu conflito com
FORCE_COLOR; configurações permanentes de ambiente e assertions dos testes estão
inalteradas. Dois alertas operacionais WARNING esperados de PUSH_RETRY_EXHAUSTED
foram emitidos por cenários de falha injetada e permanecem visíveis. Não foram
observados avisos de future flags do React Router, root do React nem implementação
do JSDOM.

As auditorias completa e de produção foram repetidas, e ambas retornaram saída 1:
respectivamente, 8 pacotes afetados (4 altos, 4 moderados) e 2 pacotes moderados de
produção. Esses resultados permanecem iguais aos da baseline corrigida anterior.
Os achados de React Router, Vite/esbuild e Miniflare independente, a lacuna de
execução macOS/fsevents e a falha de atestação do registry descritos abaixo
continuam sem solução. Esta revisão de CI não aceita esses riscos nem migra versões major.

`npm audit signatures` também foi repetido e retornou saída 1/E404. Novas
requisições confirmaram que metadados de pacote HTTP 200 anunciam a URL de
atestação de whatwg-url@17.1.1, enquanto essa URL retorna HTTP 404. A verificação de
procedência continua bloqueada pela resposta do registry; nenhuma atestação nem
verificação de segurança foi desabilitada.

Os logs de validação da revisão estão armazenados em `%TEMP%/rp-doces-ci-compatibility/`.
A primeira verificação de formatação dos workflows apontou dois arquivos; o
Prettier corrigiu as aspas do intervalo e as terminações de linha, e a repetição
passou. O novo comportamento dos workflows falha deliberadamente cedo em versões
incompatíveis de npm; comportamento da aplicação, critérios de deploy e recursos
Cloudflare não foram alterados.

<a id="audit-comparison"></a>

## Comparação da auditoria

| Verificação                                            | Antes                                     | Depois                                                                          | Código de saída  |
| ------------------------------------------------------ | ----------------------------------------- | ------------------------------------------------------------------------------- | ---------------- |
| `npm audit --json`                                     | 11 pacotes afetados: 8 altos, 3 moderados | 8 pacotes afetados: 4 altos, 4 moderados                                        | 1 antes e depois |
| `npm audit --omit=dev --json`                          | 2 moderados, 0 altos/críticos             | 2 moderados, 0 altos/críticos                                                   | 1 antes e depois |
| Scripts de lifecycle instalados pendentes              | Quatro versões de pacotes instaladas      | Nenhum                                                                          | Inspeção passou  |
| `npm ci --foreground-scripts` após revisão da política | Não executado sem uma política            | Instalação limpa passou; sem avisos de scripts de instalação nem saída de hooks | 0                |

Essas contagens descrevem nós afetados na árvore de dependências, não avisos de
segurança distintos. Por exemplo, `react-router-dom` herda vulnerabilidades de
`react-router`. A severidade reportada do Miniflare muda de alta para moderada
depois que a instância vulnerável usada pelo Wrangler é substituída; a instância
restante de Miniflare 3 ainda depende de pacotes vulneráveis. Esta não é uma
auditoria de segurança sem pendências.

<a id="dependency-ownership-and-exposure"></a>

## Responsabilidade e exposição das dependências

| Caminho da dependência                                                         | Uso                                                                                                | Exposição no deploy                                                       |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `rp-doces -> react-router-dom@6.30.6 -> react-router@6.30.6`                   | Rotas de frontend em produção e testes de UI                                                       | Incluída na aplicação do navegador                                        |
| `rp-doces -> react / react-dom / motion`                                       | Renderização e animações do frontend                                                               | Incluída na aplicação do navegador                                        |
| `rp-doces -> @mmmike/web-push`                                                 | Criptografia Web Push do backend                                                                   | Incluída no bundle do backend; não afetada por esta auditoria             |
| `rp-doces -> vite@5.4.21 -> esbuild@0.21.5`                                    | Servidor de desenvolvimento, build; a API esbuild no nível superior também empacota rotas de teste | Ferramentas de build/teste; executável nativo não enviado ao navegador    |
| `rp-doces -> vite -> postcss -> source-map-js`                                 | Processamento de source maps CSS/build                                                             | Dependência de desenvolvimento/build                                      |
| `rp-doces -> jsdom -> css-tree -> source-map-js`                               | Testes de DOM/CSS                                                                                  | Apenas testes                                                             |
| `rp-doces -> miniflare@3.20250718.3 -> workerd@1.20250718.0`                   | D1 local descartável e testes de integração com rotas reais                                        | Harness de teste, não o runtime Cloudflare publicado                      |
| `rp-doces -> miniflare@3.20250718.3 -> undici@5.29.0 -> @fastify/busboy@2.1.1` | Tratamento HTTP/multipart no harness local                                                         | Desenvolvimento/testes                                                    |
| `rp-doces -> miniflare@3.20250718.3 -> ws@8.18.0`                              | WebSockets do harness local                                                                        | Desenvolvimento/testes                                                    |
| `rp-doces -> wrangler@4.149.0 -> esbuild@0.28.2`                               | Bundling de Functions/Worker, desenvolvimento local Pages e CLI de deploy                          | Executa em ferramentas locais/CI, incluindo jobs de deploy                |
| `rp-doces -> wrangler -> miniflare@5.20261006.1-alpha -> sharp@0.35.5`         | Emulação local Cloudflare e ferramentas de imagens                                                 | CLI/desenvolvimento local, não o código de upload de imagens da aplicação |
| `rp-doces -> wrangler / miniflare -> workerd@1.20261006.1`                     | Runtime local do Wrangler                                                                          | CLI/desenvolvimento local                                                 |
| `rp-doces -> vite / wrangler -> fsevents@2.3.3`                                | Monitoramento opcional de arquivos no macOS                                                        | Ferramentas de desenvolvimento; ausente das árvores reais Windows/Linux   |
| TypeScript, tipos Workers/React, Biome, Prettier, Playwright                   | Compilação, verificações e testes de navegador                                                     | Ferramentas de build/CI/teste                                             |

`dev: true` no lockfile não torna uma vulnerabilidade irrelevante: ferramentas de
build e deploy executam com privilégios locais ou de CI. A auditoria de
dependências de produção não abrange essas ferramentas.

<a id="production-vulnerabilities-and-migration-boundary"></a>

## Vulnerabilidades de produção e limite da migração

Os dois avisos afetam `react-router@6.30.6` pela dependência direta
`react-router-dom@6.30.6`. Ambos são corrigidos a partir de 7.18.0; a recomendação
observada do npm é `react-router-dom@7.18.4`. Não havia versão v6 corrigida
disponível no registry no momento desta auditoria.

- [GHSA-wrjc-x8rr-h8h6 / CVE-2026-53669](https://github.com/advisories/GHSA-wrjc-x8rr-h8h6): caminhos controlados por atacante com barras invertidas podem produzir navegação externa inesperada por Link ou useNavigate. As rotas atuais são constantes ou têm prefixos fixos. Destinos de notificações são construídos em `functions/lib/notificacoes.ts` e consumidos em `src/admin/notificacoes/AdminNotificacoes.tsx`; o fluxo inspecionado não expõe destinos arbitrários controlados por usuários. Isso limita a exposição atual, mas não corrige o pacote vulnerável.
- [GHSA-337j-9hxr-rhxg / CVE-2026-53666](https://github.com/advisories/GHSA-337j-9hxr-rhxg): seleção insegura de construtores a partir de hidratação de erros SSR influenciados por atacante. O aviso exclui Declarative Mode. `src/main.tsx` usa createRoot e `src/App.tsx` usa BrowserRouter; nenhum fluxo SSR/hidratação foi identificado. A dependência afetada, porém, continua instalada e reportada pelo npm.

A [aceitação de risco](dependency-risk-acceptance.md) anterior permanece histórica;
esta auditoria não cria nem renova aprovação para as vulnerabilidades restantes.

O [guia oficial de migração v6 para v7](https://reactrouter.com/7.18.4/upgrading/v6)
exige Node 20+, React 18+ e React DOM 18+, requisitos atendidos pelo projeto.
O staging atualizado já habilita as duas flags de Declarative Mode,
v7_startTransition e v7_relativeSplatPath, em BrowserRouter e nos harnesses
MemoryRouter inspecionados. As demais flags do guia dizem respeito a Data/Framework
Mode e não se aplicam à aplicação. Isso reduz o risco da migração em comparação
com o estado histórico, mas não constitui teste do pacote novo. Uma migração de
versão major ainda exige revisão explícita de:

- Agendamento de navegação por startTransition e fallback de carregamento
  lazy/Suspense, incluindo transições de checkout/pagamento e tempos das animações.
- Resolução relativa em splats de múltiplos segmentos. A rota existente `/admin/*`
  é um placeholder nulo, mas URLs administrativas profundas, links relativos,
  voltar/avançar e restauração de estado de rota devem ser verificados.
- Harnesses de UI que ainda declaram future flags v6, rotas públicas de token de
  pedido, redirects de autenticação, navegação por hash e por notificações.
- Imports e tipos do Router. As APIs declarativas têm caminho de compatibilidade;
  migrar para Framework Mode, SSR ou Data Mode é desnecessário para essa correção.

Nenhuma migração major do React Router nem alteração de future flag foi aplicada.
Os pacotes 7.18.4 publicados não têm hooks de lifecycle de instalação. Seu manifesto
adiciona cookie e set-cookie-parser em react-router, e as declarações inspecionadas
de BrowserRouter/MemoryRouter removem a prop future antiga. Uma alteração concreta
para a próxima etapa é fixar react-router-dom 7.18.4, regenerar o lockfile, remover
a prop obsoleta de BrowserRouter em App.tsx e alinhar os harnesses de UI sem alterar
assertions de rotas. Antes da adoção, essa etapa deve repetir validação de rotas,
checkout, acompanhamento de pedidos, redirects, animação e suíte completa.

<a id="compatible-dependency-corrections"></a>

## Correções compatíveis de dependências

- `source-map-js` 1.2.1 -> 1.2.2, dentro da exigência `^1.2.1` dos consumidores
  existentes. [GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q)
  abrange negação de serviço do event loop por offsets excessivos de source maps
  indexados. A biblioteca atualizada rejeita um offset de um bilhão de linhas e
  preserva entradas normais; um caso adicional dentro do limite permitido termina
  sem iterar por linhas-fonte ausentes.
- Wrangler 4.148.0 -> 4.149.0, mantendo a versão major existente. Suas
  [notas de release](https://github.com/cloudflare/workers-sdk/releases/tag/wrangler%404.149.0)
  incluem a correção da dependência sharp para 0.35.5. O Miniflare do Wrangler
  passa de `5.20261006.0-alpha` para `5.20261006.1-alpha`; seu esbuild passa de
  0.28.1 para 0.28.2. As duas versões workerd usadas pelo projeto permanecem
  inalteradas.
- sharp 0.35.4 -> 0.35.5 e seus artefatos de plataforma/libvips corrigem
  [GHSA-wq5f-xc86-pv6w](https://github.com/advisories/GHSA-wq5f-xc86-pv6w), uma
  vulnerabilidade de memória do librsvg que pode permitir RCE nas condições Linux
  afetadas. Essas dependências são do Wrangler, não da implementação de upload
  da aplicação em produção.

O diff do lockfile contém os artefatos nativos necessários para as plataformas
suportadas, não apenas os pacotes Windows. Não foram introduzidos override,
correção forçada de auditoria, remoção de dependência nem atualização não relacionada
de dependência raiz.

<a id="install-script-review-and-policy"></a>

## Revisão e política de scripts de instalação

A implementação instalada do npm 11.17.0 foi inspecionada em
`lib/utils/resolve-allow-scripts.js`, `strict-allow-scripts-preflight.js` e
`@npmcli/arborist/lib/arborist/rebuild.js`.

- Sem decisão explícita, scripts ainda executam nessa versão, e o npm emite um
  aviso informativo. Esse aviso não comprova bloqueio do script.
- Uma decisão false correspondente pula a execução do lifecycle. O modo estrito
  rejeita pacotes com scripts de instalação sem correspondência antes da
  materialização da árvore; uma versão futura fora da disjunção de versões exatas
  exige, portanto, nova revisão.
- A política de CLI/ambiente tem precedência; a política do package.json raiz
  precede a do npmrc. Instalações no escopo do projeto rejeitam a flag CLI
  `--allow-scripts`. Contextos globais/npx sob demanda têm resolução de política
  diferente; não se deve presumir que a política do projeto autoriza downloads
  arbitrários pelo npx.
- O comando de listagem revisado foi
  `npm approve-scripts --allow-scripts-pending --json`: nessa versão, o modo de
  pendências é somente leitura e não aprova, grava nem executa scripts.
- `npm install-scripts` não é um comando no npm 11.17.0 instalado; documentação
  online mais recente não deve substituir essa implementação instalada.

| Pacote/versão revisados              | Lifecycle e comportamento                                                                                                                                                                                                                                                                             | Decisão                                                              |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| esbuild 0.21.5                       | `node install.js`: seleciona pacote nativo opcional, verifica versão, pode reescrever wrappers/criar hardlink do executável e chamar npm ou baixar tarball de fallback. Também aceita ESBUILD_BINARY_PATH. Seu fallback de download direto não tem a proteção mais recente de integridade do binário. | Recusar o hook; manter binário opcional e execução normal da API/CLI |
| esbuild 0.28.1 antes / 0.28.2 depois | Mesmas responsabilidades gerais do instalador; a implementação 0.28.2 revisada verifica o conteúdo do binário baixado contra os dados de integridade publicados. O SHA-512 do tarball 0.28.2 baixado coincidiu com os metadados do registry.                                                          | Recusar 0.28.2; não abranger mais o 0.28.1 removido                  |
| workerd 1.20250718.0 e 1.20261006.1  | `node install.js`: resolve o binário Cloudflare opcional, valida sua versão, opcionalmente o otimiza e pode chamar npm ou baixar executável de fallback. Esses fallbacks podem executar código nativo com privilégios do instalador.                                                                  | Recusar ambos os hooks; manter os binários opcionais Cloudflare      |
| fsevents 2.3.3                       | O lockfile marca um script de instalação; o manifesto do registry declara node-gyp rebuild. O preflight estrito também examina essa entrada exclusiva de macOS no Windows. O tarball publicado já contém fsevents.node e o loader JS; não é necessária compilação para o artefato revisado.           | Recusar essa versão exata; execução macOS não validada localmente    |

As origens foram verificadas no registry npm, URLs resolved e integridades do
lockfile, e repositórios upstream de esbuild, Cloudflare workerd/workers-sdk e
fsevents. Tarballs relevantes foram baixados para inspeção com scripts
desabilitados **somente durante a obtenção dos artefatos**. O npm ci limpo real
executou com a política explícita de recusa, sem ignore-scripts, filtragem de logs
nem dangerously-allow-all-scripts. Nenhum script de lifecycle foi aprovado.

Uma instalação limpa isolada confirmou que as duas APIs esbuild, os dois binários
workerd, um build Vite completo e 13 testes de cutover com rotas reais/D1 funcionam
sem hooks postinstall. O novo npm ci do projeto passou com logs de scripts em
primeiro plano e sem saída de execução de hooks. Os pacotes nativos opcionais devem
continuar instalados; instalações que omitem dependências opcionais não são
suportadas por essas ferramentas e não são reparadas por fallback de download
irrestrito.

`.npmrc` habilita engine-strict e strict-allow-scripts. `package.json` exige npm

> =11.17.0 para impedir que um npm antigo ignore silenciosamente a política revisada.
> Há apenas decisões false por versão exata, sem aprovação por wildcard. Um preflight
> offline isolado com um pacote canário não revisado falhou com ESTRICTALLOWSCRIPTS
> antes de qualquer download de pacote ou execução de script.

Consequências: validação de versão durante instalação e otimização por hardlink
fora do Windows não são mais realizadas por esses hooks; a execução normal das
ferramentas ainda resolve os binários opcionais com versões correspondentes.
macOS/fsevents foi inspecionado, mas não executado. Novas versões de hooks falham
deliberadamente na instalação até serem revisadas. Clientes npm antigos falham
deliberadamente na exigência de engine.

<a id="remaining-development-vulnerabilities"></a>

## Vulnerabilidades de desenvolvimento restantes

- Vite 5.4.21: traversal de source maps otimizados,
  [exposição de NTLM](https://github.com/advisories/GHSA-v6wh-96g9-6wx3) pela integração
  com editor no Windows e
  [bypass da recusa de arquivos](https://github.com/advisories/GHSA-fx2h-pf6j-xcff) por
  caminhos alternativos no Windows. Vite 6.4.3 é a linha major corrigida mais próxima
  para os avisos observados, em vez de saltar sem análise para Vite 8.3.4 proposto
  pelo npm. Também depende de esbuild ^0.25.0, além da constraint ^0.21.3 do Vite 5.
  O plugin React do projeto suporta Vite 6, e Node 24 atende sua engine. A migração
  ainda exige revisar o guia de migração Vite 6 e validar CSS/PostCSS, otimização de
  dependências, middleware de desenvolvimento, chunks de saída e comportamento no
  navegador. O [guia de migração Vite 6](https://v6.vite.dev/guide/migration.html) foi
  comparado com o vite.config.ts mínimo, apenas React: não há resolver personalizado,
  configuração SSR, modo de biblioteca, dependência Sass nem configuração PostCSS
  separada. Mudanças nos padrões JSON e bundling CommonJS ainda exigem verificações
  de regressão da saída e do navegador antes de aplicar a versão major.
- esbuild 0.21.5 sob Vite:
  [GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99), corrigido em
  0.25.0, afeta o CORS permissivo da API serve do esbuild. Os testes inspecionados
  usam build/transform, não serve; isso não corrige o pacote nem justifica ocultar
  o resultado da auditoria.
- Miniflare 3 independente permanece com undici ^5.28.5 e exatamente ws 8.18.0.
  undici 6.28.1, busboy 3.2.2 e ws 8.21.0 excedem as constraints suportadas pelos
  pacotes pais. Nenhum override foi adicionado só para aprovar a auditoria. A
  recomendação do npm substitui o pacote pai por Miniflare 5 alpha, uma migração
  major do harness que exige validar API/opções, compatibilidade workerd,
  encerramento de recursos e integridade/concorrência do D1 descartável. Não deve
  ser tratada como atualização incidental de pacote. As declarações v5
  inspecionadas mantêm cf e d1Databases, mas não declaram mais a opção d1Persist
  usada nos dois helpers de fixtures existentes. A versão v4 mais recente
  observada, 4.20260730.0, ainda fixa sharp 0.35.2, portanto essa major mais próxima
  não resolve todo o problema de dependências observado.

O inventário completo de avisos abaixo inclui achados herdados de pacotes. Esses
achados restantes não estão resolvidos nem foram aceitos novamente. A inspeção
não identificou esses pacotes de desenvolvimento no código publicado da aplicação;
sua exposição local/CI continua relevante.

<a id="original-dependency-audit-validation"></a>

## Validação original da auditoria de dependências

- Biome: passou sem avisos nem erros.
- Prettier: JSON alterados e este relatório verificados; valores npmrc validados
  com npm config, em vez de um parser Prettier não suportado.
- Typechecks frontend e Functions: passaram.
- Build de produção: passou sem avisos.
- Playwright: 11 testes passaram com o Chrome instalado via CHROME_PATH. NO_COLOR
  foi removido apenas desse processo para evitar conflito com FORCE_COLOR do
  Playwright; nenhuma configuração permanente de ambiente foi alterada.
- Suíte nativa completa: 2600 testes em 116 arquivos passaram, com 0 falhas.
- Logs de testes: não foram observados avisos de future flags do React Router,
  root do React nem implementação do JSDOM. Nenhuma alteração de future flag da
  aplicação nem de console foi feita nessa branch. Logs operacionais esperados
  de cenários de falha injetada são preservados.
- Cobertura de seis shards: os 116 arquivos de teste aparecem exatamente uma vez.
- Regressão do exploit de source map e entrada normal: passaram.
- Política estrita de instalação: instalação limpa passou; canário não revisado
  rejeitado; lista de scripts instalados pendentes vazia. Um canário adicional de
  versão exata rejeitou esbuild 0.28.3 simulado, e uma exigência incompatível de
  engine npm foi rejeitada com EBADENGINE.
- git diff --check: passou.
- npm audit completo e de produção: saída 1 com os achados restantes acima.
- npm audit signatures: **bloqueado**, saída 1. Metadados do registry anunciam
  `https://registry.npmjs.org/-/npm/v1/attestations/whatwg-url@17.1.1`, mas uma
  requisição direta retorna HTTP 404, enquanto metadados de pacote retornam
  HTTP 200. Essa dependência preexistente do JSDOM não foi alterada. A verificação
  completa de procedência está incompleta; nenhuma configuração de verificação
  ou atestação foi desabilitada.

Snapshots brutos da auditoria antes/depois, inspeção de scripts, instalações
isoladas, evidências de respostas do registry e logs de validação estão em
`%TEMP%/rp-doces-dependency-security/` nesta sessão. Nenhum secret foi copiado
para este relatório.

<a id="files-changed"></a>

## Arquivos alterados

| Arquivo                                        | Finalidade                                                                                                                       |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| package.json                                   | Elevar o mínimo compatível do Wrangler; exigir npm com suporte à política; registrar recusas de hooks revisados por versão exata |
| package-lock.json                              | Resolver source-map-js e os artefatos transitivos/nativos corrigidos do Wrangler                                                 |
| .npmrc                                         | Garantir compatibilidade de engine e falhar de forma fechada em scripts de lifecycle não revisados                               |
| .github/workflows/ci.yml                       | Selecionar Node/npm compatíveis com a política em todo job npm e verificar versões antes da instalação                           |
| .github/workflows/dependency-audit.yml         | Selecionar e verificar Node/npm compatíveis; acionar auditoria quando .npmrc muda                                                |
| tests/staging-environment.test.mjs             | Congelar o job de produção revisado; testar rejeição do npm mínimo e verificar todos os jobs npm e gatilhos da política          |
| docs/architecture/dependency-security-audit.md | Registrar achados, decisões, limites de compatibilidade, validação e riscos não resolvidos                                       |

<a id="complete-npm-finding-inventory"></a>

## Inventário completo de achados do npm

| Pacote           | Versões / severidade antes              | Versões / severidade depois | Caminhos afetados na baseline                                        |
| ---------------- | --------------------------------------- | --------------------------- | -------------------------------------------------------------------- |
| @fastify/busboy  | 2.1.1 / alta                            | 2.1.1 / alta                | node_modules/@fastify/busboy                                         |
| esbuild          | 0.21.5 / moderada                       | 0.21.5 / moderada           | node_modules/esbuild                                                 |
| miniflare        | 3.20250718.3, 5.20261006.0-alpha / alta | 3.20250718.3 / moderada     | node_modules/miniflare; node_modules/wrangler/node_modules/miniflare |
| react-router     | 6.30.6 / moderada                       | 6.30.6 / moderada           | node_modules/react-router                                            |
| react-router-dom | 6.30.6 / moderada                       | 6.30.6 / moderada           | node_modules/react-router-dom                                        |
| sharp            | 0.35.4 / alta                           | Achado removido             | node_modules/sharp                                                   |
| source-map-js    | 1.2.1 / alta                            | Achado removido             | node_modules/source-map-js                                           |
| undici           | 5.29.0 / alta                           | 5.29.0 / alta               | node_modules/undici                                                  |
| vite             | 5.4.21 / alta                           | 5.4.21 / alta               | node_modules/vite                                                    |
| wrangler         | 4.148.0 / alta                          | Achado removido             | node_modules/wrangler                                                |
| ws               | 8.18.0 / alta                           | 8.18.0 / alta               | node_modules/ws                                                      |

Os títulos oficiais dos avisos de segurança de terceiros foram preservados em inglês para identificação inequívoca.

| Aviso de segurança / causa raiz                                                                                                                                                           | Pacote afetado e intervalo observado | Versão corrigida              | Estado        |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ----------------------------- | ------------- |
| [@fastify/busboy vulnerable to Denial of Service via prototype-named multipart part header](https://github.com/advisories/GHSA-x8mw-p69m-v3mx)                                            | @fastify/busboy: >=1.0.0 <3.2.1      | 3.2.1                         | Não resolvido |
| [@fastify/busboy vulnerable to CRLF injection via multipart Content-Disposition filename and name](https://github.com/advisories/GHSA-gxm5-99cw-xjw9)                                     | @fastify/busboy: <3.2.2              | 3.2.2                         | Não resolvido |
| [esbuild enables any website to send any requests to the development server and read the response](https://github.com/advisories/GHSA-67mh-4wv8-2f99)                                     | esbuild: <=0.24.2                    | 0.25.0                        | Não resolvido |
| [React Router: Open redirect via backslash in <Link> and useNavigate (CVE-2025-68470 bypass)](https://github.com/advisories/GHSA-wrjc-x8rr-h8h6)                                          | react-router: >=6.0.0 <7.18.0        | 7.18.0                        | Não resolvido |
| [React Router: Arbitrary Constructor Injection via deserializeErrors() in React Router SSR Hydration](https://github.com/advisories/GHSA-337j-9hxr-rhxg)                                  | react-router: >=6.4.0 <7.18.0        | 7.18.0                        | Não resolvido |
| [sharp : Vulnerability in librsvg dependency CVE-2026-96889](https://github.com/advisories/GHSA-wq5f-xc86-pv6w)                                                                           | sharp: <0.35.5                       | 0.35.5                        | Corrigido     |
| [source-map-js allows event-loop denial of service through indexed source-map section offsets](https://github.com/advisories/GHSA-68fv-2mgg-jv7q)                                         | source-map-js: >=1.0.0 <1.2.2        | 1.2.2                         | Corrigido     |
| [Undici has an unbounded decompression chain in HTTP responses on Node.js Fetch API via Content-Encoding leads to resource exhaustion](https://github.com/advisories/GHSA-g9mf-h72j-4rw9) | undici: <6.23.0                      | 6.23.0                        | Não resolvido |
| [Undici has an HTTP Request/Response Smuggling issue](https://github.com/advisories/GHSA-2mjp-6q6p-2qxm)                                                                                  | undici: <6.24.0                      | 6.24.0                        | Não resolvido |
| [Undici has Unbounded Memory Consumption in WebSocket permessage-deflate Decompression](https://github.com/advisories/GHSA-vrm6-8vpv-qv8q)                                                | undici: <6.24.0                      | 6.24.0                        | Não resolvido |
| [Undici has Unhandled Exception in WebSocket Client Due to Invalid server_max_window_bits Validation](https://github.com/advisories/GHSA-v9p9-hfj2-hcw8)                                  | undici: <6.24.0                      | 6.24.0                        | Não resolvido |
| [Undici has CRLF Injection in undici via `upgrade` option](https://github.com/advisories/GHSA-4992-7rv2-5pvq)                                                                             | undici: <6.24.0                      | 6.24.0                        | Não resolvido |
| [undici vulnerable to HTTP header injection via Set-Cookie percent-decoding](https://github.com/advisories/GHSA-p88m-4jfj-68fv)                                                           | undici: <6.27.0                      | 6.27.0                        | Não resolvido |
| [undici WebSocket client vulnerable to denial of service via fragment count bypass](https://github.com/advisories/GHSA-vxpw-j846-p89q)                                                    | undici: <6.27.0                      | 6.27.0                        | Não resolvido |
| [undici vulnerable to Set-Cookie SameSite attribute downgrade via permissive substring matching](https://github.com/advisories/GHSA-g8m3-5g58-fq7m)                                       | undici: <6.27.0                      | 6.27.0                        | Não resolvido |
| [undici vulnerable to downstream response desynchronization via retry interceptor](https://github.com/advisories/GHSA-8xcm-r25x-g524)                                                     | undici: <6.28.0                      | 6.28.0                        | Não resolvido |
| [undici vulnerable to CRLF Injection via blob-like body 'type' property](https://github.com/advisories/GHSA-m8rv-5g2x-5cg5)                                                               | undici: <6.28.0                      | 6.28.0                        | Não resolvido |
| [undici vulnerable to cookie attribute injection via unsanitized domain and unparsed setCookie fields](https://github.com/advisories/GHSA-v3r7-h72x-cjcm)                                 | undici: <6.28.0                      | 6.28.0                        | Não resolvido |
| [undici vulnerable to HTTP response queue poisoning via keep-alive socket reuse](https://github.com/advisories/GHSA-35p6-xmwp-9g52)                                                       | undici: <6.27.0                      | 6.27.0                        | Não resolvido |
| [undici vulnerable to downstream response splitting via retry interceptor](https://github.com/advisories/GHSA-r53p-7pc4-xj5r)                                                             | undici: <6.28.1                      | 6.28.1                        | Não resolvido |
| [Vite Vulnerable to Path Traversal in Optimized Deps `.map` Handling](https://github.com/advisories/GHSA-4w7w-66w2-5vf9)                                                                  | vite: <=6.4.1                        | 6.4.2 (também 7.3.2 / 8.0.5)  | Não resolvido |
| [launch-editor: NTLMv2 hash disclosure via UNC path handling on Windows](https://github.com/advisories/GHSA-v6wh-96g9-6wx3)                                                               | vite: <=6.4.2                        | 6.4.3 (também 7.3.5 / 8.0.16) | Não resolvido |
| [vite: `server.fs.deny` bypass on Windows alternate paths](https://github.com/advisories/GHSA-fx2h-pf6j-xcff)                                                                             | vite: <=6.4.2                        | 6.4.3 (também 7.3.5 / 8.0.16) | Não resolvido |
| [ws: Uninitialized memory disclosure](https://github.com/advisories/GHSA-58qx-3vcg-4xpx)                                                                                                  | ws: >=8.0.0 <8.20.1                  | 8.20.1                        | Não resolvido |
| [ws: Memory exhaustion DoS from tiny fragments and data chunks](https://github.com/advisories/GHSA-96hv-2xvq-fx4p)                                                                        | ws: >=8.0.0 <8.21.0                  | 8.21.0                        | Não resolvido |
