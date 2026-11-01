import { expect, test } from "@playwright/test";
import { captureScreenshot } from "./helpers";

test("photo working avatars show a visible ring while idle avatars stay plain", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/e2e/fixtures/avatar-motion.html");

  const working = page.locator(".avatar-working");
  await expect(working).toBeVisible();
  await expect(working).toHaveAttribute("data-working", "true");
  const picture = working.locator(".atlas-bot-avatar-picture");
  const ring = working.locator(".atlas-bot-avatar-ring");
  await expect(picture).toBeVisible();
  await expect(ring).toBeVisible();

  const overflow = await working.evaluate((el) => getComputedStyle(el).overflowX);
  const ringAnimation = await ring.evaluate((el: SVGElement) => getComputedStyle(el).animationName);
  const ringColor = await ring.locator("circle").evaluate((el) => getComputedStyle(el).stroke);
  const pictureFace = picture.locator(".atlas-bot-avatar-picture-face");
  const pictureAnimation = await pictureFace.evaluate((el) => getComputedStyle(el).animationName);
  const workingColor = await page.evaluate(() => {
    const probe = document.createElement("span");
    probe.style.color = "var(--status-working)";
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  });
  expect(overflow).not.toBe("hidden");
  expect(ringAnimation).toBe("atlas-avatar-spin");
  expect(ringColor).toBe(workingColor);
  expect(pictureAnimation).toBe("atlas-picture-working");
  const firstPictureTransform = await pictureFace.evaluate((el) => getComputedStyle(el).transform);
  await page.waitForTimeout(300);
  const secondPictureTransform = await pictureFace.evaluate((el) => getComputedStyle(el).transform);
  expect(secondPictureTransform).not.toBe(firstPictureTransform);

  const idle = page.locator(".avatar-idle");
  await expect(idle).toHaveAttribute("data-working", "false");
  await expect(idle.locator(".atlas-bot-avatar-ring")).toHaveCount(0);
  await expect(idle.locator(".atlas-bot-avatar-picture-face")).toHaveCSS(
    "animation-name",
    "atlas-picture-idle",
  );
  await captureScreenshot(page, testInfo, "avatar-photo-working-and-idle");
});

test("photo avatar animations stay still when reduced motion is enabled", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/e2e/fixtures/avatar-motion.html");

  const avatar = page.locator(".avatar-working");
  await expect(avatar).toBeVisible();
  await expect(avatar).toHaveAttribute("data-working", "true");

  const ring = avatar.locator(".atlas-bot-avatar-ring");
  const pictureFace = avatar.locator(".atlas-bot-avatar-picture-face");
  await expect(ring).toBeVisible();
  const snapshot = () =>
    Promise.all([
      ring.evaluate((el: SVGElement) => ({
        animationName: getComputedStyle(el).animationName,
        transform: getComputedStyle(el).transform,
      })),
      pictureFace.evaluate((el) => ({
        animationName: getComputedStyle(el).animationName,
        transform: getComputedStyle(el).transform,
      })),
    ]);
  const first = await snapshot();
  await page.waitForTimeout(300);
  const second = await snapshot();

  expect(first[0]?.animationName).toBe("none");
  expect(first[1]?.animationName).toBe("none");
  expect(second).toEqual(first);
});
