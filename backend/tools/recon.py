"""Recon tools: HTTP probing, port scanning, and technology fingerprinting.

These tools are only dispatched for URL targets by the planner.
Each tool returns a dict with ``results``/``output`` and ``error`` keys.
A non-empty ``error`` with empty results means the tool failed to run --
callers should skip the LLM call in that case rather than treating the
error message as a security finding.
"""

import json
import subprocess

from langchain_core.tools import tool


@tool
def run_httpx(url: str) -> dict:
    """Probe a URL for HTTP status, page title, redirect chain, and tech stack.

    Requires the ProjectDiscovery ``httpx`` Go binary (not ``python-httpx``).
    Install via: go install github.com/projectdiscovery/httpx/cmd/httpx@latest

    Args:
        url: Target URL to probe.

    Returns:
        Dict with ``results`` (list of parsed JSON lines) and ``error`` string.
    """
    cmd = [
        "httpx",
        "-u", url,
        "-json", "-title", "-tech-detect", "-status-code", "-silent",
    ]
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=8)
        lines = []
        for line in r.stdout.strip().splitlines():
            if line:
                try:
                    lines.append(json.loads(line))
                except json.JSONDecodeError:
                    pass
        error = r.stderr[:500] if r.stderr else ""
        return {"results": lines, "error": error}
    except FileNotFoundError:
        return {
            "results": [],
            "error": (
                "httpx (ProjectDiscovery) not found -- install via: "
                "go install github.com/projectdiscovery/httpx/cmd/httpx@latest"
            ),
        }
    except subprocess.TimeoutExpired:
        return {"results": [], "error": "httpx timed out after 8s"}


@tool
def run_nmap(host: str) -> dict:
    """Scan open ports and services (ports 1-10000, T4 timing, version detection).

    Args:
        host: Hostname or IP address to scan.

    Returns:
        Dict with ``output`` (raw nmap stdout) and ``error`` string.
    """
    cmd = ["nmap", "-sV", "--open", "-T4", "--top-ports", "300", "--host-timeout", "15s", host]
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=20)
        return {"output": r.stdout, "error": r.stderr[:500] if r.stderr else ""}
    except FileNotFoundError:
        return {
            "output": "",
            "error": "nmap not found -- install via: brew install nmap",
        }
    except subprocess.TimeoutExpired:
        return {"output": "", "error": "nmap timed out after 20s"}


@tool
def run_whatweb(url: str) -> dict:
    """Fingerprint web technologies, CMS, frameworks, and server details.

    Args:
        url: Target URL to fingerprint.

    Returns:
        Dict with ``output`` (raw whatweb JSON) and ``error`` string.
    """
    cmd = ["whatweb", "--log-json=/dev/stdout", "--quiet", url]
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=8)
        return {
            "output": r.stdout[:2000],
            "error": r.stderr[:500] if r.stderr else "",
        }
    except FileNotFoundError:
        return {
            "output": "",
            "error": "whatweb not found -- install via: brew install whatweb",
        }
    except subprocess.TimeoutExpired:
        return {"output": "", "error": "whatweb timed out after 8s"}
