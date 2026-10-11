const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const origin = new URL(process.argv[2]).origin;
const output = process.env.POLARIS_SCREENSHOT_DIR || '.';

function sdkFixture() {
  const scan = { id: 'fixture-scan', status: 'done', target_host: 'app.example.com', target_url: 'https://app.example.com', checks: ['headers'] };
  const findings = [
    { id: 'missing-csp', status: 'done', title: 'Missing CSP', severity: 'medium', locator: '/', evidence: 'CSP was absent.', blast: 'Unrestricted content sources.', position: 0 },
    { id: 'source-map', status: 'done', title: 'Exposed app.js.map', severity: 'high', locator: '/app.js.map', evidence: 'Source map returned HTTP 200.', blast: 'Source code is public.', position: 1 },
    { id: 'blocked', status: 'blocked', title: 'Unavailable check', severity: 'context', locator: '/', blast: 'Timed out.', position: 2 },
  ];
  const history = [];
  return {
    auth: { getSession: async () => ({ data: { session: { user: { id: 'fixture-user', user_metadata: {}, identities: [] } } } }), onAuthStateChange() {} },
    from(table) {
      const query = { select: () => query, eq: () => query, in: () => query,
        single: async () => ({ data: scan }),
        order: async () => ({ data: structuredClone(table === 'findings' ? findings : table === 'finding_messages' ? history : []) }) };
      return query;
    },
    functions: { async invoke(name, { body }) {
      window.chatRequest = { name, body };
      await new Promise(resolve => setTimeout(resolve, 300));
      if (body.message === 'Show an error') return { error: { context: { json: async () => ({ error: 'Chat is busy. Please try again in a minute.' }) } } };
      const messages = [{ role: 'user', body: body.message }, { role: 'agent', body: 'Test response: review the CSP header. <script>unsafe</script>' }];
      history.push(...messages);
      return { data: { answer: messages[1].body, messages, saved: true } };
    } },
    removeChannel() {}, channel() { const channel = { on: () => channel, subscribe: () => channel }; return channel; },
  };
}

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    if (process.env.VERCEL_OIDC_TOKEN) await context.route(origin + '/**', route => route.continue({ headers: { ...route.request().headers(), 'x-vercel-trusted-oidc-idp-token': process.env.VERCEL_OIDC_TOKEN } }));
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin);
    await page.locator('#coverage-constellation').scrollIntoViewIfNeeded();
    await page.locator('.sky-viewport[data-webgl="ready"]').waitFor();
    assert.equal(await page.locator('.sky-label:not(.sky-agent-label)').count(), 5);
    assert.deepEqual(await page.locator('.sky-agents strong').allTextContents(), ['Scout', 'Analyst', 'Fixer']);
    assert.equal(await page.locator('.sky-agent-label').count(), 3);
    assert.match(await page.locator('.sky-caption').innerText(), /Sample findings only/);
    const animated = await page.locator('.sky-label:not(.sky-target)').first().getAttribute('style');
    await page.waitForTimeout(500);
    assert.notEqual(await page.locator('.sky-label:not(.sky-target)').first().getAttribute('style'), animated, 'The constellation must animate');
    await page.getByRole('button', { name: 'Pause motion', exact: true }).click();
    await page.locator('#coverage-constellation').scrollIntoViewIfNeeded();
    await page.waitForTimeout(250);
    const position = () => page.locator('.sky-label:not(.sky-target)').first().getAttribute('style');
    const still = await position();
    await page.waitForTimeout(300);
    assert.equal(await position(), still);
    await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
    await page.waitForTimeout(100);
    assert.notEqual(await position(), still, 'Zoom must work even when animation is paused');
    const box = await page.locator('.sky-viewport').boundingBox();
    const beforeOrbit = await position();
    await page.mouse.move(box.x + 30, box.y + 70);
    await page.mouse.down();
    await page.mouse.move(box.x + 150, box.y + 110, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(100);
    assert.notEqual(await position(), beforeOrbit, 'Dragging must orbit the view');
    await page.getByRole('button', { name: 'Reset view', exact: true }).click();
    await page.getByRole('button', { name: 'Fullscreen', exact: true }).click();
    await page.waitForFunction(() => document.fullscreenElement?.classList.contains('polaris-constellation'));
    const fullscreen = page.locator('.polaris-constellation');
    await fullscreen.getByRole('button', { name: 'Resume motion', exact: true }).click();
    assert.equal(await page.locator('html').getAttribute('data-motion'), 'on');
    await fullscreen.getByRole('button', { name: 'Pause motion', exact: true }).click();
    await page.screenshot({ path: path.join(output, 'polaris-fullscreen.png') });
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.fullscreenElement);
    assert.equal(await page.getByRole('button', { name: 'Fullscreen', exact: true }).getAttribute('aria-pressed'), 'false');
    await page.getByRole('button', { name: 'Explore: Missing CSP', exact: true }).click();
    assert.match(await page.locator('.sky-detail').innerText(), /Demo/);
    await page.getByRole('button', { name: 'Simulate fixes', exact: true }).click();
    await page.getByText('Locating the source', { exact: true }).waitFor();
    await page.getByText('Reviewing evidence', { exact: true }).waitFor();
    await page.getByText('Previewing the fix', { exact: true }).waitFor();
    await page.waitForFunction(() => document.querySelectorAll('.sky-fixed').length === 4);
    assert.match(await page.locator('.sky-simulation').innerText(), /No files or saved findings have changed/);
    await page.screenshot({ path: path.join(output, 'polaris-landing.png'), fullPage: true });
    await page.getByRole('button', { name: 'Reset simulation', exact: true }).click();
    assert.equal(await page.locator('.sky-fixed').count(), 0);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#coverage-constellation').scrollIntoViewIfNeeded();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.getByRole('button', { name: 'Fullscreen', exact: true }).click();
    await page.waitForFunction(() => !!document.fullscreenElement);
    assert.equal(await page.evaluate(() => document.fullscreenElement.scrollWidth > innerWidth), false);
    const mobileCanvas = await page.locator('.sky-viewport').boundingBox();
    assert.ok(mobileCanvas.width > 300 && mobileCanvas.height > 180);
    await page.screenshot({ path: path.join(output, 'polaris-fullscreen-mobile.png') });
    await page.getByRole('button', { name: 'Exit fullscreen', exact: true }).click();
    await page.waitForFunction(() => !document.fullscreenElement);
    await page.screenshot({ path: path.join(output, 'polaris-mobile.png') });

    await context.route('https://esm.sh/@supabase/supabase-js@2', route => route.fulfill({ contentType: 'application/javascript', body: 'export const createClient = () => (' + sdkFixture.toString() + ')();' }));
    await context.route('https://*.supabase.co/**', route => route.abort());
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(origin + '/scanner.html?scan=fixture-scan');
    await page.getByRole('tab', { name: '3D constellation', exact: true }).click();
    await page.locator('.sky-viewport[data-webgl="ready"]').waitFor();
    assert.equal(await page.locator('.sky-label:not(.sky-agent-label)').count(), 3, 'Only completed findings become stars');
    assert.equal(await page.locator('.sky-agent-label').count(), 3);
    assert.equal(await page.locator('#chat-panel').isVisible(), false);
    await page.screenshot({ path: path.join(output, 'polaris-report.png'), fullPage: true });
    await page.getByRole('button', { name: 'Fullscreen', exact: true }).click();
    await page.waitForFunction(() => !!document.fullscreenElement);
    await page.waitForFunction(() => parseFloat(document.querySelector('.sky-target').style.left) > 100);
    await page.getByRole('button', { name: 'View evidence: Missing CSP', exact: true }).click();
    await page.waitForFunction(() => !document.fullscreenElement);
    assert.equal(await page.locator('#tab-overview').getAttribute('aria-selected'), 'true');
    assert.equal(await page.locator('#chat-panel').isVisible(), true);
    assert.match(await page.locator('#findings-list').innerText(), /CSP was absent/);
    await page.locator('#chat-input').fill('How can I fix this?');
    await page.locator('#chat-form button').click();
    assert.equal(await page.locator('#chat-form button').isDisabled(), true);
    await page.getByText('Test response: review the CSP header. <script>unsafe</script>', { exact: true }).waitFor();
    assert.equal(await page.locator('#chat-log script').count(), 0, 'Assistant output must be escaped');
    const invoked = await page.evaluate(() => window.chatRequest);
    assert.equal(invoked.name, 'chat');
    assert.ok(invoked.body.context_ids.includes('missing-csp'));
    await page.locator('#chat-input').fill('Show an error');
    await page.locator('#chat-form button').click();
    await page.getByText('Chat is busy. Please try again in a minute.', { exact: true }).waitFor();
    assert.equal(await page.locator('#chat-input').inputValue(), 'Show an error');
    assert.equal(await page.locator('#chat-form button').isDisabled(), false);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('tab', { name: '3D constellation', exact: true }).click();
    await page.locator('#report-constellation').scrollIntoViewIfNeeded();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'Mobile report must not overflow');
    await page.screenshot({ path: path.join(output, 'polaris-report-mobile.png') });
    assert.deepEqual(errors, []);
    console.log('PASS: hosted demo, WebGL, three simulation agents and stages, fullscreen enter/exit, fullscreen evidence selection, paused zoom, fix simulation/reset, mobile sizing, report tab, chat request/loading/error handling, and output escaping.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
