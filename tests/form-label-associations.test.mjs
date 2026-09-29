import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

const dom = new JSDOM('<!doctype html><body><div id="root"></div></body>', {
  url: "https://local.test/admin"
});
const channels = [];
const NativeMessageChannel = globalThis.MessageChannel;
globalThis.MessageChannel = class extends NativeMessageChannel {
  constructor() {
    super();
    channels.push(this);
  }
};
for (const name of [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "Node",
  "Event",
  "MouseEvent",
  "MutationObserver",
  "localStorage"
]) {
  Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name] });
}
dom.window.scrollTo = () => {};
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

test.after(() => {
  dom.window.close();
  for (const channel of channels) {
    channel.port1.close();
    channel.port2.close();
  }
  globalThis.MessageChannel = NativeMessageChannel;
});

const bundle = await build({
  stdin: {
    resolveDir: process.cwd(),
    loader: "tsx",
    contents: `
      import {createRoot} from "react-dom/client";
      import AlterarSenhaModal from "./src/admin/Administradores/AlterarSenhaModal";
      import NovoAdminModal from "./src/admin/Administradores/NovoAdminModal";
      import GastoModal from "./src/admin/Despesas/GastoModal";
      import NovoPedidoModal from "./src/admin/Pedidos/NovoPedidoModal";
      import CategoriasModal from "./src/admin/Produtos/CategoriasModal";
      import NovoProdutoModal from "./src/admin/Produtos/NovoProdutoModal";
      import AdminLogin from "./src/admin/Login/AdminLogin";
      import AdminPedidos from "./src/admin/Pedidos/AdminPedidos";
      import AdminProdutos from "./src/admin/Produtos/AdminProdutos";
      import Checkout from "./src/pages/Checkout";
      import {CartProvider} from "./src/context/CartContext";
      import {StoreThemeProvider} from "./src/context/StoreThemeContext";
      import {MemoryRouter} from "react-router-dom";
      export {act} from "react";

      const noop = () => {};
      export function mount(container, component) {
        const root = createRoot(container);
        const element = {
          alterarSenha: <AlterarSenhaModal adminId={1} adminNome="Ana" isSelf onClose={noop} onSaved={noop} />,
          novoAdmin: <NovoAdminModal open onClose={noop} onSaved={noop} />,
          gasto: <GastoModal modo="criar" descricoesConhecidas={[]} onClose={noop} onSaved={noop} />,
          novoPedido: <NovoPedidoModal open onClose={noop} />,
          categorias: <CategoriasModal open onClose={noop} />,
          novoProduto: <NovoProdutoModal open onClose={noop} />,
          adminLogin: <StoreThemeProvider><MemoryRouter><AdminLogin /></MemoryRouter></StoreThemeProvider>,
          adminPedidos: <MemoryRouter><AdminPedidos /></MemoryRouter>,
          adminProdutos: <AdminProdutos />,
          checkout: <MemoryRouter><CartProvider><Checkout /></CartProvider></MemoryRouter>,
        }[component];
        root.render(element);
        return root;
      }
    `
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"development"' },
  loader: { ".css": "empty", ".png": "dataurl" }
});
const ui = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

globalThis.fetch = async url => {
  const target = String(url);
  if (target.includes("/categorias")) return Response.json({ categorias: [] });
  if (target.includes("/admin/produtos")) return Response.json({ produtos: [] });
  if (target.includes("/admin/pedidos/reconciliar")) return Response.json({ ok: true });
  if (target.includes("/admin/pedidos")) {
    return Response.json({
      pedidos: [],
      total: 0,
      page: 1,
      totalPages: 2,
      counts: {
        todos: 0,
        hoje: 0,
        novos: 0,
        em_producao: 0,
        prontos: 0,
        entregues: 0,
        arquivados: 0
      }
    });
  }
  if (target.endsWith("/api/produtos")) {
    return Response.json({
      produtos: [
        {
          id: 1,
          nome: "Bolo",
          categoria: "BOLO",
          categoria_nome: "Bolo",
          descricao: "Doce",
          destaque: 0,
          ordem: 1,
          estoque: 10,
          estoque_reservado: 0,
          image_key: null,
          preco_centavos: 1000,
          preco_promocional_centavos: null,
          promocao_ativa: 0,
          promocao_inicio: null,
          promocao_fim: null
        }
      ]
    });
  }
  return Response.json({});
};

async function render(component) {
  const container = document.getElementById("root");
  localStorage.clear();
  if (component === "checkout") {
    localStorage.setItem(
      "rp-doces:cart",
      JSON.stringify([{ id: 1, name: "Bolo", price: 10, image: "", quantity: 1 }])
    );
  }
  let root;
  await ui.act(async () => {
    root = ui.mount(container, component);
  });
  await ui.act(async () => new Promise(setImmediate));
  return async () => {
    await ui.act(async () => root.unmount());
    container.innerHTML = "";
  };
}

function assertDecorativeSvgs(selector) {
  const svgs = [...document.querySelectorAll(selector)];
  assert.ok(svgs.length > 0, `seletor sem SVG renderizado: ${selector}`);
  for (const svg of svgs) assert.equal(svg.getAttribute("aria-hidden"), "true");
}

function assertNamedControls(selector) {
  const controls = [...document.querySelectorAll(selector)];
  assert.ok(controls.length > 0, `seletor sem controle renderizado: ${selector}`);
  for (const control of controls) {
    const name = control.getAttribute("aria-label") || control.textContent.trim();
    assert.ok(name, `controle sem nome acessível: ${selector}`);
  }
}

for (const component of [
  "alterarSenha",
  "novoAdmin",
  "gasto",
  "novoPedido",
  "categorias",
  "novoProduto",
  "checkout"
]) {
  test(`${component}: labels apontam para controles e IDs não se repetem`, async () => {
    const unmount = await render(component);
    try {
      const labels = [...document.querySelectorAll("label")];
      assert.ok(labels.length > 0, "o formulário deve expor labels nativos");
      for (const label of labels) {
        assert.ok(label.control, `label sem controle: ${label.textContent.trim()}`);
      }

      const ids = [...document.querySelectorAll("[id]")].map(element => element.id);
      assert.equal(new Set(ids).size, ids.length, "IDs do modal devem ser únicos");

      for (const element of document.querySelectorAll("[aria-labelledby]")) {
        for (const id of element.getAttribute("aria-labelledby").split(" ")) {
          assert.ok(document.getElementById(id), `aria-labelledby aponta para ID ausente: ${id}`);
        }
      }
    } finally {
      await unmount();
    }
  });
}

test("ícones administrativos redundantes não alteram os nomes dos controles", async () => {
  for (const [component, svgSelector, controlSelector] of [
    ["novoAdmin", ".nadm-dropdown-trigger svg, .nadm-info-box svg", ".nadm-dropdown-trigger"],
    ["gasto", ".gasto-modal svg", ".gasto-modal button"],
    [
      "novoPedido",
      ".nped-btn-add-item svg, .nped-dropdown-trigger svg",
      ".nped-btn-add-item, .nped-dropdown-trigger"
    ],
    ["novoProduto", ".np-dropdown-trigger svg", ".np-dropdown-trigger"],
    ["adminProdutos", ".prod-btn-primary svg, .prod-search svg", ".prod-btn-primary"],
    ["adminPedidos", ".ped-btn-primary svg, .ped-search svg", ".ped-btn-primary"]
  ]) {
    const unmount = await render(component);
    try {
      assertDecorativeSvgs(svgSelector);
      assertNamedControls(controlSelector);
    } finally {
      await unmount();
    }
  }

  const unmount = await render("adminLogin");
  try {
    assertDecorativeSvgs(
      ".admin-login-theme-toggle svg, .admin-login-logo-circle svg, .admin-login-biometry svg"
    );
    assertNamedControls(".admin-login-theme-toggle, .admin-login-biometry");

    const username = document.querySelector("#admin-username");
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    await ui.act(async () => {
      setter.call(username, "ana");
      username.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await ui.act(async () => document.querySelector(".admin-login-form").requestSubmit());
    assertDecorativeSvgs(".admin-login-eye-toggle svg");
    assertNamedControls(".admin-login-eye-toggle");
  } finally {
    await unmount();
  }
});

test("AdminLogin preserva foco durante a navegacao entre etapas", async () => {
  const unmount = await render("adminLogin");

  try {
    // 1. Foco inicial no usuario.
    const username = document.querySelector("#admin-username");

    assert.ok(username, "campo de usuario deve existir");
    assert.equal(document.activeElement, username, "foco inicial deve estar no usuario");

    // 2. Preencher usuario e avancar para senha.
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;

    await ui.act(async () => {
      setter.call(username, "ana");
      username.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await ui.act(async () => {
      document.querySelector(".admin-login-form").requestSubmit();
    });

    const password = document.querySelector("#admin-password");

    assert.ok(password, "campo de senha deve existir");
    assert.equal(document.activeElement, password, "foco deve migrar para senha ao avancar");

    // 3. Mostrar/ocultar senha nao deve roubar o foco do input.
    const toggle = document.querySelector(".admin-login-eye-toggle");

    await ui.act(async () => {
      toggle.click();
    });

    assert.equal(password.type, "text");
    assert.equal(document.activeElement, password, "alternar visibilidade nao deve roubar o foco");

    // 4. Voltar para usuario restaura o foco corretamente.
    await ui.act(async () => {
      document.querySelector(".admin-login-change-user").click();
    });

    const restoredUsername = document.querySelector("#admin-username");

    assert.ok(restoredUsername, "campo de usuario deve voltar a existir");
    assert.equal(document.activeElement, restoredUsername, "foco deve retornar ao usuario");
  } finally {
    await unmount();
  }
});

test("controles somente com ícone expõem ação, estado e preservam interação", async () => {
  for (const [component, selector, expectedName] of [
    ["alterarSenha", ".nadm-close", "Fechar alteração de senha"],
    ["categorias", ".catm-close", "Fechar categorias"]
  ]) {
    const unmount = await render(component);
    try {
      const control = document.querySelector(selector);
      assert.equal(control.getAttribute("aria-label"), expectedName);
      assert.equal(control.querySelector("svg").getAttribute("aria-hidden"), "true");
    } finally {
      await unmount();
    }
  }

  let unmount = await render("novoAdmin");
  try {
    const close = document.querySelector(".nadm-close");
    assert.equal(close.getAttribute("aria-label"), "Fechar novo administrador");
    assert.equal(close.querySelector("svg").getAttribute("aria-hidden"), "true");

    const passwordToggles = [...document.querySelectorAll(".nadm-eye-btn")];
    assert.deepEqual(
      passwordToggles.map(button => button.getAttribute("aria-label")),
      ["Mostrar senha", "Mostrar confirmação da senha"]
    );
    for (const button of passwordToggles) {
      assert.equal(button.querySelector("svg").getAttribute("aria-hidden"), "true");
    }
    await ui.act(async () => passwordToggles[0].click());
    assert.equal(passwordToggles[0].getAttribute("aria-label"), "Ocultar senha");
  } finally {
    await unmount();
  }

  unmount = await render("novoProduto");
  try {
    const close = document.querySelector(".np-close");
    assert.equal(close.getAttribute("aria-label"), "Fechar produto");
    assert.equal(close.querySelector("svg").getAttribute("aria-hidden"), "true");

    const [decrease, increase] = document.querySelectorAll(".np-stepper-btn");
    assert.equal(decrease.getAttribute("aria-label"), "Diminuir estoque");
    assert.equal(increase.getAttribute("aria-label"), "Aumentar estoque");
    assert.equal(decrease.querySelector("svg").getAttribute("aria-hidden"), "true");
    assert.equal(increase.querySelector("svg").getAttribute("aria-hidden"), "true");
    const stock = document.querySelector(".np-stepper-value");
    assert.equal(stock.value, "0");
    await ui.act(async () => increase.click());
    assert.equal(stock.value, "1");
    await ui.act(async () => decrease.click());
    assert.equal(stock.value, "0");
  } finally {
    await unmount();
  }

  unmount = await render("novoPedido");
  try {
    const close = document.querySelector(".nped-close");
    assert.equal(close.getAttribute("aria-label"), "Fechar novo pedido");
    assert.equal(close.querySelector("svg").getAttribute("aria-hidden"), "true");
    await ui.act(async () => document.querySelector(".nped-btn-add-item").click());
    const removeButtons = [...document.querySelectorAll(".nped-btn-remove")];
    assert.equal(removeButtons.length, 2);
    for (const button of removeButtons) {
      assert.equal(button.getAttribute("aria-label"), "Remover item do pedido");
      assert.equal(button.querySelector("svg").getAttribute("aria-hidden"), "true");
    }
    await ui.act(async () => removeButtons[0].click());
    assert.equal(document.querySelectorAll(".nped-item-row").length, 1);
  } finally {
    await unmount();
  }

  unmount = await render("adminPedidos");
  try {
    const [previous, next] = document.querySelectorAll(".ped-page-arrow");
    assert.equal(previous.getAttribute("aria-label"), "Página anterior");
    assert.equal(next.getAttribute("aria-label"), "Próxima página");
    assert.equal(previous.querySelector("svg").getAttribute("aria-hidden"), "true");
    assert.equal(next.querySelector("svg").getAttribute("aria-hidden"), "true");
    assert.equal(previous.disabled, true);
    assert.equal(next.disabled, false);
    await ui.act(async () => next.click());
    await ui.act(async () => new Promise(setImmediate));
    assert.equal(previous.disabled, false);
  } finally {
    await unmount();
  }
});
