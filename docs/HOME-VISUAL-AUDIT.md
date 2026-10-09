<a id="on-demand-home-visual-audit"></a>

# Auditoria visual da Home sob demanda

Execute na raiz do repositório após instalar as dependências do projeto e o Chromium do Playwright:

```sh
npm run audit:home
npx playwright show-report playwright-report/home-visual-audit
```

A configuração existente do Playwright inicia o Vite local em `http://127.0.0.1:5173` ou reutiliza um servidor local. Esse comando força a origem local mesmo quando `BASE_URL` aponta para outro destino. Ele seleciona `@home-visual-audit`; o comando normal `npm run test:e2e` e a descoberta de testes do CI excluem essa spec. Não são necessárias alterações no workflow. `CHROME_PATH` continua disponível, mas use a mesma versão do Chromium fornecida pelo Playwright para comparações.

Execute `npm run typecheck:home-audit` para verificar a spec, as fixtures e a configuração do Playwright com TypeScript em modo estrito. Os typechecks normais de frontend/functions excluem esses arquivos, e o Playwright transpila sem checar tipos. A dependência de desenvolvimento `@types/node`, fixada em uma versão exata, fornece os tipos do Node e do Playwright; não adiciona dependência de runtime em produção.

<a id="coverage-and-evidence"></a>

## Cobertura e evidências

Os seis casos cobrem desktop (1440×900, mouse), tablet (820×900, touch) e mobile (390×844, emulação mobile/touch), nos temas claro e escuro, com fator de escala do dispositivo 1. Três casos adicionais verificam fontes ausentes, isolamento de requisições/navegações/WebSockets inesperados e rejeição de redirects com um servidor loopback descartável, cujo destino de redirect não pode receber nenhuma requisição.

Cada caso captura PNGs comuns do viewport em posições explícitas de `.homepage-content`, cobrindo Hero, Story, Process, galeria, Contact e footer. Seções mais altas recebem múltiplas posições. As posições de scroll solicitadas e reais são registradas; posições próximas ao final podem ser limitadas à mesma posição real. As imagens nunca são costuradas, e screenshots de locators nunca expandem o scroller fixo. O fade existente permanece visível.

O relatório HTML nativo do Playwright contém:

- Anexos PNG nomeados dos viewports para revisão humana.
- `reproduction`: HEAD do Git e estado da árvore de trabalho, viewport/perfil de entrada, tema, versões do Chromium e do Node, versão das fixtures e hashes dos assets, posições de scroll, medições e hashes SHA-256 dos PNGs.
- `network-ledger`: cada requisição HTTP e WebSocket interceptado, com seu tratamento, anexado também em caso de falha.
- Etapas separadas de execução e diagnóstico visual. Overflow, imagens quebradas ou pendentes, conteúdo não revelado e tema incorreto falham em assertions explícitas; requisições inesperadas e erros de JavaScript são falhas de execução.

Os artefatos ficam nos diretórios ignorados `test-results/home-visual-audit` e `playwright-report/home-visual-audit`. O relatório JSON nativo é `test-results/home-visual-audit/results.json`; os anexos de reprodução e rede estão disponíveis nele como corpos em base64. Cada execução substitui as evidências anteriores dessas pastas. Copie o relatório para outro diretório ignorado antes de executar novamente se quiser comparar hashes ou guardar evidências. Compartilhe apenas o relatório pretendido: o estado da árvore de trabalho inclui nomes de arquivos locais, embora não sejam coletadas credenciais nem conteúdos dos arquivos.

<a id="isolation-and-determinism"></a>

## Isolamento e determinismo

A fixture automática instala os interceptadores antes da navegação e bloqueia service workers. Só é permitida navegação à Home local; módulos existentes do Vite local e assets explicitamente listados são buscados sem seguir redirects e depois respondidos localmente. Respostas de redirect são abortadas porque redirects do navegador após `route.continue()` ignoram a interceptação. Catálogo/configuração/galeria são sintéticos; o POST de reconciliação de reservas da Home recebe uma resposta sintética de sucesso dentro do Playwright e nunca chega a um backend. Outras APIs, mutações, assets externos e rotas desconhecidas são abortados. Todos os WebSockets são fechados sem conectar a um servidor; apenas o socket HMR local esperado é classificado como simulado. Não são necessárias credenciais, banco remoto, serviços de pagamento nem disponibilidade de rede externa.

A requisição à folha de estilos de fontes do Google recebe uma resposta local com fontes licenciadas incluídas nas fixtures. As imagens da galeria reutilizam dois assets WebP versionados com registros determinísticos de produtos. Alterações de fixtures exigem atualizar `FIXTURE_VERSION` e revisar as evidências. Ao adicionar um asset ou API legítima, amplie deliberadamente a lista restrita de rotas; nunca a substitua por encaminhamento irrestrito.

A auditoria carrega fontes, decodifica imagens, percorre o scroller real para concluir os reveals e aguarda geometria estável em frames consecutivos de animação. Movimento reduzido, CSS injetado apenas no navegador de auditoria e animações SVG pausadas eliminam diferenças de screenshot dependentes do tempo. Arquivos de produção não são alterados. Não há esperas fixas, retries nem baselines de imagens de referência.

<a id="limits-and-existing-tests"></a>

## Limitações e testes existentes

Assertions aprovadas não aprovam layout, contraste nem estética: inspecione os anexos PNG. Renderização e hashes dos PNGs podem variar entre sistemas operacionais, navegadores e rasterizadores de fontes; compare primeiro execuções repetidas no mesmo ambiente. Dados sintéticos não cobrem todos os comprimentos de conteúdo nem proporções de imagens de produção. Emulação mobile não é um dispositivo Android físico.

Esta auditoria estática deliberadamente não mede fluidez de animações, displays físicos de 60/165 Hz, hardware touch nem serviços reais. As specs existentes `home-fade`, `home-legibility-anchors`, `home-menu-focus` e `theme-transition` continuam responsáveis pelas regressões de comportamento. O arquivo original `rp-doces-visual-audit.mjs` é preservado durante a revisão; o substituto não precisa do runner independente nem de `sharp`/composição de imagens longas.

A manutenção consiste em atualizações intencionais da lista de APIs/assets permitidos, fixtures sintéticas e revisão das evidências nativas do Playwright. A execução inclui seis casos visuais locais sequenciais e três controles negativos; informe a duração medida para o navegador e a máquina usados, sem presumir um tempo de CI.
