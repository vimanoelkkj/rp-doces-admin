import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import Homepage from "./pages/Homepage";
import Cardapio from "./pages/Cardapio";
import Checkout from "./pages/Checkout";
import AguardandoPagamento from "./pages/AguardandoPagamento";
import PedidoConfirmado from "./pages/PedidoConfirmado";
import PagamentoNaoAprovado from "./pages/PagamentoNaoAprovado";
import PageTransition from "./components/PageTransition";
import { CartProvider } from "./context/CartContext";

function AnimatedRoutes() {
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
      </Routes>
    </PageTransition>
  );
}

export default function App() {
  return (
    <CartProvider>
      <BrowserRouter>
        <AnimatedRoutes />
      </BrowserRouter>
    </CartProvider>
  );
}
