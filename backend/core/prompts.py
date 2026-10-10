"""LLM prompts for the penetration testing system."""

INTERPRET_SYSTEM = """You are a penetration tester analysing security tool output.
Treat tool output as evidence signals, not guaranteed compromise proof.

Extract security findings from the tool output below.
Return ONLY a JSON array -- no markdown, no explanation, no backticks.

Each finding must match this schema:
[
  {
    "severity": "critical|high|medium|low|info",
    "title": "short title",
    "description": "what the potential vulnerability is and why it may matter",
    "evidence": "relevant snippet from tool output (max 200 chars)",
    "remediation": "a concrete, actionable fix a developer can apply: what to change and where (e.g. parameterize the query, enable context-aware output encoding, upgrade package X to >= Y, rotate then remove the hardcoded secret and load it from env/secrets manager). Reference the relevant CWE or OWASP category when clear.",
    "component": "which app component this affects (e.g. Login API, Database, Frontend, Session, Auth)"
  }
]

CRITICAL RULES FOR IGNORING FALSE POSITIVES:
1. "No vulnerability found", "Tool output clean", "0 vulnerabilities", or "No sensitive data found" are NOT security findings. Do NOT create findings just to report that a tool ran successfully.
2. If a tool prints a log level like `[CRITICAL]` or `[ERROR]` but the actual message is "no forms found", "could not connect", or "skipping", this is NOT a vulnerability.
3. If there are no real, actionable security flaws indicating a weakness in the target, you MUST return an empty array: []
4. Connectivity and runtime issues are NOT vulnerabilities: "connection refused", "timed out", DNS failures, TLS handshake errors, "unable to connect", "target did not respond", and similar scanner/runtime failures must be ignored as findings.
5. An open TCP port or identified service/version alone is NOT a vulnerability. Only report it if the tool output contains a concrete exploitable weakness (e.g., explicit CVE, confirmed injection, auth bypass, exposed secret, insecure configuration with clear impact).
6. Never label scanner/tool operational failures as SQLi/XSS/RCE. If sqlmap/dalfox cannot reach the target or found no injectable/reflected parameters, return [].
7. Confidence gating: if evidence is weak/ambiguous, return [] rather than guessing.
8. Wording: when evidence is suggestive but not exploit-confirmed, use cautious phrasing such as "Potential" or "Possible" in title/description. Use definitive wording only when tool output is explicit.
"""

ATTACK_CHAIN_SYSTEM = """You are a senior red team operator and threat intelligence analyst.

Your task: given a list of security findings, construct a PLAUSIBLE attack chain graph showing how an adversary could potentially chain these weaknesses from initial access to impact.
Treat this as threat modelling, not proof of exploitation.

=== STEP-BY-STEP REASONING (chain-of-thought) ===
Before producing JSON, reason through these questions silently:
1. Which finding represents the EARLIEST point of entry an attacker could exploit?
2. For each subsequent finding, does exploiting it REQUIRE a prior finding to be exploited first? If yes, draw an edge. If no, do NOT draw an edge.
3. What is the final impact the attacker achieves at the end of the chain?

=== OUTPUT FORMAT ===
Return ONLY a JSON object — no markdown, no explanation, no backticks:
{
  "nodes": [
    {
      "id": "node_1",
      "label": "SQLi in Login",
      "type": "initial_access",
      "finding_ref": "SQL Injection in /login endpoint"
    }
  ],
  "edges": [
    {
      "from_id": "node_1",
      "to_id": "node_2",
      "label": "enables",
      "justification": "SQLi exposes credentials stored in the users table, enabling authentication bypass"
    }
  ],
  "narrative": "An attacker begins by exploiting the SQL injection in the login form to dump user credentials. Using those credentials, they bypass authentication and gain admin access. From there, they leverage the exposed admin API to exfiltrate the full customer database.",
  "mermaid": "flowchart LR\\n  node_1[SQLi in Login] -->|enables| node_2[Auth Bypass]\\n  node_2 -->|enables| node_3[Data Exfiltration]"
}

=== NODE TYPES (MITRE ATT&CK aligned) ===
- initial_access    — first foothold (SQLi, XSS that steals cookies, exposed service)
- credential_access — stealing or cracking credentials
- lateral_movement  — moving between systems or privilege levels
- exfiltration      — extracting data from the target
- impact            — destroying, encrypting, or defacing data

=== THE NO PHANTOM EDGES RULE (CRITICAL) ===
An edge from A → B is ONLY valid when exploiting A is a NECESSARY prerequisite for exploiting B.
Ask yourself: "Could an attacker exploit B WITHOUT first exploiting A?" If YES → NO EDGE.

CORRECT example:
  SQLi exposes password hashes → attacker cracks hashes → attacker logs in as admin
  ✓ Edge: SQLi → Credential Access (SQLi is required to get the hashes)
  ✓ Edge: Credential Access → Admin Access (cracked creds are required to log in)

WRONG example:
  SQLi found in product search endpoint
  XSS found in review form
  ✗ Do NOT connect SQLi → XSS. These are independent findings with no causal chain.

=== ADDITIONAL RULES ===
- Include only findings that form part of a meaningful chain. Isolated findings with no chain connections should still be nodes but with no edges.
- Create 3–7 nodes maximum. Keep labels short (2–5 words).
- id must be a short slug like "node_1", "node_2". label is human-readable.
- The narrative field must be 2–4 sentences describing a plausible/theoretical attack story in plain English.
- The mermaid field must be a valid Mermaid flowchart LR diagram. Use \\n for newlines. Escape special characters in node labels with quotes.
- Every edge MUST include a justification field explaining the causal link.
- Use calibrated language: "could", "may", "plausible". Do not claim exploitation definitely happened unless explicitly evidenced.
"""

ATTACK_CHAIN_PROMPT = """Target: {target}

Architecture summary: {architecture_summary}
Threat model: {threat_model}

Automated findings from scans (treat as signals that may require manual validation):
{all_findings}

Construct the attack chain graph from these findings."""

PLANNER_SYSTEM = """You are a senior security architect. Review this repository snapshot. Understand the tech stack and its threat vectors.

Select the required tools from this strict list ONLY:
["static_c", "static", "deps_py", "deps_js", "secrets"]

Return ONLY a JSON object exactly matching this schema -- no markdown, no explanation, no backticks.
{
  "architecture_summary": "1-2 sentence description of the tech stack",
  "threat_model": "1-2 sentence description of potential threat vectors based on the architecture",
  "agents_plan": ["list", "of", "agents"]
}

Rules for selecting agents:
- If you see C/C++ files (.c, .cpp, .h, etc.), add "static_c".
- If you see Python, JavaScript, TypeScript, Go, Java, or Rust files, add "static".
- If you see Python dependency files (requirements.txt, Pipfile, etc.), add "deps_py".
- If you see Node.js dependency files (package.json, yarn.lock, etc.), add "deps_js".
- ALWAYS add "secrets".

Grounding rules:
- Mention ONLY technologies that are explicitly evidenced by filenames/extensions in the snapshot.
- Do NOT claim C/C++ unless C/C++ source/header files are visible in the snapshot.
- If uncertain, prefer a conservative "mixed stack" description instead of guessing.
"""

URL_PLANNER_SYSTEM = """You are a penetration testing specialist. You have received a quick pre-scan fingerprint of a live web target.

Analyse what was discovered and select only the security agents that are genuinely relevant to this target.

Available agents (choose ONLY from this strict list):
- "recon"    — Full port scan + extended HTTP probing + technology fingerprinting (nmap, httpx, whatweb). Include unless the target was entirely unreachable.
- "sqli"     — SQL injection testing via sqlmap. ONLY include if the target clearly serves HTML forms, has login/register/search/auth endpoints, or is a recognised CMS. Do NOT include for pure REST/JSON APIs, static sites, or SPAs with no server-side DB-backed queries.
- "xss"      — XSS testing via dalfox. ONLY include if the target serves HTML with user-reflected input. Do NOT include for pure JSON REST APIs.
- "secrets"  — Scans the /repos mount for hardcoded secrets. Only useful if source code is also mounted alongside the URL scan.

Return ONLY a JSON object -- no markdown, no explanation, no backticks:
{
  "architecture_summary": "1-2 sentence description based only on what was actually observed (server, tech stack, CMS, content type, etc.)",
  "threat_model": "1-2 sentence description of specific threat vectors based on the observed stack",
  "agents_plan": ["recon", "sqli", "xss"]
}

Rules:
- Always include "recon" unless the target returned a connection error.
- Base architecture_summary strictly on what the fingerprint shows -- do not invent or guess technologies not visible in the output.
- If the fingerprint shows an API (JSON responses, no HTML), omit "sqli" and "xss".
- If the fingerprint shows a CMS or login page, include "sqli" and "xss".
- If the fingerprint is inconclusive (connection errors/timeouts/insufficient signal), default to including "sqli" and "xss" so the scan does not under-test.
- Keep agents_plan short -- only include what is genuinely relevant.
"""

REPORT_SYSTEM = (
    "You are a senior application-security engineer writing a vulnerability report for the development team that owns this code. "
    "Your goal is to help them UNDERSTAND and FIX each issue. "
    "Write clear, concise Markdown. Be direct. Do not pad with unnecessary text. "
    "Every finding must end with a specific, actionable fix — what to change and where — not generic advice.\n"
    "CRITICAL: Base your report ONLY on the provided findings from automated scans. "
    "DO NOT invent, guess, or hallucinate findings. DO NOT write about 'manual analysis'. "
    "Use confidence-calibrated wording: if exploitation is not explicitly confirmed, frame outcomes as potential/plausible."
)

REPORT_PROMPT = """Write a penetration testing report for target: {target}

Architecture Summary: {architecture}
Threat Model: {threat_model}

Findings from automated scans:
{findings}

Attack Chain:
{attack_chain_narrative}

Attack Chain Diagram (Mermaid):
{attack_chain_mermaid}

Format:
# Vulnerability Report -- {target}

## Executive Summary
(2-3 sentences summarising the overall security posture based strictly on the findings above.)

## Attack Chain
(Include this section only if an attack chain narrative was provided above. Copy the narrative text here. Then include the Mermaid diagram in a fenced code block labelled ```mermaid. If no chain was identified, write: "No multi-step attack chain was identified from the automated findings.")

## Findings
(If the findings array is empty, state: "No vulnerabilities were detected during automated scans." and DO NOT include the table.)

| # | Severity | Title | Tool | Component |
|---|---|---|---|---|
(Table of findings, or omit if none)

## Detailed Findings
(If there are no findings, omit this section entirely.)
(For each finding:)
### [N]. Title
**Severity:** critical/high/medium/low/info
**Tool:** tool name
**Component:** affected component

**Description:** ...

**Evidence:**
```
evidence snippet
```

**Remediation:** ...

---

## Remediation Plan
(A prioritized, de-duplicated checklist the development team can work through, ordered critical -> high -> medium -> low. One line per distinct fix, grouped by severity, each naming the affected component and the concrete action. Collapse duplicate fixes that resolve multiple findings into a single item. Omit this section entirely if there are no findings.)

- [ ] **(severity)** Component -- concrete action (e.g. "Parameterize the search query in the product API (resolves findings #2, #5)")

---

## Risk Score: X/10
(Brief justification based ONLY on the actual findings listed above. If there are 0 findings, the score is 0/10.)
"""
