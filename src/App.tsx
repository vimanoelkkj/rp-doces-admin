import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import Homepage from "./pages/Homepage";
import Cardapio from "./pages/Cardapio";
import Checkout from "./pages/Checkout";
import AguardandoPagamento from "./pages/AguardandoPagamento";
import PedidoConfirmado from "./pages/PedidoConfirmado";
import PagamentoNaoAprovado from "./pages/PagamentoNaoAprovado";
import AcompanharPedido from "./pages/AcompanharPedido";
import PreparandoPedido from "./pages/PreparandoPedido";
import GerandoPagamento from "./pages/GerandoPagamento";
import ProcessandoPagamento from "./pages/ProcessandoPagamento";
import PageTransition from "./components/PageTransition";
import { CartProvider } from "./context/CartContext";
import AdminLogin from "./admin/Login";
import AdminDashboard from "./admin/Dashboard";
import AdminProdutos from "./admin/Produtos";
import AdminPedidos from "./admin/Pedidos";
import AdminAdministradores from "./admin/Administradores";
import AdminLoja from "./admin/Loja";
import AdminDespesas from "./admin/Despesas";
import AdminNotificacoes from "./admin/notificacoes/AdminNotificacoes";
import AdminLayout from "./admin/components/AdminLayout";
import { AdminThemeProvider } from "./admin/theme/AdminThemeContext";
import "./admin/theme/admin-dark-theme.css";
import { StoreThemeProvider } from "./context/StoreThemeContext";

function StorefrontRoutes() {
  const location = useLocation();

  return (
    <PageTransition locationKey={location.key}>
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
        {/* Preview isolado das telas de loading — ficam paradas em loop,
            sem passar pelo checkout real. Só para inspeção visual. */}
        <Route path="/dev/preparando-pedido" element={<PreparandoPedido />} />
        <Route path="/dev/gerando-pagamento" element={<GerandoPagamento />} />
        <Route path="/dev/processando-pagamento" element={<ProcessandoPagamento />} />
      </Routes>
    </PageTransition>
  );
}

// Rotas administrativas ficam fora do PageTransition (sem a onda/animação
// do storefront) — o admin tem sua própria identidade visual (Sidebar).
function AdminRoutes() {
  return (
    <Routes>
      <Route
        path="/admin/login"
        element={
          <AdminThemeProvider>
            <AdminLogin />
          </AdminThemeProvider>
        }
      />
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
        {/* HUMAN-14: a rota já existia no menu lateral e não tinha destino —
            clicar caía numa área vazia. Agora é a superfície das
            notificações, dentro do layout administrativo atual. */}
        <Route path="/admin/notificacoes" element={<AdminNotificacoes />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <CartProvider>
      <BrowserRouter>
        <StoreThemeProvider>
          <StorefrontRoutes />
        </StoreThemeProvider>
        <AdminRoutes />
      </BrowserRouter>
    </CartProvider>
  );
}
