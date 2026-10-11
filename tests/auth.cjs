const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = require('node:path').resolve(__dirname, '..');
const values = new Map();
const openPage = (hash = '') => {
  const context = vm.createContext({
    URLSearchParams,
    location: { hash },
    sessionStorage: {
      setItem: (key, value) => values.set(key, value),
      getItem: key => values.get(key) ?? null,
      removeItem: key => values.delete(key),
    },
  });
  vm.runInContext(fs.readFileSync(root + '/github.js', 'utf8').replace(/^export /gm, ''), context);
  return context;
};
let context = openPage();
const session = (id, provider, token) => ({ user: { id, identities: [{ provider }] }, provider_token: token });
context.prepareOAuth('google');
context = openPage('#provider_token=synthetic-google-token');
context.rememberGitHubToken(session('google-user', 'google', 'synthetic-google-token'));
assert.equal(context.githubToken('google-user'), null);
assert.equal(values.get('polaris.provider_token'), undefined);
context.prepareOAuth('github');
context = openPage('#provider_token=synthetic-github-token');
context.rememberGitHubToken(session('github-user', 'github', 'synthetic-github-token'));
assert.equal(context.githubToken('github-user'), 'synthetic-github-token');
assert.equal(values.get('polaris.oauth_provider'), undefined);
assert.equal(context.githubToken('another-user'), null);
context.rememberGitHubToken({ user: { id: 'github-user', identities: [{ provider: 'google' }, { provider: 'github' }] }, provider_token: 'synthetic-google-token' });
assert.equal(context.githubToken('github-user'), 'synthetic-github-token');
context = openPage();
context.rememberGitHubToken(session('github-user', 'github', undefined));
assert.equal(context.githubToken('github-user'), 'synthetic-github-token');
context.rememberGitHubToken(session('another-user', 'email', undefined));
assert.equal(context.githubToken('github-user'), null);
context.prepareOAuth('github');
context = openPage();
context.rememberGitHubToken({ user: { id: 'github-user', identities: [{ provider: 'google' }, { provider: 'github' }] }, provider_token: 'synthetic-google-token' });
assert.equal(context.githubToken('github-user'), null);
context.rememberGitHubToken(session('google-user', 'google', 'synthetic-google-token'));
assert.equal(context.githubToken('google-user'), null);
context.clearGitHubToken();
context = openPage('#provider_token=synthetic-unattributed-token');
context.rememberGitHubToken(session('github-user', 'github', 'synthetic-unattributed-token'));
assert.equal(context.githubToken('github-user'), null);
context.prepareOAuth('github');
context = openPage('#provider_token=synthetic-github-token');
context.rememberGitHubToken(session('github-user', 'github', 'synthetic-github-token'));
context.rememberGitHubToken(null);
assert.equal(values.size, 0);
console.log('PASS: callback-bound GitHub capture rejects cross-tab Google sessions; account ownership, refresh and logout pass');

const html = fs.readFileSync(root + '/signin.html', 'utf8');
const start = html.indexOf('const destination = (() => {');
const end = html.indexOf('const destinationURL', start);
const redirect = html.slice(start, end) + '\ndestination;';
const destination = next => vm.runInNewContext(redirect, {
  URL, URLSearchParams,
  location: { origin: 'https://polaris.example.com', search: '?next=' + encodeURIComponent(next) },
  cfg: { AFTER_SIGNIN: '/app.html' },
});
for (const unsafe of ['//attacker.example/app.html', '/\\attacker.example/app.html', 'https://attacker.example/', '/\\', '/\\[invalid', '/signin.html', '/unknown.html']) {
  assert.equal(destination(unsafe), '/app.html');
}
assert.equal(destination('/app.html?setup=scan'), '/app.html?setup=scan');
assert.equal(destination('/scanner.html?scan=example#findings'), '/scanner.html?scan=example#findings');
console.log('PASS: unsafe and malformed redirects fall back to the console; valid setup and report destinations survive');
