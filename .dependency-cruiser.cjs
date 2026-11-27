/**
 * Architecture boundaries between workspaces (SPEC §2, AGENTS.md).
 * Runs in `pnpm verify` via `pnpm deps:check`.
 * @type {import('dependency-cruiser').IConfiguration}
 */
module.exports = {
  forbidden: [
    {
      name: "not-to-unresolvable",
      comment: "Import that cannot be resolved — usually a workspace package missing from package.json.",
      severity: "error",
      from: {},
      to: { couldNotResolve: true },
    },
    {
      name: "no-undeclared-deps",
      comment: "Every imported package must be declared in the importing workspace's package.json.",
      severity: "error",
      from: {},
      to: { dependencyTypes: ["npm-no-pkg", "npm-unknown"] },
    },
    {
      name: "no-circular",
      severity: "error",
      from: {},
      to: { circular: true },
    },
    {
      name: "schema-is-a-leaf",
      comment: "@s2d/schema is the single source of truth and depends on nothing internal.",
      severity: "error",
      from: { path: "^packages/schema/src" },
      to: { path: "^(packages/(llm|test-utils)|services)/" },
    },
    {
      name: "noiser-only-schema",
      comment: "Engine/compiler are pure: only @s2d/schema.",
      severity: "error",
      from: { path: "^services/noiser/src" },
      to: { path: "^(packages/(llm|test-utils)|services/(dataer|cascade|api|frontend))/" },
    },
    {
      name: "dataer-no-upstream",
      comment: "Data layer does not know about scenario generation or the API.",
      severity: "error",
      from: { path: "^services/dataer/src" },
      to: { path: "^services/(noiser|cascade|api|frontend)/" },
    },
    {
      name: "evidence-detective-blind",
      comment: "Evidence and detective read DuckDB only, never the scenario contract.",
      severity: "error",
      from: { path: "^services/dataer/src/(evidence|detective)" },
      to: { path: "^packages/schema/src/(scenario|artifacts|index)" },
    },
    {
      name: "llm-no-workspaces",
      comment: "@s2d/llm is infrastructure: it must not depend on any service or the contract.",
      severity: "error",
      from: { path: "^packages/llm/src" },
      to: { path: "^(packages/(schema|test-utils)|services)/" },
    },
    {
      name: "cascade-no-api",
      severity: "error",
      from: { path: "^services/cascade/src" },
      to: { path: "^services/(api|frontend)/" },
    },
    {
      name: "frontend-rest-only",
      comment: "Frontend may only import types from the API; everything else over REST.",
      severity: "error",
      from: { path: "^services/frontend" },
      to: {
        path: "^(packages/llm|services/(api|noiser|dataer|cascade))/",
        dependencyTypesNot: ["type-only"],
      },
    },
    {
      name: "src-not-to-tests",
      severity: "error",
      from: { path: "/src/" },
      to: { path: "/tests/|^packages/test-utils/" },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: { path: "(node_modules|\\.next|dist|coverage|next-env\\.d\\.ts)" },
    tsPreCompilationDeps: true,
    combinedDependencies: true,
    preserveSymlinks: false,
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "types", "default"],
      extensions: [".ts", ".tsx", ".js", ".mjs", ".json"],
    },
    tsConfig: { fileName: "tsconfig.base.json" },
  },
};
