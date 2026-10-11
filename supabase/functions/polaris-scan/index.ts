// Polaris Tier 1 passive scan runner.
//
// Everything here reads only what a browser would already download from the
// target. A check that could not actually run is recorded as blocked with no
// evidence, never as a clean result.

import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  ADMIN_ROUTES,
  auditHeaders,
  buildBackendProbes,
  classifySecret,
  detectSecrets,
  extractScriptUrls,
  findBackendRefs,
  fingerprintGenerator,
  secretLabel,
  sourceMapUrl,
} from "./engine.ts";
import type { SecretKind } from "./engine.ts";

const CORS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type, apikey, x-client-info",
  "access-control-allow-methods": "POST, OPTIONS",
};

const REQUEST_TIMEOUT_MS = 8000;
const SCAN_TIMEOUT_MS = 120000;
const MAX_REQUESTS = 40;
const MAX_BUNDLES = 6;
const MAX_MAPS = 4;
const MAX_TABLE_PROBES = 6;
const MAX_BODY_CHARS = 2_000_000;

const CHECK_ORDER = [
  "fingerprint",
  "exposed-keys",
  "source-maps",
  "backend-defaults",
  "admin-routes",
  "headers",
];

type Severity = "breach" | "high" | "medium" | "context";

type Grab =
  | { ok: true; status: number; headers: Record<string, string>; body: string; url: string; truncated?: boolean }
  | { ok: false; reason: string };

type Outcome =
  | { state: "clean" }
  | { state: "blocked"; reason: string }
  | {
    state: "found";
    evidence: string;
    locator?: string;
    severity?: Severity;
    affected?: number;
    generator?: string;
    title?: string;
    blast?: string;
    incomplete?: string;
  };

interface Plan {
  title: string;
  severity: Severity;
  blast: string;
  steps: string[];
}

interface Handle {
  id: string;
  step(position: number, state: "active" | "done" | "blocked"): Promise<void>;
}

const PLANS: Record<string, Plan> = {
  "exposed-keys": {
    title: "Exposed keys and secrets",
    severity: "breach",
    blast: "Keys compiled into the bundle are readable by anyone who opens devtools on your site.",
    steps: [
      "Load the page the way a browser does",
      "List the scripts the page downloads",
      "Read each script and match provider key patterns",
      "Work out what each key can reach",
    ],
  },
  "backend-defaults": {
    title: "Dangerous backend defaults",
    severity: "breach",
    blast: "A database that answers unauthenticated requests hands its rows to anyone who asks.",
    steps: [
      "Find the backend the app talks to",
      "Ask it for rows with no account signed in",
      "Record what came back",
    ],
  },
  "source-maps": {
    title: "Shipped source maps",
    severity: "high",
    blast: "A production build that serves its source maps serves your original code with it.",
    steps: [
      "List the scripts the page downloads",
      "Look for a source map link in each one",
      "Request the map file with no session",
      "Confirm the original files came back",
    ],
  },
  "admin-routes": {
    title: "Exposed admin and debug routes",
    severity: "high",
    blast: "An admin or debug path that loads without a session is open to everyone.",
    steps: [
      "Fetch a path that cannot exist, to learn the app's catch-all response",
      "Request each path on the fixed list with no session",
      "Keep only the paths that answered with something of their own",
    ],
  },
  headers: {
    title: "Missing security headers",
    severity: "medium",
    blast: "Browsers only enforce the rules your responses declare.",
    steps: [
      "Read the response headers from the live site",
      "Check the policies a browser relies on",
    ],
  },
  fingerprint: {
    title: "Generator fingerprint",
    severity: "context",
    blast: "Knowing the builder tells Polaris which defaults shipped with the app.",
    steps: [
      "Read the page markup and response headers",
      "Match them against known builder signatures",
    ],
  },
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "content-type": "application/json" },
  });
}

function failureReason(err: unknown): string {
  if (err && typeof err === "object" && (err as { name?: string }).name === "AbortError") {
    return "the target did not answer within " + REQUEST_TIMEOUT_MS / 1000 + " seconds";
  }
  const message = err instanceof Error ? err.message : String(err);
  if (/NotValidForName|ERR_CERT_COMMON_NAME_INVALID|WRONG_PRINCIPAL/i.test(message)) {
    return "The site's HTTPS certificate does not match its domain. Check the URL for a typo, or fix the site's certificate, then retry.";
  }
  if (/invalid peer certificate|certificate verify failed|certificate has expired|CERT_|UnknownIssuer/i.test(message)) {
    return "The site's HTTPS certificate could not be verified. Fix its certificate and certificate chain, then retry.";
  }
  if (/dns|ENOTFOUND|getaddrinfo|name resolution/i.test(message)) {
    return "The domain could not be found. Check the spelling and the site's DNS settings, then retry.";
  }
  if (/connection refused|ECONNREFUSED|connection reset|ECONNRESET/i.test(message)) {
    return "The site refused or closed the connection. Check that it is online and accepts public HTTPS requests, then retry.";
  }
  return message;
}

function createFetcher() {
  let used = 0;
  const deadline = Date.now() + SCAN_TIMEOUT_MS;
  return async function grab(url: string, headers: Record<string, string> = {}): Promise<Grab> {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return { ok: false, reason: "the scan time limit was reached; retry with fewer checks" };
    if (used >= MAX_REQUESTS) return { ok: false, reason: "the request budget for one scan was reached" };
    used++;
    const control = new AbortController();
    const timer = setTimeout(() => control.abort(), Math.min(REQUEST_TIMEOUT_MS, remaining));
    try {
      const res = await fetch(url, {
        method: "GET",
        headers: { "user-agent": "PolarisScanner/1.0 (+passive tier 1)", ...headers },
        redirect: "follow",
        signal: control.signal,
      });
      const text = await res.text();
      return {
        ok: true,
        status: res.status,
        headers: Object.fromEntries(res.headers) as Record<string, string>,
        body: text.length > MAX_BODY_CHARS ? text.slice(0, MAX_BODY_CHARS) : text,
        truncated: text.length > MAX_BODY_CHARS,
        url: res.url || url,
      };
    } catch (err) {
      return { ok: false, reason: failureReason(err) };
    } finally {
      clearTimeout(timer);
    }
  };
}

type Fetcher = ReturnType<typeof createFetcher>;

interface Context {
  target: string;
  origin: string;
  https: boolean;
  root: Grab;
  html: string;
  scriptUrls: string[];
  bundles(): Promise<{ loaded: Array<{ url: string; source: string }>; attempted: number; incomplete: boolean }>;
}

async function makeContext(targetUrl: string, grab: Fetcher): Promise<Context> {
  const root = await grab(targetUrl);
  const html = root.ok ? root.body : "";
  const base = root.ok ? root.url : targetUrl;
  const scriptUrls = html ? extractScriptUrls(html, base) : [];

  let origin = targetUrl;
  let https = true;
  try {
    const parsed = new URL(base);
    origin = parsed.origin;
    https = parsed.protocol === "https:";
  } catch {
    // A target that will not parse still gets a scan record, and every check
    // that needs the origin will report itself blocked.
  }

  let cached: { loaded: Array<{ url: string; source: string }>; attempted: number; incomplete: boolean } | null = null;
  const eligible = scriptUrls.filter((u) => new URL(u).origin === origin);
  const sameOrigin = eligible.slice(0, MAX_BUNDLES);

  return {
    target: targetUrl,
    origin,
    https,
    root,
    html,
    scriptUrls,
    async bundles() {
      if (cached) return cached;
      const loaded: Array<{ url: string; source: string }> = [];
      let incomplete = eligible.length > MAX_BUNDLES;
      for (const url of sameOrigin) {
        const res = await grab(url);
        if (res.ok && res.status < 400) loaded.push({ url, source: res.body });
        if (res.ok && res.truncated) incomplete = true;
      }
      cached = { loaded, attempted: sameOrigin.length, incomplete: incomplete || loaded.length < sameOrigin.length };
      return cached;
    },
  };
}

function pathOf(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.pathname + parsed.search;
  } catch {
    return url;
  }
}

function contentType(headers: Record<string, string>): string {
  return (headers["content-type"] || "").split(";")[0].trim().toLowerCase();
}

// A single page app answers every unknown path with the same index.html, so a
// 200 only counts when the body differs from that catch-all.
function isCatchAll(baseline: Grab, hit: Grab): boolean {
  if (!baseline.ok || !hit.ok) return false;
  if (baseline.body === hit.body) return true;
  return (
    contentType(baseline.headers) === contentType(hit.headers) &&
    Math.abs(baseline.body.length - hit.body.length) < 64
  );
}

async function runCheck(key: string, f: Handle, ctx: Context, grab: Fetcher): Promise<Outcome> {
  switch (key) {
    case "exposed-keys":
      return await checkExposedKeys(f, ctx);
    case "backend-defaults":
      return await checkBackendDefaults(f, ctx, grab);
    case "source-maps":
      return await checkSourceMaps(f, ctx, grab);
    case "admin-routes":
      return await checkAdminRoutes(f, ctx, grab);
    case "headers":
      return await checkHeaders(f, ctx);
    case "fingerprint":
      return await checkFingerprint(f, ctx);
    default:
      return { state: "blocked", reason: "this check is not part of the Tier 1 engine" };
  }
}

async function checkExposedKeys(f: Handle, ctx: Context): Promise<Outcome> {
  await f.step(0, "active");
  if (!ctx.root.ok) return { state: "blocked", reason: ctx.root.reason };
  await f.step(0, "done");

  await f.step(1, "active");
  await f.step(1, "done");

  await f.step(2, "active");
  const { loaded, incomplete } = await ctx.bundles();

  const sources = [{ url: ctx.target, source: ctx.html }, ...loaded];
  const hits: Array<{ file: string; kind: SecretKind; match: string; index: number }> = [];
  for (const file of sources) {
    for (const hit of detectSecrets(file.source)) {
      hits.push({ file: pathOf(file.url), kind: hit.kind, match: hit.match, index: hit.index });
    }
  }
  await f.step(2, "done");

  await f.step(3, "active");
  if (!hits.length && incomplete) return { state: "blocked", reason: "some script bundles could not be read in full" };
  if (!hits.length) return { state: "clean" };

  let severity: Severity = "high";
  for (const hit of hits) {
    if (classifySecret(hit.kind) === "breach") severity = "breach";
  }
  const worst = hits.find((h) => classifySecret(h.kind) === severity) || hits[0];
  await f.step(3, "done");

  const evidence = hits
    .map((h) => secretLabel(h.kind) + " " + h.match + " in " + h.file + " at character " + h.index)
    .join("\n");

  const blast = severity === "breach"
    ? "Anyone who opens devtools on your site can copy this key and use it from their own machine. A service key or database password reads and writes every row you hold, with no sign-in and no rate limit."
    : "Anyone who opens devtools on your site can copy this key and use it from their own machine, spending your quota or reaching whatever the key was issued for.";

  return {
    state: "found",
    incomplete: incomplete ? "Some script bundles could not be read in full." : undefined,
    evidence,
    locator: worst.file,
    severity,
    affected: hits.length,
    title: hits.length === 1
      ? "A live credential is readable in your JavaScript"
      : hits.length + " live credentials are readable in your JavaScript",
    blast,
  };
}

async function checkBackendDefaults(f: Handle, ctx: Context, grab: Fetcher): Promise<Outcome> {
  await f.step(0, "active");
  if (!ctx.root.ok) return { state: "blocked", reason: ctx.root.reason };

  const { loaded, incomplete } = await ctx.bundles();
  const searchable = ctx.html + " " + loaded.map((b) => b.source).join(" ");
  const refs = findBackendRefs(searchable, ctx.scriptUrls);
  if (!refs.supabaseUrl && !refs.firebaseDbUrl) {
    if (incomplete) return { state: "blocked", reason: "some script bundles could not be read in full to identify the backend" };
    await f.step(0, "done");
    return { state: "clean" };
  }
  if (refs.supabaseUrl && !refs.supabaseKey && !refs.firebaseDbUrl) {
    return {
      state: "blocked",
      reason: "a Supabase project is referenced but no publishable key was in the page, so the API cannot be queried the way the app queries it",
    };
  }
  await f.step(0, "done");

  await f.step(1, "active");
  const probes = buildBackendProbes(searchable, ctx.scriptUrls);
  const missingKey = !!refs.supabaseUrl && !refs.supabaseKey;
  const open: string[] = [];
  let reached = 0;
  let missed = 0;
  let lastFailure = "the backend did not answer";

  const supabaseProbes = probes.filter((p) => p.kind === "supabase");
  if (supabaseProbes.length) {
    const schema = await grab(supabaseProbes[0].url, supabaseProbes[0].headers);
    let tables: string[] = [];
    if (schema.ok && schema.status === 200 && !schema.truncated) {
      reached++;
      try {
        const doc = JSON.parse(schema.body) as { definitions?: Record<string, unknown> };
        if (!doc.definitions || typeof doc.definitions !== "object") throw new Error("no table definitions");
        const discovered = Object.keys(doc.definitions);
        tables = discovered.slice(0, MAX_TABLE_PROBES);
        if (discovered.length > MAX_TABLE_PROBES) {
          missed++;
          lastFailure = "the backend table limit was reached; some discovered tables were not checked";
        }
      } catch {
        missed++;
        lastFailure = "the backend schema could not be read; only the fixed table list was checked";
      }
    } else {
      missed++;
      lastFailure = schema.ok
        ? schema.truncated ? "the backend schema exceeded the scan size limit" : "backend discovery returned HTTP " + schema.status
        : schema.reason;
    }

    const targets = tables.length
      ? tables.map((t) => ({
        label: t,
        url: refs.supabaseUrl + "/rest/v1/" + encodeURIComponent(t) + "?select=*&limit=1",
      }))
      : supabaseProbes.slice(1, 1 + MAX_TABLE_PROBES).map((p) => ({ label: p.label, url: p.url }));

    for (const t of targets) {
      const res = await grab(t.url, supabaseProbes[0].headers);
      if (!res.ok || res.status >= 500 || res.status === 429 || res.truncated) {
        lastFailure = res.ok ? res.truncated ? "the backend response exceeded the scan size limit" : "the backend returned HTTP " + res.status : res.reason;
        missed++;
        continue;
      }
      reached++;
      if (res.status !== 200) continue;
      try {
        const rows = JSON.parse(res.body);
        if (Array.isArray(rows) && rows.length > 0) {
          const columns = Object.keys(rows[0] || {}).slice(0, 8).join(", ");
          open.push(
            "GET " + pathOf(t.url) + " returned a row with no account signed in. Columns: " + columns,
          );
        }
      } catch {
        // A non-JSON body is not a row, so it proves nothing either way.
      }
    }
  }

  const firebase = probes.find((p) => p.kind === "firebase");
  if (firebase) {
    const res = await grab(firebase.url, firebase.headers);
    if (res.ok && res.status < 500 && res.status !== 429 && !res.truncated) {
      reached++;
      const trimmed = res.body.trim();
      if (res.status === 200 && trimmed && trimmed !== "null") {
        let keys = 0;
        try {
          const doc = JSON.parse(trimmed);
          keys = doc && typeof doc === "object" ? Object.keys(doc).length : 0;
        } catch {
          // Not a JSON document, so the database did not hand anything over.
        }
        if (keys > 0) {
          open.push(
            "GET " + firebase.url + " returned " + keys + " top level keys with no account signed in",
          );
        }
      }
    } else {
      lastFailure = res.ok ? res.truncated ? "the backend response exceeded the scan size limit" : "the backend returned HTTP " + res.status : res.reason;
      missed++;
    }
  }

  const coverage = [incomplete ? "Some script bundles could not be read in full." : "",
    missingKey ? "The referenced Supabase backend could not be checked without its public key." : "",
    missed ? lastFailure : ""].filter(Boolean).join(" ");
  if (reached === 0 || (!open.length && coverage)) return { state: "blocked", reason: coverage || lastFailure };
  await f.step(1, "done");

  await f.step(2, "active");
  if (!open.length) return { state: "clean" };
  await f.step(2, "done");

  return {
    state: "found",
    evidence: open.join("\n"),
    incomplete: coverage || undefined,
    locator: refs.supabaseUrl || refs.firebaseDbUrl || "",
    severity: "breach",
    affected: open.length,
    title: "Your database answers requests that carry no account",
    blast:
      "The project URL and publishable key are in your bundle, so anyone can send the same request Polaris just sent and page through these rows in a browser tab. Row level security is the only thing that stops this, and here it is not stopping it.",
  };
}

async function checkSourceMaps(f: Handle, ctx: Context, grab: Fetcher): Promise<Outcome> {
  await f.step(0, "active");
  if (!ctx.root.ok) return { state: "blocked", reason: ctx.root.reason };
  const { loaded, attempted, incomplete } = await ctx.bundles();
  if (attempted > 0 && loaded.length === 0) {
    return { state: "blocked", reason: "none of the script bundles could be downloaded" };
  }
  await f.step(0, "done");

  await f.step(1, "active");
  const maps: Array<{ bundle: string; map: string }> = [];
  let omittedMaps = 0;
  for (const bundle of loaded) {
    const map = sourceMapUrl(bundle.source, bundle.url);
    if (map && maps.length < MAX_MAPS) maps.push({ bundle: pathOf(bundle.url), map });
    else if (map) omittedMaps++;
  }
  await f.step(1, "done");

  if (!maps.length && incomplete) return { state: "blocked", reason: "some script bundles could not be read in full to check for source maps" };
  if (!maps.length) return { state: "clean" };

  await f.step(2, "active");
  const proven: string[] = [];
  let reached = 0;
  let lastFailure = "the map file could not be requested";
  for (const entry of maps) {
    const res = await grab(entry.map);
    if (!res.ok || res.status >= 500 || res.status === 429 || res.truncated) {
      lastFailure = res.ok ? res.truncated ? "the source map exceeded the scan size limit" : "the map request returned HTTP " + res.status : res.reason;
      continue;
    }
    reached++;
    if (res.status !== 200) continue;
    try {
      const doc = JSON.parse(res.body) as { sources?: string[]; sourcesContent?: string[] };
      if (!Array.isArray(doc.sources) || doc.sources.length === 0) continue;
      const withContent = Array.isArray(doc.sourcesContent) && doc.sourcesContent.length > 0;
      proven.push(
        "GET " + pathOf(entry.map) + " returned a source map listing " + doc.sources.length +
          " original files" + (withContent ? " with their full contents inline" : "") +
          ", including " + doc.sources.slice(0, 3).join(", "),
      );
    } catch {
      // Something answered but it is not a source map, so it is not evidence.
    }
  }
  if (reached === 0) return { state: "blocked", reason: lastFailure };
  await f.step(2, "done");

  await f.step(3, "active");
  const coverage = [incomplete ? "Some script bundles could not be read in full." : "",
    omittedMaps ? "The source map limit was reached; some linked maps were not checked." : "",
    reached < maps.length ? lastFailure : ""].filter(Boolean).join(" ");
  if (!proven.length && coverage) {
    return { state: "blocked", reason: coverage };
  }
  if (!proven.length) return { state: "clean" };
  await f.step(3, "done");

  return {
    state: "found",
    evidence: proven.join("\n"),
    incomplete: coverage || undefined,
    locator: maps[0].map ? pathOf(maps[0].map) : "",
    severity: "high",
    affected: proven.length,
    title: "Your original source code is downloadable",
    blast:
      "The build published its source maps, so a visitor can rebuild your original files, comments and route names from the public site. Anything you assumed was only readable by you, including how each check is written, is readable by them.",
  };
}

async function checkAdminRoutes(f: Handle, ctx: Context, grab: Fetcher): Promise<Outcome> {
  await f.step(0, "active");
  const baseline = await grab(ctx.origin + "/polaris-probe-" + Date.now().toString(36) + "-not-a-route");
  if (!baseline.ok) return { state: "blocked", reason: baseline.reason };
  if (baseline.truncated) return { state: "blocked", reason: "the site's baseline response exceeded the scan size limit" };
  if (baseline.status >= 500 || baseline.status === 429) return { state: "blocked", reason: "the site's baseline request returned HTTP " + baseline.status };
  await f.step(0, "done");

  await f.step(1, "active");
  const open: string[] = [];
  let reached = 0;
  let lastFailure = "the target stopped answering";
  for (const route of ADMIN_ROUTES) {
    const res = await grab(ctx.origin + route);
    if (!res.ok || res.status >= 500 || res.status === 429 || res.truncated) {
      lastFailure = res.ok ? res.truncated ? "a route response exceeded the scan size limit" : "a route returned HTTP " + res.status : res.reason;
      continue;
    }
    reached++;
    if (res.status >= 400) continue;
    if (isCatchAll(baseline, res)) continue;
    const type = contentType(res.headers) || "no content type";
    open.push(
      "GET " + route + " returned " + res.status + " " + type + ", " +
        Math.round(res.body.length / 102.4) / 10 + " kB, and it is not the page unknown paths get",
    );
  }
  if (reached === 0 || (!open.length && reached < ADMIN_ROUTES.length)) return { state: "blocked", reason: lastFailure };
  await f.step(1, "done");

  await f.step(2, "active");
  if (!open.length) return { state: "clean" };
  await f.step(2, "done");

  return {
    state: "found",
    evidence: open.join("\n"),
    incomplete: reached < ADMIN_ROUTES.length ? lastFailure : undefined,
    locator: open.length ? open[0].split(" ")[1] : "",
    severity: "high",
    affected: open.length,
    title: open.length === 1
      ? "An admin or debug path answers without a session"
      : open.length + " admin or debug paths answer without a session",
    blast:
      "Polaris sent these requests with no cookie and no token, and they still returned content of their own. Whatever those paths do, a stranger can do it too. The guard is usually in the interface and not on the route.",
  };
}

async function checkHeaders(f: Handle, ctx: Context): Promise<Outcome> {
  await f.step(0, "active");
  if (!ctx.root.ok) return { state: "blocked", reason: ctx.root.reason };
  await f.step(0, "done");

  await f.step(1, "active");
  const issues = auditHeaders(ctx.root.headers, ctx.https);
  if (!issues.length) return { state: "clean" };
  await f.step(1, "done");

  let severity: Severity = "medium";
  for (const issue of issues) {
    if (issue.severity === "high") severity = "high";
  }

  return {
    state: "found",
    evidence: issues.map((i) => i.header + ": " + i.issue).join("\n"),
    locator: issues[0].header,
    severity,
    affected: issues.length,
    title: issues.length === 1
      ? "A security header a browser relies on is missing"
      : issues.length + " security headers a browser relies on are missing",
    blast:
      "A browser only enforces the rules your responses declare. Without these, nothing stops another site framing your app, and nothing limits what script is allowed to run on your page.",
  };
}

async function checkFingerprint(f: Handle, ctx: Context): Promise<Outcome> {
  await f.step(0, "active");
  if (!ctx.root.ok) return { state: "blocked", reason: ctx.root.reason };
  await f.step(0, "done");

  await f.step(1, "active");
  const fp = fingerprintGenerator(ctx.html, ctx.root.headers, ctx.scriptUrls);
  if (!fp) return { state: "clean" };
  await f.step(1, "done");

  return {
    state: "found",
    evidence: fp.signals.map((s) => "Matched: " + s).join("\n") + "\nConfidence " +
      Math.round(fp.confidence * 100) + " percent",
    locator: ctx.origin,
    severity: "context",
    generator: fp.name,
    affected: fp.signals.length,
    title: "Built with " + fp.name,
    blast:
      "Knowing the builder tells Polaris which defaults shipped with your app, so the rest of the scan looks for that builder's known failures instead of a generic list.",
  };
}

class RecordError extends Error {}

async function save(query: PromiseLike<{ error: { message: string } | null }>) {
  const { error } = await query;
  if (error) throw new RecordError("Could not save the scan results: " + error.message);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader) return json({ error: "Missing Authorization header" }, 401);

  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );

  let scanId = "";
  try {
    const body = await req.json().catch(() => ({}));
    scanId = String((body as { scan_id?: string }).scan_id || "");
  } catch {
    return json({ error: "Body must be JSON" }, 400);
  }
  if (!scanId) return json({ error: "scan_id is required" }, 400);

  const { data: scan, error: scanError } = await db
    .from("scans")
    .select("id, target_url, checks, status")
    .eq("id", scanId)
    .maybeSingle();

  if (scanError) return json({ error: scanError.message }, 400);
  if (!scan) return json({ error: "Scan not found" }, 404);

  if (scan.status !== "queued") return json({ error: "This scan has already started. Open its report or create a new scan." }, 409);

  const { data: claimed, error: claimError } = await db.from("scans")
    .update({ status: "running", started_at: new Date().toISOString(), error: null })
    .eq("id", scanId).eq("status", "queued").select("id").maybeSingle();
  if (claimError) return json({ error: "Could not start the scan: " + claimError.message }, 500);
  if (!claimed) return json({ error: "This scan has already started. Open its report or create a new scan." }, 409);

  try {
    const target = new URL(scan.target_url);
    if (!["http:", "https:"].includes(target.protocol) || target.username || target.password) {
      throw new Error("Enter a public HTTP or HTTPS website URL without login credentials.");
    }
    const enabled = CHECK_ORDER.filter((k) => (scan.checks || []).includes(k));
    if (!enabled.length || enabled.length !== scan.checks.length) {
      throw new Error("Choose at least one supported Tier 1 check, then retry.");
    }
    const grab = createFetcher();
    const ctx = await makeContext(scan.target_url, grab);
    if (!ctx.root.ok) throw new Error(ctx.root.reason);
    if (ctx.root.truncated) throw new Error("The page exceeded the scan size limit. Choose a smaller public page, then retry.");
    if (ctx.root.status >= 400) {
      const hint = ctx.root.status === 401 || ctx.root.status === 403
        ? "The page requires access or is blocking the scanner. Use a publicly accessible page."
        : ctx.root.status === 404
        ? "Check the URL and use a page that exists."
        : "Check that the site is working, then retry.";
      throw new Error("The target returned HTTP " + ctx.root.status + ". " + hint);
    }

    let kept = 0;
    let blocked = 0;
    let blockedReason = "";
    const coverage: string[] = [];
    let position = 0;

    for (const key of enabled) {
      const plan = PLANS[key];
      const started = Date.now();

      const { data: created, error: insertError } = await db
        .from("findings")
        .insert({
          scan_id: scanId,
          check_key: key,
          title: plan.title,
          severity: plan.severity,
          blast: plan.blast,
          status: "running",
          position: position++,
        })
        .select("id")
        .single();
      if (insertError || !created) throw new Error("Could not record the check: " + (insertError?.message || "no row"));

      const findingId = created.id as string;
      await save(db.from("finding_steps").insert(
        plan.steps.map((label, i) => ({
          finding_id: findingId,
          position: i,
          label,
          state: "pending",
        })),
      ));

      const handle: Handle = {
        id: findingId,
        async step(pos, state) {
          await save(db.from("finding_steps").update({ state })
            .eq("finding_id", findingId).eq("position", pos));
        },
      };

      let outcome: Outcome;
      try {
        outcome = await runCheck(key, handle, ctx, grab);
      } catch (err) {
        if (err instanceof RecordError) throw err;
        outcome = { state: "blocked", reason: failureReason(err) };
      }

      const duration = Date.now() - started;

      if (outcome.state === "clean") {
        await save(db.from("findings").delete().eq("id", findingId));
        continue;
      }

      if (outcome.state === "blocked") {
        // Evidence stays null. A blocked check proved nothing, and writing a
        // sentence here would describe work that did not happen.
        await save(db.from("finding_steps").update({ state: "blocked" })
          .eq("finding_id", findingId).in("state", ["pending", "active"]));
        await save(db.from("findings").update({
          status: "blocked",
          // The planned severity was the severity of a hit, and there was no
          // hit, so it must not be left on the row for the UI to render.
          severity: "context",
          title: plan.title + " (could not be checked)",
          blast: "Polaris could not complete this check, so nothing is claimed either way. Reason: " +
            outcome.reason + ".",
          duration_ms: duration,
        }).eq("id", findingId));
        blocked++;
        blockedReason ||= outcome.reason;
        continue;
      }

      await save(db.from("findings").update({
        status: "done",
        title: outcome.title ?? plan.title,
        blast: (outcome.blast ?? plan.blast) + (outcome.incomplete ? " Coverage incomplete: " + outcome.incomplete : ""),
        locator: outcome.locator ?? "",
        severity: outcome.severity ?? plan.severity,
        evidence: outcome.evidence,
        generator: outcome.generator ?? null,
        affected: outcome.affected ?? null,
        duration_ms: duration,
      }).eq("id", findingId));
      kept++;
      if (outcome.incomplete) coverage.push(plan.title + ": " + outcome.incomplete);
    }

    if (blocked === enabled.length) throw new Error("None of the selected checks could finish. " + blockedReason);
    await save(db.from("scans").update({ status: "done", error: coverage.join("\n") || null, finished_at: new Date().toISOString() })
      .eq("id", scanId));

    return json({ scan_id: scanId, status: "done", findings: kept, blocked });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.from("findings").update({
      status: "failed", severity: "context",
      blast: "This check stopped before it could finish. " + message,
    }).eq("scan_id", scanId).in("status", ["pending", "running"]);
    const { error: saveError } = await db.from("scans").update({
      status: "failed",
      error: message,
      finished_at: new Date().toISOString(),
    }).eq("id", scanId);
    return json({ scan_id: scanId, status: "failed", error: message,
      ...(saveError ? { save_error: "The failure could not be saved. Reload the report before retrying." } : {}),
    }, 500);
  }
});
