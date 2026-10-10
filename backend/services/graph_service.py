"""LangGraph-based penetration testing orchestrator.

Architecture:
  - StateGraph with a planner node that determines which agents to run
    based on target type and detected language stack.
  - Deterministic conditional edges driven by the plan (no LLM routing).
  - Tool-error guard: when a tool fails to run (FileNotFoundError, etc.)
    the error is logged and the LLM call is skipped entirely -- the tool
    operational error never becomes a "finding".
  - LLM calls use ScanStreamCallback so tokens stream to the frontend
    via the SSE endpoint in real time.
"""

import json
import logging
import os
import re
import time
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeoutError
from urllib.error import URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

from langchain_core.messages import HumanMessage
from langgraph.graph import END, StateGraph
from pydantic import BaseModel

from ..core.data_models import Finding, PortInfo, ScanStatus, Severity
from ..core.prompts import (
    ATTACK_CHAIN_PROMPT,
    ATTACK_CHAIN_SYSTEM,
    INTERPRET_SYSTEM,
    REPORT_PROMPT,
    REPORT_SYSTEM,
)
from ..tools.dependencies import run_npm_audit, run_pip_audit
from ..tools.injection import run_dalfox, run_sqlmap
from ..tools.recon import run_httpx, run_nmap, run_whatweb
from ..tools.secrets import run_detect_secrets, run_trufflehog
from ..tools.static_analysis import run_bandit, run_semgrep
from ..tools.static_c import run_cppcheck, run_semgrep_c
from .callbacks import ScanStreamCallback
from .llm_service import get_llm
from .planner_service import plan


# ── Graph State ───────────────────────────────────────────────────────────────


class GraphState(BaseModel):
    """Mutable state threaded through every LangGraph node."""

    scan_id: str = ""
    target: str = ""
    display_target: str = ""
    target_type: str = ""
    architecture_summary: str = ""
    threat_model: str = ""
    agents_plan: list[str] = []
    attack_chain: dict = {}
    findings: list[dict] = []
    report: str = ""


# ── Private helpers ───────────────────────────────────────────────────────────

_HIGH_RISK_PORTS = {3306, 5432, 27017, 6379, 1433, 9200, 5984, 2379, 4444}
_MEDIUM_RISK_PORTS = {22, 23, 21, 3389, 5900, 5901, 8888, 9090}
_LOW_RISK_PORTS = {80, 443, 8080, 8443, 8000, 3000, 4000, 5000}
_SEVERITY_RANK = {"critical": 5, "high": 4, "medium": 3, "low": 2, "info": 1}
_CHAIN_STAGE_ORDER = {
    "initial_access": 0,
    "credential_access": 1,
    "lateral_movement": 2,
    "exfiltration": 3,
    "impact": 4,
    "service": 5,
}

_NON_FINDING_PATTERNS = [
    r"\bno vulnerabilities? found\b",
    r"\bno vulnerability detected\b",
    r"\btool output clean\b",
    r"\b0 vulnerabilities?\b",
    r"\bno sensitive data found\b",
    r"\bno issues? found\b",
    r"\bno exploitable\b",
]
_SCAN_LLM_TIMEOUT_SECONDS = float(os.getenv("SCAN_LLM_TIMEOUT_SECONDS", "10"))


def _report_target_label(state: GraphState) -> str:
    """Prefer user-facing target labels over internal runtime paths in reports."""
    if state.display_target:
        return state.display_target

    if state.scan_id:
        from ..db.scans import scans

        store = scans.get(state.scan_id)
        if store:
            if store.source_repo_url:
                return store.source_repo_url
            if store.target:
                return store.target

    return state.target


def _normalize_severity(value: str, *, default: str = "info") -> str:
    """Map tool-specific severity labels to canonical severities."""
    token = str(value or "").strip().lower()
    if not token:
        return default
    if token in {"critical", "high", "medium", "low", "info"}:
        return token
    if token in {"error", "severe", "blocker"}:
        return "high"
    if token in {"warning", "warn", "moderate"}:
        return "medium"
    if token in {"notice", "minor"}:
        return "low"
    return default


def _derive_structured_findings(agent: str, tool_label: str, combined: dict | str) -> list[dict]:
    """Build deterministic findings from structured tool output when LLM parsing fails."""
    if not isinstance(combined, dict):
        return []

    collected: list[dict] = []

    if any(k in combined for k in ("results", "vulnerabilities", "findings")):
        sources = [(tool_label, combined)]
    else:
        sources = [(name, value) for name, value in combined.items() if isinstance(value, dict)]

    for source_name, payload in sources:
        for field in ("results", "vulnerabilities", "findings"):
            entries = payload.get(field)
            if not isinstance(entries, list) or not entries:
                continue

            for entry in entries[:8]:
                if not isinstance(entry, dict):
                    continue

                extra = entry.get("extra", {}) if isinstance(entry.get("extra"), dict) else {}

                severity_raw = (
                    entry.get("severity")
                    or entry.get("issue_severity")
                    or extra.get("severity")
                )
                if not severity_raw:
                    if field == "vulnerabilities":
                        severity_raw = "medium"
                    elif field == "findings":
                        hint = f"{entry.get('type', '')} {entry.get('DetectorName', '')}".lower()
                        severity_raw = "high" if "secret" in hint or "credential" in hint else "medium"
                    else:
                        severity_raw = "low"
                severity = _normalize_severity(str(severity_raw), default="low")

                if field == "results":
                    source_l = str(source_name).lower()
                    text_hint = json.dumps(entry).lower()
                    if source_l in {"httpx", "nmap", "whatweb"} and not any(
                        keyword in text_hint
                        for keyword in (
                            "cwe",
                            "owasp",
                            "vulnerab",
                            "exposed",
                            "insecure",
                            "misconfig",
                            "sql",
                            "xss",
                            "rce",
                        )
                    ):
                        continue

                name_hint = str(entry.get("name", "")).strip()
                title = (
                    str(entry.get("title", "")).strip()
                    or str(entry.get("check_id", "")).strip()
                    or str(entry.get("test_name", "")).strip()
                    or str(entry.get("id", "")).strip()
                    or str(entry.get("type", "")).strip()
                    or str(extra.get("message", "")).strip()
                    or str(entry.get("message", "")).strip()
                )
                if not title and field == "vulnerabilities" and name_hint:
                    title = f"Vulnerable dependency detected: {name_hint}"
                if not title:
                    title = f"Security signal from {source_name}"

                description = (
                    str(entry.get("description", "")).strip()
                    or str(entry.get("issue_text", "")).strip()
                    or str(extra.get("message", "")).strip()
                    or str(entry.get("message", "")).strip()
                    or "Tool reported a potential security issue requiring review."
                )

                component = (
                    str(entry.get("component", "")).strip()
                    or str(entry.get("path", "")).strip()
                    or str(entry.get("filename", "")).strip()
                    or str(entry.get("file", "")).strip()
                    or name_hint
                    or source_name
                )

                evidence_parts = [
                    f"source={source_name}",
                    f"field={field}",
                ]
                for key in ("path", "file", "filename", "line", "line_number", "cwe", "id", "check_id", "type"):
                    if key in entry and str(entry.get(key)).strip():
                        evidence_parts.append(f"{key}={entry.get(key)}")
                evidence = "; ".join(evidence_parts)[:1800]

                remediation = (
                    str(entry.get("remediation", "")).strip()
                    or "Validate this result, patch the affected component, and re-run the scan."
                )

                collected.append(
                    {
                        "agent": agent,
                        "tool": str(source_name),
                        "severity": severity,
                        "title": title[:180],
                        "description": description[:1200],
                        "evidence": evidence,
                        "remediation": remediation[:1000],
                        "component": component[:180],
                    }
                )

    deduped: list[dict] = []
    seen: set[tuple[str, str, str]] = set()
    for item in collected:
        key = (
            str(item.get("severity", "")),
            str(item.get("title", "")),
            str(item.get("component", "")),
        )
        if key in seen:
            continue
        seen.add(key)
        deduped.append(item)

    return deduped[:12]


def _parse_nmap_ports(nmap_output: str) -> list[PortInfo]:
    """Extract open port rows from nmap plain-text output.

    Args:
        nmap_output: Raw nmap stdout string.

    Returns:
        List of PortInfo objects for each open port found.
    """
    ports: list[PortInfo] = []
    # Matches lines like: 80/tcp   open  http    Apache httpd 2.4
    pattern = re.compile(
        r"^(\d+)/(tcp|udp)\s+open\s+(\S+)?\s*(.*?)\s*$",
        re.MULTILINE,
    )
    for m in pattern.finditer(nmap_output):
        port_num = int(m.group(1))
        protocol = m.group(2)
        service = (m.group(3) or "").strip("?") or "unknown"
        version = m.group(4).strip()

        if port_num in _HIGH_RISK_PORTS:
            risk = "high"
        elif port_num in _MEDIUM_RISK_PORTS:
            risk = "medium"
        elif port_num in _LOW_RISK_PORTS:
            risk = "low"
        else:
            risk = "info"

        ports.append(
            PortInfo(
                port=port_num,
                protocol=protocol,
                service=service,
                version=version[:60],
                risk=risk,
            )
        )
    return ports


def _extract_host(url: str) -> str:
    parsed = urlparse(url)
    return parsed.hostname or url


def _probe_url_headers(url: str) -> dict:
    """Quickly fetch response metadata for baseline hardening checks."""
    req = Request(
        url,
        headers={
            "User-Agent": "Polaris/1.0 (+security-scan)",
            "Accept": "text/html,*/*;q=0.8",
        },
        method="GET",
    )
    try:
        with urlopen(req, timeout=5) as response:  # noqa: S310
            headers = {k.lower(): v for k, v in response.headers.items()}
            return {
                "status": int(getattr(response, "status", 0) or 0),
                "final_url": response.geturl(),
                "headers": headers,
                "error": "",
            }
    except URLError as exc:
        return {"status": 0, "final_url": url, "headers": {}, "error": str(exc)}
    except Exception as exc:  # pylint: disable=broad-except
        return {"status": 0, "final_url": url, "headers": {}, "error": str(exc)}


def _build_url_hardening_findings(url_probe: dict) -> list[dict]:
    """Generate deterministic hardening findings from observed web response headers."""
    final_url = str(url_probe.get("final_url", "") or "")
    headers = url_probe.get("headers", {}) or {}
    if not final_url and not headers:
        return []

    csp = str(headers.get("content-security-policy", "") or "").lower()
    findings: list[dict] = []

    if final_url.lower().startswith("http://"):
        findings.append(
            {
                "severity": "medium",
                "title": "Target is served over plain HTTP",
                "description": (
                    "The target resolved over HTTP without end-to-end TLS protection, "
                    "increasing interception and session-hijack risk on untrusted networks."
                ),
                "evidence": f"Final URL observed: {final_url}",
                "remediation": (
                    "Enforce HTTPS across all routes, enable secure redirects, and set HSTS."
                ),
                "component": "Transport Security",
            }
        )

    if final_url.lower().startswith("https://") and "strict-transport-security" not in headers:
        findings.append(
            {
                "severity": "low",
                "title": "HSTS header not observed",
                "description": (
                    "Strict-Transport-Security was not detected. Browsers may still attempt "
                    "insecure HTTP on first contact."
                ),
                "evidence": "Header missing: strict-transport-security",
                "remediation": "Set Strict-Transport-Security with a long max-age and includeSubDomains.",
                "component": "Transport Security",
            }
        )

    if "content-security-policy" not in headers:
        findings.append(
            {
                "severity": "low",
                "title": "Content Security Policy not observed",
                "description": (
                    "No CSP header was detected. A strong policy helps reduce XSS blast radius "
                    "and limits untrusted resource execution."
                ),
                "evidence": "Header missing: content-security-policy",
                "remediation": "Define and enforce a strict Content-Security-Policy tailored to app resources.",
                "component": "Browser Hardening",
            }
        )

    if "x-content-type-options" not in headers:
        findings.append(
            {
                "severity": "low",
                "title": "X-Content-Type-Options header not observed",
                "description": "Missing nosniff header can increase MIME confusion risk in some browsers.",
                "evidence": "Header missing: x-content-type-options",
                "remediation": "Set X-Content-Type-Options: nosniff.",
                "component": "Browser Hardening",
            }
        )

    frame_ancestors_present = "frame-ancestors" in csp
    if "x-frame-options" not in headers and not frame_ancestors_present:
        findings.append(
            {
                "severity": "low",
                "title": "Clickjacking protection header not observed",
                "description": (
                    "Neither X-Frame-Options nor CSP frame-ancestors was detected, which can leave "
                    "pages more exposed to clickjacking overlays."
                ),
                "evidence": "Headers missing: x-frame-options / csp frame-ancestors",
                "remediation": "Set X-Frame-Options DENY/SAMEORIGIN or use CSP frame-ancestors.",
                "component": "Browser Hardening",
            }
        )

    # Keep demo output concise and focused.
    return findings[:3]


def _truncate(data: dict | list | str, max_chars: int = 4000) -> str:
    text = json.dumps(data) if not isinstance(data, str) else data
    if len(text) > max_chars:
        return text[:max_chars] + "... [truncated]"
    return text


def _extract_first_json_object(text: str) -> dict | None:
    """Extract the first syntactically valid JSON object from arbitrary text."""
    start = -1
    depth = 0
    in_string = False
    escape = False

    for i, ch in enumerate(text):
        if in_string:
            if escape:
                escape = False
            elif ch == "\\":
                escape = True
            elif ch == '"':
                in_string = False
            continue

        if ch == '"':
            in_string = True
            continue

        if ch == "{":
            if depth == 0:
                start = i
            depth += 1
        elif ch == "}" and depth > 0:
            depth -= 1
            if depth == 0 and start != -1:
                try:
                    candidate = json.loads(text[start : i + 1])
                    if isinstance(candidate, dict):
                        return candidate
                except json.JSONDecodeError:
                    start = -1
                    continue
    return None


def _clean_json_fence(text: str) -> str:
    clean = re.sub(r"^```(?:json)?\s*", "", text.strip())
    clean = re.sub(r"\s*```$", "", clean).strip()
    return clean


def _parse_attack_chain_response(text: str) -> dict | None:
    """Parse attack chain JSON, tolerating extra prose or markdown fences."""
    clean = _clean_json_fence(text)

    for candidate_text in (clean, text):
        try:
            parsed = json.loads(candidate_text)
            if isinstance(parsed, dict):
                return parsed
        except (json.JSONDecodeError, ValueError, TypeError):
            pass

    return _extract_first_json_object(text)


def _guess_chain_type(finding: dict) -> str:
    """Infer a MITRE-like chain stage from finding title/description/tool."""
    text = " ".join(
        [
            str(finding.get("title", "")),
            str(finding.get("description", "")),
            str(finding.get("tool", "")),
            str(finding.get("component", "")),
        ]
    ).lower()

    if any(
        k in text
        for k in (
            "secret",
            "token",
            "apikey",
            "api key",
            "credential",
            "password",
            "hash",
        )
    ):
        return "credential_access"
    if any(
        k in text
        for k in (
            "sqli",
            "sql injection",
            "xss",
            "rce",
            "command injection",
            "path traversal",
            "auth bypass",
            "cve",
            "vulnerability",
        )
    ):
        return "initial_access"
    if any(k in text for k in ("privilege", "lateral", "pivot", "admin takeover")):
        return "lateral_movement"
    if any(k in text for k in ("exfil", "data leak", "dump", "exposure", "disclosure")):
        return "exfiltration"
    if any(
        k in text for k in ("delete", "destruct", "encrypt", "denial", "dos", "impact")
    ):
        return "impact"
    return "service"


def _escape_mermaid_label(label: str) -> str:
    safe = str(label).replace('"', "'").strip()
    return safe[:60] if safe else "Finding"


def _build_mermaid_from_chain(nodes: list[dict], edges: list[dict]) -> str:
    """Render a simple Mermaid LR flowchart from chain nodes/edges."""
    lines = ["flowchart LR"]
    for n in nodes:
        node_id = n.get("id", "")
        if not node_id:
            continue
        label = _escape_mermaid_label(n.get("label", "Finding"))
        lines.append(f'  {node_id}["{label}"]')

    for e in edges:
        from_id = e.get("from_id", "")
        to_id = e.get("to_id", "")
        if not from_id or not to_id:
            continue
        edge_label = _escape_mermaid_label(e.get("label", "may enable"))
        lines.append(f"  {from_id} -->|{edge_label}| {to_id}")

    return "\\n".join(lines)


def _build_fallback_attack_chain(findings: list[dict]) -> dict:
    """Build a deterministic, theory-oriented chain from existing findings."""
    if not findings:
        return {"nodes": [], "edges": [], "narrative": "", "mermaid": ""}

    deduped: list[dict] = []
    seen: set[tuple[str, str, str]] = set()
    for f in findings:
        key = (
            str(f.get("title", "")).strip().lower(),
            str(f.get("component", "")).strip().lower(),
            str(f.get("tool", "")).strip().lower(),
        )
        if key in seen:
            continue
        seen.add(key)
        deduped.append(f)

    deduped.sort(
        key=lambda f: (
            -_SEVERITY_RANK.get(str(f.get("severity", "info")).lower(), 1),
            str(f.get("title", "")).lower(),
        )
    )
    selected = deduped[:6]

    nodes = []
    for i, f in enumerate(selected, start=1):
        title = str(f.get("title", "Unnamed finding")).strip() or "Unnamed finding"
        nodes.append(
            {
                "id": f"node_{i}",
                "label": title[:42],
                "type": _guess_chain_type(f),
                "finding_ref": title,
            }
        )

    ordered_nodes = sorted(
        nodes,
        key=lambda n: (
            _CHAIN_STAGE_ORDER.get(str(n.get("type", "service")), 5),
            n.get("id", ""),
        ),
    )

    edges = []
    for i in range(len(ordered_nodes) - 1):
        src = ordered_nodes[i]
        dst = ordered_nodes[i + 1]
        edges.append(
            {
                "from_id": src["id"],
                "to_id": dst["id"],
                "label": "may enable",
                "justification": (
                    "The earlier weakness can plausibly increase attacker leverage "
                    "toward the subsequent step, based on automated evidence."
                ),
            }
        )

    if ordered_nodes:
        first = ordered_nodes[0].get("label", "initial weakness")
        last = ordered_nodes[-1].get("label", "impact")
        if len(ordered_nodes) > 1:
            narrative = (
                f"A plausible attack path begins with {first}. "
                f"From there, an attacker could chain additional weaknesses to reach {last}. "
                "This chain is theoretical and should be validated with targeted manual testing."
            )
        else:
            narrative = (
                f"One plausible security concern centers on {first}. "
                "No reliable multi-step chaining evidence was found from automated scans alone."
            )
    else:
        narrative = ""

    return {
        "nodes": ordered_nodes,
        "edges": edges,
        "narrative": narrative,
        "mermaid": _build_mermaid_from_chain(ordered_nodes, edges),
    }


def _normalize_attack_chain(parsed: dict | None) -> dict:
    """Normalize chain payload shape and fill narrative/mermaid when missing."""
    parsed = parsed or {}
    raw_nodes_obj = parsed.get("nodes")
    raw_edges_obj = parsed.get("edges")
    raw_nodes = raw_nodes_obj if isinstance(raw_nodes_obj, list) else []
    raw_edges = raw_edges_obj if isinstance(raw_edges_obj, list) else []
    nodes = [n for n in raw_nodes if isinstance(n, dict)]
    edges = [e for e in raw_edges if isinstance(e, dict)]
    narrative = str(parsed.get("narrative", "")).strip()
    mermaid = str(parsed.get("mermaid", "")).strip()

    if nodes and not narrative:
        narrative = (
            "The findings suggest a potential multi-step path. "
            "Treat this as a theoretical chain pending manual validation."
        )
    if nodes and not mermaid:
        mermaid = _build_mermaid_from_chain(nodes, edges)

    return {
        "nodes": nodes,
        "edges": edges,
        "narrative": narrative,
        "mermaid": mermaid,
    }


def _sanitize_attack_chain(chain: dict | None) -> dict:
    """Coerce chain payload into a model-safe shape.

    LLM output can contain partial nodes/edges that are valid JSON but fail
    the Pydantic AttackChain model (missing ids/labels, dangling edges, etc.).
    """
    chain = chain or {}
    raw_nodes_obj = chain.get("nodes")
    raw_edges_obj = chain.get("edges")
    raw_nodes = raw_nodes_obj if isinstance(raw_nodes_obj, list) else []
    raw_edges = raw_edges_obj if isinstance(raw_edges_obj, list) else []

    allowed_types = set(_CHAIN_STAGE_ORDER.keys())
    nodes: list[dict] = []
    node_ids: set[str] = set()

    for idx, node in enumerate(raw_nodes, start=1):
        if not isinstance(node, dict):
            continue

        node_id = str(node.get("id", "")).strip() or f"node_{idx}"
        if node_id in node_ids:
            node_id = f"{node_id}_{idx}"

        label = (
            str(node.get("label", "")).strip()
            or str(node.get("finding_ref", "")).strip()
        )
        if not label:
            continue

        node_type = str(node.get("type", "service")).strip().lower() or "service"
        if node_type not in allowed_types:
            node_type = "service"

        finding_ref = str(node.get("finding_ref", "")).strip() or label

        nodes.append(
            {
                "id": node_id,
                "label": label[:60],
                "type": node_type,
                "finding_ref": finding_ref[:200],
            }
        )
        node_ids.add(node_id)

    edges: list[dict] = []
    for edge in raw_edges:
        if not isinstance(edge, dict):
            continue

        from_id = str(edge.get("from_id", "")).strip()
        to_id = str(edge.get("to_id", "")).strip()
        if not from_id or not to_id:
            continue
        if from_id not in node_ids or to_id not in node_ids:
            continue

        edges.append(
            {
                "from_id": from_id,
                "to_id": to_id,
                "label": str(edge.get("label", "may enable")).strip()[:60]
                or "may enable",
                "justification": str(edge.get("justification", "")).strip()[:400],
            }
        )

    narrative = str(chain.get("narrative", "")).strip()
    if nodes and not narrative:
        narrative = (
            "The findings suggest a plausible multi-step path. "
            "Treat this as a theoretical chain pending manual validation."
        )

    mermaid = str(chain.get("mermaid", "")).strip()
    if nodes and not mermaid:
        mermaid = _build_mermaid_from_chain(nodes, edges)

    return {
        "nodes": nodes,
        "edges": edges,
        "narrative": narrative,
        "mermaid": mermaid,
    }


def _has_real_output(result: dict) -> bool:
    """Return True when a tool produced substantive output.

    A result where data fields are empty/zero means there is nothing useful
    to interpret, so we skip downstream LLM interpretation.

    Args:
        result: Tool return dict.

    Returns:
        True if there is output worth sending to the LLM.
    """
    # Check every possible data-holding key.
    has_results = bool(result.get("results"))
    has_output = bool(result.get("output", "").strip())
    has_findings = bool(result.get("findings"))
    has_vulns = bool(result.get("vulnerabilities"))
    has_total = result.get("total", 0) > 0
    has_data = has_results or has_output or has_findings or has_vulns or has_total
    return has_data


def _parse_findings(agent: str, tool: str, llm_response: str) -> list[dict]:
    """Extract JSON array from LLM response, tolerating minor formatting issues.

    Args:
        agent: Agent name (eg: "static_c").
        tool: Tool name string (eg: "cppcheck+semgrep/c").
        llm_response: Raw LLM output string.

    Returns:
        List of finding dicts with agent/tool fields injected.
    """
    text = llm_response.strip()
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    text = text.strip()
    try:
        items = json.loads(text)
        if not isinstance(items, list):
            return []
        parsed: list[dict] = []
        for item in items:
            if not isinstance(item, dict):
                continue
            severity = str(item.get("severity", "info")).lower()
            title = str(item.get("title", "Unnamed finding")).strip()
            description = str(item.get("description", "")).strip()
            evidence = str(item.get("evidence", ""))[:2000]

            non_finding_text = f"{title} {description} {evidence}".lower()
            if severity in {"low", "info"} and any(
                re.search(pattern, non_finding_text) for pattern in _NON_FINDING_PATTERNS
            ):
                continue

            parsed.append(
                {
                    "agent": agent,
                    "tool": tool,
                    "severity": severity,
                    "title": title or "Unnamed finding",
                    "description": description,
                    "evidence": evidence,
                    "remediation": item.get("remediation", ""),
                    "component": item.get("component", ""),
                }
            )
        return parsed
    except (json.JSONDecodeError, ValueError):
        return []


def _build_observation_finding(
    agent: str,
    tool: str,
    title: str,
    description: str,
    evidence: str = "",
    component: str = "Scan Observability",
) -> dict:
    """Create an info-severity finding that represents useful scan output."""
    return {
        "agent": agent,
        "tool": tool,
        "severity": "info",
        "title": title,
        "description": description,
        "evidence": evidence[:1800],
        "remediation": "",
        "component": component,
    }


def _invoke_llm_with_timeout(llm, messages, timeout_seconds: float = _SCAN_LLM_TIMEOUT_SECONDS):
    """Invoke an LLM call with a hard timeout to avoid stalled scan stages."""
    pool = ThreadPoolExecutor(max_workers=1)
    future = pool.submit(llm.invoke, messages)
    try:
        return future.result(timeout=timeout_seconds)
    except FutureTimeoutError:
        future.cancel()
        logging.warning("LLM invocation timed out after %.1fs", timeout_seconds)
        return None
    except Exception as exc:  # pylint: disable=broad-except
        logging.warning("LLM invocation failed: %s", exc)
        return None
    finally:
        pool.shutdown(wait=False, cancel_futures=True)


def _fallback_report_markdown(state: GraphState) -> str:
    """Produce deterministic markdown when report LLM is unavailable/slow."""
    findings = state.findings or []
    target_label = _report_target_label(state)
    if not findings:
        return (
            f"# Vulnerability Report -- {target_label}\n\n"
            "## Executive Summary\n"
            "Automated scanning completed, but no structured findings were produced in this run. "
            "This usually indicates either a clean target posture or tooling/network coverage gaps.\n\n"
            "## Scope & Execution Context\n"
            f"- Target: `{target_label}`\n"
            f"- Scan type: `{state.target_type or 'unknown'}`\n"
            f"- Planned stages: `{', '.join(state.agents_plan) if state.agents_plan else 'default pipeline'}`\n\n"
            "## Severity Breakdown\n"
            "Critical: 0 | High: 0 | Medium: 0 | Low: 0 | Info: 0\n\n"
            "## Findings\n"
            "No actionable vulnerabilities were detected by automated stages.\n\n"
            "## Risk Score: 0/10\n"
            "No confirmed vulnerabilities were produced by this automated run.\n\n"
            "## Next Steps\n"
            "1. Re-run from a network location with full outbound access.\n"
            "2. Scan a known vulnerable demo target to validate tooling health.\n"
            "3. Run a deeper manual review for business-logic risks."
        )

    severity_counts = {"critical": 0, "high": 0, "medium": 0, "low": 0, "info": 0}
    for finding in findings:
        sev = str(finding.get("severity", "info")).lower()
        if sev in severity_counts:
            severity_counts[sev] += 1

    ordered = sorted(
        findings,
        key=lambda f: _SEVERITY_RANK.get(str(f.get("severity", "info")).lower(), 1),
        reverse=True,
    )
    top = ordered[:10]
    bullets = []
    for item in top:
        severity = str(item.get("severity", "info")).upper()
        title = str(item.get("title", "Unnamed finding")).strip()
        component = str(item.get("component", "unknown component")).strip()
        bullets.append(f"- [{severity}] {title} ({component})")

    summary = (
        f"Critical: {severity_counts['critical']} | "
        f"High: {severity_counts['high']} | "
        f"Medium: {severity_counts['medium']} | "
        f"Low: {severity_counts['low']} | "
        f"Info: {severity_counts['info']}"
    )

    weighted = (
        severity_counts["critical"] * 4
        + severity_counts["high"] * 3
        + severity_counts["medium"] * 2
        + severity_counts["low"] * 1
    )
    risk_score = min(10, max(0, int(round(weighted / 1.8))))

    findings_table_lines = [
        "| # | Severity | Title | Tool | Component |",
        "| --- | --- | --- | --- | --- |",
    ]
    for idx, item in enumerate(ordered[:15], start=1):
        findings_table_lines.append(
            f"| {idx} | {str(item.get('severity', 'info')).upper()} | "
            f"{str(item.get('title', 'Unnamed finding')).replace('|', '/')} | "
            f"{str(item.get('tool', 'unknown')).replace('|', '/')} | "
            f"{str(item.get('component', 'unknown')).replace('|', '/')} |"
        )

    detail_lines: list[str] = []
    for idx, item in enumerate(ordered[:10], start=1):
        detail_lines.extend(
            [
                f"### {idx}. [{str(item.get('severity', 'info')).upper()}] {str(item.get('title', 'Unnamed finding'))}",
                f"- **Agent:** {item.get('agent', 'unknown')}",
                f"- **Tool:** {item.get('tool', 'unknown')}",
                f"- **Component:** {item.get('component', 'unknown')}",
                f"- **Description:** {item.get('description', 'No description provided.')}",
                f"- **Evidence:** {item.get('evidence', 'No evidence provided.')}",
                f"- **Remediation:** {item.get('remediation', 'No remediation provided.')}",
                "",
            ]
        )

    chain_narrative = ""
    if isinstance(state.attack_chain, dict):
        chain_narrative = str(state.attack_chain.get("narrative", "")).strip()

    return (
        f"# Vulnerability Report -- {target_label}\n\n"
        "## Executive Summary\n"
        "Automated scanning completed and findings were synthesized using deterministic fallback "
        "formatting because LLM report generation was unavailable or timed out.\n\n"
        f"## Severity Breakdown\n{summary}\n\n"
        "## Findings\n"
        f"{chr(10).join(findings_table_lines)}\n\n"
        "## Detailed Findings\n"
        f"{chr(10).join(detail_lines)}\n"
        "## Attack Chain\n"
        f"{chain_narrative or 'No multi-step attack chain was identified from the automated findings.'}\n\n"
        f"## Risk Score: {risk_score}/10\n"
        "Score is derived from weighted severity counts (critical/high/medium/low).\n\n"
        "## Notes\n"
        "Fallback reporting preserves scan value even when report synthesis is delayed."
    )


def _update_store(
    scan_id: str,
    agent: str,
    log_msg: str,
    new_findings: list[dict],
) -> None:
    """Update the global scan store for live SSE progress.

    Args:
        scan_id: Scan identifier (no-op when empty).
        agent: Current agent name.
        log_msg: Human-readable log entry.
        new_findings: Parsed findings to append.
    """
    if not scan_id:
        return
    from ..db.scans import scans  # avoid circular at module level

    if scan_id not in scans:
        return
    state = scans[scan_id]
    state.current_agent = agent
    state.log.append(log_msg)
    # Record the first time this agent runs.
    if agent not in state.agent_timings:
        state.agent_timings[agent] = time.time()
    for f in new_findings:
        try:
            state.findings.append(
                Finding(
                    agent=f["agent"],
                    tool=f["tool"],
                    severity=Severity(f.get("severity", "info")),
                    title=f["title"],
                    description=f.get("description", ""),
                    evidence=f.get("evidence", ""),
                    remediation=f.get("remediation", ""),
                    component=f.get("component", ""),
                )
            )
        except Exception:  # pylint: disable=broad-except
            pass


def _llm_interpret(
    scan_id: str,
    agent: str,
    tool_label: str,
    combined: dict | str,
    threat_model: str = "",
) -> list[dict]:
    """Call the LLM to interpret tool output and return parsed findings.

    Args:
        scan_id: Scan identifier (used to attach streaming callback).
        agent: Agent name for labelling findings.
        tool_label: Human-readable tool name (eg: "cppcheck+semgrep/c").
        combined: Tool output to interpret.
        threat_model: Optional context about the repo's risks.

    Returns:
        List of finding dicts.
    """
    callback = ScanStreamCallback(scan_id=scan_id, agent=agent)
    llm = get_llm().with_config({"callbacks": [callback]})
    deterministic_fallback = _derive_structured_findings(agent, tool_label, combined)

    context = f"\n\nThreat Model Context: {threat_model}" if threat_model else ""
    prompt = (
        INTERPRET_SYSTEM
        + context
        + f"\n\nAgent: {agent}\nTools: {tool_label}\nOutput:\n"
        + _truncate(combined)
    )
    response = _invoke_llm_with_timeout(llm, [HumanMessage(content=prompt)])
    if response is None:
        return deterministic_fallback

    parsed = _parse_findings(agent, tool_label, str(response.content or ""))
    if parsed:
        return parsed
    return deterministic_fallback


# ── Graph Nodes ───────────────────────────────────────────────────────────────


def planner_node(state: GraphState) -> dict:
    """Inspect the target and produce a tailored scan plan.

    For repo targets, an LLM determines the architecture, threat model,
    and agent routing plan.
    """
    _update_store(state.scan_id, "planner", "Analysing target architecture...", [])

    scan_plan = plan(state.target)

    logging.info(
        "Scan plan for %s: %s",
        state.target,
        scan_plan,
    )

    if state.scan_id:
        from ..db.scans import scans

        if state.scan_id in scans:
            store = scans[state.scan_id]
            store.target_type = scan_plan.target_type
            store.architecture_summary = scan_plan.architecture_summary
            store.threat_model = scan_plan.threat_model
            store.agents_plan = scan_plan.agents
            store.log.append(
                f"Plan: target_type={scan_plan.target_type}, agents={scan_plan.agents}"
            )

    return {
        "target_type": scan_plan.target_type,
        "architecture_summary": scan_plan.architecture_summary,
        "threat_model": scan_plan.threat_model,
        "agents_plan": scan_plan.agents,
    }


def attack_chain_node(state: GraphState) -> dict:
    """Ask the LLM to build an attack chain graph from ALL confirmed findings.

    Runs after all scan agents so the chain incorporates every discovered
    vulnerability. Streams reasoning to the UI via ScanStreamCallback.
    """
    _update_store(
        state.scan_id,
        "attack_chain",
        "Building attack chain from confirmed findings...",
        [],
    )

    if not state.findings:
        _update_store(
            state.scan_id,
            "attack_chain",
            "No confirmed findings; skipping attack-chain synthesis.",
            [],
        )
        return {"attack_chain": {"nodes": [], "edges": [], "narrative": "", "mermaid": ""}}

    prompt = ATTACK_CHAIN_PROMPT.format(
        target=state.target,
        architecture_summary=state.architecture_summary or "Unknown",
        threat_model=state.threat_model or "Unknown",
        all_findings=_truncate(state.findings, max_chars=3000)
        if state.findings
        else "No findings recorded.",
    )

    callback = ScanStreamCallback(scan_id=state.scan_id, agent="attack_chain")
    llm = get_llm().with_config({"callbacks": [callback]})
    response = _invoke_llm_with_timeout(
        llm, [HumanMessage(content=ATTACK_CHAIN_SYSTEM + "\n\n" + prompt)]
    )

    parsed = _parse_attack_chain_response(str(response.content or "")) if response else None
    attack_chain = _sanitize_attack_chain(_normalize_attack_chain(parsed))

    if not attack_chain.get("nodes") and state.findings:
        attack_chain = _sanitize_attack_chain(
            _build_fallback_attack_chain(state.findings)
        )

    node_count = len(attack_chain.get("nodes", []))
    _update_store(
        state.scan_id,
        "attack_chain",
        f"Attack chain built — {node_count} steps identified",
        [],
    )

    if state.scan_id:
        from ..db.scans import scans  # avoid circular at module level

        if state.scan_id in scans:
            from ..core.data_models import AttackChain, ChainEdge, ChainNode

            try:
                scans[state.scan_id].attack_chain = AttackChain(
                    nodes=[ChainNode(**n) for n in attack_chain.get("nodes", [])],
                    edges=[ChainEdge(**e) for e in attack_chain.get("edges", [])],
                    narrative=attack_chain.get("narrative", ""),
                    mermaid=attack_chain.get("mermaid", ""),
                )
            except Exception as exc:  # pylint: disable=broad-except
                logging.warning(
                    "Failed to persist attack chain for scan %s: %s", state.scan_id, exc
                )
                if state.findings:
                    fallback = _sanitize_attack_chain(
                        _build_fallback_attack_chain(state.findings)
                    )
                    try:
                        scans[state.scan_id].attack_chain = AttackChain(
                            nodes=[ChainNode(**n) for n in fallback.get("nodes", [])],
                            edges=[ChainEdge(**e) for e in fallback.get("edges", [])],
                            narrative=fallback.get("narrative", ""),
                            mermaid=fallback.get("mermaid", ""),
                        )
                    except Exception as fallback_exc:  # pylint: disable=broad-except
                        logging.warning(
                            "Failed to persist fallback attack chain for scan %s: %s",
                            state.scan_id,
                            fallback_exc,
                        )

    return {"attack_chain": attack_chain}


def recon_node(state: GraphState) -> dict:
    """HTTP probing, port scanning, and web tech fingerprinting."""
    _update_store(state.scan_id, "recon", "Starting reconnaissance...", [])

    with ThreadPoolExecutor(max_workers=3) as pool:
        httpx_future = pool.submit(run_httpx.invoke, {"url": state.target})
        nmap_future = pool.submit(run_nmap.invoke, {"host": _extract_host(state.target)})
        web_future = pool.submit(run_whatweb.invoke, {"url": state.target})
        httpx_result = httpx_future.result()
        nmap_result = nmap_future.result()
        web_result = web_future.result()
    combined = {"httpx": httpx_result, "nmap": nmap_result, "whatweb": web_result}

    # Skip LLM if all tools failed to run.
    any_output = (
        _has_real_output(httpx_result)
        or _has_real_output(nmap_result)
        or _has_real_output(web_result)
    )
    if not any_output:
        errors = ", ".join(
            e
            for r in (httpx_result, nmap_result, web_result)
            if (e := r.get("error", ""))
        )
        _update_store(
            state.scan_id,
            "recon",
            f"[SKIP] Recon tools unavailable: {errors}",
            [],
        )
        return {"findings": state.findings}

    # Parse and store open ports from nmap output for the port map visualisation.
    parsed_ports = _parse_nmap_ports(nmap_result.get("output", ""))
    if state.scan_id and parsed_ports:
        from ..db.scans import scans as _scans

        if state.scan_id in _scans:
            _scans[state.scan_id].ports = parsed_ports

    url_probe = _probe_url_headers(state.target)
    hardening_findings: list[dict] = []
    if url_probe.get("error"):
        hardening_findings = [
            {
                "agent": "recon",
                "tool": "header-audit",
                "severity": "low",
                "title": "Web header hardening checks could not be completed",
                "description": (
                    "The scanner could not complete HTTP header posture checks from the current "
                    "runtime network path, so browser-hardening coverage is partial for this run."
                ),
                "evidence": f"Header probe error: {url_probe['error']}",
                "remediation": (
                    "Re-run from an environment with outbound network access to the target and "
                    "validate CSP/HSTS/X-Frame-Options headers."
                ),
                "component": "Scan Coverage",
            }
        ]
        _update_store(
            state.scan_id,
            "recon",
            f"[INFO] Header posture probe unavailable: {url_probe['error']}",
            hardening_findings,
        )
    else:
        hardening_findings = [
            {
                "agent": "recon",
                "tool": "header-audit",
                **item,
            }
            for item in _build_url_hardening_findings(url_probe)
        ]

    findings = _llm_interpret(
        state.scan_id, "recon", "httpx+nmap+whatweb", combined, state.threat_model
    )
    synthetic: list[dict] = []
    if not findings:
        http_entries = httpx_result.get("results") or []
        status_hint = ""
        title_hint = ""
        if isinstance(http_entries, list) and http_entries:
            first = http_entries[0]
            status_hint = f"HTTP status: {first.get('status-code', 'unknown')}."
            page_title = str(first.get("title", "")).strip()
            if page_title:
                title_hint = f" Page title: {page_title}."
        ports_hint = f"Open ports detected: {len(parsed_ports)}."
        synthetic.append(
            _build_observation_finding(
                agent="recon",
                tool="httpx+nmap+whatweb",
                title="Reconnaissance completed",
                description=(
                    "Target discovery finished and telemetry was collected. "
                    "No exploitable vulnerability was confirmed at recon stage."
                ),
                evidence=f"{status_hint}{title_hint} {ports_hint}".strip(),
                component="Network Surface",
            )
        )

    _update_store(
        state.scan_id,
        "recon",
        (
            f"Recon complete -- findings={len(findings)}, "
            f"hardening={len(hardening_findings)}, observations={len(synthetic)}, "
            f"open ports={len(parsed_ports)}"
        ),
        findings + hardening_findings + synthetic,
    )
    return {"findings": state.findings + findings + hardening_findings + synthetic}


def sqli_node(state: GraphState) -> dict:
    """SQL injection testing with sqlmap."""
    _update_store(
        state.scan_id, "sql_injection", "Running SQL injection tests (sqlmap)...", []
    )

    result = run_sqlmap.invoke({"url": state.target})
    if not _has_real_output(result):
        _update_store(
            state.scan_id,
            "sql_injection",
            f"[SKIP] sqlmap unavailable: {result.get('error', '')}",
            [],
        )
        return {"findings": state.findings}
    if not bool(result.get("vulnerable")):
        synthetic = [
            _build_observation_finding(
                agent="sql_injection",
                tool="sqlmap",
                title="SQL injection checks completed",
                description=(
                    "Automated SQLi probes finished and no injectable parameters were confirmed "
                    "for this target during this run."
                ),
                evidence=str(result.get("output", "")),
                component="Input Validation",
            )
        ]
        _update_store(
            state.scan_id,
            "sql_injection",
            "SQLi scan complete -- no injectable parameters detected",
            synthetic,
        )
        return {"findings": state.findings + synthetic}

    findings = _llm_interpret(
        state.scan_id, "sql_injection", "sqlmap", result, state.threat_model
    )
    _update_store(
        state.scan_id,
        "sql_injection",
        f"SQLi scan complete -- findings={len(findings)}",
        findings,
    )
    return {"findings": state.findings + findings}


def xss_node(state: GraphState) -> dict:
    """XSS testing with dalfox."""
    _update_store(state.scan_id, "xss", "Running XSS tests (dalfox)...", [])

    result = run_dalfox.invoke({"url": state.target})
    if not _has_real_output(result):
        _update_store(
            state.scan_id,
            "xss",
            f"[SKIP] dalfox unavailable: {result.get('error', '')}",
            [],
        )
        return {"findings": state.findings}
    if not bool(result.get("vulnerable")):
        synthetic = [
            _build_observation_finding(
                agent="xss",
                tool="dalfox",
                title="XSS checks completed",
                description=(
                    "Automated XSS probes finished and no exploitable reflected/stored "
                    "payload behavior was confirmed in this run."
                ),
                evidence=str(result.get("output", "")),
                component="Web Application",
            )
        ]
        _update_store(
            state.scan_id,
            "xss",
            "XSS scan complete -- no exploitable reflections detected",
            synthetic,
        )
        return {"findings": state.findings + synthetic}

    findings = _llm_interpret(
        state.scan_id, "xss", "dalfox", result, state.threat_model
    )
    _update_store(
        state.scan_id,
        "xss",
        f"XSS scan complete -- findings={len(findings)}",
        findings,
    )
    return {"findings": state.findings + findings}


def static_c_node(state: GraphState) -> dict:
    """Static analysis for C/C++ repositories (cppcheck + semgrep p/c)."""
    _update_store(
        state.scan_id,
        "static_c",
        "Running C/C++ static analysis (cppcheck + semgrep p/c)...",
        [],
    )

    with ThreadPoolExecutor(max_workers=2) as pool:
        cppcheck_future = pool.submit(run_cppcheck.invoke, {"repo_path": state.target})
        semgrep_future = pool.submit(run_semgrep_c.invoke, {"repo_path": state.target})
        cppcheck_result = cppcheck_future.result()
        semgrep_c_result = semgrep_future.result()
    combined = {"cppcheck": cppcheck_result, "semgrep_c": semgrep_c_result}

    any_output = _has_real_output(cppcheck_result) or _has_real_output(semgrep_c_result)
    if not any_output:
        errors = ", ".join(
            e for r in (cppcheck_result, semgrep_c_result) if (e := r.get("error", ""))
        )
        _update_store(
            state.scan_id,
            "static_c",
            f"[SKIP] C analysis tools unavailable: {errors}",
            [],
        )
        return {"findings": state.findings}

    findings = _llm_interpret(
        state.scan_id, "static_c", "cppcheck+semgrep/c", combined, state.threat_model
    )
    _update_store(
        state.scan_id,
        "static_c",
        f"C static analysis complete -- findings={len(findings)}",
        findings,
    )
    return {"findings": state.findings + findings}


def static_node(state: GraphState) -> dict:
    """Static analysis for Python/JS repos (semgrep auto + bandit)."""
    _update_store(
        state.scan_id,
        "static_analysis",
        "Running static analysis (semgrep + bandit)...",
        [],
    )

    with ThreadPoolExecutor(max_workers=2) as pool:
        semgrep_future = pool.submit(run_semgrep.invoke, {"repo_path": state.target})
        bandit_future = pool.submit(run_bandit.invoke, {"repo_path": state.target})
        semgrep_result = semgrep_future.result()
        bandit_result = bandit_future.result()
    combined = {"semgrep": semgrep_result, "bandit": bandit_result}

    any_output = _has_real_output(semgrep_result) or _has_real_output(bandit_result)
    if not any_output:
        errors = ", ".join(
            e for r in (semgrep_result, bandit_result) if (e := r.get("error", ""))
        )
        _update_store(
            state.scan_id,
            "static_analysis",
            f"[SKIP] Static analysis tools unavailable: {errors}",
            [],
        )
        return {"findings": state.findings}

    findings = _llm_interpret(
        state.scan_id, "static_analysis", "semgrep+bandit", combined, state.threat_model
    )
    _update_store(
        state.scan_id,
        "static_analysis",
        f"Static analysis complete -- findings={len(findings)}",
        findings,
    )
    return {"findings": state.findings + findings}


def deps_py_node(state: GraphState) -> dict:
    """Python dependency CVE audit (pip-audit)."""
    _update_store(
        state.scan_id,
        "deps_py",
        "Scanning Python dependencies for CVEs (pip-audit)...",
        [],
    )

    result = run_pip_audit.invoke({"repo_path": state.target})
    if not _has_real_output(result):
        _update_store(
            state.scan_id,
            "deps_py",
            f"[SKIP] pip-audit unavailable: {result.get('error', '')}",
            [],
        )
        return {"findings": state.findings}

    findings = _llm_interpret(
        state.scan_id, "deps_py", "pip-audit", result, state.threat_model
    )
    _update_store(
        state.scan_id,
        "deps_py",
        f"Python dependency scan complete -- findings={len(findings)}",
        findings,
    )
    return {"findings": state.findings + findings}


def deps_js_node(state: GraphState) -> dict:
    """Node.js dependency CVE audit (npm audit)."""
    _update_store(
        state.scan_id,
        "deps_js",
        "Scanning JS dependencies for CVEs (npm audit)...",
        [],
    )

    result = run_npm_audit.invoke({"repo_path": state.target})
    if not _has_real_output(result):
        _update_store(
            state.scan_id,
            "deps_js",
            f"[SKIP] npm unavailable: {result.get('error', '')}",
            [],
        )
        return {"findings": state.findings}

    findings = _llm_interpret(
        state.scan_id, "deps_js", "npm-audit", result, state.threat_model
    )
    _update_store(
        state.scan_id,
        "deps_js",
        f"JS dependency scan complete -- findings={len(findings)}",
        findings,
    )
    return {"findings": state.findings + findings}


def deps_node(state: GraphState) -> dict:
    """Dependency scan for URL targets (checks /repos mount for manifests)."""
    _update_store(
        state.scan_id,
        "dependencies",
        "Scanning dependencies for CVEs...",
        [],
    )

    repo_path = "/repos"
    with ThreadPoolExecutor(max_workers=2) as pool:
        pip_future = pool.submit(run_pip_audit.invoke, {"repo_path": repo_path})
        npm_future = pool.submit(run_npm_audit.invoke, {"repo_path": repo_path})
        pip_result = pip_future.result()
        npm_result = npm_future.result()
    combined = {"pip_audit": pip_result, "npm_audit": npm_result}

    any_output = _has_real_output(pip_result) or _has_real_output(npm_result)
    if not any_output:
        _update_store(
            state.scan_id,
            "dependencies",
            "[SKIP] No dependency manifests found at /repos",
            [],
        )
        return {"findings": state.findings}

    findings = _llm_interpret(
        state.scan_id,
        "dependencies",
        "pip-audit+npm-audit",
        combined,
        state.threat_model,
    )
    _update_store(
        state.scan_id,
        "dependencies",
        f"Dependency scan complete -- findings={len(findings)}",
        findings,
    )
    return {"findings": state.findings + findings}


def secrets_node(state: GraphState) -> dict:
    """Hardcoded secrets scanning (trufflehog + detect-secrets)."""
    _update_store(state.scan_id, "secrets", "Scanning for hardcoded secrets...", [])

    if state.target_type != "repo":
        _update_store(
            state.scan_id,
            "secrets",
            "[SKIP] Secrets scan requires repository source and is skipped for URL targets",
            [],
        )
        return {"findings": state.findings}

    repo_path = state.target

    with ThreadPoolExecutor(max_workers=2) as pool:
        truffle_future = pool.submit(run_trufflehog.invoke, {"repo_path": repo_path})
        detect_future = pool.submit(run_detect_secrets.invoke, {"repo_path": repo_path})
        truffle_result = truffle_future.result()
        detect_result = detect_future.result()
    combined = {"trufflehog": truffle_result, "detect_secrets": detect_result}

    any_output = _has_real_output(truffle_result) or _has_real_output(detect_result)
    if not any_output:
        errors = ", ".join(
            e for r in (truffle_result, detect_result) if (e := r.get("error", ""))
        )
        _update_store(
            state.scan_id,
            "secrets",
            f"[SKIP] Secrets tools unavailable: {errors}",
            [],
        )
        return {"findings": state.findings}

    findings = _llm_interpret(
        state.scan_id,
        "secrets",
        "trufflehog+detect-secrets",
        combined,
        state.threat_model,
    )
    _update_store(
        state.scan_id,
        "secrets",
        f"Secrets scan complete -- findings={len(findings)}",
        findings,
    )
    return {"findings": state.findings + findings}


def report_node(state: GraphState) -> dict:
    """Synthesise all findings into a final Markdown report."""
    _update_store(state.scan_id, "report", "Generating vulnerability report...", [])

    if not state.findings:
        synthetic = [
            _build_observation_finding(
                agent="report",
                tool="summary",
                title="Scan completed with no confirmed vulnerabilities",
                description=(
                    "All enabled stages completed successfully. This run did not confirm actionable "
                    "vulnerabilities, but produced telemetry and stage-level evidence."
                ),
                evidence="Scan status: complete. No critical/high/medium/low findings were confirmed.",
                component="Executive Summary",
            )
        ]
        _update_store(
            state.scan_id,
            "report",
            "Report synthesis produced clean-run summary observation.",
            synthetic,
        )
        state.findings = state.findings + synthetic

    findings_text = _truncate(state.findings, max_chars=6000)
    architecture = state.architecture_summary or "N/A"
    threats = state.threat_model or "N/A"
    report_target = _report_target_label(state)
    chain_narrative = (
        state.attack_chain.get("narrative", "") if state.attack_chain else ""
    )
    chain_mermaid = state.attack_chain.get("mermaid", "") if state.attack_chain else ""

    prompt = REPORT_PROMPT.format(
        target=report_target,
        architecture=architecture,
        threat_model=threats,
        findings=findings_text,
        attack_chain_narrative=chain_narrative
        or "No multi-step attack chain identified.",
        attack_chain_mermaid=chain_mermaid or "",
    )

    callback = ScanStreamCallback(scan_id=state.scan_id, agent="report")
    llm = get_llm().with_config({"callbacks": [callback]})
    response = _invoke_llm_with_timeout(
        llm, [HumanMessage(content=REPORT_SYSTEM + "\n\n" + prompt)]
    )
    report = str(response.content or "").strip() if response else ""
    if not report:
        report = _fallback_report_markdown(state)

    if state.scan_id:
        from ..db.scans import scans

        if state.scan_id in scans:
            scans[state.scan_id].report = report
            scans[state.scan_id].current_agent = "complete"
            scans[state.scan_id].status = ScanStatus.complete
            scans[state.scan_id].log.append("Report generation complete.")

    return {"report": report}


# ── Routing ───────────────────────────────────────────────────────────────────

# All node keys registered in the graph.
_ALL_NODES = {
    "recon",
    "attack_chain",
    "sqli",
    "xss",
    "static_c",
    "static",
    "deps_py",
    "deps_js",
    "deps",
    "secrets",
    "report",
}


def _next_in_plan(current: str, state: GraphState) -> str:  # pylint: disable=unused-argument
    """Return the next node key after *current* in agents_plan.

    Falls back to "report" when the plan is exhausted or the current node
    is not found.

    Args:
        current: Key of the node that just finished.
        state: Current graph state.

    Returns:
        Next node key string.
    """
    agents_plan = state.agents_plan
    try:
        idx = agents_plan.index(current)
        nxt = agents_plan[idx + 1]
        return nxt if nxt in _ALL_NODES else "report"
    except (ValueError, IndexError):
        return "report"


def _make_router(node_key: str):
    """Create a routing function for *node_key* that advances the plan.

    For "planner" specifically, returns plan[0] (the first scheduled agent).
    For all other nodes, returns the element immediately after node_key in plan.

    Args:
        node_key: The node whose successor this router computes.

    Returns:
        A callable suitable for add_conditional_edges.
    """

    def _router(state: GraphState) -> str:  # pylint: disable=unused-argument
        if node_key == "planner":
            # Planner is not in agents_plan -- just return the first item.
            agents_plan = state.agents_plan
            if not agents_plan:
                return "report"
            first = agents_plan[0]
            return first if first in _ALL_NODES else "report"
        return _next_in_plan(node_key, state)

    _router.__name__ = f"_route_after_{node_key}"
    return _router


# ── Graph Assembly ────────────────────────────────────────────────────────────


def _build_graph() -> object:
    """Compile the LangGraph state machine.

    All inter-node routing is driven by agents_plan so the planner fully
    controls execution order without requiring a separate edge per path.
    """
    g = StateGraph(GraphState)

    g.add_node("planner", planner_node)
    g.add_node("recon", recon_node)
    g.add_node("attack_chain", attack_chain_node)
    g.add_node("sqli", sqli_node)
    g.add_node("xss", xss_node)
    g.add_node("static_c", static_c_node)
    g.add_node("static", static_node)
    g.add_node("deps_py", deps_py_node)
    g.add_node("deps_js", deps_js_node)
    g.add_node("deps", deps_node)
    g.add_node("secrets", secrets_node)
    g.add_node("report", report_node)

    g.set_entry_point("planner")

    # Planner -> first node in plan.
    g.add_conditional_edges(
        "planner",
        _make_router("planner"),
        {n: n for n in _ALL_NODES},
    )

    # Every non-terminal node routes to whatever comes next in the plan.
    # This single pattern handles all language-specific orderings.
    for node_key in _ALL_NODES - {"report"}:
        g.add_conditional_edges(
            node_key,
            _make_router(node_key),
            {n: n for n in _ALL_NODES},
        )

    g.add_edge("report", END)

    return g.compile()


SCAN_GRAPH = _build_graph()
