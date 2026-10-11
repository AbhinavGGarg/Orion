const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

const scan = '11111111-1111-4111-8111-111111111111';
const user = '22222222-2222-4222-8222-222222222222';
const finding = '33333333-3333-4333-8333-333333333333';
const foreign = '44444444-4444-4444-8444-444444444444';
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });

(async () => {
  const { createChatHandler, redact } = await import(pathToFileURL(path.resolve(__dirname, '../supabase/functions/chat/handler.ts')));
  async function run(options = {}) {
    const calls = [];
    const handler = createChatHandler({ url: 'https://db.example.com', anonKey: 'public-test-key', groqKey: 'server-test-key', model: 'test-model' }, async (url, init) => {
      calls.push({ url, init });
      if (url.endsWith('/auth/v1/user')) return json({ id: user }, options.expired ? 401 : 200);
      if (url.includes('/scans?')) return json(options.foreignScan ? [] : [{ id: scan, status: 'done', target_host: 'app.example.com' }]);
      if (url.includes('/findings?')) return options.readFailure ? json({}, 500) : json([{ id: finding, status: 'done', title: 'Missing CSP', evidence: options.evidence || 'Content-Security-Policy was absent.', locator: '/' }]);
      if (url.includes('/finding_messages?')) return json([{ role: 'user', body: 'What should I fix first?', created_at: '2020-01-01T00:00:00Z' }]);
      if (url.endsWith('/rpc/reserve_chat_request')) return json(!options.rateLimited);
      if (url.includes('api.groq.com')) return json({ choices: [{ message: { content: options.empty ? '' : 'Add and test a Content-Security-Policy header.' } }] }, options.providerStatus || 200);
      if (url.endsWith('/finding_messages')) return json({}, options.saveFailure ? 500 : 201);
      throw new Error('Unexpected endpoint');
    });
    const response = await handler(new Request('https://chat.example.com', {
      method: 'POST', headers: options.anonymous ? {} : { authorization: 'Bearer test-user-token' },
      body: JSON.stringify({ scan_id: scan, message: options.long ? 'a'.repeat(4001) : 'How do I fix this?', context_ids: [options.foreignFinding ? foreign : finding] }),
    }));
    return { status: response.status, body: await response.json(), calls };
  }
  for (const [options, status] of [[{ anonymous: true }, 401], [{ expired: true }, 401], [{ foreignScan: true }, 404], [{ foreignFinding: true }, 400], [{ long: true }, 400], [{ readFailure: true }, 502], [{ rateLimited: true }, 429]]) {
    const checked = await run(options);
    assert.equal(checked.status, status);
    assert.ok(!checked.calls.some(call => call.url.includes('api.groq.com')), 'Invalid access must never reach the paid provider');
  }
  const success = await run();
  assert.equal(success.status, 200);
  assert.equal(success.body.saved, true);
  const provider = success.calls.find(call => call.url.includes('api.groq.com'));
  const prompt = JSON.parse(provider.init.body);
  assert.ok(prompt.messages.some(message => message.content.includes('Content-Security-Policy was absent.')));
  assert.ok(prompt.messages.some(message => message.content === 'What should I fix first?'));
  assert.equal(prompt.messages.at(-1).content, 'How do I fix this?');
  const saved = success.calls.find(call => call.url.endsWith('/finding_messages'));
  const messages = JSON.parse(saved.init.body);
  assert.deepEqual(messages.map(message => message.role), ['user', 'agent']);
  assert.ok(messages.every(message => message.user_id === user && message.scan_id === scan));
  assert.equal(saved.init.headers.authorization, 'Bearer test-user-token');
  assert.ok(success.calls.filter(call => call.url.includes('/rest/')).every(call => !JSON.stringify(call).includes('server-test-key')));
  for (const providerStatus of [429, 503]) {
    const checked = await run({ providerStatus });
    assert.equal(checked.status, providerStatus === 429 ? 429 : 502);
    assert.ok(!checked.calls.some(call => call.url.endsWith('/finding_messages')));
  }
  assert.equal((await run({ empty: true })).status, 502);
  const unsaved = await run({ saveFailure: true });
  assert.equal(unsaved.status, 200);
  assert.equal(unsaved.body.saved, false);
  assert.ok(unsaved.body.answer);
  const sampleKey = 'gsk_' + 's'.repeat(30);
  assert.ok(!redact('Found ' + sampleKey).includes(sampleKey));
  assert.equal(redact('password=not-a-real-secret'), 'password=[redacted]');
  assert.equal(redact('Authorization: Bearer test-secret-value'), 'Authorization: Bearer [redacted]');
  const secretEvidence = await run({ evidence: 'Key ' + sampleKey + ' ' + 'large evidence '.repeat(8000) });
  const secretPrompt = secretEvidence.calls.find(call => call.url.includes('api.groq.com')).init.body;
  assert.ok(!secretPrompt.includes(sampleKey), 'Recognized credentials must be removed before the provider request');
  assert.match(secretPrompt, /excerpt truncated/);
  assert.match(secretPrompt, /truncated\\":true/);
  assert.ok(secretPrompt.length < 40_000, 'Provider context must stay within the aggregate budget');
  console.log('PASS: chat rejects invalid access before Groq; scopes evidence/history; persists ordered messages; handles provider and storage failures.');
})().catch(error => { console.error(error); process.exitCode = 1; });
