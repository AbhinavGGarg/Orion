const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');

const root = path.resolve(__dirname, '..');
const scanDir = path.join(root, 'supabase/functions/polaris-scan');
const engine = stripTypeScriptTypes(fs.readFileSync(path.join(scanDir, 'engine.ts'), 'utf8')).replace(/^export /gm, '');
const runner = stripTypeScriptTypes(fs.readFileSync(path.join(scanDir, 'index.ts'), 'utf8')
  .replace(/^import[\s\S]*?from "[^"]+";\s*/gm, ''));
const checks = ['fingerprint', 'exposed-keys', 'source-maps', 'backend-defaults', 'admin-routes', 'headers'];

function fixture(options = {}) {
  const rows = {
    scans: [{ id: 'scan-1', target_url: 'https://app.example.com/', checks: options.checks || checks, status: 'queued' }],
    findings: [], finding_steps: [],
  };
  let sequence = 0;
  let handler;
  let clock = Date.now();
  const requests = [];
  const writes = [];
  const db = {
    from(table) {
      const filters = [];
      let action = 'select', payload, single = false, pending;
      const query = {
        select() { return query; },
        eq(key, value) { filters.push(row => row[key] === value); return query; },
        in(key, values) { filters.push(row => values.includes(row[key])); return query; },
        maybeSingle() { single = true; return query; },
        single() { single = true; return query; },
        update(value) { action = 'update'; payload = value; return query; },
        insert(value) { action = 'insert'; payload = value; return query; },
        delete() { action = 'delete'; return query; },
        then(resolve, reject) {
          pending ||= Promise.resolve().then(() => {
            if (action !== 'select') writes.push({ table, action, payload });
            if (options.fail?.({ table, action, payload })) return { data: null, error: { message: options.failMessage || 'database unavailable' } };
            let selected = rows[table].filter(row => filters.every(filter => filter(row)));
            if (action === 'insert') {
              selected = (Array.isArray(payload) ? payload : [payload]).map(row => ({ id: 'row-' + ++sequence, ...row }));
              rows[table].push(...selected);
            } else if (action === 'update') selected.forEach(row => Object.assign(row, payload));
            else if (action === 'delete') rows[table] = rows[table].filter(row => !selected.includes(row));
            return { data: structuredClone(single ? selected[0] || null : selected), error: null };
          });
          return pending.then(resolve, reject);
        },
      };
      return query;
    },
  };
  const context = vm.createContext({
    createClient: () => db,
    Deno: { env: { get: () => 'test' }, serve: callback => { handler = callback; } },
    Request, Response, URL, Headers, AbortController, Error, setTimeout, clearTimeout,
    Date: class extends Date { static now() { return clock; } },
    fetch: async (url, init) => {
      requests.push(url);
      return options.fetch ? options.fetch(url, init) : new Response('<html><p>Example</p></html>');
    },
  });
  vm.runInContext(engine + '\n' + runner, context);
  return {
    rows, requests, writes, context,
    advance(ms) { clock += ms; },
    run: () => handler(new Request('https://scanner.example.com/scan', {
      method: 'POST', headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' },
      body: JSON.stringify({ scan_id: 'scan-1' }),
    })),
  };
}

async function run() {
  for (const [message, expected] of [
    ['invalid peer certificate: NotValidForName', /certificate does not match its domain/],
    ['invalid peer certificate: UnknownIssuer', /certificate could not be verified/],
    ['dns error: ENOTFOUND', /domain could not be found/],
    ['connection refused: ECONNREFUSED', /refused or closed/],
  ]) {
    const test = fixture({ fetch: () => { throw new Error(message); } });
    const response = await test.run();
    assert.equal(response.status, 500);
    assert.equal(test.rows.scans[0].status, 'failed');
    assert.match(test.rows.scans[0].error, expected);
    assert.equal(test.rows.findings.length, 0);
    assert.equal(test.requests.length, 1);
  }
  const timeout = fixture({ fetch: () => { const error = new Error('aborted'); error.name = 'AbortError'; throw error; } });
  await timeout.run();
  assert.match(timeout.rows.scans[0].error, /did not answer within/);
  for (const status of [401, 403, 404, 429, 500, 503]) {
    const test = fixture({ fetch: () => new Response('Unavailable', { status }) });
    await test.run();
    assert.equal(test.rows.scans[0].status, 'failed');
    assert.match(test.rows.scans[0].error, new RegExp('HTTP ' + status));
    assert.equal(test.rows.findings.length, 0);
  }
  console.log('PASS: TLS, DNS, connection, timeout and HTTP failures fail once with an actionable reason');

  const failedScripts = url => url.endsWith('/')
    ? new Response('<script src="/app.js"></script>')
    : Promise.reject(new Error('connection refused'));
  const blocked = fixture({ checks: ['exposed-keys', 'source-maps', 'backend-defaults'], fetch: failedScripts });
  await blocked.run();
  assert.equal(blocked.rows.scans[0].status, 'failed');
  assert.ok(blocked.rows.findings.every(row => row.status === 'blocked' && !row.evidence && row.severity === 'context'));
  const partial = fixture({ checks: ['exposed-keys', 'headers'], fetch: failedScripts });
  await partial.run();
  assert.equal(partial.rows.scans[0].status, 'done');
  assert.equal(partial.rows.findings.filter(row => row.status === 'blocked').length, 1);
  assert.equal(partial.rows.findings.filter(row => row.status === 'done' && row.evidence).length, 1);
  const someScripts = fixture({ checks: ['exposed-keys', 'source-maps', 'backend-defaults'], fetch: url => {
    if (url.endsWith('/')) return new Response('<script src="/ok.js"></script><script src="/bad.js"></script>');
    return new Response('', { status: url.endsWith('/bad.js') ? 503 : 200 });
  } });
  await someScripts.run();
  assert.equal(someScripts.rows.scans[0].status, 'failed');
  assert.equal(someScripts.rows.findings.length, 3);
  assert.ok(someScripts.rows.findings.every(row => row.status === 'blocked'));
  console.log('PASS: all-blocked and partial scans retain honest outcomes; unavailable scripts cannot produce a clean result');

  for (const withMissingScript of [true, false]) {
    const test = fixture({ checks: ['backend-defaults'], fetch: url => {
      if (url.endsWith('/')) return new Response(withMissingScript
        ? '<script src="/ok.js"></script><script src="/bad.js"></script>'
        : 'https://abcdefghijklmnop.supabase.co https://scan-test.firebaseio.com');
      if (url.endsWith('/ok.js')) return new Response('https://scan-test.firebaseio.com');
      if (url.endsWith('/bad.js')) throw new Error('connection refused');
      return new Response('Access denied', { status: 403 });
    } });
    await test.run();
    assert.equal(test.rows.scans[0].status, 'failed');
    assert.equal(test.rows.findings[0].status, 'blocked');
  }
  const syntheticSecret = 'sk_' + 'live_' + 'X'.repeat(24);
  const positiveCases = [
    ['exposed-keys', url => url.endsWith('/') ? new Response('<script src="/bad.js"></script>' + syntheticSecret) : Promise.reject(new Error('offline'))],
    ['backend-defaults', url => url.endsWith('/') ? new Response('https://abcdefghijklmnop.supabase.co https://scan-test.firebaseio.com') : new Response('{"public":true}')],
    ['source-maps', url => {
      if (url.endsWith('/')) return new Response('<script src="/a.js"></script><script src="/b.js"></script>');
      if (url.endsWith('.js')) return new Response('//# sourceMappingURL=' + url + '.map');
      if (url.endsWith('a.js.map')) return new Response('{"sources":["app.ts"],"sourcesContent":["example"]}');
      throw new Error('offline');
    }],
    ['admin-routes', url => {
      if (url.endsWith('/')) return new Response('Example');
      if (url.endsWith('/admin')) return new Response('Admin content '.repeat(30));
      if (url.endsWith('/debug')) throw new Error('offline');
      return new Response('not found', { status: 404 });
    }],
  ];
  for (const [key, fetch] of positiveCases) {
    const test = fixture({ checks: [key], fetch });
    await test.run();
    assert.equal(test.rows.scans[0].status, 'done', key);
    assert.ok(test.rows.scans[0].error, key + ' must retain incomplete coverage');
    assert.equal(test.rows.findings[0].status, 'done', key);
    assert.ok(test.rows.findings[0].evidence, key + ' must retain the proof');
    assert.match(test.rows.findings[0].blast, /Coverage incomplete/, key);
  }
  const large = ' '.repeat(2000001);
  const largePage = fixture({ fetch: () => new Response(large) });
  await largePage.run();
  assert.equal(largePage.rows.scans[0].status, 'failed');
  assert.match(largePage.rows.scans[0].error, /size limit/);
  for (const prefix of ['', syntheticSecret]) {
    const test = fixture({ checks: ['exposed-keys', 'source-maps'], fetch: url => url.endsWith('/')
      ? new Response('<script src="/app.js"></script>') : new Response(prefix + large) });
    await test.run();
    assert.equal(test.rows.scans[0].status, prefix ? 'done' : 'failed');
    if (prefix) assert.ok(test.rows.scans[0].error);
    assert.ok(test.rows.findings.some(row => row.status === 'blocked'));
  }
  console.log('PASS: partial backend coverage, positive findings with failed probes, and truncated bodies remain explicitly incomplete');

  const publicKey = 'sb_' + 'publishable_' + 'X'.repeat(20);
  for (const schemaMode of ['offline', '503', 'large', 'invalid', 'too-many-tables']) {
    for (const positive of [false, true]) {
      const test = fixture({ checks: ['backend-defaults'], fetch: url => {
        if (url === 'https://app.example.com/') return new Response('https://abcdefghijklmnop.supabase.co ' + publicKey);
        if (url.endsWith('/rest/v1/')) {
          if (schemaMode === 'offline') throw new Error('discovery offline');
          if (schemaMode === '503') return new Response('Unavailable', { status: 503 });
          if (schemaMode === 'large') return new Response(large);
          if (schemaMode === 'invalid') return new Response('{}');
          return new Response(JSON.stringify({ definitions: Object.fromEntries(Array.from({ length: 8 }, (_, i) => ['table' + i, {}])) }));
        }
        return positive ? new Response('[{"public":true}]') : new Response('not found', { status: 404 });
      } });
      await test.run();
      assert.equal(test.rows.scans[0].status, positive ? 'done' : 'failed', schemaMode);
      if (positive) assert.ok(test.rows.scans[0].error, schemaMode);
    }
  }
  for (const [key, count] of [['exposed-keys', 8], ['source-maps', 5]]) {
    const test = fixture({ checks: [key], fetch: url => {
      if (url.endsWith('/')) return new Response(Array.from({ length: count }, (_, i) => '<script src="/bundle' + i + '.js"></script>').join(''));
      if (url.endsWith('.js')) return new Response('//# sourceMappingURL=' + url + '.map');
      return new Response('not found', { status: 404 });
    } });
    await test.run();
    assert.equal(test.rows.scans[0].status, 'failed', key + ' must disclose omitted files');
  }
  console.log('PASS: failed schema discovery and table, script and map limits cannot silently omit coverage');

  for (const fail of [
    ({ table, action }) => table === 'finding_steps' && action === 'insert',
    ({ table, action }) => table === 'finding_steps' && action === 'update',
    ({ table, action }) => table === 'findings' && action === 'delete',
    ({ table, action }) => table === 'findings' && action === 'update',
    ({ table, payload }) => table === 'scans' && payload?.status === 'done',
  ]) {
    const test = fixture({ checks: ['fingerprint', 'headers'], fail });
    const response = await test.run();
    assert.equal(response.status, 500);
    assert.equal(test.rows.scans[0].status, 'failed');
    assert.match(test.rows.scans[0].error, /Could not save/);
    if (!fail({ table: 'findings', action: 'update' })) {
      assert.ok(test.rows.findings.every(row => row.status !== 'running' && row.status !== 'pending'));
    }
  }
  const unsaved = fixture({ fetch: () => { throw new Error('offline'); }, fail: ({ payload }) => payload?.status === 'failed' });
  assert.match((await (await unsaved.run()).json()).save_error, /could not be saved/);
  const persistenceDns = fixture({ checks: ['headers'], failMessage: 'ENOTFOUND database-host',
    fail: ({ table, action }) => table === 'finding_steps' && action === 'insert' });
  await persistenceDns.run();
  assert.match(persistenceDns.rows.scans[0].error, /Could not save.*ENOTFOUND/);
  assert.doesNotMatch(persistenceDns.rows.scans[0].error, /site's DNS/);
  const concurrent = fixture({ checks: ['headers'] });
  const responses = await Promise.all([concurrent.run(), concurrent.run()]);
  assert.deepEqual(responses.map(response => response.status).sort(), [200, 409]);
  assert.equal(concurrent.rows.findings.length, 1);
  assert.equal((await concurrent.run()).status, 409);
  for (const selected of [[], ['unknown-check'], ['headers', 'headers']]) {
    const test = fixture({ checks: selected });
    await test.run();
    assert.equal(test.rows.scans[0].status, 'failed');
    assert.equal(test.requests.length, 0);
  }
  console.log('PASS: database failures cannot report success; duplicate invocations do not rerun; invalid check selections fail');

  const bounded = fixture();
  const grab = bounded.context.createFetcher();
  bounded.advance(120001);
  assert.match((await grab('https://app.example.com/')).reason, /time limit/);
  assert.equal(bounded.requests.length, 0);
  const origin = fixture({ checks: ['exposed-keys'], fetch: () => new Response('<script src="https://app.example.com.attacker.example/bundle.js"></script>') });
  await origin.run();
  assert.deepEqual(origin.requests, ['https://app.example.com/']);
  const clean = fixture({ checks: ['fingerprint', 'headers'], fetch: () => new Response('<html>Example</html>', { headers: {
    'content-security-policy': "default-src 'self'; frame-ancestors 'none'", 'x-content-type-options': 'nosniff',
    'strict-transport-security': 'max-age=31536000',
  } }) });
  assert.equal((await clean.run()).status, 200);
  assert.equal(clean.rows.scans[0].status, 'done');
  assert.equal(clean.rows.findings.length, 0);
  console.log('PASS: scan request deadline, exact script origin and successful clean scans');

  const html = fs.readFileSync(path.join(root, 'scanner.html'), 'utf8');
  const nodes = new Map();
  const state = { scan: { status: 'done', target_host: 'app.example.com', target_url: 'https://app.example.com/', checks: ['headers'] }, findings: [], loadError: '', selected: new Set() };
  const report = vm.createContext({
    state, URLSearchParams, renderConstellation() {},
    $: id => { if (!nodes.has(id)) nodes.set(id, {}); return nodes.get(id); },
    esc: value => String(value ?? '').replace(/[&<>"']/g, char => '&#' + char.charCodeAt(0) + ';'),
  });
  vm.runInContext(html.slice(html.indexOf('const STATUS_LABEL ='), html.indexOf('const fmtDuration')), report);
  vm.runInContext(html.slice(html.indexOf('function renderHeader()'), html.indexOf('/* ---- agent activity ---- */')), report);
  state.findings = [{ status: 'blocked', severity: 'context', blast: 'invalid peer certificate: NotValidForName' }];
  assert.equal(report.reportStatus(), 'failed');
  report.renderHeader();
  report.renderFindings();
  assert.match(nodes.get('res-sub').innerHTML, /failed/);
  assert.doesNotMatch(nodes.get('res-sub').innerHTML, /1 context|verified/);
  assert.match(nodes.get('findings-list').innerHTML, /certificate does not match/);
  assert.doesNotMatch(nodes.get('findings-list').innerHTML, /could not run|NotValidForName/);
  assert.equal(nodes.get('retry-scan').textContent, 'Edit URL and retry');
  const retry = new URL(nodes.get('retry-scan').href, 'https://scanner.example.com');
  assert.equal(retry.searchParams.get('url'), state.scan.target_url);
  assert.equal(retry.searchParams.get('checks'), 'headers');
  state.scan.checks = ['headers', 'exposed-keys'];
  assert.equal(report.reportStatus(), 'partial');
  state.findings = [];
  assert.equal(report.reportStatus(), 'done');
  assert.match(report.emptyReport(), /selected Tier 1 checks completed/);
  state.scan.error = 'Some scripts could not be read in full.';
  assert.equal(report.reportStatus(), 'partial');
  assert.match(report.reportNotice(), /Some scripts could not be read in full/);
  state.scan.error = null;
  state.loadError = 'Database is unavailable';
  report.renderFindings();
  assert.equal(report.reportStatus(), 'partial');
  assert.match(nodes.get('findings-list').innerHTML, /report could not be loaded/);
  assert.doesNotMatch(nodes.get('findings-list').innerHTML, /No findings|Nothing found/);
  state.loadError = '';
  state.scan.status = 'failed';
  state.scan.error = 'Could not save the scan results: invalid peer certificate: NotValidForName';
  assert.equal(report.scanFailure(), state.scan.error);
  const unfinished = { id: 'unfinished', status: 'running', title: 'Unfinished check', severity: 'high', steps: [{ state: 'active', label: 'Read the page' }] };
  state.findings = [unfinished];
  report.renderFindings();
  assert.doesNotMatch(nodes.get('findings-list').innerHTML, /working|still running/);
  assert.match(report.evidenceText(unfinished), /scan stopped/);
  report.fmtDuration = String;
  report.sevClass = value => value;
  vm.runInContext(html.slice(html.indexOf('function renderActivity()'), html.indexOf('/* ---- chat ---- */')), report);
  report.renderActivity();
  assert.match(nodes.get('activity-list').innerHTML, /failed/);
  assert.match(nodes.get('activity-list').innerHTML, /step blocked/);
  assert.doesNotMatch(nodes.get('activity-list').innerHTML, /working|step active/);
  console.log('PASS: historical failures, partial coverage, retry parameters and read errors render without claiming success');
}

run().catch(error => { console.error(error); process.exitCode = 1; });
