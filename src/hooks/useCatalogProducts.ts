import { useEffect, useState } from "react";
import { fetchProducts } from "../api/products";
import type { Product } from "../types/product";

const MIN_REVALIDATION_INTERVAL_MS = 2_000;

export function useCatalogProducts() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let inFlight = false;
    let lastRequestAt = 0;

    const load = (initial = false) => {
      const now = Date.now();
      if (inFlight || (!initial && now - lastRequestAt < MIN_REVALIDATION_INTERVAL_MS)) return;
      inFlight = true;
      lastRequestAt = now;
      if (initial) setLoading(true);
      fetchProducts()
        .then((next) => {
          if (!active) return;
          setProducts(next);
          setError(null);
        })
        .catch((reason: unknown) => {
          if (!active) return;
          setError(reason instanceof Error ? reason.message : "Falha ao carregar produtos");
        })
        .finally(() => {
          inFlight = false;
          if (active) setLoading(false);
        });
    };

    const onVisible = () => {
      if (document.visibilityState === "visible") load();
    };
    const onFocus = () => load();

    load(true);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      active = false;
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return { products, loading, error };
}
