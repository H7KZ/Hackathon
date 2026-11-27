import { expect, test } from "@playwright/test";

// runs against the API with fake services (playwright.config.ts sets API_FAKE)
test("landing: validation, then a story is accepted by the API", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "JOJO" })).toBeVisible();
  await expect(page.getByRole("img", { name: /Fakulta informatiky/ })).toBeVisible();

  await page.getByRole("button", { name: "Odeslat" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Doplňte" })).toBeVisible();

  await page.getByRole("button", { name: "Příklad: Dodavatel" }).click();
  const created = page.waitForResponse(
    (r) => r.url().endsWith("/sessions") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Odeslat" }).click();
  expect((await created).status()).toBe(201);
  await expect(page.getByText("Zadání odesláno")).toBeVisible();

  await page.getByRole("button", { name: "Vymazat" }).click();
  await page.getByRole("button", { name: "Smazat" }).click();
  await expect(page.getByLabel("Firma")).toHaveValue("");

  await page.getByRole("button", { name: "Číst více" }).click();
  await expect(page.getByText("Jak zadat příběh")).toBeVisible();
  await page.getByRole("button", { name: "Zavřít" }).click();
  expect(errors).toEqual([]);
});
