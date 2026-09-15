import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import Homepage from "./pages/Homepage";
import Cardapio from "./pages/Cardapio";
import Checkout from "./pages/Checkout";
import AguardandoPagamento from "./pages/AguardandoPagamento";
import PedidoConfirmado from "./pages/PedidoConfirmado";
import PagamentoNaoAprovado from "./pages/PagamentoNaoAprovado";
import AcompanharPedido from "./pages/AcompanharPedido";
import PageTransition from "./components/PageTransition";
import { CartProvider } from "./context/CartContext";
import AdminLogin from "./admin/Login";
import AdminDashboard from "./admin/Dashboard";
import AdminProdutos from "./admin/Produtos";
import AdminPedidos from "./admin/Pedidos";
import AdminAdministradores from "./admin/Administradores";
import AdminLoja from "./admin/Loja";
import { AdminThemeProvider } from "./admin/theme/AdminThemeContext";
import "./admin/theme/admin-dark-theme.css";

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
      </Routes>
    </PageTransition>
  );
}

// Rotas administrativas ficam fora do PageTransition (sem a onda/animação
// do storefront) — o admin tem sua própria identidade visual (Sidebar).
function AdminRoutes() {
  return (
    <Routes>
      <Route path="/admin/login" element={<AdminLogin />} />
      <Route
        path="/admin"
        element={
          <AdminThemeProvider>
            <AdminDashboard />
          </AdminThemeProvider>
        }
      />
      <Route
        path="/admin/produtos"
        element={
          <AdminThemeProvider>
            <AdminProdutos />
          </AdminThemeProvider>
        }
      />
      <Route
        path="/admin/pedidos"
        element={
          <AdminThemeProvider>
            <AdminPedidos />
          </AdminThemeProvider>
        }
      />
      <Route
        path="/admin/administradores"
        element={
          <AdminThemeProvider>
            <AdminAdministradores />
          </AdminThemeProvider>
        }
      />
      <Route
        path="/admin/loja"
        element={
          <AdminThemeProvider>
            <AdminLoja />
          </AdminThemeProvider>
        }
      />
    </Routes>
  );
}

export default function App() {
  return (
    <CartProvider>
      <BrowserRouter>
        <StorefrontRoutes />
        <AdminRoutes />
      </BrowserRouter>
    </CartProvider>
  );
}
