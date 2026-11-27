/**
 * Golden tests: pinned hashes of every generated table for supplier_delay@seed42.
 * When the engine changes intentionally, update the hashes in the same commit and say why.
 */
import { describe, it } from "vitest";

describe("golden: supplier_delay@42", () => {
  it.todo("determinism: two runs produce identical table hashes");
  it.todo("stream isolation: changing late_prob.to leaves purchase_attempt identical");
  it.todo("integrity: every FK resolves and stock never goes negative");
  it.todo("pinned hashes match tests/golden/supplier_delay.hashes.json");
});
