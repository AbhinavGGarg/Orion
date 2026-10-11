# Wiring up the Polaris backend

Polaris is static HTML plus Supabase. There is no server of its own, so the scan
engine runs as a Supabase Edge Function. Copy `config.example.js` to `config.js`
and replace its placeholders with your own project URL and publishable key.
Skip this step if your local copy is already configured.

## 1. Create the tables

Open the SQL editor for the project and run `schema.sql`:

    https://supabase.com/dashboard/project/YOUR-PROJECT-REF/sql/new

It creates `scans`, `findings`, `finding_steps` and `finding_messages`, turns on
Row Level Security so every row is reachable only by the account that owns it,
and adds the three tables the scan page watches to the realtime publication.
It also grants authenticated users access to those tables; the row policies
still decide which records each user can access.

The file is safe to run more than once. Policies are dropped before they are
recreated, and the publication changes swallow a duplicate.

Until this runs, `scanner.html` will say so in as many words rather than failing
with a generic save error. It detects PostgREST's `PGRST205`, which is the code
for a table the API cannot see.

## 2. Deploy the scan engine

From this folder, with the Supabase CLI installed:

    supabase login
    supabase link --project-ref YOUR-PROJECT-REF
    supabase functions deploy polaris-scan --use-api

The `supabase` folder already contains the CLI configuration and migrations.
If you use migrations instead of the SQL editor, apply them in order. Keep
JWT verification enabled for the scan function.

The function reads the caller's JWT and creates its Supabase client with that
token, so it can only ever touch the calling user's own rows. It needs no
service role key and none is stored anywhere in this repository.

Until it is deployed, a scan still records correctly and the report page says
the engine did not answer instead of showing an empty report that looks like a
clean bill of health.

## 3. Configure sign-in

For local use, set Authentication > URL Configuration > Site URL to
`http://localhost:8000` and add `http://localhost:8000/**` to Redirect URLs.
Use your actual website URL instead when deploying publicly.

Email sign-up requires the recipient to confirm their email. Supabase's default
mail service only sends to addresses on your Supabase organization team. Before
opening signup to other people, configure Authentication > Emails > SMTP Settings
with your mail service's host, port, username, password and verified sender.
Keep email confirmation enabled. See the [SMTP setup guide](https://supabase.com/docs/guides/auth/auth-smtp).

Google and GitHub buttons require separate provider configuration in
Authentication > Sign In / Providers. Create an OAuth app with the provider,
then enter its client ID and secret in Supabase. Use this callback URL:

    https://YOUR-PROJECT-REF.supabase.co/auth/v1/callback

Keep OAuth client secrets in Supabase, never in `config.js`. Email/password
sign-in does not require either social provider.

Deploy the configured copy using the commands below, then sign in on that
hosted preview. See `FRONTEND.md` for the component and build setup.

## 4. Host the frontend

The frontend builds a React background alongside the existing static pages.
Vercel uses the Other framework preset, runs `npm run build` and serves dist
as configured in vercel.json. Deploy from a configured copy so config.js is
present; it is intentionally absent from Git.

    vercel login
    vercel link
    vercel project inspect
    npm ci
    npm run build
    vercel deploy

Choose your intended project during linking and check the owner and project
before deploying. Keep this as a separate preview. `.vercelignore` allows the
frontend build inputs; scripts/copy-pages.mjs copies only browser assets into
dist. SQL, setup docs, local credentials and Supabase source stay out of the
website.

Once the site is deployed, set Supabase's Site URL to its HTTPS address. Add
`https://YOUR-SITE/app.html` and `https://YOUR-SITE/scanner.html` to Redirect URLs.
Keep `http://localhost:8000/**` if you also use the local copy.

When sharing source, replace `config.js` with `config.example.js` and omit `.git`,
`.vercel`, `.env*`, and `supabase/.temp`. Recipients supply their own backend
configuration and apply the included migrations.

## What the engine does and does not do

It runs the six Tier 1 checks server side, because a browser cannot read a
cross-origin response at all. For each check it writes the finding and its
steps before doing the work, so the report fills in as it goes.

Three rules it holds to:

- A check that ran and found nothing is deleted, not written. A finding on the
  report means something was actually found.
- A check that could not run is marked `blocked` with `evidence` left null and
  its severity demoted to `context`. It never writes a sentence describing work
  that did not happen.
- Credentials found in a bundle are redacted before storage. The first six and
  last four characters survive; the middle is masked.

Tier 2 and Tier 3 are not implemented. Their options stay locked in the page.

## Report chat

Apply the included `chat_request_quota` migration, then deploy the chat function:

```sh
supabase functions deploy chat --project-ref YOUR-PROJECT-REF
```

In Supabase's Edge Functions > Secrets, save `GROQ_API_KEY`. The default model
is `openai/gpt-oss-120b`; `GROQ_MODEL` can override it with a compatible model.
Never put the Groq key in config.js. The shared source contains no credentials.

Chat verifies the current user and scan ownership, reads selected findings and
recent messages through RLS, redacts recognized credential formats, and sends
bounded excerpts to Groq. It reserves request capacity atomically before calling
the model. A user can make six requests per minute. Conversation save failures
are reported without discarding the generated answer. AI suggestions still need
review; chat cannot apply fixes or verify a simulation.

`node --experimental-strip-types tests/chat.cjs` tests the handler with fixtures.
`tests/chat-live.cjs` is an opt-in integration test. It requires an isolated,
auto-confirmed test account in ignored `.env.chat-test` as JSON with email and
password. It creates and deletes synthetic scan data, calls Groq, and checks
the quota. Do not use a personal account for this test.

## Testing the report UI

`scanner.html` imports Supabase by full URL, so an import map can redirect that
one specifier at a local mock and exercise the real page against fixtures. That
is how the report views, the injection escaping, the failure states and the
responsive breakpoints were checked.
