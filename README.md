# Orion

**Every vulnerability is a star. Every attack path is a line between them.**

Orion is a self-hosted AI pentester that scans a web target or a code repository, finds the weak points, works out how they chain together, and draws the result as a live constellation. Each finding is a star, sized and coloured by severity. The attack chain is the bright lines connecting them. The constellation is drawn in real time while the agents work, so you watch the attack surface take shape instead of reading a list afterwards. Click a star and you get the fix.

Orion is built for the Crafting Constellations hackathon on top of our earlier pentesting pipeline. The new part is the constellation layer: a hand-written force simulation and canvas renderer that turns scanner findings and the MITRE-aligned attack chain into a star map.

---

## Why Orion is different

**You see the attack, not a list.** Security reports are tables of CVEs. Orion reasons over the findings to build a causal attack chain (initial access, credential access, lateral movement, exfiltration) and shows it as a constellation. Dangerous stars glow brighter, chain edges pulse like signals, and related findings cluster by component.

**Local and sovereign.** The whole pipeline, including LLM inference, can run on your own machine with a local Ollama model. Your source, your targets, and your findings never have to leave your infrastructure.

**Repo-native.** Orion scans source repositories directly, not just live web targets, so it can run before you ship.

**Fixes, not just findings.** Every finding carries a concrete remediation. Copy one fix from a star, or copy the whole prioritised remediation plan from the report.

---

## The constellation

`components/attack-constellation.tsx` does the drawing. It has no graph library behind it; the physics is about 80 lines so it stays easy to explain:

1. Every star pushes every other star away, so they spread out.
2. Every link pulls its two stars toward a rest distance, so attack paths stay tight.
3. Everything drifts gently toward the centre, so nothing flies off.

Stars are born near the target with an expanding ring, then settle. Bright gradient lines are attack chain edges from the attack-chain node (or inferred from findings when the agent has not run yet). Faint dashed lines connect findings in the same file. Hover a star to isolate its paths, drag it to rearrange, click it to open the fix.

---

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

Orion defaults to a **local** model so nothing leaves your machine. Set `LLM_PROVIDER` to switch backends:

| Provider           | Env var           | Notes                                  |
| ------------------ | ----------------- | -------------------------------------- |
| `ollama` (default) | `OLLAMA_MODEL`    | Fully local inference                  |
| `openai`           | `OPENAI_MODEL`    | OpenAI-compatible (incl. self-hosted)  |
| `claude`           | `ANTHROPIC_MODEL` | Optional, for comparison               |

To run your own fine-tuned checkpoint, serve it behind any OpenAI-compatible endpoint (e.g. vLLM) and point `OPENAI_BASE_URL` at it.

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
- **Public repo:** submit a repository root URL; Orion clones it inside the backend container and scans that snapshot, nothing is cloned into your workspace.

## Deploy (live demo)

Orion is built to run locally, but you can stand up a hosted instance for demos. The backend deploys to **Render** and the frontend to **Vercel**.

**Backend (Render).** The repo ships a `render.yaml` blueprint. In Render, create a new Blueprint from this repo; it builds `docker/Dockerfile.backend` as a web service. Set these secrets in the dashboard (they are `sync: false` in the blueprint, never committed): `OPENAI_API_KEY`, `OPENAI_MODEL`, and optionally `CORS_ALLOW_ORIGINS`. A hosted instance has no local Ollama, so it uses any OpenAI-compatible provider (set `OPENAI_BASE_URL` if it is not OpenAI itself). The blueprint uses Render's **free** tier ($0); it sleeps after ~15 min idle (expect a slow first request) and has 512MB RAM, so very heavy scans may need a bump to a paid plan. Repo clones use ephemeral storage, so no paid disk is required.

**Frontend (Vercel).** Deploy the Next.js app and set `NEXT_PUBLIC_API_URL` to your Render backend URL so the browser streams scan progress straight from the backend (long SSE streams do not survive the Vercel proxy). Add your Vercel domain to `CORS_ALLOW_ORIGINS` on the backend.

> Note: the hosted path trades the "nothing leaves your machine" guarantee for a public demo URL. For real use, self-host with the local Ollama default, that is the point of the project.

## Responsible use

Orion is for testing systems you own or are explicitly authorised to assess. Scanning targets without permission may be illegal. By default, only an allowlist of safe public examples (`example.com`, `scanme.nmap.org`, `testphp.vulnweb.com`) is treated as sanctioned; keep `ENFORCE_TARGET_ALLOWLIST=true` in shared or production deployments.

## License

MIT, see [LICENSE](LICENSE).
