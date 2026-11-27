// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

/** Engine purity: SPEC §2 rule 2 (deterministic, no I/O). */
const enginePurity = {
  "no-restricted-syntax": [
    "error",
    {
      selector: "MemberExpression[object.name='Math'][property.name='random']",
      message: "Engine is deterministic: use streams from src/engine/rng.ts.",
    },
    {
      selector: "MemberExpression[object.name='Date'][property.name='now']",
      message: "Engine is deterministic: no wall clock. Work with day indices.",
    },
    {
      selector: "NewExpression[callee.name='Date'][arguments.length=0]",
      message: "Engine is deterministic: new Date() needs an explicit argument.",
    },
    {
      selector: "CallExpression[callee.name='Date']",
      message: "Engine is deterministic: Date() without new returns the wall clock.",
    },
    {
      selector: "MemberExpression[object.name='crypto']",
      message: "Engine is deterministic: derive ids/randomness from the RNG stream.",
    },
    {
      selector: "MemberExpression[object.name='performance'][property.name='now']",
      message: "Engine is deterministic: no wall clock.",
    },
    {
      selector: "MemberExpression[object.name='process'][property.name='env']",
      message: "Engine is pure: pass configuration in via the scenario / RunOptions.",
    },
  ],
  "no-restricted-imports": [
    "error",
    {
      patterns: [
        {
          regex: "^(node:)?(fs|fs/promises|path|os|child_process|http|https|net|crypto)$",
          message: "Engine is pure: no I/O or Node APIs.",
        },
        { regex: "^@s2d/(llm|dataer|cascade|api)", message: "Engine may import only @s2d/schema." },
        { regex: "^(ai|@ai-sdk/.*|@duckdb/.*)$", message: "Engine is pure: no LLM or DB." },
      ],
      paths: [
        {
          name: "@faker-js/faker",
          importNames: ["faker", "fakerCS_CZ"],
          message:
            "Global faker instances share RNG state. Use new Faker({ locale }) seeded from the process stream.",
        },
      ],
    },
  ],
};

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/.next/**",
      "**/dist/**",
      "**/coverage/**",
      "**/next-env.d.ts",
      "**/playwright-report/**",
      "**/test-results/**",
      ".turbo/**",
      "out/**",
      "runs/**",
      ".cache/**",
      ".playwright-mcp/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: {
        projectService: {
          allowDefaultProject: ["*.ts"],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-console": ["warn", { allow: ["warn", "error"] }],
    },
  },
  {
    files: ["**/*.js", "**/*.cjs", "**/*.mjs"],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    // CLI and servers may log.
    files: ["services/api/src/cli/**", "services/api/src/server.ts", "services/cascade/tests/evals/**"],
    rules: { "no-console": "off" },
  },
  {
    files: ["services/noiser/src/engine/**/*.ts"],
    rules: enginePurity,
  },
  {
    // SPEC §2 rule 7+8: evidence & detective read only DuckDB, never the scenario.
    files: ["services/dataer/src/evidence/**/*.ts", "services/dataer/src/detective/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "^@s2d/(schema$|schema/scenario|schema/artifacts|noiser|cascade)",
              message:
                "Evidence/detective must not see the scenario. Import @s2d/schema/evidence|detective|run only.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["services/frontend/**/*.{ts,tsx}"],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "^@s2d/(api|noiser|dataer|cascade|llm)",
              allowTypeImports: true,
              message: "Frontend talks to the backend only over REST (type imports allowed).",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["**/tests/**/*.{ts,tsx}", "**/*.test.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
    },
  },
);
