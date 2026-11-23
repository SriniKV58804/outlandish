import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { chromium } from "playwright";
import type { Locator, Page } from "playwright";

const origin = process.env.OUTLANDISH_TEST_URL ?? "http://127.0.0.1:3000";
const artifacts = process.env.OUTLANDISH_CAPTURE_DIR;
const preview = new URL("/preview", origin).href;

async function screenshot(page: Page, name: string) {
  if (!artifacts) return;
  await mkdir(artifacts, { recursive: true });
  await page.screenshot({ path: resolve(artifacts, name) });
}

// Pick an actual hit target. Portraits may intentionally overlap and are not
// guaranteed to follow DOM order or to be inside the viewport.
async function reachable(buttons: Locator) {
  const index = await buttons.evaluateAll((elements) => elements.findIndex((item) => {
    const r = item.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    return r.width > 0 && r.height > 0 && item.contains(document.elementFromPoint(x, y));
  }));
  assert.ok(index >= 0, "at least one control must be visible and accept input");
  return buttons.nth(index);
}

async function positions(page: Page) {
  return page.getByTestId("scene-clip").evaluateAll((elements) => elements.map((element) => ({
    id: element.getAttribute("data-post-id"),
    x: element.getBoundingClientRect().x,
    depth: Number(element.getAttribute("data-depth")),
  })));
}

test("anonymous visitors cannot obtain opportunities or select the preview through the private route", async () => {
  for (const path of ["/", "/?fixture=illustrative"]) {
    const response = await fetch(new URL(path, origin), { redirect: "manual" });
    assert.match(response.headers.get("cache-control") ?? "", /no-store/i);
    const body = await response.text();
    assert.doesNotMatch(body, /data-testid="scene-(clip|topic)"|data-testid="preview-label"/);
    assert.ok([200, 302, 303, 307, 401, 403, 503].includes(response.status));
  }
  for (const path of ["/api/briefs/latest", "/api/opportunities/probe"]) {
    const response = await fetch(new URL(path, origin), { redirect: "manual" });
    assert.ok([401, 403, 503].includes(response.status));
    assert.match(response.headers.get("cache-control") ?? "", /private.*no-store|no-store.*private/i);
    const payload = await response.json();
    assert.equal(typeof payload.error, "string");
    assert.equal(payload.opportunities, undefined);
  }
  for (const method of ["GET", "POST"]) {
    const response = await fetch(new URL("/api/collection/refresh", origin), { method });
    assert.equal(response.status, 401);
    assert.match(response.headers.get("cache-control") ?? "", /no-store/i);
  }
});

test("desktop displays real image resources, pans at multiple depths and restores the camera after inspection", async (t) => {
  const browser = await chromium.launch({ channel: process.env.OUTLANDISH_TEST_BROWSER_CHANNEL });
  t.after(() => browser.close());
  const viewport = { width: 1440, height: 900 };
  const context = await browser.newContext({
    viewport,
    recordVideo: artifacts ? { dir: artifacts, size: viewport } : undefined,
  });
  t.after(() => context.close());
  const page = await context.newPage();
  const errors: string[] = [];
  const providerRequests: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => {
    if (new URL(request.url()).hostname === "connect.oriane.xyz") providerRequests.push(request.url());
  });
  await page.goto(preview);
  await page.getByTestId("preview-label").waitFor();
  const world = page.getByTestId("scene-world");
  await world.waitFor();
  await page.waitForFunction(() => {
    const images = Array.from(document.querySelectorAll<HTMLImageElement>('[data-testid="scene-clip"] img'));
    return images.length > 1 && images.every(img => img.complete && img.naturalWidth > 0);
  });
  await screenshot(page, "opening.png");
  const before = await positions(page);
  const horizon = page.getByTestId("scene-horizon");
  const horizonBefore = await horizon.boundingBox();
  assert.ok(horizonBefore);

  // Start on a card to catch accidental activation at the end of a drag.
  const dragCard = await reachable(page.getByTestId("scene-clip"));
  const dragBox = await dragCard.boundingBox();
  assert.ok(dragBox);
  const x = dragBox.x + dragBox.width / 2;
  const y = dragBox.y + dragBox.height / 2;
  const travel = x < viewport.width / 2 ? 125 : -125;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + travel, y + 12, { steps: 12 });
  await page.mouse.up();
  await page.waitForFunction(() => document.querySelector('[data-testid="scene-world"]')?.getAttribute("data-mode") === "overview");
  assert.equal(await page.getByRole("dialog", { name: "Clip evidence" }).isVisible(), false);
  await page.waitForFunction((initial) => {
    const node = document.querySelector('[data-testid="scene-clip"]');
    return !!node && Math.abs(node.getBoundingClientRect().x - initial) > 5;
  }, before[0].x);
  const dragged = await positions(page);
  const horizonAfter = await horizon.boundingBox();
  assert.ok(horizonAfter);
  const shifts = dragged.map((card, i) => Math.abs(card.x - before[i].x));
  assert.ok(Math.max(...shifts) - Math.min(...shifts) > 5, "clip depths must move differently");
  assert.ok(Math.max(...shifts) > Math.abs(horizonAfter.x - horizonBefore.x) + 5, "foreground crosses the horizon");

  // A real drag coasts after release. Save the settled position so the
  // return assertion compares the exact departure and arrival coordinates.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByTestId("scene-horizon").evaluate(async (horizon) => {
    let prior = horizon.getBoundingClientRect().x;
    let stillFrames = 0;
    const deadline = performance.now() + 3000;
    while (stillFrames < 6 && performance.now() < deadline) {
      await new Promise(requestAnimationFrame);
      const next = horizon.getBoundingClientRect().x;
      stillFrames = Math.abs(next - prior) < 0.001 ? stillFrames + 1 : 0;
      prior = next;
    }
  });
  const topic = await reachable(page.getByTestId("scene-topic"));
  const topicId = await topic.getAttribute("data-topic-id");
  assert.ok(topicId);
  await topic.focus();
  const saved = await positions(page);
  await topic.press("Enter");
  await page.locator('[data-testid="scene-world"][data-mode="topic"]').waitFor();
  const clip = await reachable(page.getByTestId("scene-clip").and(page.locator('[data-topic-id=' + JSON.stringify(topicId) + ']')));
  const id = await clip.getAttribute("data-post-id");
  assert.ok(id);
  await clip.press("Enter");
  const detail = page.getByRole("dialog", { name: "Clip evidence" });
  await detail.waitFor();
  const detailLink = new URL(page.url());
  assert.equal(detailLink.searchParams.get("opportunity"), topicId);
  assert.equal(detailLink.searchParams.get("clip"), id);
  const direct = await context.newPage();
  await direct.goto(detailLink.href);
  await direct.getByRole("dialog", { name: "Clip evidence" }).waitFor();
  await direct.close();
  await screenshot(page, "clip-evidence.png");
  assert.ok((await detail.innerText()).trim().length > 40);
  await page.keyboard.press("Escape");
  await detail.waitFor({ state: "hidden" });
  await page.waitForFunction((id) => document.activeElement?.getAttribute("data-post-id") === id, id);
  await page.keyboard.press("Escape");
  await page.locator('[data-testid="scene-world"][data-mode="overview"]').waitFor();
  await page.waitForFunction((id) => document.activeElement?.getAttribute("data-topic-id") === id, topicId);
  assert.equal(new URL(page.url()).searchParams.has("opportunity"), false);
  const restored = await positions(page);
  for (const [index, card] of restored.entries()) {
    assert.equal(card.id, saved[index].id);
    assert.ok(Math.abs(card.x - saved[index].x) <= 2, "return must restore the same camera");
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(providerRequests, []);
});

test("at phone width, a tap and the list reach evidence with reduced motion and no horizontal overflow", async (t) => {
  const browser = await chromium.launch({ channel: process.env.OUTLANDISH_TEST_BROWSER_CHANNEL });
  t.after(() => browser.close());
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: "reduce",
  });
  await page.goto(preview);
  await page.getByTestId("preview-label").waitFor();
  assert.equal(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches), true);
  await screenshot(page, "phone-opening.png");
  const index = page.getByRole("button", { name: "Topic index" });
  await index.tap();
  const topic = await reachable(page.getByTestId("index-topic"));
  const id = await topic.getAttribute("data-topic-id");
  await topic.tap();
  await page.locator('[data-testid="scene-world"][data-mode="topic"]').waitFor();
  const allClips = page.getByTestId("scene-clip");
  const clips = id ? allClips.and(page.locator('[data-topic-id=' + JSON.stringify(id) + ']')) : allClips;
  const clip = await reachable(clips);
  assert.equal(await clip.evaluate(el => getComputedStyle(el).transitionDuration
    .split(",").every(duration => Number.parseFloat(duration) === 0)), true);
  await clip.tap();
  const detail = page.getByRole("dialog", { name: "Clip evidence" });
  await detail.waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  const close = page.getByTestId("close-evidence");
  const bounds = await close.boundingBox();
  assert.ok(bounds && bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= 391 && bounds.y + bounds.height <= 845);
  await screenshot(page, "phone-evidence.png");
  await close.tap();
  await detail.waitFor({ state: "hidden" });
  await page.getByTestId("scene-back").tap();
  await page.locator('[data-testid="scene-world"][data-mode="overview"]').waitFor();
});
