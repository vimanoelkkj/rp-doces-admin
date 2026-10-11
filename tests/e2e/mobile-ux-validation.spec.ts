import { test, expect } from "@playwright/test";

const MOCK_PRODUTOS = [
  {
    id: 1,
    nome: "Bolo de Cenoura",
    categoria: "bolos",
    categoria_nome: "Bolos no Pote",
    descricao: "Bolo delicioso",
    destaque: 1,
    ordem: 1,
    estoque: 10,
    estoque_reservado: 0,
    preco_centavos: 1600,
    image_key: null
  },
  {
    id: 2,
    nome: "Pudim Tradicional",
    categoria: "pudins",
    categoria_nome: "Mini Pudins",
    descricao: "Pudim cremoso",
    destaque: 0,
    ordem: 2,
    estoque: 5,
    estoque_reservado: 0,
    preco_centavos: 1200,
    image_key: null
  },
  {
    id: 3,
    nome: "Torta Holandesa",
    categoria: "tortas",
    categoria_nome: "Tortas Artesanais",
    descricao: "Cremosa com chocolate belga",
    destaque: 0,
    ordem: 3,
    estoque: 8,
    estoque_reservado: 0,
    preco_centavos: 1800,
    image_key: null
  },
  {
    id: 4,
    nome: "Brownie Especial",
    categoria: "brownies",
    categoria_nome: "Brownies & Cookies",
    descricao: "Brownie com nozes",
    destaque: 0,
    ordem: 4,
    estoque: 12,
    estoque_reservado: 0,
    preco_centavos: 1400,
    image_key: null
  }
];

test.describe("Validação visual e funcional mobile das 3 melhorias", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test.beforeEach(async ({ page }) => {
    await page.route(
      url => url.pathname.startsWith("/api/"),
      route => {
        const path = new URL(route.request().url()).pathname;
        if (path === "/api/produtos") {
          return route.fulfill({ json: { produtos: MOCK_PRODUTOS } });
        }
        return route.fulfill({ json: {} });
      }
    );
  });

  test("1. Botão + possui área de toque efetiva de 44x44px sem clipping ou sobreposição indevida", async ({
    page
  }) => {
    await page.goto("/cardapio");
    await page.locator(".category-group").first().waitFor({ state: "visible", timeout: 15000 });

    const addButton = page.locator(".add-button:not([disabled])").first();
    await addButton.scrollIntoViewIfNeeded();

    // Mede a bounding box do botão e do pseudo-elemento ::before
    const metrics = await addButton.evaluate(el => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      const beforeStyle = window.getComputedStyle(el, "::before");
      return {
        buttonWidth: rect.width,
        buttonHeight: rect.height,
        position: style.position,
        overflow: style.overflow,
        beforeContent: beforeStyle.content,
        beforeWidth: beforeStyle.width,
        beforeHeight: beforeStyle.height,
        beforePosition: beforeStyle.position
      };
    });

    expect(metrics.buttonWidth).toBe(36);
    expect(metrics.buttonHeight).toBe(36);
    expect(metrics.beforeWidth).toBe("44px");
    expect(metrics.beforeHeight).toBe("44px");
    expect(metrics.beforeContent).not.toBe("none");

    // Testa clique real na área do hitbox expandido (::before)
    const buttonBox = await addButton.boundingBox();
    expect(buttonBox).not.toBeNull();
    if (!buttonBox) return;

    const badge = page.locator(".cart-fab-badge");
    const countBefore = (await badge.isVisible())
      ? Number.parseInt(await badge.innerText(), 10)
      : 0;

    // Clica ligeiramente fora da borda do círculo visual (no hitbox do ::before)
    await page.mouse.click(buttonBox.x - 2, buttonBox.y + buttonBox.height / 2);
    await expect(badge).toBeVisible();
    const countAfter = Number.parseInt(await badge.innerText(), 10);
    expect(countAfter).toBe(countBefore + 1);
  });

  test("2. Barra horizontal de categorias em 360px e 390px com scroll, toque e teclado", async ({
    page
  }) => {
    for (const width of [360, 390]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/cardapio");
      await page.locator(".category-group").first().waitFor({ state: "visible", timeout: 15000 });

      const tabsContainer = page.locator(".filter-tabs");
      const tabs = page.locator(".filter-tab");
      const count = await tabs.count();
      expect(count).toBeGreaterThan(1);

      // Verifica scrollWidth > clientWidth (conteúdo transborda horizontalmente e permite scroll)
      const scrollInfo = await tabsContainer.evaluate(el => {
        return {
          scrollWidth: el.scrollWidth,
          clientWidth: el.clientWidth,
          overflowX: window.getComputedStyle(el).overflowX,
          flexWrap: window.getComputedStyle(el).flexWrap
        };
      });

      expect(scrollInfo.flexWrap).toBe("nowrap");
      expect(scrollInfo.overflowX).toBe("auto");
      expect(scrollInfo.scrollWidth).toBeGreaterThan(scrollInfo.clientWidth);

      // Valida navegação por teclado: foca a segunda aba e ativa com Enter
      const secondTab = tabs.nth(1);
      await secondTab.focus();
      await page.keyboard.press("Enter");
      await expect(secondTab).toHaveClass(/active/);
    }
  });

  test("3. Botão voltar ao topo e posicionamento mobile", async ({ page }) => {
    await page.goto("/");
    await page.locator(".hero").waitFor({ state: "visible", timeout: 15000 });

    // Rola para baixo para ativar o botão voltar ao topo
    const scroller = page.locator(".homepage-content");
    await scroller.evaluate(el => {
      el.scrollTop = 500;
      el.dispatchEvent(new Event("scroll"));
    });

    const backToTop = page.locator(".back-to-top");
    await expect(backToTop).toHaveClass(/back-to-top--visible/);

    // Aguarda o término da transição CSS de opacidade/transform (0.3s)
    await page.waitForTimeout(350);

    const bttMetrics = await backToTop.evaluate(el => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return {
        bottom: style.bottom,
        right: style.right,
        rectBottom: rect.bottom,
        windowHeight: window.innerHeight,
        distanceFromBottom: window.innerHeight - rect.bottom
      };
    });

    expect(bttMetrics.bottom).toBe("84px");
    expect(bttMetrics.right).toBe("20px");
    expect(Math.round(bttMetrics.distanceFromBottom)).toBe(84);
  });
});
