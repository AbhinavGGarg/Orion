const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');
const root = path.resolve(__dirname, '..');

(async () => {
  const config = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'config.js'), 'utf8'), config);
  const { SUPABASE_URL: url, SUPABASE_PUBLISHABLE_KEY: apikey } = config.window.POLARIS_CONFIG;
  const credentials = JSON.parse(fs.readFileSync(path.join(root, '.env.chat-test'), 'utf8'));
  const signed = await fetch(url + '/auth/v1/token?grant_type=password', {
    method: 'POST', headers: { apikey, 'content-type': 'application/json' }, body: JSON.stringify(credentials),
  });
  assert.equal(signed.status, 200, 'Temporary account must sign in');
  const session = await signed.json();
  const headers = { apikey, authorization: 'Bearer ' + session.access_token, 'content-type': 'application/json' };
  const scanId = randomUUID(), findingId = randomUUID();
  const call = (route, method, body) => fetch(url + route, { method, headers, body: body && JSON.stringify(body) });
  try {
    assert.equal((await call('/rest/v1/scans', 'POST', { id: scanId, user_id: session.user.id, target_url: 'https://example.com', target_host: 'example.com', checks: ['headers'], status: 'done' })).status, 201);
    assert.equal((await call('/rest/v1/findings', 'POST', { id: findingId, scan_id: scanId, user_id: session.user.id, check_key: 'headers', title: 'Missing CSP', locator: '/', severity: 'medium', status: 'done', blast: 'Unrestricted content sources.', evidence: 'Synthetic test evidence: Content-Security-Policy was absent from the response.' })).status, 201);
    const completion = await call('/functions/v1/chat', 'POST', { scan_id: scanId, message: 'Explain this finding in two sentences and say whether you applied a fix.', context_ids: [findingId.toUpperCase()] });
    const answer = await completion.json();
    assert.equal(completion.status, 200, answer.error || 'Chat request failed');
    assert.ok(answer.answer.length > 20);
    assert.equal(answer.saved, true);
    const history = await (await call('/rest/v1/finding_messages?scan_id=eq.' + scanId + '&order=created_at', 'GET')).json();
    assert.deepEqual(history.map(message => message.role), ['user', 'agent']);
    assert.equal(history[1].body, answer.answer);
    const denied = await call('/functions/v1/chat', 'POST', { scan_id: randomUUID(), message: 'Read another scan.' });
    assert.equal(denied.status, 404);
    const anonymous = await fetch(url + '/functions/v1/chat', { method: 'POST', headers: { apikey, 'content-type': 'application/json' }, body: JSON.stringify({ scan_id: scanId, message: 'Read this scan.' }) });
    assert.equal(anonymous.status, 401);
    const reservations = await Promise.all(Array.from({ length: 8 }, () => call('/rest/v1/rpc/reserve_chat_request', 'POST', {}).then(response => response.json())));
    assert.ok(reservations.every(value => typeof value === 'boolean'));
    assert.ok(reservations.filter(Boolean).length <= 5, 'Atomic quota must include the completed chat request');
    assert.equal((await call('/rest/v1/chat_request_quota?user_id=eq.' + session.user.id, 'DELETE')).status, 403, 'Users cannot reset quota records');
    assert.equal((await call('/functions/v1/chat', 'POST', { scan_id: scanId, message: 'Over quota', context_ids: [findingId] })).status, 429);
    console.log('PASS: real Supabase sign-in, owned evidence, live Groq answer, persisted conversation, uppercase IDs, access denial, concurrent quota enforcement, and protected quota storage.');
    console.log('Synthetic answer:', answer.answer);
  } finally {
    const removed = await call('/rest/v1/scans?id=eq.' + scanId, 'DELETE');
    assert.equal(removed.status, 204, 'Synthetic scan must be removed');
    await call('/auth/v1/logout', 'POST');
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
