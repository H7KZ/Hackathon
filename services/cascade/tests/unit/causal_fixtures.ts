/** supplier_delay expressed in the causal design (03a map + 03b processes with trace). */
import type { CausalMap, ProcessesPlan } from "@s2d/schema/artifacts";
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
