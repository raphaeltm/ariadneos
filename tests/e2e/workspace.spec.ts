import { expect, test } from "@playwright/test";

const CASE_COUNT = /Process cases/;
const VENDOR = /Vendor onboarding/;
const REFUND = /Customer refunds/;
const UPDATED = /new events across 6 cases/;
const EVIDENCE = /Inspect .* source events/;

test("opens the dialog, contains focus, and restores it on Escape", async ({
  page,
}) => {
  await page.goto("/app");
  const opener = page.getByRole("button", { name: "About this demo" });
  await opener.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Close about dialog" })
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    dialog.getByRole("button", { name: "Explore the process" })
  ).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(
    dialog.getByRole("button", { name: "Close about dialog" })
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test("refreshes persisted simulation results and exposes evidence", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/app");
  await expect(page.getByRole("heading", { name: VENDOR })).toBeVisible();
  const cases = page
    .locator(".stat")
    .filter({ hasText: CASE_COUNT })
    .locator(".stat-value");
  await expect(cases).toHaveText("24");
  await page
    .getByRole("button", { exact: true, name: "Simulate activity" })
    .click();
  await expect(page.getByText(UPDATED)).toBeVisible();
  await expect(cases).toHaveText("30");
  await page.reload();
  await expect(cases).toHaveText("30");
  await page.locator(".react-flow__edge").first().click();
  await page.getByRole("button", { name: EVIDENCE }).click();
  await expect(page.locator(".events-panel .event-row").first()).toBeVisible();
  await page
    .getByRole("button", { exact: true, name: "Customer refunds" })
    .click();
  await expect(page.getByRole("heading", { name: REFUND })).toBeVisible();
  await expect(cases).toHaveText("24");
  expect(errors).toEqual([]);
});
