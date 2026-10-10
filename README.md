# Polaris

**Every vulnerability is a star. Every attack path is a line between them.**

Polaris is the star you navigate by. It is a self-hosted AI pentester that scans a web target or a code repository, finds the weak points, works out how they chain together, and draws the result as a live constellation. Each finding is a star, sized and coloured by severity. The attack chain appears as bright lines connecting them. The constellation is drawn in real time while the agents work, so you watch the attack surface take shape instead of reading a list afterwards. Click a star and you get the fix.

Polaris is built for the Crafting Constellations hackathon on top of our earlier pentesting pipeline. The new part is the constellation layer: a hand-written force simulation and canvas renderer that turns scanner findings and the MITRE-aligned attack chain into a star map.

---

## Why Polaris is different

**You see the attack, not a list.** Security reports are tables of CVEs. Polaris reasons over the findings to build a causal attack chain (initial access, credential access, lateral movement, exfiltration) and shows it as a constellation. Dangerous stars glow brighter, chain edges pulse like signals, and related findings cluster by component.

**Local and sovereign.** The whole pipeline, including LLM inference, can run on your own machine with a local Ollama model. Your source, your targets, and your findings never have to leave your infrastructure.

**Repo-native.** Polaris scans source repositories directly, not just live web targets, so it can run before you ship.

**Fixes, not just findings.** Every finding carries a concrete remediation. On a GitHub repository, one click opens a pull request: Polaris finds the file behind each critical, high and medium finding, rewrites it, syntax checks it, and pushes a branch with a `POLARIS_FIXES.md` that explains every change and lists what still needs a human. Fixed stars turn green. Nothing touches your default branch; you review and merge.

---

## The constellation

The scan page opens on a full screen 3D sky (`components/attack-sky.tsx`, built with three.js through react-three-fiber). Each finding is a glowing sphere, sized and coloured by severity, with a bloom pass so the dangerous ones burn brighter. The attack chain from the attack-chain node is drawn as lines between them with signal pulses running along each path. Faint lines connect findings in the same file. The target sits in the middle with a pulse ring while the scan is running. Drag to orbit, scroll to zoom, hover a star to isolate its paths, click it to fly to it and open the fix. The Details button drops down to the console, findings list and report.

Layout uses a hand-written force simulation without a graph library, so it stays easy to explain:

1. Every star pushes every other star away, so they spread out.
2. Every link pulls its two stars toward a rest distance, so attack paths stay tight.
3. Everything drifts gently toward the centre, so nothing flies off.

New stars are born next to the target with an expanding ring and settle into place, so the constellation is drawn live while the agents work. A 2D canvas version of the same thing (`components/attack-constellation.tsx`) is kept for low power devices.

---

## Fix it on GitHub

`backend/services/fix_service.py`. After a repo scan completes, `POST /api/scan/{id}/fix` starts a job that:

1. Takes the critical, high and medium findings (deduplicated, max 6).
2. Finds the file each one lives in. The scanner evidence usually carries a `path:line`; when it does not, the model picks from the repo's file list.
3. Asks the model for the fixed version of the whole file, with the rule to change nothing unrelated. Python files are syntax checked, and a result that drops or balloons the file is rejected and handed to a human instead.
4. Writes `POLARIS_FIXES.md` and opens a pull request on a new `polaris/fixes-<timestamp>` branch through the GitHub Contents API.

The frontend polls `GET /api/scan/{id}/fix` and shows the steps live. Set `GITHUB_TOKEN` on the backend (a token with `public_repo` scope on the account that owns the repos you scan, or `repo` for private ones). The token never reaches the browser. The idea and the branch-then-PR flow were borrowed from [Salus](https://github.com/Aadi-Tiwari/Salus) with permission.

## How it works

A **planner node** inspects the target first:

- **URL targets**, a quick fingerprint (httpx + whatweb), then LLM-driven adaptive planning selects the relevant web agents. Under uncertain signal, guardrails keep a safe baseline of recon + SQLi + XSS before the attack-chain and report stages.
- **Repository targets**, walks the file tree, builds a fingerprint, and selects only the relevant agents from `static_c`, `static`, `deps_py`, `deps_js`, `secrets`.

Each selected **agent node** runs its toolset, skips the LLM call if the tools produce no output, and accumulates structured findings into shared graph state. An **attack-chain node** then reasons over the combined findings to produce the MITRE-aligned exploit graph, and a final **report node** synthesises everything into a Markdown report. LLM token streaming is pushed to the frontend over SSE throughout.

## Agent pipeline

| Agent                 | Tools                        | Target type |
| --------------------- | ---------------------------- | ----------- |
| Planner               | LLM + file-tree fingerprint  | both        |
| Recon                 | httpx · nmap · whatweb       | URL         |
| SQL Injection         | sqlmap                       | URL         |
| XSS                   | dalfox                       | URL         |
| C/C++ Static Analysis | cppcheck · semgrep p/c       | repo        |
| Static Analysis       | semgrep · bandit             | repo        |
| Python Deps           | pip-audit                    | repo        |
| JS Deps               | npm audit                    | repo        |
| Secrets               | trufflehog · detect-secrets  | both        |
| Attack Chain          | LLM reasoning (MITRE ATT&CK) | both        |
| Report                | LLM synthesis                | both        |

## LLM providers

Polaris defaults to a **local** model so nothing leaves your machine. Set `LLM_PROVIDER` to switch backends:

| Provider           | Env var           | Notes                                  |
| ------------------ | ----------------- | -------------------------------------- |
| `ollama` (default) | `OLLAMA_MODEL`    | Fully local inference                  |
| `openai`           | `OPENAI_MODEL`    | OpenAI-compatible (incl. self-hosted)  |
| `groq`             | `GROQ_MODEL`       | Groq API, requires `GROQ_API_KEY`         |
| `claude`           | `ANTHROPIC_MODEL` | Optional, for comparison               |

To run your own fine-tuned checkpoint, serve it behind any OpenAI-compatible endpoint (e.g. vLLM) and point `OPENAI_BASE_URL` at it.

### Use Groq

Create a `.env` file in the project root with these settings, then add your key from the [Groq console](https://console.groq.com/keys):

```dotenv
LLM_PROVIDER=groq
GROQ_API_KEY=
GROQ_MODEL=openai/gpt-oss-120b
GROQ_REQUEST_TIMEOUT_SECONDS=120
SCAN_LLM_TIMEOUT_SECONDS=120
CHAT_LLM_TIMEOUT_SECONDS=30
```

The key stays on the backend. Groq uses the existing OpenAI-compatible client at `https://api.groq.com/openai/v1`, as documented in the [Groq API guide](https://console.groq.com/docs/openai). Planning, findings, attack chains, reports, fixes, and model-backed help chat all use this provider. Scan and chat timeouts above allow more time for remote inference. Source excerpts and scan context included in prompts are sent to Groq.

Groq's free plan has model-specific [request and token limits](https://console.groq.com/docs/rate-limits). Large or frequent scans can exceed these limits.

Start the backend and test target with `docker compose -f docker-compose.dev.yml up -d --build`, then run `pnpm install` and `pnpm dev`. Ollama is not needed for this setup. For the fully containerised Groq setup, use `docker compose up -d --build --no-deps backend frontend target` to skip the Ollama service.

To run the API without Docker, use `uv run --env-file .env fastapi dev backend/main.py`. Install the scanner tools separately for actual scans; the Docker backend includes them.

## Quick start (development)

The backend runs inside Docker (for the security tooling); the frontend runs natively for fast hot-reload. Local inference is served by Ollama on the host.

```bash
# 1. Backend + test target (OWASP Juice Shop)
docker compose -f docker-compose.dev.yml up -d --build

# 2. Frontend
pnpm install
pnpm dev
```

- Frontend: `http://localhost:3000`
- Backend API: `http://localhost:8000`
- Test target: `http://localhost:3001`

For a fully containerised stack (Ollama + backend + frontend + target):

```bash
docker compose up -d --build
```

## Scanning targets

- **Web target:** submit an `http(s)` URL (from inside the backend container, use `http://host.docker.internal:3001` for the bundled Juice Shop).
- **Public repo:** submit a repository root URL. Polaris clones it inside the backend container and scans that snapshot; nothing is cloned into your workspace.

## Deploy (live demo)

Polaris is built to run locally, but you can stand up a hosted instance for demos. The backend deploys to **Render** and the frontend to **Vercel**.

**Backend (Render).** The repo ships a `render.yaml` blueprint. In Render, create a new Blueprint from this repo; it builds `docker/Dockerfile.backend` as a web service. Set these secrets in the dashboard (they are `sync: false` in the blueprint, never committed): `OPENAI_API_KEY`, `OPENAI_MODEL`, and optionally `CORS_ALLOW_ORIGINS`. A hosted instance has no local Ollama, so it uses any OpenAI-compatible provider (set `OPENAI_BASE_URL` if it is not OpenAI itself). The blueprint uses Render's **free** tier ($0); it sleeps after ~15 min idle (expect a slow first request) and has 512MB RAM, so very heavy scans may need a bump to a paid plan. Repo clones use ephemeral storage, so no paid disk is required.

**Frontend (Vercel).** Deploy the Next.js app and set `NEXT_PUBLIC_API_URL` to your Render backend URL so the browser streams scan progress straight from the backend (long SSE streams do not survive the Vercel proxy). Add your Vercel domain to `CORS_ALLOW_ORIGINS` on the backend.

> Note: the hosted path trades the "nothing leaves your machine" guarantee for a public demo URL. For real use, self-host with the local Ollama default, that is the point of the project.

## Responsible use

Polaris is for testing systems you own or are explicitly authorised to assess. Scanning targets without permission may be illegal. By default, only an allowlist of safe public examples (`example.com`, `scanme.nmap.org`, `testphp.vulnweb.com`) is treated as sanctioned; keep `ENFORCE_TARGET_ALLOWLIST=true` in shared or production deployments.

## License

MIT, see [LICENSE](LICENSE).
