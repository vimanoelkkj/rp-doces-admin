import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import Homepage from "./pages/Homepage";
import PageTransition from "./components/PageTransition";

function CardapioPlaceholder() {
  return (
    <div style={{ padding: 32, fontFamily: "sans-serif" }}>
      Cardápio — em construção
    </div>
  );
}

function AnimatedRoutes() {
  const location = useLocation();

  return (
    <PageTransition locationKey={location.key}>
      <Routes location={location}>
        <Route path="/" element={<Homepage />} />
        <Route path="/cardapio" element={<CardapioPlaceholder />} />
      </Routes>
    </PageTransition>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AnimatedRoutes />
    </BrowserRouter>
  );
}
