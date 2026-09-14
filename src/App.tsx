import { BrowserRouter, Routes, Route } from "react-router-dom";

function Placeholder() {
  return (
    <div style={{ padding: 32, fontFamily: "sans-serif" }}>
      R&amp;P Doces — em construção
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Placeholder />} />
      </Routes>
    </BrowserRouter>
  );
}
