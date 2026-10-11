const { chromium } = require('playwright');
const assert = require('node:assert/strict');

const origin = new URL(process.argv[2]).origin;
const token = process.env.VERCEL_OIDC_TOKEN;
const errors = [];

async function previewContext(browser, options = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'no-preference', ...options });
  if (token) await context.route(origin + '/**', route => route.continue({ headers: {
    ...route.request().headers(), 'x-vercel-trusted-oidc-idp-token': token,
  } }));
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  return context;
}

const pixels = page => page.locator('.echoes-particles').evaluate(canvas => canvas.toDataURL());

async function checkLayer(page, contentSelector) {
  await page.locator('.echoes-particles').waitFor();
  assert.equal(await page.locator('.echoes-particles').count(), 1);
  assert.equal(await page.locator('.dr-root, .dr-main, .dr-bloom, .constellation-field').count(), 0, 'App pages must render only the Echoes particle effect');
  const layer = await page.evaluate(selector => {
    const canvas = document.querySelector('.echoes-particles');
    const style = getComputedStyle(canvas);
    const bounds = canvas.getBoundingClientRect();
    const image = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let ink = 0;
    let transparent = 0;
    for (let i = 3; i < image.length; i += 4) { if (image[i]) ink++; else transparent++; }
    return {
      backgroundZ: Number(getComputedStyle(document.querySelector('.field')).zIndex),
      particleZ: Number(style.zIndex),
      contentZ: Number(getComputedStyle(document.querySelector(selector)).zIndex),
      pointerEvents: style.pointerEvents, background: style.backgroundColor,
      hidden: canvas.getAttribute('aria-hidden'),
      fits: Math.abs(bounds.width - document.documentElement.clientWidth) <= 1 && Math.abs(bounds.height - innerHeight) <= 1,
      overflow: document.documentElement.scrollWidth > innerWidth,
      ink, transparent,
    };
  }, contentSelector);
  assert.ok(layer.backgroundZ < layer.particleZ && layer.particleZ < layer.contentZ, 'Particles must be between background and content');
  assert.equal(layer.pointerEvents, 'none');
  assert.equal(layer.background, 'rgba(0, 0, 0, 0)');
  assert.equal(layer.hidden, 'true');
  assert.ok(layer.transparent > 0, 'The canvas must retain transparent pixels instead of covering the background');
  assert.equal(layer.fits, true);
  assert.equal(layer.overflow, false);
  assert.ok(layer.ink > 0, 'Canvas must contain visible particles');
}

// These pages use a test session without reading credentials or writing to Supabase.
const fixture = `export const createClient = () => ({
  auth: {
    getSession: async () => ({data: {session: {user: {
      id: 'fixture-user', email: 'reader@example.com',
      user_metadata: {full_name: 'Preview reader'}, app_metadata: {provider: 'email'}, identities: []
    }}}}),
    onAuthStateChange: () => ({data: {subscription: {unsubscribe() {}}}})
  }
});`;

(async () => {
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge', headless: true });
  try {
    const context = await previewContext(browser);
    const page = await context.newPage();
    const loaded = [];
    page.on('request', request => loaded.push(request.url()));
    await page.goto(origin, { waitUntil: 'networkidle' });
    assert.equal(await page.locator('.echoes-particles, #polaris-background').count(), 0);
    assert.ok(!loaded.some(url => /assets\/particles\.(js|css)/.test(url)), 'Landing must not load Echoes particles');
    await page.goto(origin + '/signin.html', { waitUntil: 'networkidle' });
    await checkLayer(page, '.shell');
    assert.equal(await page.locator('.foot-note').evaluate(node => getComputedStyle(node).zIndex), '2');
    const moving = await pixels(page);
    await page.mouse.move(250, 260);
    await page.mouse.move(450, 430, { steps: 12 });
    await page.waitForTimeout(400);
    assert.notEqual(await pixels(page), moving, 'Particles must animate');
    await page.getByRole('textbox', { name: 'Email', exact: true }).fill('reader@example.com');
    assert.equal(await page.getByRole('textbox', { name: 'Email', exact: true }).inputValue(), 'reader@example.com');
    await page.getByRole('button', { name: 'Pause motion', exact: true }).click();
    await page.waitForTimeout(100);
    const paused = await pixels(page);
    await page.mouse.move(760, 430);
    await page.waitForTimeout(400);
    assert.equal(await pixels(page), paused, 'Pause must freeze particles, including pointer effects');
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Resume motion', exact: true }).waitFor();
    const reloaded = await pixels(page);
    await page.waitForTimeout(400);
    assert.equal(await pixels(page), reloaded, 'Pause must persist on reload');
    await page.getByRole('button', { name: 'Resume motion', exact: true }).click();
    await page.waitForTimeout(400);
    assert.notEqual(await pixels(page), reloaded, 'Resume must restart particles');

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForTimeout(150);
    const reduced = await pixels(page);
    await page.waitForTimeout(400);
    assert.equal(await pixels(page), reduced, 'Changing reduced motion must stop an existing loop');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.waitForTimeout(400);
    assert.notEqual(await pixels(page), reduced, 'Removing reduced motion must resume');

    // Exercise the visibility handler without a platform-specific tab-focus assumption.
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    const hidden = await pixels(page);
    await page.waitForTimeout(400);
    assert.equal(await pixels(page), hidden, 'Hidden document must stop painting');
    await page.evaluate(() => {
      delete document.hidden;
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForTimeout(400);
    assert.notEqual(await pixels(page), hidden, 'Visible document must resume painting');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(200);
    await checkLayer(page, '.shell');
    await page.getByRole('button', { name: 'Pause motion', exact: true }).click();
    await page.screenshot({ path: process.env.POLARIS_SCREENSHOT_DIR ? process.env.POLARIS_SCREENSHOT_DIR + '/particles-mobile.png' : 'particles-mobile.png', fullPage: true });
    await context.close();

    const quiet = await previewContext(browser, { reducedMotion: 'reduce', viewport: { width: 390, height: 844 } });
    const still = await quiet.newPage();
    await still.goto(origin + '/signin.html', { waitUntil: 'networkidle' });
    await checkLayer(still, '.shell');
    const staticPixels = await pixels(still);
    await still.waitForTimeout(400);
    assert.equal(await pixels(still), staticPixels, 'Initial reduced motion must render once');
    await still.getByRole('button', { name: 'Resume motion', exact: true }).click();
    await still.waitForTimeout(500);
    assert.notEqual(await pixels(still), staticPixels, 'Explicit Resume must override the initial reduced-motion default');
    const anotherTab = await quiet.newPage();
    await anotherTab.goto(origin + '/signin.html', { waitUntil: 'networkidle' });
    assert.equal(await anotherTab.locator('html').getAttribute('data-motion'), 'on', 'Explicit Resume must persist in a newly opened tab under reduced motion');
    const anotherFrame = await pixels(anotherTab);
    await anotherTab.waitForTimeout(400);
    assert.notEqual(await pixels(anotherTab), anotherFrame, 'New tabs must animate after explicit Resume');
    await anotherTab.getByRole('button', { name: 'Pause motion', exact: true }).click();
    await still.getByRole('button', { name: 'Resume motion', exact: true }).waitFor();
    await still.waitForTimeout(100);
    const syncedPause = await pixels(still);
    await still.waitForTimeout(400);
    assert.equal(await pixels(still), syncedPause, 'Pause must synchronize to existing tabs');
    await anotherTab.getByRole('button', { name: 'Resume motion', exact: true }).click();
    await still.getByRole('button', { name: 'Pause motion', exact: true }).waitFor();
    await anotherTab.close();
    await still.reload({ waitUntil: 'networkidle' });
    await still.getByRole('button', { name: 'Pause motion', exact: true }).waitFor();
    const resumedReload = await pixels(still);
    await still.waitForTimeout(400);
    assert.notEqual(await pixels(still), resumedReload, 'Explicit Resume must persist across reloads under reduced motion');
    await quiet.route('https://esm.sh/@supabase/supabase-js@2', route => route.fulfill({ contentType: 'application/javascript', body: fixture }));
    await quiet.route('https://*.supabase.co/**', route => route.abort());
    for (const file of ['app.html', 'scanner.html']) {
      await still.goto(origin + '/' + file, { waitUntil: 'networkidle' });
      await checkLayer(still, '.wrap');
      await still.getByRole('button', { name: 'Pause motion', exact: true }).waitFor();
      const navigated = await pixels(still);
      await still.waitForTimeout(400);
      assert.notEqual(await pixels(still), navigated, 'Explicit Resume must persist when navigating to ' + file);
    }
    await still.getByRole('button', { name: 'Pause motion', exact: true }).click();
    await still.waitForTimeout(150);
    const reducedPaused = await pixels(still);
    await still.waitForTimeout(400);
    assert.equal(await pixels(still), reducedPaused, 'Pause must still work after explicitly resuming under reduced motion');
    await quiet.close();

    const application = await previewContext(browser);
    await application.route('https://esm.sh/@supabase/supabase-js@2', route => route.fulfill({ contentType: 'application/javascript', body: fixture }));
    await application.route('https://*.supabase.co/**', route => route.abort());
    const app = await application.newPage();
    for (const file of ['app.html', 'scanner.html']) {
      await app.goto(origin + '/' + file, { waitUntil: 'networkidle' });
      await checkLayer(app, '.wrap');
      if (file === 'app.html') await app.getByRole('tab', { name: 'Website & code', exact: true }).click();
      else {
        await app.locator('#url').fill('https://app.example.com');
        await app.locator('#run').click();
        await app.locator('#consent').waitFor();
        assert.equal(await app.locator('#confirm').isDisabled(), true);
        const overlayZ = await app.locator('#consent').evaluate(node => {
          let current = node;
          while (current) {
            if (Number(getComputedStyle(current).zIndex) > 2) return true;
            current = current.parentElement;
          }
          return false;
        });
        assert.equal(overlayZ, true, 'Scanner consent dialog must remain above particles');
      }
      await app.setViewportSize({ width: 390, height: 844 });
      await app.waitForTimeout(200);
      await checkLayer(app, '.wrap');
      await app.setViewportSize({ width: 1440, height: 900 });
    }
    await application.close();
    assert.deepEqual(errors, []);
    console.log('PASS: Echoes particles on sign-in, dashboard and scanner only; transparent layer below content and dialog; desktop/mobile sizing; input interaction; animation; pause/reload/resume; initial and live reduced motion; explicit Resume under reduced motion persists across new tabs and all app pages; cross-tab pause/resume; simulated visibility lifecycle; no page errors');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
