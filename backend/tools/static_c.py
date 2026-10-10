"""Static analysis tools for C and C++ codebases.

Dispatched only when the planner detects .c/.h/.cpp files.
Tools used:
  - cppcheck: memory safety, undefined behaviour, resource leaks
  - semgrep:  pattern-based rules using the p/c ruleset
  - clang:    --analyze via scan-build (best-effort; skipped if absent)

Each tool returns a dict with ``results``/``output``, ``total``, and
``error`` keys.  An ``error``-only result (empty results) is a tool
operational failure -- callers skip the LLM call in that case.
"""

import json
import subprocess

from langchain_core.tools import tool


@tool
def run_cppcheck(repo_path: str) -> dict:
    """Run cppcheck on a C/C++ repository to find memory and safety issues.

    Args:
        repo_path: Absolute path to the repository root.

    Returns:
        Dict with ``results`` (list of finding dicts), ``total``, and ``error``.
    """
    cmd = [
        "cppcheck",
        "--enable=all",
        "--inconclusive",
        "--xml",
        "--suppress=missingIncludeSystem",
        repo_path,
    ]
    try:
        # cppcheck writes XML to stderr, stdout is empty.
        r = subprocess.run(
            cmd, capture_output=True, text=True, timeout=120,
        )
        xml_output = r.stderr  # cppcheck --xml writes to stderr by design.
        if not xml_output.strip():
            return {"results": [], "total": 0, "error": ""}

        # Parse XML into structured findings without a heavy dependency.
        results = _parse_cppcheck_xml(xml_output)
        return {"results": results[:50], "total": len(results), "error": ""}
    except FileNotFoundError:
        return {
            "results": [], "total": 0,
            "error": (
                "cppcheck not found -- install via system package manager (Debian/Ubuntu: apt-get install -y cppcheck)"
            ),
        }
    except subprocess.TimeoutExpired:
        return {
            "results": [], "total": 0,
            "error": "cppcheck timed out after 120s",
        }


def _parse_cppcheck_xml(xml: str) -> list[dict]:
    """Extract findings from cppcheck XML output without lxml dependency.

    Args:
        xml: Raw cppcheck --xml stderr output.

    Returns:
        List of finding dicts with severity, id, message, file, line keys.
    """
    import re
    # Match <error> elements -- cppcheck XML is simple enough for regex.
    pattern = re.compile(
        r'<error\s[^>]*?id="(?P<id>[^"]*)"[^>]*?severity="(?P<sev>[^"]*)"'
        r'[^>]*?msg="(?P<msg>[^"]*)"[^>]*?>.*?'
        r'(?:<location[^>]*?file="(?P<file>[^"]*)"[^>]*?line="(?P<line>[^"]*)")?',
        re.DOTALL,
    )
    findings = []
    for m in pattern.finditer(xml):
        findings.append({
            "id":       m.group("id") or "",
            "severity": m.group("sev") or "information",
            "message":  m.group("msg") or "",
            "file":     m.group("file") or "",
            "line":     m.group("line") or "",
        })
    return findings


@tool
def run_semgrep_c(repo_path: str) -> dict:
    """Run semgrep with the C/C++ security ruleset on a repository.

    Uses ``p/c`` (C-specific rules) rather than the generic auto config
    which is optimised for Python and JavaScript.

    Args:
        repo_path: Absolute path to the repository root.

    Returns:
        Dict with ``results``, ``total``, and ``error``.
    """
    cmd = ["semgrep", "--config=p/c", "--json", "--quiet", repo_path]
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
            # semgrep not installed or invalid output.
            stderr = r.stderr[:500] if r.stderr else ""
            return {"results": [], "total": 0, "error": stderr}
    except FileNotFoundError:
        return {
            "results": [], "total": 0,
            "error": "semgrep not found -- install via: pip install semgrep",
        }
    except subprocess.TimeoutExpired:
        return {
            "results": [], "total": 0,
            "error": "semgrep timed out after 120s",
        }
