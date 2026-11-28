import { expect, test } from "@playwright/test";
import { screens, watchErrors } from "./helpers";

/**
 * Visual review of finished live sessions (E2E_REVIEW=<api url>|<sessionId>,<sessionId>…): opens each
 * session in the UI (SSE replay rebuilds the whole thread) and screenshots every panel.
 * The API must allow the UI origin (CORS_ORIGIN=http://localhost:3310) and use the runs dir of the sessions.
 */
const spec = process.env.E2E_REVIEW ?? "";
const [api = "", list = ""] = spec.split("|");
const sessions = list.split(",").filter(Boolean);

test.skip(!api || sessions.length === 0, "set E2E_REVIEW=<api>|<id,id>");

for (const id of sessions) {
  test(`review ${id}`, async ({ page }) => {
    const errors = watchErrors(page);
    const shot = screens(`review-${id.slice(0, 8)}`);
    await page.goto(`/chat?s=${id}&api=${encodeURIComponent(api)}`);
    // every dataset the API knows must come back from the SSE replay, a what-if one with its comparison tab
    const state = (await (await page.request.get(`${api}/sessions/${id}`)).json()) as {
      datasets: { id: string; parent: string | null }[];
    };
    for (const d of state.datasets) {
      await expect(page.getByRole("region", { name: `Dataset ${d.id}` })).toBeVisible({ timeout: 60_000 });
      if (d.parent)
        await expect(
          page
            .getByRole("region", { name: `Dataset ${d.id}` })
            .getByRole("tab", { name: `Porovnání s ${d.parent}` }),
        ).toBeVisible();
    }
    await page.waitForTimeout(1000);
    // labels first: nth() locators re-resolve, and opening a tab adds regions (table cards) in between
    const labels = await Promise.all(
      (await page.getByRole("region").all()).map((r) => r.getAttribute("aria-label")),
    );
    for (const [i, label] of labels.entries()) {
      const name = label ?? "panel";
      const region = page
        .getByRole("region", { name, exact: true })
        .nth(labels.slice(0, i).filter((l) => l === label).length);
      await region.scrollIntoViewIfNeeded();
      await shot(page, name.replace(/[^\p{L}\d]+/gu, "-").toLowerCase());
      const tabs = region.getByRole("tab");
      for (const tab of await tabs.all()) {
        const label = (await tab.textContent()) ?? "";
        if (label === "Přehled") continue;
        await tab.click();
        await shot(page, `${name}-${label}`.replace(/[^\p{L}\d]+/gu, "-").toLowerCase());
      }
    }
    await shot(page, "full-thread", true);
    expect(errors.filter((e) => !/EventSource|ERR_INCOMPLETE_CHUNKED/.test(e))).toEqual([]);
  });
}
