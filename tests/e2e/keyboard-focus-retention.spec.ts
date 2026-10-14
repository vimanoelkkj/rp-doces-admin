import { test, expect, type Locator } from "@playwright/test";

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
  }
];

test.describe("Navegação por teclado: retenção de foco em ações interativas", () => {
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

    await page.goto("/cardapio");
    await page.locator(".category-group").first().waitFor({ state: "visible", timeout: 15000 });
  });

  test.describe("coarse pointer with keyboard and touch", () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    for (const theme of ["light", "dark"] as const) {
      test(`focus indicators follow input modality in ${theme} mode`, async ({ page }) => {
        if ((await page.locator("html").getAttribute("data-theme")) !== theme) {
          await page.locator(".theme-toggle-btn").click();
        }
        await expect(page.locator("html")).not.toHaveAttribute("data-theme-transitioning");
        expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);

        const expectKeyboardOutline = async (control: Locator) => {
          await control.focus();
          await page.keyboard.press("Shift+Tab");
          await page.keyboard.press("Tab");
          await expect(control).toBeFocused();
          expect(await control.evaluate(el => el.matches(":focus-visible"))).toBe(true);
          const outline = await control.evaluate(el => {
            const style = getComputedStyle(el);
            return { style: style.outlineStyle, width: parseFloat(style.outlineWidth) };
          });
          expect(outline.style).not.toBe("none");
          expect(outline.width).toBeGreaterThan(0);
        };
        const expectTouchOutline = async (control: Locator) => {
          await control.tap();
          await expect(control).toBeFocused();
          expect(await control.evaluate(el => el.matches(":focus-visible"))).toBe(false);
          await expect(control).toHaveCSS("outline-style", "none");
        };

        const filter = page.locator(".filter-tab").first();
        const add = page.locator(".add-button:not([disabled])").first();
        await expectKeyboardOutline(filter);
        await expectKeyboardOutline(add);
        await expectTouchOutline(filter);
        await expectTouchOutline(add);

        const fab = page.locator(".cart-fab");
        await expectKeyboardOutline(fab);
        await fab.tap();
        await expect(page.locator(".cart-modal")).toBeVisible();
        const close = page.locator(".cart-close-btn");
        await expect(close).toBeVisible();
        await expect(close).toBeFocused();
        const quantity = page.locator(".cart-qty-controls button").last();
        await expectKeyboardOutline(close);
        await expectKeyboardOutline(quantity);
        await expectKeyboardOutline(page.locator(".cart-checkout-btn"));
        await expectTouchOutline(quantity);
        await close.tap();
        await expect(fab).toBeFocused();
        expect(await fab.evaluate(el => el.matches(":focus-visible"))).toBe(false);
        await expect(fab).toHaveCSS("outline-style", "none");
      });
    }
  });

  test("ativar aba de filtro com Enter preserva foco na aba selecionada", async ({ page }) => {
    const tabs = page.locator(".filter-tab");
    const secondTab = tabs.nth(1);
    await secondTab.focus();
    await expect(secondTab).toBeFocused();

    // Pressiona Enter para ativar o filtro
    await page.keyboard.press("Enter");

    // O foco NÃO deve ser ejetado para o body
    await expect(secondTab).toBeFocused();
    const isBodyFocused = await page.evaluate(() => document.activeElement === document.body);
    expect(isBodyFocused).toBe(false);
  });

  test("adicionar produto ao carrinho via teclado não ejeta foco para document.body", async ({
    page
  }) => {
    const addButtons = page.locator(".add-button:not([disabled])");
    const firstAddBtn = addButtons.first();
    await firstAddBtn.focus();
    await expect(firstAddBtn).toBeFocused();

    // Pressiona Enter para adicionar
    await page.keyboard.press("Enter");

    // O foco permanece no elemento (ou no contexto do card), não no body
    const isBodyFocused = await page.evaluate(() => document.activeElement === document.body);
    expect(isBodyFocused).toBe(false);
  });

  test("pressionamentos repetidos de Enter durante justAdded não adicionam itens duplicados", async ({
    page
  }) => {
    const firstAddBtn = page.locator(".add-button:not([disabled])").first();
    await firstAddBtn.focus();

    // Pressiona Enter 3 vezes em rápida sucessão
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");

    // O badge do carrinho deve exibir exatamente '1' item
    const badge = page.locator(".cart-fab-badge");
    await expect(badge).toHaveText("1");
  });

  test("ajustar quantidade no carrinho via teclado mantém foco no botão clicado", async ({
    page
  }) => {
    // Adiciona 1 produto para abrir a sacola
    const firstAddBtn = page.locator(".add-button:not([disabled])").first();
    await firstAddBtn.click();

    // Abre o carrinho
    const fab = page.locator(".cart-fab");
    await fab.waitFor({ state: "visible" });
    await fab.click();

    const cartModal = page.locator(".cart-modal");
    await cartModal.waitFor({ state: "visible" });

    // Foca o botão '+' de quantidade na linha do item
    const plusBtn = page.locator(".cart-qty-controls button:has-text('+')").first();
    await plusBtn.focus();
    await expect(plusBtn).toBeFocused();

    // Pressiona Enter para incrementar
    await page.keyboard.press("Enter");

    // O botão '+' continua focado, permitindo múltiplos cliques sem perder posição
    await expect(plusBtn).toBeFocused();
    const isBodyFocused = await page.evaluate(() => document.activeElement === document.body);
    expect(isBodyFocused).toBe(false);
  });
});
