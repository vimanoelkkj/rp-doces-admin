import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { build } from "esbuild";

const path = "functions/lib/operacoes.ts";
const identityPath = "functions/lib/operacaoIdentity.ts";
const source = (await readFile(identityPath, "utf8")).replace(/\r\n/g, "\n");

// Bundle the real entry point. Expose its private canonical only in memory;
// no copied implementation, production export, D1 fixture or external request.
async function compile(mutation) {
  let loaded = 0;
  let replacements = 0;
  const bundle = await build({
    stdin: {
      contents: `export * from './${path}'; export { __canonical } from './${identityPath}';`,
      resolveDir: process.cwd(),
      loader: "ts"
    },
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    plugins: [
      {
        name: "identity-contract",
        setup(builder) {
          builder.onLoad({ filter: /[/\\]operacaoIdentity\.ts$/ }, () => {
            loaded++;
            let contents = source;
            if (mutation) {
              assert.equal(
                contents.split(mutation.from).length - 1,
                1,
                "mutation anchor must occur exactly once"
              );
              contents = contents.replace(mutation.from, mutation.to);
              replacements++;
            }
            assert.equal(
              contents.split("function canonical(").length - 1,
              1,
              "private canonical must be present exactly once"
            );
            return { contents: `${contents}\nexport { canonical as __canonical };`, loader: "ts" };
          });
        }
      }
    ]
  });
  assert.equal(loaded, 1, "the real identity implementation must be loaded");
  assert.equal(replacements, mutation ? 1 : 0, "mutation must reach production exactly once");
  return import(
    `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
  );
}

const invalid = { ok: false, erro: "OPERATION_KEY_INVALIDA" };
const derivations = [
  ["chavePedido", ["AbC_1234"], "a1:AbC_1234"],
  ["chavePagamento", ["AbC_1234"], "a1:AbC_1234:pag"],
  ["chaveReembolso", ["AbC_1234"], "a1:AbC_1234:ref"],
  ["chaveMp", ["AbC_1234"], "a1:AbC_1234:mp"],
  ["chaveCancelamento", ["AbC_1234"], "a1:AbC_1234:cancel"],
  ["chaveAnulacaoRefund", ["AbC_1234", 7], "a1:AbC_1234:anul:7"]
];
const base = {
  tipo: "PAGAMENTO_ADMIN",
  escopo: "ADMIN",
  ator_usuario_id: 1,
  fingerprint_versao: 1,
  fingerprint: '1:{"valor":100}'
};
const expected = {
  tipo: "PAGAMENTO_ADMIN",
  escopo: "ADMIN",
  atorUsuarioId: 1,
  fingerprint: '1:{"valor":100}'
};

const scenarios = [
  [
    "operation key rejects non-string values",
    module => {
      for (const value of [
        undefined,
        null,
        12345678,
        true,
        false,
        {},
        [],
        new String("AbC_1234"),
        1n,
        Symbol("key"),
        () => "AbC_1234"
      ]) {
        assert.deepEqual(module.parseOperationKey(value), invalid);
      }
    }
  ],
  [
    "operation key trims external whitespace",
    module => {
      for (const value of [" AbC_1234 ", "\t\r\nAbC_1234\n\t", "\u00a0\ufeffAbC_1234\u2003"]) {
        assert.deepEqual(module.parseOperationKey(value), { ok: true, key: "AbC_1234" });
      }
      assert.deepEqual(module.parseOperationKey(" \t\n"), invalid);
    }
  ],
  [
    "operation key rejects internal whitespace",
    module => {
      for (const value of ["AbC 1234", "AbC\t1234", "AbC\n1234", "AbC\u00a01234"]) {
        assert.deepEqual(module.parseOperationKey(value), invalid);
      }
    }
  ],
  [
    "operation key lengths are 8 through 128 after trim",
    module => {
      for (const length of [7, 8, 128, 129]) {
        const key = "A".repeat(length);
        const result = length === 8 || length === 128 ? { ok: true, key } : invalid;
        assert.deepEqual(module.parseOperationKey(key), result);
        assert.deepEqual(module.parseOperationKey(` ${key} `), result);
      }
    }
  ],
  [
    "operation key first character must be ASCII alphanumeric",
    module => {
      for (const first of ["A", "z", "0", "9"]) {
        const key = `${first}bc12345`;
        assert.deepEqual(module.parseOperationKey(key), { ok: true, key });
      }
      for (const first of [".", "_", ":", "-"]) {
        assert.deepEqual(module.parseOperationKey(`${first}bc12345`), invalid);
      }
    }
  ],
  [
    "operation key permits dot underscore colon and dash",
    module => {
      for (const character of [".", "_", ":", "-"]) {
        const key = `A${character.repeat(7)}`;
        assert.deepEqual(module.parseOperationKey(key), { ok: true, key });
      }
      assert.deepEqual(module.parseOperationKey("A._:-123"), { ok: true, key: "A._:-123" });
    }
  ],
  [
    "operation key rejects slash accents emoji and punctuation",
    module => {
      for (const character of ["/", "\\", "é", "🍰", "@", "+", "=", "#", "?", "\0", "\u200b"]) {
        assert.deepEqual(module.parseOperationKey(`Ab${character}12345`), invalid);
        assert.deepEqual(module.parseOperationKey(`${character}bc12345`), invalid);
      }
    }
  ],
  [
    "operation key preserves capitalization",
    module => {
      assert.deepEqual(module.parseOperationKey("AbCd1234"), { ok: true, key: "AbCd1234" });
      assert.deepEqual(module.parseOperationKey("abcd1234"), { ok: true, key: "abcd1234" });
    }
  ],
  ...derivations.map(([name, args, literal]) => [
    name,
    module => {
      assert.equal(module[name](...args), literal);
      assert.equal(module[name](...args), literal);
    }
  ]),
  [
    "annulment refund keys distinguish payments",
    module => {
      assert.equal(module.chaveAnulacaoRefund("AbC_1234", 8), "a1:AbC_1234:anul:8");
      assert.notEqual(
        module.chaveAnulacaoRefund("AbC_1234", 7),
        module.chaveAnulacaoRefund("AbC_1234", 8)
      );
    }
  ],
  [
    "derivation does not trim or validate its argument",
    module => {
      assert.equal(module.chavePedido(" x "), "a1: x ");
      assert.equal(module.chaveMp(""), "a1::mp");
    }
  ],
  [
    "fingerprint version is literal 1",
    module => {
      assert.equal(module.FINGERPRINT_VERSAO, 1);
      assert.equal(module.fingerprint({}), "1:{}");
    }
  ],
  [
    "canonical recursively orders object keys without mutating input",
    module => {
      const input = { z: { y: 2, a: 1 }, a: [{ d: 4, c: 3 }] };
      const result = module.__canonical(input);
      assert.deepEqual(Object.keys(result), ["a", "z"]);
      assert.deepEqual(Object.keys(result.z), ["a", "y"]);
      assert.deepEqual(Object.keys(result.a[0]), ["c", "d"]);
      assert.equal(JSON.stringify(result), '{"a":[{"c":3,"d":4}],"z":{"a":1,"y":2}}');
      assert.equal(module.fingerprint(input), '1:{"a":[{"c":3,"d":4}],"z":{"a":1,"y":2}}');
      assert.deepEqual(Object.keys(input), ["z", "a"]);
      assert.deepEqual(Object.keys(input.z), ["y", "a"]);
      assert.notEqual(result, input);
    }
  ],
  [
    "nested arrays preserve order",
    module => {
      const input = [
        [2, 1],
        [{ b: 2, a: 1 }, 3]
      ];
      assert.deepEqual(module.__canonical(input), [
        [2, 1],
        [{ a: 1, b: 2 }, 3]
      ]);
      assert.equal(module.fingerprint(input), '1:[[2,1],[{"a":1,"b":2},3]]');
      assert.equal(module.fingerprint([1, 2]), "1:[1,2]");
      assert.equal(module.fingerprint([2, 1]), "1:[2,1]");
    }
  ],
  [
    "canonical omits own undefined object properties",
    module => {
      const input = { b: undefined, a: { y: undefined, x: 1 } };
      const result = module.__canonical(input);
      // Stringification alone cannot detect retaining undefined as an own property.
      assert.equal(Object.hasOwn(result, "b"), false);
      assert.equal(Object.hasOwn(result.a, "y"), false);
      assert.deepEqual(Object.keys(result), ["a"]);
      assert.equal(module.fingerprint(input), '1:{"a":{"x":1}}');
      assert.equal(module.fingerprint({ a: 1, b: undefined }), '1:{"a":1}');
    }
  ],
  [
    "undefined array entries and holes serialize as null",
    module => {
      const input = Array(3);
      input[0] = undefined;
      input[2] = null;
      const result = module.__canonical(input);
      assert.equal(Object.hasOwn(result, 0), true);
      assert.equal(result[0], undefined);
      assert.equal(Object.hasOwn(result, 1), false);
      assert.equal(result.length, 3);
      assert.equal(JSON.stringify(result), "[null,null,null]");
      assert.equal(module.fingerprint(input), "1:[null,null,null]");
      assert.equal(module.fingerprint([undefined]), "1:[null]");
    }
  ],
  [
    "null and root undefined retain current semantics",
    module => {
      assert.equal(module.__canonical(null), null);
      assert.equal(module.__canonical(undefined), undefined);
      assert.equal(module.fingerprint(null), "1:null");
      assert.equal(module.fingerprint(undefined), "1:undefined");
      assert.equal(module.fingerprint({ a: null }), '1:{"a":null}');
      assert.equal(module.fingerprint({ a: undefined }), "1:{}");
    }
  ],
  [
    "numbers use current JSON semantics and retain type distinctions",
    module => {
      for (const value of [1, 1.0]) assert.equal(module.fingerprint(value), "1:1");
      for (const value of [-0, 0]) assert.equal(module.fingerprint(value), "1:0");
      for (const value of [NaN, Infinity, -Infinity])
        assert.equal(module.fingerprint(value), "1:null");
      assert.equal(module.fingerprint("1"), '1:"1"');
      assert.equal(module.fingerprint({ number: NaN }), '1:{"number":null}');
      assert.equal(module.fingerprint([Infinity]), "1:[null]");
      assert.notEqual(module.fingerprint(1), module.fingerprint("1"));
      assert.ok(Object.is(module.__canonical(-0), -0));
      assert.ok(Number.isNaN(module.__canonical(NaN)));
    }
  ],
  [
    "Unicode is preserved without normalization",
    module => {
      assert.equal(module.fingerprint("é"), '1:"é"');
      assert.equal(module.fingerprint("e\u0301"), '1:"e\u0301"');
      assert.notEqual(module.fingerprint("é"), module.fingerprint("e\u0301"));
      assert.equal(module.fingerprint({ nome: "🍰漢字" }), '1:{"nome":"🍰漢字"}');
    }
  ],
  [
    "equivalent object order matches but distinct payloads do not",
    module => {
      assert.equal(module.fingerprint({ b: 2, a: { z: 3, x: 1 } }), '1:{"a":{"x":1,"z":3},"b":2}');
      assert.equal(module.fingerprint({ a: { x: 1, z: 3 }, b: 2 }), '1:{"a":{"x":1,"z":3},"b":2}');
      assert.equal(module.fingerprint({ value: 1 }), '1:{"value":1}');
      assert.equal(module.fingerprint({ value: 2 }), '1:{"value":2}');
      assert.notEqual(module.fingerprint({ value: 1 }), module.fingerprint({ value: 2 }));
    }
  ],
  [
    "compatible operation identity returns null",
    module => {
      assert.equal(module.conflitoOperacao(base, expected), null);
    }
  ],
  [
    "type scope and actor have independent conflict guards",
    module => {
      assert.equal(
        module.conflitoOperacao({ ...base, tipo: "PIX_ADMIN" }, expected),
        "OPERACAO_CONFLITO_TIPO"
      );
      assert.equal(
        module.conflitoOperacao({ ...base, escopo: "SITE" }, expected),
        "OPERACAO_CONFLITO_ESCOPO"
      );
      assert.equal(
        module.conflitoOperacao({ ...base, ator_usuario_id: 2 }, expected),
        "OPERACAO_CONFLITO_ESCOPO"
      );
    }
  ],
  [
    "actor null and undefined are equivalent on both sides",
    module => {
      for (const stored of [null, undefined]) {
        for (const requested of [null, undefined]) {
          assert.equal(
            module.conflitoOperacao(
              { ...base, ator_usuario_id: stored },
              { ...expected, atorUsuarioId: requested }
            ),
            null
          );
        }
      }
    }
  ],
  [
    "actor comparison preserves zero and strict numeric type",
    module => {
      assert.equal(
        module.conflitoOperacao(
          { ...base, ator_usuario_id: 0 },
          { ...expected, atorUsuarioId: null }
        ),
        "OPERACAO_CONFLITO_ESCOPO"
      );
      assert.equal(
        module.conflitoOperacao(
          { ...base, ator_usuario_id: null },
          { ...expected, atorUsuarioId: 0 }
        ),
        "OPERACAO_CONFLITO_ESCOPO"
      );
      assert.equal(
        module.conflitoOperacao({ ...base, ator_usuario_id: "1" }, expected),
        "OPERACAO_CONFLITO_ESCOPO"
      );
      assert.equal(
        module.conflitoOperacao(base, { ...expected, atorUsuarioId: "1" }),
        "OPERACAO_CONFLITO_ESCOPO"
      );
    }
  ],
  [
    "fingerprint version is checked independently with Number coercion",
    module => {
      for (const version of [0, 2, 99, undefined, null, "invalid"]) {
        assert.equal(
          module.conflitoOperacao({ ...base, fingerprint_versao: version }, expected),
          "OPERACAO_CONFLITO_PAYLOAD"
        );
      }
      assert.equal(module.conflitoOperacao({ ...base, fingerprint_versao: "1" }, expected), null);
    }
  ],
  [
    "different fingerprints conflict even with identical metadata",
    module => {
      assert.equal(
        module.conflitoOperacao({ ...base, fingerprint: '1:{"valor":101}' }, expected),
        "OPERACAO_CONFLITO_PAYLOAD"
      );
      assert.equal(
        module.conflitoOperacao(base, { ...expected, fingerprint: '1:{"valor":101}' }),
        "OPERACAO_CONFLITO_PAYLOAD"
      );
    }
  ],
  [
    "conflict precedence is type then scope or actor then payload",
    module => {
      const mismatch = {
        ...base,
        tipo: "PIX_ADMIN",
        escopo: "SITE",
        ator_usuario_id: 2,
        fingerprint_versao: 99,
        fingerprint: "other"
      };
      assert.equal(module.conflitoOperacao(mismatch, expected), "OPERACAO_CONFLITO_TIPO");
      assert.equal(
        module.conflitoOperacao({ ...mismatch, tipo: base.tipo }, expected),
        "OPERACAO_CONFLITO_ESCOPO"
      );
      assert.equal(
        module.conflitoOperacao({ ...mismatch, tipo: base.tipo, escopo: base.escopo }, expected),
        "OPERACAO_CONFLITO_ESCOPO"
      );
    }
  ],
  [
    "current runtime exports remain available from operacoes",
    module => {
      const functions = [
        "parseOperationKey",
        ...derivations.map(([name]) => name),
        "fingerprint",
        "conflitoOperacao",
        "buscarOperacao",
        "fontePagamento",
        "fonteReembolso",
        "fontePedidoComPagamento",
        "fonteItemAdicionado",
        "fonteCancelamentoCriado",
        "fonteTrocaCriada",
        "prepareClaimOperacao",
        "prepareRegistrarFase",
        "registrarFase",
        "listarOperacoesInconclusivas",
        "listarOperacoesInconclusivasDoPedido",
        "listarOperacoesInconclusivasRecentes",
        "claimRecuperacao",
        "registrarObservacao",
        "externalReferenceDaOperacao",
        "dateOfExpirationDaOperacao",
        "expiracaoDecorrida",
        "fecharOperacaoExpirada",
        "parseResultado"
      ];
      for (const name of functions) assert.equal(typeof module[name], "function", name);
      for (const name of [
        "FINGERPRINT_VERSAO",
        "RECUPERACAO_APOS_SEGUNDOS",
        "RECUPERACAO_EXPIRACAO_MARGEM_MS"
      ]) {
        assert.equal(typeof module[name], "number", name);
      }
      for (const name of ["OPERACAO_MENSAGENS", "OPERACAO_HTTP_STATUS"])
        assert.equal(typeof module[name], "object", name);
      assert.equal(Object.hasOwn(module, "canonical"), false);
    }
  ]
];

const mutations = [
  ["allow seven-character keys", "{7,127}", "{6,127}"],
  ["allow 129-character keys", "{7,127}", "{7,128}"],
  ["allow slash in keys", "[A-Za-z0-9._:-]", "[A-Za-z0-9._:/-]"],
  ["allow punctuation as first character", "/^[A-Za-z0-9]", "/^[A-Za-z0-9._:-]"],
  ["remove key trim", "const key = raw.trim();", "const key = raw;"],
  ...derivations.map(([name]) => {
    const suffix =
      name === "chaveAnulacaoRefund"
        ? `:anul:\${pagamentoId}`
        : {
            chavePedido: "",
            chavePagamento: ":pag",
            chaveReembolso: ":ref",
            chaveMp: ":mp",
            chaveCancelamento: ":cancel"
          }[name];
    return [`change ${name} prefix`, `\`a1:\${key}${suffix}\``, `\`a2:\${key}${suffix}\``];
  }),
  ["remove object key sorting", "Object.keys(origem).sort()", "Object.keys(origem)"],
  ["reverse array order", "value.map(canonical)", "value.map(canonical).reverse()"],
  ["retain undefined own properties", "if (origem[chave] === undefined) continue;", ""],
  ["convert undefined to null", "return value;", "return value === undefined ? null : value;"],
  [
    "change fingerprint version",
    "export const FINGERPRINT_VERSAO = 1;",
    "export const FINGERPRINT_VERSAO = 2;"
  ],
  [
    "remove type guard",
    'if (operacao.tipo !== esperado.tipo) return "OPERACAO_CONFLITO_TIPO";',
    ""
  ],
  [
    "remove scope guard",
    'if (operacao.escopo !== esperado.escopo) return "OPERACAO_CONFLITO_ESCOPO";',
    ""
  ],
  [
    "remove actor guard",
    "(operacao.ator_usuario_id ?? null) !== (esperado.atorUsuarioId ?? null)",
    "false"
  ],
  ["remove version guard", "Number(operacao.fingerprint_versao) !== FINGERPRINT_VERSAO", "false"],
  [
    "accept different fingerprints",
    'if (operacao.fingerprint !== esperado.fingerprint) return "OPERACAO_CONFLITO_PAYLOAD";',
    ""
  ]
];

test("Operation identity characterization", async t => {
  const network = t.mock.method(globalThis, "fetch", () => {
    throw new Error("network prohibited in identity harness");
  });
  const module = await compile();
  for (const [name, contract] of scenarios) {
    await t.test(name, () => contract(module));
  }
  for (const [name, from, to] of mutations) {
    await t.test(`negative control: ${name}`, async () => {
      // Compile outside the detection catch: syntax errors and missing anchors fail the control.
      const mutant = await compile({ from, to });
      const failures = [];
      for (const [scenario, contract] of scenarios) {
        try {
          contract(mutant);
        } catch (error) {
          assert.equal(error.code, "ERR_ASSERTION", `${scenario} must fail behaviorally`);
          failures.push(scenario);
        }
      }
      assert.ok(failures.length > 0, "mutation must reach a behavioral assertion failure");
    });
  }
  assert.equal(network.mock.callCount(), 0, "no network during baseline or mutations");
});
