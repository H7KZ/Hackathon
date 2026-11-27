/** supplier_delay expressed in the causal design (03a map + 03b processes with trace). */
import type { CausalMap, ProcessesPlan, StoryOverlay } from "@s2d/schema/artifacts";
import { base } from "./fixtures";

export const causalMap: CausalMap = {
  nodes: [
    { id: "late_prob", kind: "lever", description: "pravděpodobnost pozdní dodávky", baseline: 0.05 },
    { id: "demand", kind: "lever", description: "poptávka", baseline: 1 },
    { id: "late_delivery", kind: "event", description: "pozdní dodávka", table: "delivery" },
    { id: "purchase", kind: "event", description: "pokus o nákup", table: "purchase_attempt" },
    { id: "stock", kind: "state", description: "zásoba", table: "stock_daily" },
    { id: "fulfil", kind: "branch", description: "je zboží skladem?" },
    { id: "sale", kind: "event", description: "prodej", table: "sale" },
    { id: "lost_sale", kind: "event", description: "neuskutečněný nákup", table: "lost_sale" },
    { id: "complaint", kind: "event", description: "stížnost", table: "complaint" },
  ],
  edges: [
    {
      id: "e_late",
      from: "late_prob",
      to: "late_delivery",
      type: "probabilistic",
      sign: "positive",
      p: 0.05,
      rationale: "r",
    },
    {
      id: "e_late_stock",
      from: "late_delivery",
      to: "stock",
      type: "mechanical",
      sign: "negative",
      rationale: "r",
    },
    { id: "e_demand", from: "demand", to: "purchase", type: "mechanical", sign: "positive", rationale: "r" },
    {
      id: "e_purchase",
      from: "purchase",
      to: "fulfil",
      type: "mechanical",
      sign: "positive",
      rationale: "r",
    },
    { id: "e_stock", from: "stock", to: "fulfil", type: "mechanical", sign: "positive", rationale: "r" },
    { id: "e_sale", from: "fulfil", to: "sale", type: "mechanical", sign: "positive", rationale: "r" },
    { id: "e_lost", from: "fulfil", to: "lost_sale", type: "mechanical", sign: "negative", rationale: "r" },
    {
      id: "e_lost_complaint",
      from: "lost_sale",
      to: "complaint",
      type: "probabilistic",
      sign: "positive",
      p: 0.25,
      rationale: "r",
    },
    {
      id: "e_sale_complaint",
      from: "sale",
      to: "complaint",
      type: "probabilistic",
      sign: "positive",
      p: 0.01,
      rationale: "r",
    },
  ],
};

export const processesPlan: ProcessesPlan = {
  entities: base.entities,
  flows: base.flows,
  processes: base.processes,
  trace: {
    e_late: "/processes/0/fields/is_late",
    e_late_stock: "/processes/0/effects/0",
    e_demand: "/processes/1/rate",
    e_purchase: "/processes/2",
    e_stock: "/processes/2/cond",
    e_sale: "/processes/2/then/effects/0",
    e_lost: "/processes/2",
    e_lost_complaint: "/processes/3",
    e_sale_complaint: "/processes/4/p",
  },
};

/** sp1: SUP-002 starts delivering late on 1 March and stays late (open period). */
export const overlay: StoryOverlay = {
  name: "Pozdní dodávky dodavatele SUP-002",
  start: base.meta.start,
  end: base.meta.end,
  storyPoints: [
    {
      id: "sp1",
      phase: 1,
      title: "Dodavatel SUP-002 začíná dodávat pozdě",
      description: "Od 1. 3. chodí většina dodávek SUP-002 pozdě.",
      entity: { name: "supplier", ids: ["SUP-002"] },
      start: "2025-03-01",
    },
  ],
  levers: [
    {
      lever: "late_prob",
      scope: { field: "self.supplier_id", ids: ["SUP-002"] },
      values: [{ storyPointId: "sp1", value: 0.8 }],
    },
  ],
};

const BEFORE_DAYS = 59; // 2025-01-01 .. 2025-02-28
const AFTER_DAYS = 184; // 2025-03-01 .. 2025-08-31

/** Per-day rate (or average level) before/after 1 March, as the SQL agent is asked to write it. */
function rateSql(from: string, date: string, where: string, agg: "count" | "avg" = "count"): string {
  const value =
    agg === "count"
      ? `CAST(COUNT(*) AS DOUBLE) / CASE period WHEN 'before' THEN ${BEFORE_DAYS} ELSE ${AFTER_DAYS} END`
      : "AVG(CASE WHEN v <= 0 THEN 1.0 ELSE 0.0 END)"; // stock-out share of a state (EXPECTATION_SQL prompt)
  return `SELECT period, ${value} AS value FROM (SELECT CASE WHEN ${date} < DATE '2025-03-01' THEN 'before' ELSE 'after' END AS period, ${agg === "avg" ? "t.value" : "1"} AS v FROM ${from} WHERE ${where}) GROUP BY period`;
}

const sup = (op: "=" | "<>") => `p.supplier_id ${op} 'SUP-002'`;
const viaProduct = (table: string) => `main.${table} t JOIN main.product p ON p.id = t.product_id`;

/** One query per hypothesis that deriveHypotheses yields for the fixtures. */
export const queries = [
  {
    hypothesisId: "sp1_late_delivery",
    sql: rateSql("main.delivery t", "t.planned_date", "t.is_late AND t.supplier_id = 'SUP-002'"),
  },
  { hypothesisId: "sp1_stock", sql: rateSql(viaProduct("stock_daily"), "t.date", sup("="), "avg") },
  { hypothesisId: "sp1_sale", sql: rateSql(viaProduct("sale"), "t.date", sup("=")) },
  { hypothesisId: "sp1_sale_outside", sql: rateSql(viaProduct("sale"), "t.date", sup("<>")) },
  { hypothesisId: "sp1_complaint", sql: rateSql(viaProduct("complaint"), "t.date", sup("=")) },
];
