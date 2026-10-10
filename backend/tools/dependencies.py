"""Dependency vulnerability audit tools.

Dispatched selectively by the planner:
  - run_pip_audit: only for repos with Python manifest files
  - run_npm_audit: only for repos with package.json

Each tool validates that the relevant manifest exists before running,
so the calling node never needs to handle "No X found" errors as
security findings.
"""

import json
import os
import subprocess

from langchain_core.tools import tool


_PYTHON_MANIFESTS = ("requirements.txt", "requirements-dev.txt", "pyproject.toml")


@tool
def run_pip_audit(repo_path: str) -> dict:
    """Audit Python dependencies for known CVEs using pip-audit.

    Searches for requirements.txt, requirements-dev.txt, or pyproject.toml.
    Returns an empty result (not an error) when no manifest is found so the
    planner's pre-check is the canonical guard -- not this function.

    Args:
        repo_path: Absolute path to the repository root.

    Returns:
        Dict with ``vulnerabilities`` (affected packages only), ``total``,
        and ``error``.
    """
    req_file = None
    for name in _PYTHON_MANIFESTS:
        candidate = os.path.join(repo_path, name)
        if os.path.exists(candidate):
            req_file = candidate
            break

    if not req_file:
        # Planner should have prevented this, but guard defensively.
        return {"vulnerabilities": [], "total": 0, "error": ""}

    if req_file.endswith(".txt"):
        cmd = ["pip-audit", "-r", req_file, "--format=json"]
    else:
        cmd = ["pip-audit", "--format=json"]

    try:
        r = subprocess.run(
            cmd, capture_output=True, text=True, timeout=90, cwd=repo_path,
        )
        try:
            data = json.loads(r.stdout)
            vulns = data if isinstance(data, list) else data.get("dependencies", [])
            affected = [d for d in vulns if d.get("vulns")]
            return {"vulnerabilities": affected[:30], "total": len(affected), "error": ""}
        except json.JSONDecodeError:
            err_msg = r.stderr[:500] if r.stderr else "pip-audit failed to return JSON."
            if "internal pip failure" in err_msg or "No matching distribution found" in err_msg:
                return {
                    "vulnerabilities": [], "total": 0,
                    "error": "Target repo dependencies are incompatible with the scanner's Python environment (resolution failed). Skipping deep pip audit.",
                }
            return {
                "vulnerabilities": [], "total": 0,
                "error": err_msg,
            }
    except FileNotFoundError:
        return {
            "vulnerabilities": [], "total": 0,
            "error": "pip-audit not found -- install via: pip install pip-audit",
        }
    except subprocess.TimeoutExpired:
        return {
            "vulnerabilities": [], "total": 0,
            "error": "pip-audit timed out after 90s",
        }


@tool
def run_npm_audit(repo_path: str) -> dict:
    """Audit Node.js dependencies for known CVEs using npm audit.

    Args:
        repo_path: Absolute path to the repository root (must contain package.json).

    Returns:
        Dict with ``vulnerabilities``, ``total``, and ``error``.
    """
    pkg_json = os.path.join(repo_path, "package.json")
    if not os.path.exists(pkg_json):
        # Planner should have prevented this, but guard defensively.
        return {"vulnerabilities": [], "total": 0, "error": ""}

    cmd = ["npm", "audit", "--json"]
    try:
        r = subprocess.run(
            cmd, capture_output=True, text=True, timeout=60, cwd=repo_path,
        )
        try:
            data = json.loads(r.stdout)
            vulns = data.get("vulnerabilities", {})
            flat = [{"name": k, **v} for k, v in list(vulns.items())[:30]]
            total = (
                data.get("metadata", {})
                .get("vulnerabilities", {})
                .get("total", len(flat))
            )
            return {"vulnerabilities": flat, "total": total, "error": ""}
        except json.JSONDecodeError:
            return {
                "vulnerabilities": [], "total": 0,
                "error": r.stderr[:500] if r.stderr else "",
            }
    except FileNotFoundError:
        return {
            "vulnerabilities": [], "total": 0,
            "error": "npm not found -- install Node.js to enable npm",
        }
    except subprocess.TimeoutExpired:
        return {
            "vulnerabilities": [], "total": 0,
            "error": "npm audit timed out after 60s",
        }
