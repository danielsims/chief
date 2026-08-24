import { RuleTester } from "oxlint/plugins-dev";

import plugin from "../plugin.ts";

const tester = new RuleTester();

function rule(name: keyof typeof plugin.rules) {
  return plugin.rules[name];
}

tester.run("no-conditional-empty-spread", rule("no-conditional-empty-spread"), {
  valid: ["const value = { ...(enabled ? first : second) };"],
  invalid: [
    {
      code: "const value = { ...(enabled ? { label: 'Chief' } : {}) };",
      errors: 1,
    },
  ],
});

tester.run("no-module-mocking", rule("no-module-mocking"), {
  valid: ["const service = createService({ transport });"],
  invalid: [{ code: "vi.mock('./transport');", errors: 1 }],
});

tester.run("no-reflect-apply", rule("no-reflect-apply"), {
  valid: ["handler(value);"],
  invalid: [{ code: "Reflect.apply(handler, owner, [value]);", errors: 1 }],
});

tester.run("no-reflect-get", rule("no-reflect-get"), {
  valid: ["const value = record.name;"],
  invalid: [{ code: "const value = Reflect.get(record, 'name');", errors: 1 }],
});

tester.run("no-ad-hoc-typeof", rule("no-ad-hoc-typeof"), {
  valid: ["const parsed = userSchema.parse(input);"],
  invalid: [
    { code: "if (typeof input === 'string') consume(input);", errors: 1 },
  ],
});

tester.run("no-ambiguous-shape-names", rule("no-ambiguous-shape-names"), {
  valid: [
    { code: "type WorkspaceRecord = { id: string };", filename: "case.ts" },
  ],
  invalid: [
    {
      code: "type WorkspaceShape = { id: string };",
      filename: "case.ts",
      errors: 1,
    },
  ],
});

tester.run("no-chained-type-assertions", rule("no-chained-type-assertions"), {
  valid: [{ code: "const value = input as Workspace;", filename: "case.ts" }],
  invalid: [
    {
      code: "const value = input as unknown as Workspace;",
      filename: "case.ts",
      errors: 1,
    },
  ],
});

tester.run("no-known-value-widening", rule("no-known-value-widening"), {
  valid: [{ code: "const mode = 'hosted';", filename: "case.ts" }],
  invalid: [
    { code: "const mode: string = 'hosted';", filename: "case.ts", errors: 1 },
  ],
});

tester.run("no-broad-object-parameters", rule("no-broad-object-parameters"), {
  valid: [
    { code: "function read(value: { id: string }) {}", filename: "case.ts" },
  ],
  invalid: [
    { code: "function read(value: object) {}", filename: "case.ts", errors: 1 },
  ],
});

tester.run("no-unknown-parameters", rule("no-unknown-parameters"), {
  valid: [{ code: "function read(value: Workspace) {}", filename: "case.ts" }],
  invalid: [
    {
      code: "function read(value: unknown) {}",
      filename: "case.ts",
      errors: 1,
    },
  ],
});

tester.run("no-unknown-returns", rule("no-unknown-returns"), {
  valid: [
    {
      code: "function read(): Workspace { return workspace; }",
      filename: "case.ts",
    },
  ],
  invalid: [
    {
      code: "function read(): unknown { return workspace; }",
      filename: "case.ts",
      errors: 1,
    },
  ],
});

tester.run("no-unknown-only-aliases", rule("no-unknown-only-aliases"), {
  valid: [{ code: "type Workspace = { id: string };", filename: "case.ts" }],
  invalid: [
    { code: "type Workspace = unknown;", filename: "case.ts", errors: 1 },
  ],
});

tester.run("no-unsafe-dictionary-values", rule("no-unsafe-dictionary-values"), {
  valid: [
    { code: "type Lookup = Record<string, Workspace>;", filename: "case.ts" },
  ],
  invalid: [
    {
      code: "type Lookup = Record<string, unknown>;",
      filename: "case.ts",
      errors: 1,
    },
  ],
});

tester.run("no-widen-then-assert", rule("no-widen-then-assert"), {
  valid: [{ code: "const mode = input as Mode;", filename: "case.ts" }],
  invalid: [
    {
      code: "const mode: string = input as Mode;",
      filename: "case.ts",
      errors: 1,
    },
  ],
});

tester.run(
  "require-assertion-justification",
  rule("require-assertion-justification"),
  {
    valid: [
      { code: "const mode = input as const;", filename: "case.ts" },
      {
        code: "// Safe because the schema validated input.\nconst mode = input as Mode;",
        filename: "case.ts",
      },
    ],
    invalid: [
      { code: "const mode = input as Mode;", filename: "case.ts", errors: 1 },
    ],
  },
);

tester.run(
  "no-undeclared-environment-variables",
  rule("no-undeclared-environment-variables"),
  {
    valid: [
      {
        code: "const mode = process.env.CHIEF_MODE;",
        options: [{ allowed: ["CHIEF_*"] }],
      },
    ],
    invalid: [
      {
        code: "const token = process.env.SECRET_TOKEN;",
        options: [{ allowed: ["CHIEF_*"] }],
        errors: 1,
      },
    ],
  },
);
