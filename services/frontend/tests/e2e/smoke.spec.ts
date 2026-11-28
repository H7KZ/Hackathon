import { expect, test } from "@playwright/test";
import { watchErrors } from "./helpers";

// runs against the API with fake services (playwright.config.ts sets API_FAKE)
test("landing: validation, examples, help, clear", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "JOJO" })).toBeVisible();
  await expect(page.getByRole("img", { name: /Fakulta informatiky/ })).toBeVisible();

  await page.getByRole("button", { name: "Odeslat", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Doplňte" })).toBeVisible();

  await page.getByRole("button", { name: "Příklad: Dodavatel" }).click();
  await expect(page.getByLabel("Firma")).not.toHaveValue("");
  await page.getByRole("button", { name: "Vymazat" }).click();
  await page.getByRole("button", { name: "Smazat" }).click();
  await expect(page.getByLabel("Firma")).toHaveValue("");

  await page.getByRole("button", { name: "Číst více" }).click();
  await expect(page.getByText("Jak zadat příběh")).toBeVisible();
  await page.getByRole("button", { name: "Zavřít" }).click();
  expect(errors).toEqual([]);
});
