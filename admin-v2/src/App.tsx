import { AuthGate } from "./auth/AuthGate";
import { ProductsPage } from "./products/ProductsPage";

export function App() {
  return <AuthGate>{() => <ProductsPage />}</AuthGate>;
}
