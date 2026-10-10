"""Fix service: turn findings into a pull request on the scanned repository.

Flow (runs in a background thread after POST /api/scan/{id}/fix):

1. Pick the actionable findings (critical / high / medium) from the scan.
2. For each one, find the file it lives in. The scanner evidence usually has a
   ``path:line`` in it; when it does not, the LLM picks from the file list.
3. Ask the LLM for the fixed version of that file. The whole file comes back,
   not a diff, because models are far more reliable at rewriting a file than
   at producing a patch that applies. Python files are syntax checked.
4. Write POLARIS_FIXES.md explaining every change and listing what still
   needs a human.
5. Create a branch on GitHub, commit the files through the Contents API, and
   open a pull request. Nothing touches the default branch; a person merges.

The GitHub token lives on the server (GITHUB_TOKEN env var). The frontend
never sees it.
"""

from __future__ import annotations

import ast
import base64
import json
import logging
import os
import re
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

from langchain_core.messages import HumanMessage

from ..core.data_models import Finding, ScanState
from ..db.scans import scans
from .llm_service import get_llm

_GITHUB_API = "https://api.github.com"
_MAX_FINDINGS = int(os.getenv("FIX_MAX_FINDINGS", "6"))
_MAX_FILE_CHARS = int(os.getenv("FIX_MAX_FILE_CHARS", "14000"))
_LLM_TIMEOUT = float(os.getenv("FIX_LLM_TIMEOUT_SECONDS", "90"))

_SKIP_DIRS = {
    ".git", "node_modules", ".venv", "venv", "__pycache__", "dist", "build", ".next",
    "vendor", "target", ".idea", ".vscode", "coverage",
}
_SOURCE_EXT = {
    ".py", ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".php", ".rb", ".go", ".java",
    ".cs", ".c", ".cpp", ".h", ".html", ".htm", ".yml", ".yaml", ".json", ".toml",
    ".env", ".cfg", ".ini", ".txt", ".md", ".sh", ".sql", ".xml", ".Dockerfile",
}


@dataclass
class FixedFile:
    path: str
    finding: str
    summary: str


@dataclass
class ManualItem:
    finding: str
    note: str


@dataclass
class FixJob:
    scan_id: str
    status: str = "idle"  # idle | running | done | failed
    steps: list[str] = field(default_factory=list)
    files: list[FixedFile] = field(default_factory=list)
    manual: list[ManualItem] = field(default_factory=list)
    fixed_titles: list[str] = field(default_factory=list)
    pr_url: str = ""
    pr_number: int = 0
    branch: str = ""
    error: str = ""
    started_at: float = 0.0
    finished_at: float = 0.0

    def say(self, message: str) -> None:
        logging.info("[fix %s] %s", self.scan_id, message)
        self.steps.append(message)

    def to_dict(self) -> dict:
        return {
            "scan_id": self.scan_id,
            "status": self.status,
            "steps": list(self.steps),
            "files": [f.__dict__ for f in self.files],
            "manual": [m.__dict__ for m in self.manual],
            "fixed_titles": list(self.fixed_titles),
            "pr_url": self.pr_url,
            "pr_number": self.pr_number,
            "branch": self.branch,
            "error": self.error,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
        }


fix_jobs: dict[str, FixJob] = {}
_lock = threading.Lock()


# ── GitHub ───────────────────────────────────────────────────────────────────


class GitHubError(RuntimeError):
    def __init__(self, message: str, status: int = 0):
        super().__init__(message)
        self.status = status


def _gh(token: str, path: str, method: str = "GET", body: dict | None = None) -> dict:
    data = json.dumps(body).encode() if body is not None else None
    req = Request(
        f"{_GITHUB_API}{path}",
        data=data,
        method=method,
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "Content-Type": "application/json",
            "User-Agent": "Polaris/1.0 (+fix-pr)",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    )
    try:
        with urlopen(req, timeout=30) as resp:  # noqa: S310 - fixed api.github.com host
            raw = resp.read().decode()
            return json.loads(raw) if raw else {}
    except HTTPError as exc:
        detail = ""
        try:
            detail = json.loads(exc.read().decode()).get("message", "")
        except Exception:  # pylint: disable=broad-except
            pass
        raise GitHubError(detail or exc.reason or f"GitHub API error {exc.code}", exc.code) from exc
    except URLError as exc:
        raise GitHubError(f"Could not reach GitHub: {exc.reason}") from exc


def parse_repo_slug(url: str) -> str | None:
    """github.com/owner/repo (any of the usual spellings) -> 'owner/repo'."""
    s = url.strip().replace(".git", "")
    s = re.sub(r"^https?://", "", s).replace("git@github.com:", "").replace("github.com/", "")
    parts = [p for p in s.split("/") if p]
    if len(parts) < 2:
        return None
    return f"{parts[0]}/{parts[1]}"


def open_pull_request(
    token: str,
    slug: str,
    files: dict[str, str],
    title: str,
    body: str,
    say,
) -> dict:
    say(f"Reading {slug}")
    info = _gh(token, f"/repos/{slug}")
    if info.get("archived"):
        raise GitHubError("That repository is archived, so it cannot take a pull request.")
    perms = info.get("permissions") or {}
    if not perms.get("push"):
        raise GitHubError(
            f"The server's GitHub token cannot push to {slug}. "
            "Fork the repo into the account that owns the token, or scan a repo you own."
        )
    base = info["default_branch"]

    say(f"Branching from {base}")
    base_ref = _gh(token, f"/repos/{slug}/git/ref/heads/{quote(base, safe='')}")
    base_sha = base_ref["object"]["sha"]
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    branch = f"polaris/fixes-{stamp}"
    _gh(token, f"/repos/{slug}/git/refs", "POST", {"ref": f"refs/heads/{branch}", "sha": base_sha})

    n = 0
    for path, contents in files.items():
        n += 1
        say(f"Writing {path} ({n} of {len(files)})")
        sha = None
        try:
            existing = _gh(token, f"/repos/{slug}/contents/{quote(path)}?ref={quote(branch, safe='')}")
            sha = existing.get("sha")
        except GitHubError as exc:
            if exc.status != 404:
                raise
        payload = {
            "message": f"Polaris: fix {path}" if sha else f"Polaris: add {path}",
            "content": base64.b64encode(contents.encode()).decode(),
            "branch": branch,
        }
        if sha:
            payload["sha"] = sha
        _gh(token, f"/repos/{slug}/contents/{quote(path)}", "PUT", payload)

    say("Opening the pull request")
    pr = _gh(token, f"/repos/{slug}/pulls", "POST", {"title": title, "body": body, "head": branch, "base": base})
    say(f"Opened #{pr['number']}")
    return {"url": pr["html_url"], "number": pr["number"], "branch": branch, "base": base}


# ── Repo helpers ─────────────────────────────────────────────────────────────


def _list_source_files(repo: Path, limit: int = 400) -> list[str]:
    out: list[str] = []
    for root, dirs, files in os.walk(repo):
        dirs[:] = [d for d in dirs if d not in _SKIP_DIRS and not d.startswith(".")]
        for name in files:
            p = Path(root) / name
            if p.suffix.lower() in _SOURCE_EXT or name in {"Dockerfile", "requirements.txt", "package.json"}:
                try:
                    if p.stat().st_size > 400_000:
                        continue
                except OSError:
                    continue
                out.append(str(p.relative_to(repo)))
                if len(out) >= limit:
                    return out
    return out


_PATH_RE = re.compile(r"(?<!\w)((?:[\w.-]+/)*[\w.-]+\.(?:py|js|jsx|ts|tsx|mjs|php|rb|go|java|html|yml|yaml|json|toml|txt|env|cfg|ini))(?::\d+)?")


def _paths_in_text(text: str, known: set[str]) -> list[str]:
    hits: list[str] = []
    for m in _PATH_RE.finditer(text or ""):
        candidate = m.group(1).lstrip("./")
        # the scanner may print absolute clone paths; match on suffix
        for k in known:
            if k == candidate or k.endswith("/" + candidate) or candidate.endswith("/" + k):
                if k not in hits:
                    hits.append(k)
                break
    return hits


def _llm_text(llm, prompt: str) -> str | None:
    try:
        resp = llm.invoke([HumanMessage(content=prompt)])
    except Exception as exc:  # pylint: disable=broad-except
        logging.warning("fix llm call failed: %s", exc)
        return None
    content = getattr(resp, "content", resp)
    if isinstance(content, list):
        content = "".join(part.get("text", "") if isinstance(part, dict) else str(part) for part in content)
    return str(content)


def _locate_with_llm(llm, finding: Finding, files: list[str]) -> str | None:
    prompt = (
        "You are helping fix a security finding in a code repository.\n\n"
        f"Finding: {finding.title}\nSeverity: {finding.severity}\nDescription: {finding.description}\n"
        f"Evidence: {finding.evidence[:1500]}\nComponent: {finding.component}\n\n"
        "Here is the list of files in the repository:\n"
        + "\n".join(files)
        + "\n\nWhich single file should be edited to fix this finding? "
        "Reply with JSON only: {\"path\": \"<path from the list>\"} or {\"path\": null} if no file change can fix it."
    )
    text = _llm_text(llm, prompt)
    if not text:
        return None
    m = re.search(r"\{[^{}]*\}", text)
    if not m:
        return None
    try:
        data = json.loads(m.group(0))
    except json.JSONDecodeError:
        return None
    path = data.get("path")
    return path if isinstance(path, str) and path in files else None


def _fix_with_llm(llm, finding: Finding, path: str, original: str) -> tuple[str, str] | None:
    """Return (fixed_content, one_line_summary) or None."""
    prompt = (
        "You are a senior application security engineer. Fix exactly one security finding in the file below.\n"
        "Rules:\n"
        "- Keep every existing behaviour that is not part of the vulnerability. Do not refactor, rename or reformat unrelated code.\n"
        "- Make the smallest change that removes the vulnerability. Add imports only if the fix needs them.\n"
        "- Do not add comments that mention an AI or a scanner. A short comment explaining the fix is fine.\n"
        "- Return the COMPLETE file, then a one line summary.\n\n"
        f"Finding: {finding.title}\nSeverity: {finding.severity}\nDescription: {finding.description}\n"
        f"Evidence: {finding.evidence[:1500]}\nSuggested remediation: {finding.remediation}\n\n"
        f"File: {path}\n```\n{original}\n```\n\n"
        "Respond in exactly this format:\n"
        "```\n<complete fixed file>\n```\n"
        "SUMMARY: <one line describing the change>"
    )
    text = _llm_text(llm, prompt)
    if not text:
        return None
    m = re.search(r"```[a-zA-Z0-9_+-]*\n(.*?)\n```", text, re.S)
    if not m:
        return None
    fixed = m.group(1)
    if fixed.endswith("\n") is False and original.endswith("\n"):
        fixed += "\n"
    sm = re.search(r"SUMMARY:\s*(.+)", text)
    summary = sm.group(1).strip() if sm else f"Fix for {finding.title}"
    if not fixed.strip() or fixed.strip() == original.strip():
        return None
    # guard against the model dropping or ballooning the file
    if len(fixed) < len(original) * 0.5 or len(fixed) > len(original) * 2.5 + 2000:
        return None
    if path.endswith(".py"):
        try:
            ast.parse(fixed)
        except SyntaxError:
            return None
    return fixed, summary


def _actionable(findings: list[Finding]) -> list[Finding]:
    rank = {"critical": 0, "high": 1, "medium": 2}
    seen: set[str] = set()
    out: list[Finding] = []
    for f in sorted(findings, key=lambda x: rank.get(str(x.severity.value if hasattr(x.severity, "value") else x.severity), 9)):
        sev = str(f.severity.value if hasattr(f.severity, "value") else f.severity)
        if sev not in rank:
            continue
        key = f.title.strip().lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(f)
    return out[:_MAX_FINDINGS]


def _fixes_markdown(scan: ScanState, files: list[FixedFile], manual: list[ManualItem], skipped: list[Finding]) -> str:
    lines = [
        "# Polaris security fixes",
        "",
        f"Opened by Polaris from the scan of `{scan.target}`.",
        "",
        "Nothing here has been merged. Read each change, edit what you disagree with, merge when you are happy.",
        "",
    ]
    if files:
        lines += ["## What this changes", ""]
        for f in files:
            lines += [f"### {f.finding}", "", f"- `{f.path}`: {f.summary}", ""]
    if manual:
        lines += ["## Needs a human", ""]
        for m in manual:
            lines += [f"- **{m.finding}**: {m.note}"]
        lines.append("")
    if skipped:
        lines += ["## Lower severity findings not touched by this PR", ""]
        for f in skipped:
            lines += [f"- {f.title} ({f.severity.value if hasattr(f.severity, 'value') else f.severity})"]
        lines.append("")
    return "\n".join(lines)


# ── Job ──────────────────────────────────────────────────────────────────────


def start_fix_job(scan_id: str) -> FixJob:
    with _lock:
        job = fix_jobs.get(scan_id)
        if job and job.status == "running":
            return job
        job = FixJob(scan_id=scan_id, status="running", started_at=time.time())
        fix_jobs[scan_id] = job
    thread = threading.Thread(target=_run, args=(job,), daemon=True)
    thread.start()
    return job


def _run(job: FixJob) -> None:
    try:
        _run_inner(job)
        job.status = "done"
    except GitHubError as exc:
        job.error = str(exc)
        job.status = "failed"
        job.say(f"GitHub: {exc}")
    except Exception as exc:  # pylint: disable=broad-except
        logging.exception("fix job failed")
        job.error = str(exc)
        job.status = "failed"
        job.say(f"Failed: {exc}")
    finally:
        job.finished_at = time.time()


def _run_inner(job: FixJob) -> None:
    scan = scans.get(job.scan_id)
    if scan is None:
        raise RuntimeError("Scan not found on this server (it may have restarted). Run the scan again.")
    token = os.getenv("GITHUB_TOKEN", "").strip()
    if not token:
        raise RuntimeError("GITHUB_TOKEN is not configured on the server, so Polaris cannot open pull requests.")
    slug = parse_repo_slug(scan.source_repo_url or scan.target)
    if not slug:
        raise RuntimeError("Fixes can only be pushed for GitHub repository targets.")
    repo = Path(scan.resolved_target)
    if not repo.is_dir():
        raise RuntimeError("The repository snapshot is gone from this server. Run the scan again, then fix.")

    findings = _actionable(scan.findings)
    skipped = [f for f in scan.findings if f not in findings and str(getattr(f.severity, "value", f.severity)) not in {"critical", "high", "medium"}]
    if not findings:
        raise RuntimeError("No critical, high or medium findings to fix.")
    job.say(f"{len(findings)} findings to fix in {slug}")

    files_index = _list_source_files(repo)
    known = set(files_index)
    llm = get_llm(request_timeout=_LLM_TIMEOUT)

    changes: dict[str, str] = {}
    current: dict[str, str] = {}

    for finding in findings:
        job.say(f"Locating: {finding.title}")
        paths = _paths_in_text(f"{finding.evidence}\n{finding.description}\n{finding.component}", known)
        path = paths[0] if paths else _locate_with_llm(llm, finding, files_index)
        if not path:
            job.manual.append(ManualItem(finding.title, "Could not tie this to a single file. See the remediation in the report."))
            job.say("  no single file, left for a human")
            continue
        if path not in current:
            try:
                current[path] = (repo / path).read_text(encoding="utf-8", errors="replace")
            except OSError:
                job.manual.append(ManualItem(finding.title, f"Could not read `{path}`."))
                continue
        original = current[path]
        if len(original) > _MAX_FILE_CHARS:
            job.manual.append(ManualItem(finding.title, f"`{path}` is too large to rewrite safely. Apply the remediation by hand."))
            job.say(f"  {path} is too large, left for a human")
            continue
        job.say(f"Fixing {path}")
        result = _fix_with_llm(llm, finding, path, original)
        if not result:
            job.manual.append(ManualItem(finding.title, f"Could not produce a safe change for `{path}`. Follow the remediation in the report."))
            job.say("  no safe change produced, left for a human")
            continue
        fixed, summary = result
        current[path] = fixed  # later fixes build on earlier ones in the same file
        changes[path] = fixed
        job.files.append(FixedFile(path=path, finding=finding.title, summary=summary))
        job.fixed_titles.append(finding.title)
        job.say(f"  {summary}")

    if not changes:
        raise RuntimeError("None of the findings could be fixed automatically. The report has the manual steps.")

    changes["POLARIS_FIXES.md"] = _fixes_markdown(scan, job.files, job.manual, skipped)

    n_fixed = len(job.files)
    title = f"Polaris: fix {n_fixed} security finding{'s' if n_fixed != 1 else ''}"
    body = changes["POLARIS_FIXES.md"]
    pr = open_pull_request(token, slug, changes, title, body, job.say)
    job.pr_url = pr["url"]
    job.pr_number = pr["number"]
    job.branch = pr["branch"]
