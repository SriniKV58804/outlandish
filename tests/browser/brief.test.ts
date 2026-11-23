import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright";
import type { Browser } from "playwright";

const origin = process.env.OUTLANDISH_TEST_URL ?? "http://127.0.0.1:3000";
const topic = "Heatless curls for short hair";
const detailId = "sample-curlers";
const cardId = `opportunity-${detailId}`;

async function launchBrowser(): Promise<Browser> {
  return chromium.launch({ channel: process.env.OUTLANDISH_TEST_BROWSER_CHANNEL, headless: true });
}

test("keyboard and browser history preserve the evidence journey", async (t) => {
  const browser = await launchBrowser();
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(origin);
  await page.getByRole("heading", { name: /this week.s opportunities/i }).waitFor();
  const card = page.getByRole("button", { name: new RegExp(topic, "i") });
  const detail = page.getByRole("region", { name: "Opportunity detail" });
  await card.focus();
  await page.keyboard.press("Enter");
  await detail.waitFor();
  assert.equal(new URL(page.url()).searchParams.get("opportunity"), detailId);
  await detail.getByRole("heading", { name: /what to pitch/i }).waitFor();
  await detail.getByText("Will this stay in place on chin-length hair?", { exact: true }).first().waitFor();
  await detail.getByRole("button", { name: /inspect source post/i }).nth(1).click();
  const selectedPost = detail.getByRole("article", { name: "Selected post details" });
  await selectedPost.getByText("Comments partially available").waitFor();
  await selectedPost.getByText("I had the same question before trying it.").waitFor();
  await page.keyboard.press("Escape");
  await detail.waitFor({ state: "hidden" });
  assert.equal(new URL(page.url()).searchParams.has("opportunity"), false);
  await page.waitForFunction((id) => document.activeElement?.id === id, cardId);
  await page.keyboard.press("Enter");
  await detail.waitFor();
  await page.goBack();
  await detail.waitFor({ state: "hidden" });
  await page.waitForFunction((id) => document.activeElement?.id === id, cardId);
  await page.goto(new URL(`/?opportunity=${detailId}`, origin).href);
  await detail.waitFor();
});

test("touch and reduced motion keep the brief readable at phone width", async (t) => {
  const browser = await launchBrowser();
  t.after(() => browser.close());
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    reducedMotion: "reduce",
  });
  await page.goto(origin);
  assert.equal(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches), true);
  const card = page.getByRole("button", { name: new RegExp(topic, "i") });
  await card.tap();
  const detail = page.getByRole("region", { name: "Opportunity detail" });
  await detail.getByRole("heading", { name: /source evidence/i }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  const firstPost = detail.getByRole("button", { name: /inspect tiktok post/i }).first();
  assert.equal(await firstPost.evaluate((element) => getComputedStyle(element).animationName), "none");
  await detail.getByRole("button", { name: /back to opportunities/i }).tap();
  await card.waitFor();
});

test("unpublished and empty fixture weeks render different states", async (t) => {
  const browser = await launchBrowser();
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.goto(new URL("/?fixture=unpublished", origin).href);
  await page.getByRole("heading", { name: /no brief published yet/i }).waitFor();
  await page.goto(new URL("/?fixture=empty", origin).href);
  await page.getByRole("heading", { name: /no qualifying opportunities this week/i }).waitFor();
});
