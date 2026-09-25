# R&P Doces — Manual de Engenharia e Documentação Técnica Oficial

> **Fonte Única de Verdade:** Este `README.md` é a documentação técnica oficial, definitiva e viva da plataforma R&P Doces (storefront de e-commerce e painel administrativo). Em caso de qualquer divergência pontual entre textos legados, anotações de conversas ou comentários em arquivos antigos, as implementações de código, os schemas e as migrations do `HEAD` atual prevalecem de forma autoritativa.

---

## 1. Visão Geral e Objetivos do Projeto

A **R&P Doces** é uma confeitaria artesanal com operação híbrida: e-commerce público voltado para clientes finais e painel de retaguarda (PDV/ERP) voltado para operação interna no balcão e gestão do negócio.

### Objetivos Centrais da Plataforma
1. **Atendimento Público Sem Atrito:** Catálogo em tempo real com controle rigoroso de disponibilidade física, sacola persistida no cliente, checkout Pix dinâmico e acompanhamento transparente do pedido sem necessidade de cadastro burocrático inicial.
2. **Operação de Balcão e Comandas em Tempo Real:** Criação imediata de pedidos balcão com geração de cobrança Pix na maquininha/tela, pagamentos múltiplos (dinheiro, cartão, Pix externo), cancelamento com devolução atômica de itens e controle auditável de anulações.
3. **Integridade Financeira e Contábil:** Eliminação de reconciliações manuais por meio de um ledger contábil em partidas dobradas, preservação imutável de fatos financeiros, idempotência estrita em todas as operações de escrita (`operationKey`) e concorrência resolvida via constraints no banco relacional.
4. **Reserva Física Confiável (Anti-Overselling):** Estoque livre calculado dinamicamente, reserva em duas fases (local + prazo do gateway) e conversão em baixa física somente no momento da confirmação financeira.
5. **Aparência e Identidade Visual Únicas:** Design editorial acolhedor para a confeitaria, com animações suaves de onda, máscaras de gradiente na rolagem, tema escuro nativo (*warm dark chocolate*) e componentes unificados entre a loja e o painel de administração.

---

## 2. Princípios de Engenharia e Regras de Ouro

1. **O Figma/CSS Manda no Pixel, o Backend Manda nos Dados:**
   - A interface do usuário obedece rigorosamente às diretrizes visuais e semânticas definidas nos arquivos CSS e no design system da confeitaria.
   - Nenhuma tela cliente possui autoridade para inventar estados financeiros, forçar baixas de estoque ou decretar expiração de cobranças. O backend Cloudflare D1 é a autoridade máxima de domínio.
2. **Modularização por Domínio e Fachadas Públicas Estritas:**
   - A inteligência de negócio é segregada em subsistemas coesos (`functions/lib/ledger/`, `functions/lib/pix/`, `functions/lib/paymentSync/`, `functions/lib/adminPedidos/`).
   - Cada subsistema expõe seu contrato exclusivamente através de uma **fachada pública** (`comandaLedger.ts`, `comandaPix.ts`, `paymentSync.ts`).
   - Consumidores externos (rotas HTTP, testes, scripts) **nunca** importam arquivos internos de um subsistema diretamente, impedindo dependências circulares ocultas e blindando a arquitetura.
3. **Fatos Financeiros Imutáveis no Ledger:**
   - Pagamentos confirmados nunca são alterados para representar estornos; estornos são gravados como fatos adicionais em `pedido_reembolsos`.
   - O saldo e a situação de um pedido são calculados como uma **projeção líquida** (`bruto - reembolsos`) diretamente em SQL transacional atômico.
4. **Idempotência de Ponta a Ponta (A1):**
   - Nenhuma escrita financeira ou mutação operacional de pedido é executada sem uma `operationKey` gerada pelo cliente antes do envio.
   - Retries de rede, telas remontadas, quedas de conexão ou recarregamentos de página reaproveitam a mesma chave e retornam o mesmo resultado original, sem duplicar cobranças, pedidos ou baixas físicas.
5. **Zero Migrations Destrutivas:**
   - Migrations do banco relacional D1 são puramente aditivas e sequenciais (`migrations/0001_*.sql` a `migrations/0030_*.sql`). Nunca se aplica `DROP TABLE` em entidades que sustentam histórico em produção.

---

## 3. Stack Tecnológica Oficial

A stack da plataforma foi estritamente verificada contra as dependências do código real:

### Frontend
- **React 18:** Biblioteca base para a Single Page Application (`react@18.3.1`, `react-dom@18.3.1`).
- **TypeScript 5:** Tipagem estática em toda a camada cliente (`typescript@5.5.3`).
- **Vite 5:** Bundler de alta performance e servidor de desenvolvimento local (`vite@5.4.0`, `@vitejs/plugin-react@4.3.1`).
- **React Router DOM v6:** Roteamento declarativo com suporte a rotas aninhadas e resoluções contextuais (`react-router-dom@6.26.0`).
- **Motion (Framer Motion 13):** Animações fluidas de caminhos SVG para as ondas orgânicas da casca e transições de página (`motion@13.4.3`).
- **CSS Nativo Modular:** Variáveis CSS semânticas (`:root`, `[data-theme="dark"]`, `[data-admin-theme="dark"]`), grid e flexbox modernos. **Não** utiliza TailwindCSS, Bootstrap ou bibliotecas de componentes externas como Material UI/Chakra.
- **PWA (Progressive Web App):** Service Worker dedicado para o painel admin (`public/sw-admin.js`, `public/admin-manifest.webmanifest`, `public/admin-offline.html`).

### Backend (Serverless Edge)
- **Cloudflare Pages Functions:** Endpoints HTTP serverless executados no edge global da Cloudflare (`functions/api/**`).
- **TypeScript nativo no backend:** Tipagem de contextos e bindings via `@cloudflare/workers-types@4.20260702.1`.
- **Cloudflare D1 (SQLite Engine):** Banco de dados relacional distribuído, com suporte a transações atômicas com `db.batch()` e constraints nativas de integridade.
- **Cloudflare R2 Storage:** Armazenamento de objetos S3-compatível para fotos de produtos enviadas pelo lojista, servidas através de streaming autenticado em `functions/api/images/[key].ts`.
- **Wrangler 3:** CLI oficial da Cloudflare para execução de migrações, bindings locais e simulação de ambiente (`wrangler@3.78.0`).

### Gateway de Pagamento
- **Mercado Pago Payments API:** Utiliza exclusivamente o endpoint de pagamentos diretos (`/v1/payments`) com Pix dinâmico, verificação criptográfica de Webhooks via HMAC-SHA256 e polling síncrono. Deliberadamente **não** utiliza a Orders API legada.

### Notificações
- **Web Push Protocol:** Notificações push push-to-device usando chaves VAPID geradas e criptografia AES-GCM via `@mmmike/web-push@1.3.0`.

### Infraestrutura de Testes
- **Node.js Native Test Runner:** Execução direta com `node --test` através de scripts orquestradores em JavaScript ES Modules (`scripts/run-tests.mjs`).
- **JSDOM:** Simulação de árvore DOM para componentes React com listeners e portais (`jsdom@30.1.0`).
- **Miniflare & esbuild:** Subida de D1 e bindings locais descartáveis em memória durante testes de concorrência e idempotência.

---

## 4. Arquitetura Geral do Sistema

O sistema é construído como uma aplicação unificada que compartilha infraestrutura, tipos de domínio e componentes visuais entre o storefront público e a retaguarda administrativa:

```text
┌────────────────────────────────────────────────────────────────────────┐
│                        R&P DOCES ECOSYSTEM                             │
├───────────────────────────────────┬────────────────────────────────────┤
│         STOREFRONT (Público)      │         ADMIN DASHBOARD (Privado)  │
│  - Home, Cardápio, Sacola         │  - Painel de Gestão & Indicadores  │
│  - Checkout Pix & Polling         │  - Comandas Balcão, Pix Maquininha │
│  - Acompanhamento de Pedido       │  - Gestão de Catálogo, Despesas    │
├───────────────────────────────────┴────────────────────────────────────┤
│                       UNIFIED APPLICATION SHELL                        │
│  - Header Único com Navegação Contextual (`Header.tsx`)                │
│  - StorefrontFrame com Onda Orgânica SVG e Fade via `mask-image`       │
│  - StoreThemeContext (Sincronização `data-theme` / `data-admin-theme`) │
├────────────────────────────────────────────────────────────────────────┤
│                   CLOUDFLARE PAGES FUNCTIONS (API)                     │
│  - Storefront API: /api/checkout, /api/produtos, /api/pedido, etc.     │
│  - Admin API: /api/admin/pedidos, /api/admin/produtos, etc.            │
│  - Gateway Webhooks: /api/webhooks/mercadopago (HMAC SHA-256)          │
├────────────────────────────────────────────────────────────────────────┤
│                     CORE DOMAIN SUBSYSTEMS (lib/)                      │
│  - ledger/ (Razão contábil, waterfall, projeção líquida)               │
│  - pix/ (Cobrança Pix admin, regeneração, substituições)               │
│  - paymentSync/ (Convergência com PSP, sweeps, resgate incerto B3)     │
│  - adminPedidos/ (Comandas balcão, validações, concorrência A1)        │
│  - stock.ts (Reservas físicas, conversão em baixa, devoluções)         │
├────────────────────────────────────────────────────────────────────────┤
│                           STORAGE & STORAGE                            │
│  - Cloudflare D1 (SQLite com 30 Migrations Atômicas)                   │
│  - Cloudflare R2 (Buckets de Imagens de Alta Resolução)                │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 5. Estrutura de Diretórios e Mapa de Entrypoints

```text
rp-doces/
├── public/                       # Arquivos estáticos servidos diretamente
│   ├── _headers                  # Configurações de segurança e cache HTTP
│   ├── _redirects                # Regras de SPA fallback para o Cloudflare Pages
│   ├── favicon.svg               # Identidade visual da confeitaria
│   ├── admin-manifest.webmanifest# Manifesto PWA do painel administrativo
│   ├── admin-offline.html        # Página de fallback offline do Service Worker
│   ├── sw-admin.js               # Service worker do painel admin
│   ├── icons/                    # Ícones de aplicação (Apple Touch, PWA badges)
│   └── images/                   # Fotografias em formato WebP otimizado
│
├── src/                          # Código-fonte da aplicação React
│   ├── main.tsx                  # Ponto de entrada do bootstrap da UI
│   ├── App.tsx                   # Roteamento central e divisão Storefront/Admin
│   ├── global.css                # Tokens de design, fontes e estilos globais
│   │
│   ├── components/               # Componentes compartilhados
│   │   ├── Header.tsx            # Header global unificado
│   │   ├── Header.css            # Estilos do Header e do Drawer Mobile
│   │   ├── StorefrontFrame.tsx   # Casca unificada com onda animada e mask-image
│   │   ├── StorefrontFrame.css   # Regras de layout, scroll container e gradiente
│   │   └── PageTransition.tsx    # Transições de rota animadas
│   │
│   ├── context/                  # Contextos globais do React
│   │   ├── StoreThemeContext.tsx # Sincronizador autoritativo de temas claro/escuro
│   │   └── CartContext.tsx       # Gerenciador da sacola com persistência local
│   │
│   ├── pages/                    # Páginas públicas do Storefront
│   │   ├── Homepage.tsx          # Página inicial institucional
│   │   ├── Cardapio.tsx          # Vitrine de produtos com filtros e busca
│   │   ├── Checkout.tsx          # Revisão de itens e submissão do pedido
│   │   ├── AguardandoPagamento.tsx# Tela de QR Code Pix e polling dinâmico
│   │   ├── PedidoConfirmado.tsx  # Tela de sucesso com timeline de preparo
│   │   ├── PagamentoNaoAprovado.tsx# Tela de recusa ou expiração de pagamento
│   │   ├── AcompanharPedido.tsx  # Consulta pública de status via token
│   │   ├── PreparandoPedido.tsx  # Tela cheia de carregamento e montagem
│   │   ├── GerandoPagamento.tsx  # Tela cheia de comunicação inicial com gateway
│   │   └── ProcessandoPagamento.tsx# Tela cheia de transição pós-pagamento
│   │
│   └── admin/                    # Módulo do Painel Administrativo
│       ├── components/           # Componentes e casca administrativa
│       │   ├── AdminLayout.tsx   # Casca do admin com StorefrontFrame e auth
│       │   ├── AdminWave.tsx     # Onda estática para a tela de login
│       │   ├── AdminSidebar.css  # Regras legadas e estilos estruturais
│       │   ├── PortalDropdown.tsx# Dropdown flutuante portado fora de modais
│       │   └── useAdminModal.ts  # Hook com scroll lock e detecção de backdrop
│       ├── auth/                 # Contexto de autenticação administrativa
│       ├── theme/                # AdminThemeContext (pass-through para StoreTheme)
│       ├── notificacoes/         # Central de notificações internas e unread badge
│       ├── pwa/                  # Registrador do Service Worker PWA
│       ├── Dashboard/            # Indicadores operacionais, KPIs e caixa do dia
│       ├── Produtos/             # Catálogo, upload R2 e modal de criação/edição
│       ├── Pedidos/              # Listagem de comandas e orquestrador PedidoDetalhe
│       ├── Despesas/             # Livro de saídas e gestão de custos
│       ├── Loja/                 # Configurações de horário, taxa e WhatsApp
│       └── Administradores/      # Gestão de credenciais da equipe
│
├── functions/                    # Cloudflare Pages Functions (Edge Backend)
│   ├── api/                      # Endpoints HTTP da API
│   │   ├── _middleware.ts        # Interceptor de segurança das rotas /api/admin/*
│   │   ├── checkout.ts           # Criação pública de pedido e reserva de estoque
│   │   ├── produtos.ts           # Catálogo público enriquecido com estoque livre
│   │   ├── pedido.ts             # Consulta pública de pedido por token
│   │   ├── pedido-status.ts      # Polling leve para clientes aguardando Pix
│   │   ├── webhooks/             # Receptor de eventos do Mercado Pago
│   │   └── admin/                # Endpoints de retaguarda protegidos por sessão
│   │
│   └── lib/                      # Lógica de negócio e subsistemas de domínio
│       ├── comandaLedger.ts      # Fachada pública do subsistema contábil
│       ├── ledger/               # Módulos internos do motor contábil
│       ├── comandaPix.ts         # Fachada pública do subsistema Pix admin
│       ├── pix/                  # Módulos internos de geração/regeneração Pix
│       ├── paymentSync.ts        # Fachada pública da sincronização com PSP
│       ├── paymentSync/          # Módulos internos de webhooks, sweeps e resgate
│       ├── adminPedidos/         # Módulos internos da orquestração de comandas
│       ├── stock.ts              # Regras físicas de estoque e reservas
│       ├── pedidoReconcile.ts    # Ponte entre fatos financeiros e baixa física
│       └── webPush.ts            # Despacho de notificações Web Push VAPID
│
├── migrations/                   # Migrations sequenciais do Cloudflare D1
│   ├── 0001_products.sql         # Criação de produtos e constraint de reserva
│   └── ... (0002 a 0030)         # Evolução aditiva do schema
│
├── seed/                         # Dados de inicialização para testes locais
│   └── products.sql              # Catálogo semente de desenvolvimento
│
├── scripts/                      # Utilitários de execução e orquestração
│   ├── run-tests.mjs             # Test runner que executa testes sequencialmente
│   └── run-tests-cached.mjs      # Test runner com hash de cache de dependências
│
└── tests/                        # Bateria de testes automatizados com node:test
    ├── helpers/                  # Subida de D1 simulado e fixtures Miniflare
    └── *.test.mjs                # 50 suítes completas de testes de domínio e UI
```

---

## 6. Storefront (E-commerce Público)

O storefront da R&P Doces foi projetado para oferecer uma experiência de compra leve, bonita e direta:

- **Homepage (`/`):** Apresentação visual da confeitaria com seção hero, história, diferenciais, destaques do cardápio, depoimentos e rodapé institucional.
- **Cardápio (`/cardapio`):** Listagem de produtos filtrável por categorias com busca em tempo real. Itens com estoque esgotado são exibidos com selo explicativo e botão de compra desabilitado. O catálogo só consome e exibe a quantidade **disponível para venda** (`estoque - estoque_reservado`).
- **Carrinho e Sacola:** Gerenciados pelo `CartContext` com persistência automática em `localStorage`. Mudanças dinâmicas de catálogo ajustam automaticamente quantidades excedentes no carrinho para impedir que o cliente tente finalizar itens que acabaram de esgotar.
- **Checkout (`/checkout`):** Validação de itens, dados do comprador (nome, WhatsApp, recado para embalagem), cálculo de taxa de entrega e envio com emissão de `operationKey` única.
- **Acompanhamento (`/pedido/:token`):** Acesso aberto via `token_publico` aleatório único gerado no momento do pedido. Mostra o status em tempo real (`NOVO`, `PREPARANDO`, `PRONTO`, `ENTREGUE`), lista de itens e situação financeira, sem exigir autenticação.

---

## 7. Header Global e Shell Unificado da Aplicação

Anteriormente, o sistema contava com headers divergentes entre a loja e o painel de administração. O repositório foi padronizado em torno de uma **fonte única de verdade**:

### Componente `Header.tsx`
- **Componente Único:** Atende **100% das páginas** do projeto que possuem cabeçalho.
- **Detecção Contextual:** A prop `variant="storefront" | "admin"` define o conjunto de navegação. Caso omitida, o Header inspeciona automaticamente `location.pathname` (rotas que começam com `/admin` ativam a variante administrativa).
- **Navegação do Storefront:** Links de navegação para âncoras da página inicial (`#cardapio`, `#sobre`, `#onde-estamos`, `#contato`) com rolagem suave inter-rotas (se clicado a partir de outra página, navega para a Home antes de rolar suavemente). Exibe também a contagem da sacola e o seletor de tema.
- **Navegação do Admin:** Links operacionais (*Dashboard*, *Produtos*, *Pedidos*, *Despesas*, *Loja*, *Administradores*, *Notificações* com badge de não lidas sincronizado), avatar do operador logado e ação de logout imediata.

### Casca Unificada `StorefrontFrame.tsx`
- **Onda Orgânica com Framer Motion:** Desenhos vetoriais dinâmicos (`wave-primary` e `wave-secondary`) posicionados fixamente no topo a `z-index: 4`. Respeita a preferência do usuário por redução de movimento (`prefers-reduced-motion`).
- **Degradê de Máscara (`mask-image`):** O container de rolagem (`.storefront-frame__scroll`) utiliza `-webkit-mask-image` e `mask-image` com gradiente linear suave para fazer o conteúdo surgir e desaparecer gradualmente logo abaixo da onda.
- **Compartilhamento Integral:** Tanto a vitrine pública quanto o painel administrativo (`AdminLayout.tsx`) utilizam o `<StorefrontFrame>` com o mesmo efeito de onda e fade, garantindo elegância e coesão visual em toda a plataforma.

### Exceções Sem Header (Telas Cheias)
As seguintes páginas são telas de transição pura ou isolamento operacional e não recebem o cabeçalho:
- Telas de loading do checkout: `PreparandoPedido`, `GerandoPagamento`, `ProcessandoPagamento`.
- Tela de acesso: `AdminLogin` (possui sua própria onda de fundo via `AdminWave.tsx`).

---

## 8. Responsividade e Experiência Mobile

A plataforma adota design responsivo rigoroso sem quebra de leiautes em dispositivos compactos:

- **Drawer Mobile com Handle em Onda:** O menu lateral mobile do Header utiliza **CSS puro com transições e `pointer-events`**, eliminando travamentos de animações complexas. A barra reta genérica foi substituída pelo SVG ondulado rosa da confeitaria dentro do botão `.mobile-menu-close`, atuando como a própria alça acessível de arraste (*drag-to-close*).
- **Clearance Inferior Estrutural do Admin Mobile (`--admin-mobile-nav-space`):** O layout administrativo reserva `88px` de padding inferior no container principal (`.admin-main`) para acomodar com folga a barra de navegação móvel fixa (`AdminMobileNav`). Regras genéricas de estilo entre telas foram isoladas para garantir que o último card ou formulário (ex.: `/admin/produtos`, `/admin/pedidos`) possa ser completamente rolado acima da barra.
- **Navegação em Telas Médias:** O ponto de quebra para recolhimento da barra administrativa é estabelecido em `960px`, impedindo o estouro dos múltiplos botões do painel em tablets ou janelas compactas.
- **Visualização de Comandas:** Em telas abaixo de `600px`, as tabelas de pedidos do Dashboard e da página de Pedidos deixam de exigir rolagem horizontal; cada linha se reconfigura automaticamente em um cartão vertical empilhado (*card grid*), com ações acessíveis ao toque.
- **Safe Area Insets:** Margens inferiores consideram `env(safe-area-inset-bottom)` em aparelhos modernos (iOS/Android).

---

## 9. Sistema de Temas, Dark Mode e View Transitions API

A aplicação oferece alternância instantânea entre modo claro e escuro:

- **Sincronização Bidirecional Contínua:** O contexto único [StoreThemeContext.tsx](file:///c:/Users/vitormanoel/dev/rp-doces/src/context/StoreThemeContext.tsx) gerencia o estado e sincroniza simultaneamente:
  - O atributo `data-theme` em `document.documentElement`.
  - O atributo `data-admin-theme` em `document.documentElement`.
  - As chaves `store-theme` e `admin-theme` em `localStorage`.
- **Pass-through Transparente:** O `AdminThemeContext.tsx` atua como uma fachada transparente que delega chamadas diretamente ao `StoreThemeContext`. Alterar o tema no admin altera a loja, e vice-versa.
- **Sincronização Dinâmica da Status Bar (PWA / Mobile):**
  - O `<meta name="theme-color">` é atualizado em tempo real para sincronizar a barra de status do navegador móvel com a cor exata do header: `#eddcc6` (modo claro) e `#271f1b` (modo escuro).
  - Um script inline no `<head>` do `index.html` aplica o tema antes do primeiro paint, prevenindo flash de tela branca (FOUC).
  - Um `MutationObserver` no `StoreThemeContext` monitora mutações em `data-theme`/`data-admin-theme`, garantindo consistência mesmo em transições de rotas ou limpezas de PWA.
- **View Transitions API Diferenciada por Dispositivo:**
  - **Desktop / Telas Maiores:** Revelação circular radial (`clip-path: circle(...)`) a partir da posição exata do botão clicado com 480ms de duração e curva `cubic-bezier(0.4, 0, 0.2, 1)`.
  - **Mobile ($\le 768\text{px}$):** Otimizado especificamente para alta taxa de atualização (telas 90Hz/120Hz). Utiliza crossfade acelerado por GPU com `opacity: [0, 1]` em 260ms e curva `cubic-bezier(0.2, 0.8, 0.2, 1)`. O `clip-path` pesado foi desativado no mobile para eliminar quedas de frames.
  - **Zero Ghosting e Alinhamento 1:1:** O snapshot mobile opera sem transformação de escala (`scale`), garantindo alinhamento pixel-a-pixel perfeito entre o tema anterior e o novo, sem halos esbranquiçados, bordas duplas em cards ou piscadas nos cantos da tela.
  - **Bypass de Acessibilidade:** Suporte integral a `prefers-reduced-motion: reduce`, aplicando a troca de tema instantânea sem animações.
- **Paleta de Cores do Tema Escuro:**
  - Fundo principal: `#161210` e `#1a1412` (castanho chocolate nobre, evitando o preto puro `#000000`).
  - Ondas: `var(--store-wave-primary)` ajustada para `#271f1b` e secundária para `#3b2c26`.
  - Textos: `#faf4ee` (títulos) e `#f4e9df` (corpo) para legibilidade sem fadiga visual.
  - Acentos: `#d38b80` (rosa confeitaria suave) e variações de foco `#e09a8e`.

---

## 10. Catálogo, Carrinho e Sacola

- **Catálogo Dinâmico:** Consome `GET /api/produtos`. Retorna produtos com preços em centavos, categoria identificada por slug e nome, fotos do bucket R2 ou seed estático, além da quantidade disponível calculada no servidor.
- **Regras de Vigência Promocional (`shared/promocao.ts`):** O preço promocional possui 5 estados automáticos:
  - `SEM_PROMOCAO`: Preço normal.
  - `DESLIGADA`: Promoção inativa.
  - `AGENDADA_FUTURA`: Início programado em instante ISO UTC futuro.
  - `VIGENTE`: Ativa e dentro do período (ou sem agendamento obrigatório).
  - `EXPIRADA`: Período encerrado.
  *A expiração é decorrente do próprio dado no instante da leitura — dispensando rotinas de cron para ligar ou desligar promoções.*
- **Reconciliação da Sacola:** Quando um item tem seu estoque reduzido ou esgotado por compras de terceiros, a função `reconcileCartWithCatalog` diminui a quantidade no carrinho para o limite disponível ou remove o item zerado, exibindo um alerta amigável ao cliente.

---

## 11. Checkout e Fluxo de Pagamento Pix

O checkout é a porta de entrada para a compra pública:

1. **Submissão do Formulário:** Ao clicar em "Finalizar Pedido", `Checkout.tsx` gera uma `operationKey` única (UUID v4) associada a essa intenção de compra.
2. **Envio para `POST /api/checkout`:** O backend valida estoque livre, preços vigentes de cada item e integridade do payload no mesmo batch atômico.
3. **Reserva Imediata:** O estoque reservado é incrementado atomicamente antes do contato com o provedor externo.
4. **Chamada ao Mercado Pago Payments API:** Um pagamento Pix com expiração inicial é criado no gateway.
5. **Gravação do Pedido e Ledger:** O pedido nasce como `PENDENTE`, acompanhado de sua linha correspondente em `pedido_pagamentos`.
6. **Acompanhamento no Frontend:** O cliente é redirecionado para `AguardandoPagamento.tsx`, onde visualiza o QR Code Pix e a chave Copia e Cola, com contador regressivo e polling automático para detecção instantânea do pagamento.

---

## 12. Acompanhamento de Pedido e Telas de Processamento

- **Acompanhamento Dinâmico (`/pedido/:token`):** Página pública que exibe a timeline de evolução do pedido:
  - `NOVO`: Pedido recebido e aguardando confirmação.
  - `PREPARANDO`: Na bancada de produção da confeitaria.
  - `PRONTO`: Pronto para retirada no balcão ou despacho.
  - `ENTREGUE`: Pedido finalizado com sucesso.
  - `CANCELADO`: Cancelado pelo lojista ou cliente.
- **Telas de Processamento Estético:** Transições animadas dedicadas (`PreparandoPedido`, `GerandoPagamento`, `ProcessandoPagamento`) com tempos mínimos garantidos para fornecer retorno visual suave e encantador sem saltos abruptos de tela.

---

## 13. Painel Administrativo (Admin)

Área de retaguarda autenticada com recursos de gestão completa:

- **Autenticação de Equipe:** Sessões persistidas via cookies `HttpOnly` com token criptográfico de alta entropia. Interceptor `_middleware.ts` valida as credenciais em todas as rotas `/api/admin/*`.
- **Dashboard (`/admin`):** Indicadores em tempo real: faturamento do dia, total recebido, contas a receber (comandas abertas), pedidos aguardando preparo e ranking dos doces mais vendidos no período selecionado.
- **Gestão de Produtos (`/admin/produtos`):** Catálogo administrativo com filtros, reordenação, badges de estoque, ativação/desativação de itens, controle de promoções e envio de fotos para o Cloudflare R2.
- **Gestão de Comandas (`/admin/pedidos`):** Central de pedidos com abas por status operacionais, busca instantânea por cliente ou código, criação de pedidos de balcão e gaveta de detalhes completos.
- **Gestão de Despesas (`/admin/despesas`):** Lançamento de custos operacionais (ingredientes, embalagens, utilidades) com controle de status e cálculo de lucro líquido real.
- **Configurações da Loja (`/admin/loja`):** Edição de horário de funcionamento, taxa de entrega padrão e chave Pix da loja.
- **Gestão de Administradores (`/admin/administradores`):** Criação e revogação de acessos para atendentes e mestres da confeitaria.

---

## 14. Gestão de Produtos e Categorias

- **Catálogo Relacional:** Tabela `produtos` associada à tabela `categorias` via chave estrangeira.
- **Upload e Otimização para Cloudflare R2:** Ao anexar uma imagem no modal de produto (`NovoProdutoModal.tsx`), o arquivo é enviado para `POST /api/admin/produtos/:id/imagem`, validado contra tipos MIME permitidos (`image/jpeg`, `image/png`, `image/webp`), armazenado no bucket R2 com chave única `product-{id}-{uuid}.webp` e servido sob demanda em `/api/images/:key`.
- **Proteção do Estoque Reservado:** Na edição de um produto, o lojista visualiza tanto o estoque total quanto o desdobramento entre **reservado** e **livre**, recebendo avisos visuais caso tente definir o estoque abaixo do volume já reservado para pedidos em andamento.

---

## 15. Motor de Estoque e Reserva Atômica

O controle de estoque da R&P Doces impede o problema de *overselling* (vender itens além da capacidade física real) através de garantias relacionais:

### Fórmula de Disponibilidade
$$\text{Estoque Disponível (Livre)} = \max(0, \text{estoque} - \text{estoque\_reservado})$$

### Ciclo de Vida da Reserva
1. **Reserva na Criação (Ativa):**
   - No checkout público ou no pedido balcão, a reserva nasce com `reserva_status = 'ATIVA'`.
   - O banco impõe a constraint SQLite: `CHECK (estoque_reservado >= 0 AND estoque_reservado <= estoque)`. Se duas compras simultâneas disputarem a última unidade de um bolo, uma das transações é abortada pelo banco relacional, garantindo integridade absoluta sem travamentos manuais lentos.
2. **Conversão em Baixa Física (PAGO):**
   - Assim que o pagamento integral é confirmado (no ledger), a rotina `baixarEstoquePedido` decrementa o `estoque` físico e reduz o `estoque_reservado` no mesmo batch, marcando `estoque_baixado_em = datetime('now')` e atualizando os itens para o estado `BAIXADO`.
3. **Liberação por Cancelamento ou Expiração (LIBERADA):**
   - Se o Pix expira ou o pedido é cancelado sem pagamento, `liberarReservaPedido` devolve o saldo de `estoque_reservado` ao estoque livre e marca a reserva como `LIBERADA`.
4. **Política de Reserva de Balcão (MANUAL):**
   - Pedidos manuais de balcão nascem com reserva `ATIVA` sem prazo de validade (`reserva_expira_em = NULL`). O doce prometido ao cliente na loja física nunca é liberado sozinho por tempo; sua liberação exige cancelamento explícito do operador ou baixa por pagamento.

---

## 16. Ledger Financeiro e Razão Contábil

A plataforma utiliza um modelo contábil de partidas financeiras para eliminar qualquer ambiguidade sobre valores:

```text
┌────────────────────────────────────────────────────────┐
│                        PEDIDO                          │
│  - Total do Pedido: R$ 50,00                           │
│  - Projeção de Status: PENDENTE | PARCIAL | PAGO       │
└──────────────────────────┬─────────────────────────────┘
                           │ 1:N
                           ▼
┌────────────────────────────────────────────────────────┐
│                   PEDIDO_PAGAMENTOS                    │
│  - Pagamento 1: R$ 50,00 (PIX_MP, PAGO)                │
└──────────────────────────┬─────────────────────────────┘
                           │ 1:N
                           ▼
┌────────────────────────────────────────────────────────┐
│              PEDIDO_PAGAMENTO_ALOCACOES                │
│  - Item 1 (Bolo): R$ 30,00                             │
│  - Item 2 (Doce): R$ 20,00                             │
└────────────────────────────────────────────────────────┘
```

### Principais Entidades
- **`pedido_pagamentos`:** Registra cada tentativa individual de pagamento (Pix Mercado Pago, Dinheiro, Cartão, Pix Externo).
- **`pedido_pagamento_alocacoes`:** Distribui o valor recebido especificamente entre os itens do pedido via algoritmo waterfall (cascata).
- **`pedido_reembolsos`:** Registra fatos independentes de estorno, apontando para o pagamento de origem.

### Status Financeiro Agregado (Projeção Pura)
O status financeiro do pedido **nunca** é gravado manualmente como uma verdade isolada; ele é derivado via query SQL com base no valor líquido confirmado:
- $\text{Líquido Confirmado} \le 0 \implies \mathbf{PENDENTE}$
- $0 < \text{Líquido Confirmado} < \text{Total do Pedido} \implies \mathbf{PARCIAL}$
- $\text{Líquido Confirmado} \ge \text{Total do Pedido} \implies \mathbf{PAGO}$

---

## 17. Pagamentos, Gateway Mercado Pago e Pix

A integração com o Mercado Pago segue a **Payments API** oficial com resiliência de nível bancário:

- **Chave de Idempotência Externa (`X-Idempotency-Key`):** Cada chamada ao Mercado Pago recebe uma chave derivada de forma determinística da `operationKey` da tentativa (`a1:<key>:mp`). Quedas de conexão no envio do POST recuperam a transação já criada no PSP sem gerar duas cobranças.
- **Consulta Autoritativa (Protocolo B2):** Uma cobrança expirada localmente **só pode virar PAGO** se o backend obtiver uma resposta `approved` comprovada via chamada GET direta e verificada contra a API do Mercado Pago (`fetchMpPayment`). Webhooks isolados ou relógios descalibrados não possuem autoridade para aprovar transações expiradas.
- **Tratamento de Respostas Ambíguas:** Falhas de rede, timeouts HTTP (408/429/5xx) durante o envio do Pix nunca inventam status `FALHOU`. A operação permanece em `ENVIO_INCONCLUSIVO`, preservando a reserva e aguardando confirmação do webhook ou do motor de recuperação.

---

## 18. Pagamentos Manuais no Balcão

Para o atendimento presencial na loja física, o operador pode registrar pagamentos em dinheiro, cartão ou Pix recebido em chave externa:

- **Lançamento Atômico:** Registrado via `POST /api/admin/pedidos/:id/pagamentos`.
- **Alocação por Cascata (Waterfall):** O montante recebido consome primeiramente os itens ainda descobertos, preservando a rastreabilidade contábil.
- **Substituição de Cobranças Provisórias:** O registro de um pagamento manual em dinheiro ou cartão cancela automaticamente cobranças provisórias locais não-fiscais (`substitui_pagamento_id`), mantendo a comanda limpa e organizada.

---

## 19. Reembolsos e Estornos

- **Natureza Aditiva:** Estornos não apagam nem sobrescrevem linhas da tabela `pedido_pagamentos`. O estorno cria uma linha correspondente em `pedido_reembolsos`.
- **Cálculo Líquido:** O teto máximo reembolsável de qualquer pagamento é rigorosamente calculado como:
  $$\text{Reembolsável} = \text{Valor Bruto Pago} - \sum \text{Reembolsos Confirmados Anteriores}$$
- **Estorno Manual de Pix (`PIX_MP`):** Caso o cliente pague via Pix e o operador realize a devolução bancária diretamente pela conta da empresa, o lojista registra o estorno manual no painel, reduzindo o líquido do pedido para permitir o cancelamento legal.

---

## 20. Ciclo de Vida do Pedido: Cancelamento, Arquivamento e Anulação Auditável

O sistema distingue claramente quatro ações que outrora eram confundidas:

```text
┌───────────────────────┬─────────────────────────────────────────────────────────────────┐
│ Ação                  │ Comportamento e Efeito no Sistema                               │
├───────────────────────┼─────────────────────────────────────────────────────────────────┤
│ Cancelamento          │ Cancela comanda com saldo zerado. Libera reservas ativas.        │
│ Arquivamento          │ Oculta pedidos concluídos/cancelados da visualização principal. │
│ Reembolso             │ Devolve valores financeiros sem alterar itens ou repor estoque. │
│ Anulação Auditável    │ Invalida o pedido por erro grave com escolha auditável de estoque.│
└───────────────────────┴─────────────────────────────────────────────────────────────────┘
```

### Anulação Auditável (`POST /api/admin/pedidos/:id/anulacao`)
Criada para situações de erro operacional grave (ex.: pedido lançado em duplicidade ou cancelado antes de qualquer entrega):
- **Garantia de Imutabilidade:** Insere registro em `pedido_anulacoes` e ativa gatilhos relacionais no banco que bloqueiam permanentemente qualquer mutação futura naquele pedido ou em seus itens.
- **Tratamento de Estoque Controlado:** O operador escolhe expressamente se deseja devolver os itens ao estoque livre (`devolverEstoque: true`) ou descartá-los por perda física.
- **Proteção do Mercado Pago:** A anulação é terminantemente recusada caso existam cobranças Pix pendentes ou pagamentos `PAGO` sem cobertura integral de estorno verificado.

---

## 21. Subsistemas Modulares do Backend (`functions/lib/`)

Seguindo o padrão de arquitetura modular, a camada de lógica foi segregada em 4 subsistemas centrais no backend e 1 no frontend:

### 21.1. `ledger/` (Motor Contábil)
- **Fachada:** `functions/lib/comandaLedger.ts`
- **Módulos:**
  - `types.ts`: Tipagens contábeis, enums e contratos de transição.
  - `allocations.ts`: Algoritmos waterfall de alocação de recebimentos por item.
  - `projection.ts`: Projeções SQL de saldo e agregação financeira.
  - `adminPayments.ts`: Lançamento e validação de pagamentos presenciais.
  - `adminRefunds.ts`: Lançamento de estornos com checagem de teto líquido.
  - `legacy.ts`: Compatibilidade com comandas anteriores ao ledger.

### 21.2. `pix/` (Gateway Pix Administrativo)
- **Fachada:** `functions/lib/comandaPix.ts`
- **Módulos:**
  - `types.ts`: Contratos de requisição Pix no balcão.
  - `queries.ts`: Cálculo de capacidade cobrável em aberto.
  - `adminCharge.ts`: Emissão atômica de QR Code Pix administrativo.
  - `adminRegenerate.ts`: Substituição de QR Code Pix expirado por nova cobrança ativa.
  - `replay.ts`: Replay idempotente de cobranças já emitidas.

### 21.3. `paymentSync/` (Sincronização e Reconciliação)
- **Fachada:** `functions/lib/paymentSync.ts`
- **Módulos:**
  - `types.ts`: Mapeamentos de payloads do provedor.
  - `status.ts`: Normalizador de status entre Mercado Pago e o domínio local.
  - `client.ts`: Cliente HTTP com timeout determinístico de 5 segundos.
  - `webhook.ts`: Validador de assinatura criptográfica HMAC-SHA256.
  - `ledgerSync.ts`: Execução de transições de status no banco relacional.
  - `sweeps.ts`: Varreduras periódicas de expiração e liberação de reservas órfãs.
  - `inconclusiveRecovery.ts`: Protocolo B3 para resgate de transações incertas.

### 21.4. `adminPedidos/` (Orquestração do Balcão)
- **Consumidores:** `functions/api/admin/pedidos.ts`
- **Módulos:**
  - `list.ts`: Listagem paginada enriquecida com projeções contábeis em lote.
  - `manualValidation.ts`: Validação de catálogo, quantidade e dados do comprador.
  - `manualCreation.ts`: Criação atômica no banco D1 com reserva física simultânea.
  - `manualReplay.ts`: Replay de comandas manuais enviadas repetidamente.

### 21.5. Frontend Admin: `PedidoDetalhe/`
- **Orquestrador:** `src/admin/Pedidos/PedidoDetalheModal.tsx`
- **Componentes Especializados:**
  - `PedidoHeader.tsx`: Cabeçalho com status operacional e ações rápidas.
  - `PedidoItens.tsx`: Tabela de itens, cancelamentos parciais e trocas.
  - `PedidoPagamento.tsx`: Balanço financeiro, emissão de Pix e reembolsos.
  - `usePedidoDetalhe.ts`: Hook de ciclo de vida, polling e mutações atômicas.

---

## 22. Protocolos de Reconciliação e Resiliência

A estabilidade da plataforma decorre de protocolos rigorosos de engenharia:

- **A1 (Idempotência Integral):** Nenhuma requisição de escrita pode ser processada duas vezes se reenviada com a mesma `operationKey`.
- **B1 (Contenção de Edição Destrutiva):** O endpoint `PUT /api/admin/pedidos/:id/itens` foi intencionalmente bloqueado com `409 Conflict`, eliminando mutações destrutivas silenciosas em pedidos já gravados.
- **B2 (Aprovação Autoritativa Pós-Expiração):** Transição de `EXPIRADO` para `PAGO` autorizada somente mediante consulta GET direta verificada contra os servidores do Mercado Pago.
- **B3 (Reconciliação Financeira Repetível):** Reconciliação convergente que projeta o líquido em SQL e executa baixa de estoque somente se o agregado fechou como `PAGO`.
- **B4 (Reserva por Pedido com Múltiplos Pix):** A existência de qualquer cobrança Pix pendente impede a liberação indevida da reserva do pedido.
- **B-1 (Visibilidade Operacional de Balcão):** Pedidos criados no balcão (`origem = 'MANUAL'`) permanecem visíveis imediatamente na listagem, independentemente de estarem pendentes.
- **B-2 (Estorno Manual de Pix):** Registro contábil de estorno para pagamentos `PIX_MP` devolvidos por fora pelo lojista.
- **B-3 (Recuperação de Envio Inconclusivo):** Varredura de busca via `GET /v1/payments/search` no Mercado Pago para descobrir cobranças criadas cujo retorno HTTP se perdeu por timeout.
- **B5 (GETs Idempotentes e Livres de Efeitos Colaterais):** Segregação estrita de responsabilidade HTTP. As rotas `GET /api/admin/pedidos` e `GET /api/admin/pedidos/:id` operam como puramente de leitura. Efeitos colaterais de manutenção financeira e sincronização em background foram movidos para endpoints POST explícitos e idempotentes com proteção `sameOrigin`:
  - `POST /api/admin/pedidos/reconciliar`: Executa em lote a rotina `reconcilePedidosEmBackground` para a lista de comandas.
  - `POST /api/admin/pedidos/:id/reconciliar`: Executa a reconciliação sob demanda da comanda ativa (`reconcileLiveTabPedido`).
  - No frontend, o hook `usePedidoDetalhe.ts` dispara o POST de reconciliação em modo *best-effort* antes do GET no carregamento inicial, nas chamadas explícitas e no polling silencioso, preservando a recuperação contínua sem violar a semântica HTTP.

---

## 23. Idempotência e Identidade de Operações (`operationKey`)

Toda escrita crítica no sistema requer uma chave de operação:

1. **Geração no Cliente:** Antes de despachar a requisição, o frontend cria um UUID v4 e versiona o payload gerando um fingerprint SHA-256 canônico.
2. **Tabela `pedido_operacoes`:** O banco grava a chave em uma coluna `UNIQUE`. Se duas chamadas simultâneas chegarem com a mesma chave:
   - A primeira adquire a operação e realiza os lançamentos no mesmo `db.batch()`.
   - A segunda falha no `UNIQUE` e executa um **replay idempotente da resposta original**, devolvendo exatamente os mesmos dados da primeira sem criar registros duplicados.
3. **Detecção de Conflito:** Caso a mesma `operationKey` seja reutilizada com dados diferentes (fingerprint conflitante), a requisição é terminantemente recusada com `409 Conflict`.

---

## 24. Webhooks e Comunicação com Gateways

- **Endpoint de Recepção:** `POST /api/webhooks/mercadopago`.
- **Validação Criptográfica HMAC-SHA256:**
  - O header `x-signature` é inspecionado extraindo o timestamp `ts` e a assinatura criptográfica `v1`.
  - O hash calculado sobre a query string e o corpo é comparado em tempo constante (*timing-safe equal*) contra o segredo `MP_WEBHOOK_SECRET`.
  - Requisições sem assinatura válida são sumariamente rejeitadas com código HTTP `401 Unauthorized`.
- **Nunca Confia no Payload:** O webhook do Mercado Pago serve apenas como um sinalizador de evento. O backend nunca extrai o status diretamente do corpo do webhook; ele realiza uma chamada segura para `fetchMpPayment` para obter o dado oficial e imutável antes de atualizar o ledger.

---

## 25. Sistema de Notificações Operacionais e Web Push

- **Central de Notificações Interna:** Exibe alertas em tempo real para os atendentes: novos pedidos aguardando preparo, pagamentos confirmados no Pix, estoque baixo ou esgotado e falhas operacionais que exijam atenção.
- **Badge Dinâmico Unificado:** O número de notificações não lidas é consumido pelo `Header.tsx` a partir de `NotificacoesContext.tsx` e atualizado automaticamente sem necessidade de recarregar a página.
- **Web Push (PWA):** Integração com a API de notificações do navegador via chaves VAPID (`functions/lib/webPush.ts`). Dispara notificações no desktop ou celular do operador quando um novo pedido com pagamento confirmado ingressa no sistema.

---

## 26. Infraestrutura Cloudflare (Pages, D1, R2)

O arquivo `wrangler.toml` define os bindings do ecossistema Cloudflare:

```toml
name = "rp-doces"
compatibility_date = "2024-09-23"
pages_build_output_dir = "dist"

[[d1_databases]]
binding = "DB"
database_name = "rp-doces-db"
database_id = "c2e15599-3d68-4801-9a1c-96a84977dd7c"

[[r2_buckets]]
binding = "PRODUCT_IMAGES"
bucket_name = "rp-doces-images"
```

- **`DB` (Cloudflare D1):** Instância relacional que armazena pedidos, itens, ledger contábil, histórico, produtos e sessões.
- **`PRODUCT_IMAGES` (Cloudflare R2):** Bucket dedicado ao armazenamento das fotos em alta resolução do catálogo.

---

## 27. Migrations do Banco de Dados (0001 a 0030)

O banco de dados D1 evolui estritamente através das migrações sequenciais em `migrations/`:

```text
0001_products.sql                              # Tabela base de produtos com constraint CHECK de reserva
0002_orders.sql                                # Schema inicial de pedidos
0003_admin_products.sql                        # Campos administrativos de produtos
0004_admin_auth.sql                            # Tabela de administradores e sessões seguras
0005_categorias_e_produtos.sql                 # Categorias com emojis e normalização de slugs
0006_pedidos_producao.sql                      # Alinhamento de colunas de pedidos com produção
0007_pedido_itens_auditoria.sql                # Auditoria de itens e marcações de baixa
0008_ledger_pagamentos.sql                     # Criação do razão: pedido_pagamentos e alocações
0009_reembolsos.sql                            # Tabela de estornos: pedido_reembolsos
0010_pedido_pagamentos_mp_payment_id_index.sql # Índice para resolução rápida do webhook
0011_pedidos_reserva_ativa_index.sql           # Índice para varreduras de expiração de reservas
0012_operacoes_idempotencia.sql                # Tabela pedido_operacoes (Chave de Idempotência A1)
0013_pedidos_compat_colunas_legadas.sql        # Compatibilidade com colunas históricas
0014_notificacao_leituras.sql                  # Controle de notificações lidas por operador
0015_admin_diagnostico_eventos.sql             # Eventos e testes de diagnóstico operacional
0016_pedido_itens_estado_estoque.sql           # Estados detalhados de estoque por item
0017_pedido_operacoes_item_adicao.sql          # Adição controlada de itens em comanda aberta
0018_item_cancelamento_preview.sql             # Visualização prévia de cancelamento de item
0019_comanda_viva_item_trocas.sql              # Troca de itens em comanda viva
0020_pedido_reembolso_pix_mp_intencoes.sql     # Rastreabilidade de estorno para Pix Mercado Pago
0021_cobertura_financeira_linhagem_trocas.sql  # Linhagem de trocas e cobertura contábil
0022_pedido_anulacoes.sql                      # Tabela e triggers de anulação auditável de pedidos
0023_pedido_reembolso_pix_mp_intencoes_anulacao.sql# Estornos vinculados a anulações
0024_pix_mp_refund_excl_mutua_assimetrica.sql  # Exclusão mútua em concorrência de refund Pix
0025_configuracoes_loja.sql                    # Parâmetros operacionais e horários da loja
0026_despesas_itemizadas.sql                   # Tabela de custos operacionais e fornecedores
0027_checkout_rate_limits.sql                  # Proteção anti-abuso e rate limit no checkout
0028_operacao_expiracao.sql                    # Expiração controlada de operações órfãs
0029_operacao_regeneracao_ativa.sql            # Regeneração ativa de cobranças em voo
0030_admin_push_subscriptions.sql              # Inscrições de navegadores para Web Push VAPID
```

> **Regra de Ouro das Migrações:** Nunca edite um arquivo `.sql` já aplicado em produção. Correções e novos campos devem ser implementados exclusivamente via uma nova migration numerada de forma estritamente sequencial.

---

## 28. Desenvolvimento Local e Variáveis de Ambiente

### Pré-requisitos
- Node.js versão 18 ou 20 LTS.
- npm versão 9 ou superior.

### Variáveis de Ambiente Locais (`.dev.vars`)
Para executar localmente com suporte ao gateway e notificações, crie o arquivo `.dev.vars` na raiz (o arquivo é ignorado no Git por conter segredos):

```bash
# Mercado Pago (obrigatório para testar Pix)
MP_ACCESS_TOKEN="APP_USR-seu-access-token"
MP_WEBHOOK_SECRET="seu-webhook-secret"

# Web Push VAPID (opcional em desenvolvimento local)
VAPID_PUBLIC_KEY="sua-chave-publica-vapid"
VAPID_PRIVATE_KEY="sua-chave-privada-vapid"
VAPID_SUBJECT="mailto:contato@rpdoces.com.br"
```

### Inicialização do Ambiente
```bash
# 1. Instalar dependências
npm install

# 2. Aplicar migrações no banco local do Wrangler
npm run db:migrate:local

# 3. Popular o catálogo com dados de teste
npm run db:seed:local

# 4. Compilar e subir o servidor completo com Pages Functions e D1 local
npm run build
npm run pages:dev
# A aplicação estará disponível em: http://127.0.0.1:8788
```

---

## 29. Scripts npm e Ciclo de Vida

| Comando | Descrição |
| :--- | :--- |
| `npm run dev` | Inicia o servidor Vite para desenvolvimento rápido da interface SPA. |
| `npm run build` | Valida tipos do frontend (`tsc --noEmit`) e gera a pasta de produção `dist/`. |
| `npm run typecheck` | Executa a checagem de tipos do TypeScript sem gerar arquivos. |
| `npm test` | Executa a suíte completa de 50 testes automatizados com `node --test`. |
| `npm run test:cached` | Executa testes ignorando suítes cujos arquivos fonte não foram alterados. |
| `npm run preview` | Previsualiza a pasta `dist/` estaticamente. |
| `npm run pages:dev` | Roda o emulador do Cloudflare Pages com banco D1 local e Functions. |
| `npm run db:migrate:local` | Aplica todas as migrações pendentes no banco D1 local. |
| `npm run db:seed:local` | Popula o banco local com o catálogo inicial de doces e bolos. |

---

## 30. Compilação, Build e TypeScript

O comando `npm run build` executa:
```bash
tsc --noEmit && vite build
```

- **Escopo do `tsconfig.json` Principal:** O arquivo `tsconfig.json` cobre primordialmente o frontend SPA (`src/` e `vite.config.ts`).
- **Verificação do Backend (`functions/**`):** A checagem de tipos das funções serverless da Cloudflare é realizada pelo bundler do Wrangler e durante os testes automatizados, que importam e compilam os módulos de backend via `esbuild`.

---

## 31. Estrutura e Execução de Testes Automatizados

A plataforma possui uma robusta rede de segurança com **50 suítes de testes automatizados**, totalizando centenas de asserções executadas nativamente:

- **Runner Oficial:** `scripts/run-tests.mjs` itera recursivamente sobre todos os arquivos `tests/*.test.mjs`.
- **Testes de Concorrência e Rollback:** Utilizam simuladores D1 em memória através de Miniflare, testando corridas entre webhooks e aprovações manuais com travas e barreiras determinísticas.
- **Testes de Interface (UI):** Utilizam JSDOM para renderizar componentes modais, verificar bloqueios de scroll e simular cliques em backdrops de fechamento.
- **Execução:**
  ```bash
  npm test
  ```

---

## 32. Segurança e Vetores de Proteção

- **Cookies HttpOnly:** Sessões administrativas utilizam cookies com flags `HttpOnly; Secure; SameSite=Lax`, impedindo o roubo de tokens via JavaScript malicioso (XSS).
- **Proteção Same-Origin:** Endpoints de mutação do painel exigem cabeçalhos de mesma origem para repelir ataques de CSRF (Cross-Site Request Forgery).
- **Mitigação de Timing Attack e Enumeração de Usuários (PBKDF2 Dummy):** O endpoint de login administrativo (`POST /api/auth/login`) executa verificação de senha em tempo equivalente para qualquer cenário. Quando o usuário não existe ou está inativo, a rotina realiza uma checagem contra um hash PBKDF2 dummy estático e válido (`pbkdf2_sha256` com 100.000 iterações), eliminando vazamento de enumeração de contas por medição de latência de resposta.
- **Hardening na Alteração da Própria Senha:** O endpoint de atualização de credenciais (`POST /api/admin/administradores/:id/senha`) exige expressamente a senha atual (`senha_atual`) do operador autenticado e valida sua correspondência antes de aplicar a nova senha com salt criptográfico.
- **Validação Rigorosa de Assinatura:** Eventos de gateway só são aceitos quando acompanhados da assinatura criptográfica HMAC SHA-256 válida.
- **Constraints a Nível de Banco de Dados:** A integridade de estoque e a exclusão mútua de operações contam com travas relacionais em SQLite (`UNIQUE`, `CHECK`), blindando a plataforma contra inconsistências mesmo em cenários de alta concorrência.
- **Segregação Estrita de Efeitos Colaterais em GETs:** Endpoints de consulta (`GET /api/admin/pedidos` e `GET /api/admin/pedidos/:id`) operam exclusivamente como leitura pura, delegando mutações de recuperação a rotas POST dedicadas (`/reconciliar`).

---

## 33. Convenções de Código e Padrões de Commit

1. **Padrão de Mensagem de Commit:**
   - Todo commit deve adotar o prefixo `rp-doces: <mensagem descritiva em português>`.
   - Exemplo: `rp-doces: unifica header, wave e fade entre storefront e admin`.
   - **Sem co-authorship:** Não utilizar trailers como `Co-Authored-By`.
2. **Atômico e Funcional:** Cada commit deve representar uma unidade funcional completa. O projeto precisa compilar (`npm run build`) e passar nos testes após cada commit.
3. **Formatação de Código:** Utiliza Prettier com as configurações especificadas em `.prettierrc`.

---

## 34. Decisões Arquiteturais Relevantes

1. **Adoção da Payments API em Detrimento da Orders API:**
   - A Payments API do Mercado Pago oferece maior controle sobre cada tentativa de pagamento individual (`PIX_MP`), expiração explícita por cobrança e suporte à identificação de pagamentos aditivos, alinhando-se perfeitamente ao ledger de comandas.
2. **Fatos Financeiros em Partidas Dobradas:**
   - Nenhuma linha de pagamento confirmada é alterada ou cancelada retrospectivamente. Estornos geram fatos contábeis próprios, mantendo a trilha de auditoria limpa.
3. **Header Único com Degradação Elegante:**
   - O mesmo componente de cabeçalho atende à loja e ao painel de administração, evitando divergências de layout e sincronizando o estado de temas e responsividade de ponta a ponta.
4. **View Transitions com Especialização por Dispositivo:**
   - Animação radial por `clip-path` preservada no desktop, enquanto o mobile adota crossfade puro por `opacity` via GPU sem transformações de escala, garantindo fluidez máxima em 90/120Hz sem ghosting ou piscadas visuais.

---

## 35. Limitações Conhecidas e Dívidas Técnicas Reais

1. **Overpayment (Pagamentos Excedentes):**
   - Caso um cliente gere dois códigos Pix e pague ambos, o ledger preserva corretamente o montante total recebido, mas a interface visual ainda não possui um módulo dedicado para converter o excedente em crédito de loja.
2. **Edição Destrutiva de Itens Bloqueada (B1):**
   - A rota `PUT /api/admin/pedidos/:id/itens` permanece bloqueada com código `409` por segurança. A manipulação de itens em comandas vivas deve ser feita exclusivamente através das rotas de cancelamento de item com reposição e troca de item.
3. **Typecheck Separado para Functions:**
   - O `npm run build` valida os tipos do frontend via `tsc --noEmit`. Os tipos das rotas sob `functions/` dependem da compilação e dos testes do Wrangler/esbuild.

---

## 36. Estado Atual do Sistema (Checklist de Componentes)

| Módulo / Funcionalidade | Situação | Observações |
| :--- | :---: | :--- |
| **Storefront Institucional** | ✅ | Home, Cardápio, Sobre, Contato e Rodapé funcionando perfeitamente. |
| **Carrinho & Sacola** | ✅ | Persistência em `localStorage` com auto-reconciliação de estoque. |
| **Checkout Pix** | ✅ | Emissão com idempotência A1, QR Code dinâmico e cópia-e-cola. |
| **Acompanhamento de Pedido** | ✅ | Acesso público por token com atualização de status em tempo real. |
| **Header Unificado** | ✅ | Fonte única de verdade para loja e admin, com drawer mobile CSS e handle ondulado. |
| **Wave e Fade Animados** | ✅ | Efeito visual presente na loja e no painel admin via `StorefrontFrame`. |
| **Tema Dark Chocolate** | ✅ | Sincronização simultânea de `data-theme` e `data-admin-theme`. |
| **View Transitions (Mobile/Desktop)** | ✅ | Revelação radial no desktop e crossfade GPU 260ms fluido em 90/120Hz no mobile. |
| **Dashboard Administrativo** | ✅ | Indicadores financeiros do dia, comandas em aberto e ranking de vendas. |
| **Catálogo Administrativo** | ✅ | CRUD de produtos, categorias com emojis, upload R2 e clearance inferior mobile. |
| **Gestão de Comandas (Admin)** | ✅ | Criação manual, pagamentos múltiplos, geração de Pix, anulação e histórico. |
| **Reconciliação Segregada (POST)** | ✅ | Rotas POST dedicadas para sincronização; GETs 100% puros e sem efeitos colaterais. |
| **Segurança & Anti-Enumeração** | ✅ | Verificação de senha timing-safe via dummy PBKDF2 e proteção na troca de senha. |
| **Livro de Despesas** | ✅ | Lançamento e controle de custos operacionais com cálculo de lucro líquido. |
| **Anulação Auditável** | ✅ | Cancelamento definitivo de comandas com proteção relacional imutável. |
| **Web Push Notifications** | ✅ | Notificações no navegador para alertas operacionais e novos pedidos pagos. |
| **Ledger Contábil** | ✅ | Partidas financeiras, waterfall de alocações e projeção líquida em SQL. |
| **Reserva Atômica de Estoque** | ✅ | Constraints `CHECK` no SQLite impedindo qualquer venda excedente. |
| **Suíte de Testes (50 Suítes)** | ✅ | 100% dos testes aprovados cobrindo concorrência, domínio e UI. |
