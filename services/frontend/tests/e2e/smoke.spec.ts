import { expect, test } from "@playwright/test";

test("home lists all six pages and the API is reachable", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Story2Data" })).toBeVisible();
  for (const label of ["Příběh", "Scénář", "Data", "Důkaz", "Detektiv", "Porovnání"]) {
    await expect(page.getByRole("navigation").getByRole("link", { name: label })).toBeVisible();
  }
  await expect(page.getByText(/API: v\d/)).toBeVisible();
});
