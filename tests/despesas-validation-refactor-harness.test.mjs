import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";

// Compile real validation in memory. The private calendar helper is exposed
// only here; negative controls never write production files. Loaded-module
// anchors allow the validators to move behind the existing public reexports.
async function compile(mutation) {
  let exposed = 0;
  let replacements = 0;
  const result = await build({
    stdin: {
      contents: "export * from './functions/lib/despesas';",
      resolveDir: process.cwd(),
      loader: "ts"
    },
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    plugins: [
      {
        name: "validation-characterization",
        setup(api) {
          api.onLoad({ filter: /\.ts$/ }, async ({ path }) => {
            let contents = (await readFile(path, "utf8")).replace(/\r\n/g, "\n");
            if (/^(?:export )?function isValidCalendarDate\(/m.test(contents)) {
              exposed++;
              contents += "\nexport { isValidCalendarDate as calendarForTest };\n";
            }
            if (mutation && contents.includes(mutation.from)) {
              assert.equal(contents.split(mutation.from).length - 1, 1, mutation.name);
              replacements++;
              contents = contents.replace(mutation.from, mutation.to);
            }
            return { contents, loader: "ts" };
          });
        }
      }
    ]
  });
  assert.equal(exposed, 1, "Exactly one calendar implementation");
  if (mutation) assert.equal(replacements, 1, mutation.name);
  return import(
    `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
  );
}
const production = await compile();
const errors = {
  list: "A despesa precisa ter ao menos um item",
  count: "Máximo de 60 itens por despesa",
  shape: "Item de despesa inválido",
  description: "Descrição do item é obrigatória (até 200 caracteres)",
  category:
    "Categoria inválida. Use uma de: INGREDIENTES, EMBALAGENS, ENTREGA_TRANSPORTE, TAXAS, MARKETING, EQUIPAMENTOS, MANUTENCAO, SERVICOS, OUTROS",
  unit: "Unidade inválida. Use uma de: UN, KG, G, L, ML, PACOTE, CAIXA, BANDEJA, OUTRO",
  quantity: "Quantidade deve ser um número maior que zero",
  roundedQuantity: "Quantidade inválida",
  price: "Valor unitário deve ser maior que zero",
  precision: "Valor unitário aceita no máximo 5 casas decimais em reais",
  total: "Total do item inválido",
  supplier: "Fornecedor muito longo",
  date: "Data da compra inválida (esperado YYYY-MM-DD)",
  observation: "Observação muito longa"
};
const item = (changes = {}) => ({
  descricao: "Ovos",
  categoria: "INGREDIENTES",
  quantidade: 2,
  unidade: "UN",
  valorUnitarioCentavos: 100,
  ...changes
});
const normalized = (changes = {}) => ({
  descricao: "Ovos",
  categoria: "INGREDIENTES",
  quantidadeMilesimos: 2000,
  unidade: "UN",
  valorUnitarioCentavos: 100,
  valorTotalCentavos: 200,
  ...changes
});
const header = (changes = {}) => ({
  fornecedor: "Loja",
  dataCompetencia: "2026-09-22",
  observacao: "Compra",
  ...changes
});
const successItems = (...itens) => ({ ok: true, itens });
const failure = key => ({ ok: false, erro: errors[key] });
const cases = [];
function scenario(name, method, input, expected) {
  cases.push({ name, method, input, expected });
}
function validItem(name, changes = {}, output = {}) {
  scenario(name, "validarItens", [item(changes)], successItems(normalized(output)));
}
function invalidItem(name, changes, error) {
  scenario(name, "validarItens", [item(changes)], failure(error));
}

for (const [date, expected] of [
  ["2026-09-22", true],
  ["2024-02-29", true],
  ["2000-02-29", true],
  ["2025-02-29", false],
  ["1900-02-29", false],
  ["2026-04-31", false],
  ["2026-00-01", false],
  ["2026-13-01", false],
  ["2026-01-00", false],
  ["2026-01-32", false],
  ["22/09/2026", false],
  ["2026-9-22", false],
  ["2026-09-22T00:00:00Z", false],
  [" 2026-09-22 ", false],
  ["", false],
  ["0100-01-01", true]
])
  scenario(`calendar: ${JSON.stringify(date)}`, "calendarForTest", date, expected);
for (let year = 0; year < 100; year++) {
  const date = `${String(year).padStart(4, "0")}-01-01`;
  scenario(`calendar: Date.UTC year ${date.slice(0, 4)}`, "calendarForTest", date, false);
}
for (const [name, changes, output] of [
  ["valid header", {}, {}],
  ["supplier trim", { fornecedor: "  Loja  " }, {}],
  ["supplier non string", { fornecedor: 123 }, { fornecedor: "" }],
  ["supplier empty", { fornecedor: "" }, { fornecedor: "" }],
  ["supplier exact limit", { fornecedor: "a".repeat(200) }, { fornecedor: "a".repeat(200) }],
  [
    "supplier limit after trim",
    { fornecedor: ` ${"a".repeat(200)} ` },
    { fornecedor: "a".repeat(200) }
  ],
  ["observation trim", { observacao: "  Compra  " }, {}],
  ["observation non string", { observacao: null }, { observacao: "" }],
  ["observation empty", { observacao: "" }, { observacao: "" }],
  ["observation exact limit", { observacao: "a".repeat(1000) }, { observacao: "a".repeat(1000) }],
  ["date trim", { dataCompetencia: " 2026-09-22 " }, {}],
  [
    "optional fields absent",
    { fornecedor: undefined, observacao: undefined },
    { fornecedor: "", observacao: "" }
  ],
  ["leap date", { dataCompetencia: "2024-02-29" }, { dataCompetencia: "2024-02-29" }]
])
  scenario(`header: ${name}`, "validarCabecalho", header(changes), {
    ok: true,
    cabecalho: header(output)
  });
for (const [name, changes, error] of [
  ["supplier over limit", { fornecedor: "a".repeat(201) }, "supplier"],
  ["observation over limit", { observacao: "a".repeat(1001) }, "observation"],
  ["impossible date", { dataCompetencia: "2026-02-29" }, "date"],
  ["invalid date format", { dataCompetencia: "22/09/2026" }, "date"],
  ["date absent", { dataCompetencia: undefined }, "date"],
  ["date non string", { dataCompetencia: 20260922 }, "date"],
  [
    "supplier before date and observation",
    { fornecedor: "a".repeat(201), dataCompetencia: "", observacao: "a".repeat(1001) },
    "supplier"
  ],
  ["date before observation", { dataCompetencia: "", observacao: "a".repeat(1001) }, "date"]
])
  scenario(`header: ${name}`, "validarCabecalho", header(changes), failure(error));
validItem("items: valid item");
validItem("items: description trim", { descricao: "  Ovos  " });
validItem(
  "items: description limit",
  { descricao: "a".repeat(200) },
  { descricao: "a".repeat(200) }
);
for (const category of [
  "INGREDIENTES",
  "EMBALAGENS",
  "ENTREGA_TRANSPORTE",
  "TAXAS",
  "MARKETING",
  "EQUIPAMENTOS",
  "MANUTENCAO",
  "SERVICOS",
  "OUTROS"
])
  validItem(`items: category ${category}`, { categoria: category }, { categoria: category });
for (const unit of ["UN", "KG", "G", "L", "ML", "PACOTE", "CAIXA", "BANDEJA", "OUTRO"])
  validItem(`items: unit ${unit}`, { unidade: unit }, { unidade: unit });
for (const [name, changes, error] of [
  ["empty description", { descricao: "  " }, "description"],
  ["non string description", { descricao: 12 }, "description"],
  ["long description", { descricao: "a".repeat(201) }, "description"],
  ["invalid category", { categoria: "ingredientes" }, "category"],
  ["invalid unit", { unidade: "un" }, "unit"],
  ["numeric string quantity", { quantidade: "2" }, "quantity"],
  ["zero quantity", { quantidade: 0 }, "quantity"],
  ["negative quantity", { quantidade: -1 }, "quantity"],
  ["NaN quantity", { quantidade: NaN }, "quantity"],
  ["infinite quantity", { quantidade: Infinity }, "quantity"],
  ["quantity above limit", { quantidade: 1_000_001 }, "quantity"],
  ["quantity rounded to zero", { quantidade: 0.00049 }, "roundedQuantity"],
  ["numeric string price", { valorUnitarioCentavos: "100" }, "price"],
  ["zero price", { valorUnitarioCentavos: 0 }, "price"],
  ["negative price", { valorUnitarioCentavos: -1 }, "price"],
  ["NaN price", { valorUnitarioCentavos: NaN }, "price"],
  ["infinite price", { valorUnitarioCentavos: Infinity }, "price"],
  ["price above limit", { valorUnitarioCentavos: 100_000_001 }, "price"],
  ["invalid precision", { valorUnitarioCentavos: 116.3051 }, "precision"],
  ["above tolerance", { valorUnitarioCentavos: 1.0000000011 }, "precision"],
  ["floating tolerance boundary rejected", { valorUnitarioCentavos: 1.000000001 }, "precision"],
  ["total rounds to zero", { quantidade: 0.001, valorUnitarioCentavos: 1 }, "total"],
  ["description before category", { descricao: "", categoria: "invalid" }, "description"],
  ["category before unit", { categoria: "invalid", unidade: "invalid" }, "category"],
  ["unit before quantity", { unidade: "invalid", quantidade: 0 }, "unit"],
  ["quantity before price", { quantidade: 0, valorUnitarioCentavos: 0 }, "quantity"],
  [
    "rounded quantity before price",
    { quantidade: 0.0001, valorUnitarioCentavos: 0 },
    "roundedQuantity"
  ]
])
  invalidItem(`items: ${name}`, changes, error);
for (const [name, quantity, price, thousandths, total] of [
  ["extra quantity decimals round down", 1.2344, 100, 1234, 123],
  ["extra quantity decimals round up", 1.2346, 100, 1235, 124],
  ["quantity half rounds up", 1.2345, 100, 1235, 124],
  ["smallest quantity half", 0.0005, 1000, 1, 1],
  ["fractional cents", 200, 116.305, 200000, 23261],
  ["one millicent", 1000, 0.001, 1000000, 1],
  ["below tolerance preserves original", 2, 1.0000000009, 2000, 2],

  ["below half cent", 1, 1.499, 1000, 1],
  ["half cent rounds up", 1, 1.5, 1000, 2],
  ["above half cent", 1, 1.501, 1000, 2],
  ["quantity exact maximum", 1000000, 100, 1000000000, 100000000],
  ["price exact maximum", 2, 100000000, 2000, 200000000],
  ["BigInt product beyond safe intermediate", 999999.999, 99999999.999, 999999999, 99999999899000]
])
  validItem(
    `items: ${name}`,
    { quantidade: quantity, valorUnitarioCentavos: price },
    { quantidadeMilesimos: thousandths, valorUnitarioCentavos: price, valorTotalCentavos: total }
  );
validItem("items: client totals and unknown fields ignored", {
  valorTotalCentavos: 999999,
  total: 999999,
  extra: true
});
scenario(
  "items: multiple items preserve order",
  "validarItens",
  [item({ descricao: "Z" }), item({ descricao: "A", quantidade: 3 })],
  successItems(
    normalized({ descricao: "Z" }),
    normalized({ descricao: "A", quantidadeMilesimos: 3000, valorTotalCentavos: 300 })
  )
);
scenario(
  "items: first failing item wins",
  "validarItens",
  [item(), item({ unidade: "invalid" }), item({ descricao: "" })],
  failure("unit")
);
for (const [name, raw, error] of [
  ["empty list", [], "list"],
  ["missing list", undefined, "list"],
  ["non array", {}, "list"],
  ["null item", [null], "shape"],
  ["array item", [[]], "shape"],
  ["primitive item", [1], "shape"],
  ["over item limit before item validation", Array(61).fill(null), "count"]
])
  scenario(`items: ${name}`, "validarItens", raw, failure(error));
scenario(
  "items: exact item limit",
  "validarItens",
  Array.from({ length: 60 }, () => item()),
  successItems(...Array.from({ length: 60 }, () => normalized()))
);
scenario("header: plain empty object requires date", "validarCabecalho", {}, failure("date"));
function assertCase(module, entry) {
  assert.deepEqual(module[entry.method](entry.input), entry.expected, entry.name);
}
for (const entry of cases) test(entry.name, () => assertCase(production, entry));
test("validation does not mutate plain input objects", () => {
  const input = [item({ descricao: " Ovos ", total: 999 })];
  const body = header({ fornecedor: " Loja " });
  const before = structuredClone({ input, body });
  production.validarItens(input);
  production.validarCabecalho(body);
  assert.deepEqual({ input, body }, before);
});
const controls = [
  {
    name: "trim removed",
    from: "descricaoRaw.trim()",
    to: "descricaoRaw",
    scenario: "items: description trim"
  },
  {
    name: "numeric string coerced",
    from: 'typeof quantidade !== "number" ||\n      !Number.isFinite(quantidade)',
    to: "!Number.isFinite(Number(quantidade))",
    scenario: "items: numeric string quantity"
  },
  {
    name: "thousandths truncated",
    from: "Math.round(quantidade * QUANTIDADE_MILESIMOS_POR_UNIDADE)",
    to: "Math.floor(quantidade * QUANTIDADE_MILESIMOS_POR_UNIDADE)",
    scenario: "items: extra quantity decimals round up"
  },
  {
    name: "monetary tolerance widened",
    from: "> 1e-6",
    to: "> 1e-5",
    scenario: "items: above tolerance"
  },
  {
    name: "original price replaced",
    from: "      valorUnitarioCentavos,\n      valorTotalCentavos",
    to: "      valorUnitarioCentavos: valorUnitarioMilicentavos / 1000,\n      valorTotalCentavos",
    scenario: "items: below tolerance preserves original"
  },
  {
    name: "BigInt rounding removed",
    from: "(numerador + divisor / 2n) / divisor",
    to: "numerador / divisor",
    scenario: "items: half cent rounds up"
  },
  {
    name: "error precedence changed",
    from: "if (!descricao || descricao.length > MAX_DESCRICAO)",
    to: "if ((!descricao || descricao.length > MAX_DESCRICAO) && isDespesaCategoria(categoria))",
    scenario: "items: description before category"
  },
  {
    name: "early years corrected",
    from: "new Date(Date.UTC(ano, mes - 1, dia))",
    to: "(() => { const d = new Date(Date.UTC(ano, mes - 1, dia)); d.setUTCFullYear(ano); return d; })()",
    scenario: "calendar: Date.UTC year 0000"
  }
];
for (const control of controls)
  test(`negative control: ${control.name}`, async () => {
    const mutated = await compile(control);
    const entry = cases.find(candidate => candidate.name === control.scenario);
    assert.ok(entry, "Control must reuse a behavior assertion");
    assert.throws(() => assertCase(mutated, entry), { code: "ERR_ASSERTION" });
  });
