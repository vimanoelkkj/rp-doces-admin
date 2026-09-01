import { AuthGate } from "./auth/AuthGate";
import { ProductsPage } from "./products/ProductsPage";

export function App() {
  return (
    <AuthGate>
      {session => <ProductsPage session={session} />}
    </AuthGate>
  );
}
