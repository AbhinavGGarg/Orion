import subprocess
from langchain_core.tools import tool


@tool
def run_sqlmap(url: str) -> dict:
    """Test a URL for SQL injection vulnerabilities (batch mode, level 1, risk 1 — detection only, no data extraction)."""
    cmd = [
        "sqlmap", "-u", url,
        "--batch",
        "--level=1", "--risk=1",
        "--smart",
        "--threads=2",
        "--timeout=6",
        "--retries=1",
        "--time-sec=3",
        "--flush-session",
        "--forms",
        "--output-dir=/tmp/sqlmap_out",
        "--answers=quit=N",
    ]
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=28)
        output = (r.stdout + r.stderr)[:4000]
        return {"output": output, "vulnerable": "injectable" in output.lower() or "sql injection" in output.lower()}
    except FileNotFoundError:
        return {"output": "sqlmap not found", "vulnerable": False}
    except subprocess.TimeoutExpired:
        return {"output": "sqlmap timed out after 28s", "vulnerable": False}


@tool
def run_dalfox(url: str) -> dict:
    """Test a URL for XSS vulnerabilities using dalfox (skip blind attack vectors)."""
    cmd = ["dalfox", "url", url, "--skip-bav", "--silence"]
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=20)
        output = (r.stdout + r.stderr)[:3000]
        return {"output": output, "vulnerable": "[V]" in r.stdout or "XSS" in r.stdout.upper()}
    except FileNotFoundError:
        return {"output": "dalfox not found — install via: go install github.com/hahwul/dalfox/v2@latest", "vulnerable": False}
    except subprocess.TimeoutExpired:
        return {"output": "dalfox timed out after 20s", "vulnerable": False}
