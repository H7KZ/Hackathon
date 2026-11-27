/**
 * Few-shot example for the model syntax (A2/A5). Deliberately a different domain than the demo
 * story, so the agent copies the syntax, not the content. tests/unit/prompts.test.ts keeps it valid.
 */
export const MODEL_EXAMPLE = {
  entities: [
    {
      name: "courier",
      count: 4,
      idPrefix: "COU",
      fields: { id: { gen: "id" }, name: { gen: "fake", kind: "companyName" } },
    },
    {
      name: "customer",
      count: 300,
      idPrefix: "CUS",
      fields: {
        id: { gen: "id" },
        city: { gen: "fake", kind: "city" },
        courier_id: { gen: "pick", entity: "courier" },
        segment: { gen: "categorical", values: ["nový", "věrný"], weights: [0.7, 0.3] },
      },
    },
  ],
  flows: [],
  processes: [
    {
      type: "arrival",
      id: "eshop_order",
      table: "eshop_order",
      per: ["customer"],
      rate: { curve: "demand", scale: 0.05 },
      fields: {
        id: { gen: "id" },
        customer_id: { gen: "ref", path: "key.customer" },
        courier_id: { gen: "lookup", entity: "customer", key: "key.customer", field: "courier_id" },
        items: { gen: "uniformInt", min: 1, max: 4 },
        date: { gen: "ref", path: "day" },
        is_late: { gen: "bernoulli", p: { curve: "late_prob" } },
        delay_days: {
          gen: "if",
          cond: { kind: "fieldEq", path: "self.is_late", value: true },
          then: { gen: "uniformInt", min: 2, max: 6 },
          else: { gen: "const", value: 0 },
        },
        delivered_date: { gen: "dateOffset", base: "self.date", days: "self.delay_days" },
      },
    },
    {
      type: "branch",
      id: "delivery_check",
      source: "eshop_order",
      cond: { kind: "fieldEq", path: "source.is_late", value: true },
      then: {
        table: "late_delivery",
        fields: {
          id: { gen: "id" },
          order_id: { gen: "ref", path: "source.id" },
          courier_id: { gen: "ref", path: "source.courier_id" },
          date: { gen: "ref", path: "day" },
        },
      },
    },
    {
      type: "derive",
      id: "complaint",
      table: "complaint",
      source: "delivery_check:then",
      p: 0.3,
      lag: { min: 0, max: 2 },
      fields: {
        id: { gen: "id" },
        order_id: { gen: "ref", path: "source.order_id" },
        reason: { gen: "const", value: "zpoždění" },
        date: { gen: "ref", path: "day" },
      },
    },
  ],
};
