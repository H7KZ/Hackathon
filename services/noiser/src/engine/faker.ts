/**
 * Faker bound to an engine RNG stream. Never the global `faker` (shared state, eslint-enforced):
 * each stream gets its own instance whose randomizer draws from that stream.
 */
import { Faker, base, cs_CZ, en } from "@faker-js/faker";
import type { Rng } from "./rng";
import type { FakeKind } from "./types";

export function createFaker(rng: Rng): Faker {
  return new Faker({
    // cs_CZ first; en/base fill definitions cs_CZ lacks (e.g. product names)
    locale: [cs_CZ, en, base],
    randomizer: {
      next: () => rng.next(),
      seed: () => {
        // seeding happens through the stream key, never through faker
      },
    },
  });
}

export function fake(faker: Faker, kind: FakeKind): string {
  switch (kind) {
    case "personName":
      return faker.person.fullName();
    case "companyName":
      return faker.company.name();
    case "city":
      return faker.location.city();
    case "email":
      return faker.internet.email().toLowerCase();
    case "productName":
      return faker.commerce.productName();
  }
}
