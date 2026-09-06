import { useEffect } from "react";
import type { AdminV2Page } from "../layout/AdminShell";
import { listProducts } from "../products/product.api";
import { availableStock } from "../products/productDisplay";

type Props = {
  onNavigate: (page: AdminV2Page, focusProductIds?: number[]) => void;
};

function attentionAction(text: string): "low-stock" | "sold-out" | "orders" | null {
  const normalized = text.toLocaleLowerCase("pt-BR");
  if (normalized.includes("estoque baixo")) return "low-stock";
  if (normalized.includes("esgotado")) return "sold-out";
  if (normalized.includes("saldo pendente") || normalized.includes("aguardando") || normalized.includes("preparo")) {
    return "orders";
  }
  return null;
}

function attentionItem(target: EventTarget | null): HTMLLIElement | null {
  if (!(target instanceof Element)) return null;
  const item = target.closest("li");
  if (!(item instanceof HTMLLIElement)) return null;
  if (!item.closest('[data-admin-view="dashboard"]')) return null;
  return attentionAction(item.textContent || "") ? item : null;
}

export function AttentionNavigationBridge({ onNavigate }: Props) {
  useEffect(() => {
    let alive = true;

    const decorate = () => {
      document.querySelectorAll<HTMLLIElement>('[data-admin-view="dashboard"] li').forEach(item => {
        if (!attentionAction(item.textContent || "")) return;
        item.dataset.attentionLink = "true";
        item.tabIndex = 0;
        item.setAttribute("role", "button");
        item.setAttribute("aria-label", `${item.textContent?.trim() || "Aviso"}. Abrir detalhes.`);
      });
    };

    const activate = async (item: HTMLLIElement) => {
      const action = attentionAction(item.textContent || "");
      if (!action) return;

      if (action === "orders") {
        onNavigate("pedidos");
        return;
      }

      try {
        const products = await listProducts();
        if (!alive) return;
        const ids = products
          .filter(product => {
            const available = availableStock(product);
            if (!product.ativo) return false;
            return action === "sold-out" ? available <= 0 : available > 0 && available <= 2;
          })
          .map(product => product.id);
        onNavigate("produtos", ids);
      } catch {
        onNavigate("produtos");
      }
    };

    const handleClick = (event: MouseEvent) => {
      const item = attentionItem(event.target);
      if (!item) return;
      event.preventDefault();
      void activate(item);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const item = attentionItem(event.target);
      if (!item) return;
      event.preventDefault();
      void activate(item);
    };

    const observer = new MutationObserver(decorate);
    observer.observe(document.body, { childList: true, subtree: true });
    decorate();
    document.addEventListener("click", handleClick);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      alive = false;
      observer.disconnect();
      document.removeEventListener("click", handleClick);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onNavigate]);

  useEffect(() => {
    const style = document.createElement("style");
    style.dataset.rpAttentionNavigation = "true";
    style.textContent = `
      [data-admin-view="dashboard"] li[data-attention-link="true"] {
        cursor: pointer;
        transition: transform 140ms ease, box-shadow 160ms ease, border-color 160ms ease;
      }
      [data-admin-view="dashboard"] li[data-attention-link="true"]:hover,
      [data-admin-view="dashboard"] li[data-attention-link="true"]:focus-visible {
        transform: translateY(-1px);
        box-shadow: 0 6px 18px rgba(206, 61, 95, .08);
        outline: 2px solid rgba(220, 78, 109, .22);
        outline-offset: 2px;
      }
    `;
    document.head.append(style);
    return () => style.remove();
  }, []);

  return null;
}
