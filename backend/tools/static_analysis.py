"""Static analysis tools for Python and JavaScript/TypeScript codebases.

Dispatched when the planner detects Python or JS/TS files.
Tools used:
  - semgrep: auto-detect ruleset (strong Python/JS coverage)
  - bandit:  Python-specific security linter

Each tool returns a dict with ``results``, ``total``, and ``error`` keys.
An ``error``-only result means the tool failed to run -- the node skips
the LLM call rather than treating the error message as a finding.
"""

import json
import subprocess

from langchain_core.tools import tool


@tool
def run_semgrep(repo_path: str) -> dict:
    """Run semgrep with auto-detect ruleset to find security vulnerabilities.

    Args:
        repo_path: Absolute path to the repository root.

    Returns:
        Dict with ``results`` (capped at 50), ``total``, and ``error``.
    """
    cmd = ["semgrep", "--config=auto", "--json", "--quiet", repo_path]
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
        try:
            data = json.loads(r.stdout)
            results = data.get("results", [])[:50]
            return {
                "results": results,
                "total": len(data.get("results", [])),
                "error": "",
            }
        except json.JSONDecodeError:
            stderr = r.stderr[:500] if r.stderr else ""
            return {"results": [], "total": 0, "error": stderr}
    except FileNotFoundError:
        return {
            "results": [], "total": 0,
            "error": "semgrep not found -- install via: pip install semgrep",
        }
    except subprocess.TimeoutExpired:
        return {"results": [], "total": 0, "error": "semgrep timed out after 120s"}


@tool
def run_bandit(repo_path: str) -> dict:
    """Run bandit security linter on a Python codebase.

    Args:
        repo_path: Absolute path to the repository root.

    Returns:
        Dict with ``results`` (capped at 50), ``total``, and ``error``.
    """
    cmd = ["bandit", "-r", repo_path, "-f", "json", "-q"]
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
        try:
            data = json.loads(r.stdout)
            results = data.get("results", [])[:50]
            return {
                "results": results,
                "total": len(data.get("results", [])),
                "error": "",
            }
        except json.JSONDecodeError:
            stderr = r.stderr[:500] if r.stderr else ""
            return {"results": [], "total": 0, "error": stderr}
    except FileNotFoundError:
        return {
            "results": [], "total": 0,
            "error": "bandit not found -- install via: pip install bandit",
        }
    except subprocess.TimeoutExpired:
        return {"results": [], "total": 0, "error": "bandit timed out after 60s"}
