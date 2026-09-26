import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import PageTransition from "./components/PageTransition";
import RouteLoadingFallback from "./components/RouteLoadingFallback";
import { CartProvider } from "./context/CartContext";
import "./admin/theme/admin-dark-theme.css";
import { StoreThemeProvider } from "./context/StoreThemeContext";

// Storefront routes (lazy)
const Homepage = lazy(() => import("./pages/Homepage"));
const Cardapio = lazy(() => import("./pages/Cardapio"));
const Checkout = lazy(() => import("./pages/Checkout"));
const AguardandoPagamento = lazy(() => import("./pages/AguardandoPagamento"));
const PedidoConfirmado = lazy(() => import("./pages/PedidoConfirmado"));
const PagamentoNaoAprovado = lazy(() => import("./pages/PagamentoNaoAprovado"));
const AcompanharPedido = lazy(() => import("./pages/AcompanharPedido"));

// Preview isolado das telas de loading — ficam paradas em loop, sem passar
// pelo checkout real. Só para inspeção visual, por isso só existem em `npm run
// dev`: em produção `import.meta.env.DEV` é `false`, as rotas /dev/* não são
// registradas e estes lazy() são eliminados do bundle. (As páginas em si
// continuam no build porque o fluxo real de AguardandoPagamento as importa.)
const DEV_PREVIEW_ROUTES = import.meta.env.DEV
  ? [
      { path: "/dev/preparando-pedido", Page: lazy(() => import("./pages/PreparandoPedido")) },
      { path: "/dev/gerando-pagamento", Page: lazy(() => import("./pages/GerandoPagamento")) },
      { path: "/dev/processando-pagamento", Page: lazy(() => import("./pages/ProcessandoPagamento")) },
    ]
  : [];

// Admin routes (lazy)
const AdminLogin = lazy(() => import("./admin/Login"));
const AdminLayout = lazy(() => import("./admin/components/AdminLayout"));
const AdminDashboard = lazy(() => import("./admin/Dashboard"));
const AdminProdutos = lazy(() => import("./admin/Produtos"));
const AdminPedidos = lazy(() => import("./admin/Pedidos"));
const AdminAdministradores = lazy(() => import("./admin/Administradores"));
const AdminLoja = lazy(() => import("./admin/Loja"));
const AdminDespesas = lazy(() => import("./admin/Despesas"));
const AdminNotificacoes = lazy(() => import("./admin/notificacoes/AdminNotificacoes"));

function StorefrontRoutes() {
  const location = useLocation();

  return (
    <>
      <div className="store-background" aria-hidden="true" />
      <PageTransition locationKey={location.key}>
        <Suspense fallback={<RouteLoadingFallback />}>
          <Routes location={location}>
            <Route path="/" element={<Homepage />} />
            <Route path="/cardapio" element={<Cardapio />} />
            <Route path="/checkout" element={<Checkout />} />
            <Route
              path="/aguardando-pagamento"
              element={<AguardandoPagamento />}
            />
            <Route path="/pedido-confirmado" element={<PedidoConfirmado />} />
            <Route
              path="/pagamento-nao-aprovado"
              element={<PagamentoNaoAprovado />}
            />
            <Route path="/pedido/:token" element={<AcompanharPedido />} />
            {DEV_PREVIEW_ROUTES.map(({ path, Page }) => (
              <Route key={path} path={path} element={<Page />} />
            ))}
            {/* As duas árvores de rotas (loja e admin) são montadas em toda URL.
                O admin pertence à AdminRoutes: aqui ele existe só para o React
                Router não avisar "No routes matched" em toda página do admin.
                Uma rota realmente inexistente continua avisando. */}
            <Route path="/admin/*" element={null} />
          </Routes>
        </Suspense>
      </PageTransition>
    </>
  );
}

// Rotas administrativas ficam fora do PageTransition (sem a onda/animação do storefront).
// Compartilham o mesmo Header global do storefront com navegação contextual.
function AdminRoutes() {
  const { pathname } = useLocation();
  // Fora de /admin não há nada a casar: evita o aviso "No routes matched" em
  // todas as páginas da loja (o aviso segue valendo para /admin/inexistente).
  if (pathname !== "/admin" && !pathname.startsWith("/admin/")) return null;

  return (
    <Suspense fallback={<RouteLoadingFallback />}>
      <Routes>
        <Route path="/admin/login" element={<AdminLogin />} />
        <Route element={<AdminLayout />}>
          <Route path="/admin" element={<AdminDashboard />} />
          <Route path="/admin/produtos" element={<AdminProdutos />} />
          <Route path="/admin/pedidos" element={<AdminPedidos />} />
          <Route
            path="/admin/administradores"
            element={<AdminAdministradores />}
          />
          <Route path="/admin/loja" element={<AdminLoja />} />
          <Route path="/admin/despesas" element={<AdminDespesas />} />
          <Route path="/admin/notificacoes" element={<AdminNotificacoes />} />
        </Route>
      </Routes>
    </Suspense>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <StoreThemeProvider>
        <CartProvider>
          <StorefrontRoutes />
          <AdminRoutes />
        </CartProvider>
      </StoreThemeProvider>
    </BrowserRouter>
  );
}
