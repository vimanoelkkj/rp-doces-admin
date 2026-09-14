import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import Homepage from "./pages/Homepage";
import Cardapio from "./pages/Cardapio";
import Checkout from "./pages/Checkout";
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
