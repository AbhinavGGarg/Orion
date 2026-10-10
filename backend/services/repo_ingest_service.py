"""Repository ingestion helpers for public GitHub URLs."""

import logging
import re
import shutil
import subprocess
from pathlib import Path
from urllib.parse import urlparse

from ..core.constants import (
    REPO_CLONE_DEPTH,
    REPO_CLONE_ROOT,
    REPO_CLONE_TIMEOUT_SECONDS,
)

_GITHUB_HOSTS = {"github.com", "www.github.com"}
_NAME_RE = re.compile(r"^[A-Za-z0-9_.-]+$")


def _normalise_github_repo_url(repo_url: str) -> tuple[str, str, str]:
    """Validate and normalise public GitHub repository URL.

    Args:
        repo_url: User-provided repository URL

    Returns:
        Tuple of (clone_url, owner, repo_name)

    Raises:
        ValueError: If URL is not a supported public GitHub repository URL
    """
    raw_url = repo_url.strip()
    parsed = urlparse(raw_url)

    if parsed.scheme not in {"http", "https"}:
        raise ValueError("Repository URL must start with http:// or https://")

    host = (parsed.hostname or "").lower()
    if host not in _GITHUB_HOSTS:
        raise ValueError("Only public github.com repository URLs are supported")

    if parsed.username or parsed.password:
        raise ValueError("Repository URL must not include credentials")

    path_parts = [part for part in parsed.path.split("/") if part]
    if len(path_parts) < 2:
        raise ValueError("Repository URL must match github.com/<owner>/<repo>")
    if len(path_parts) > 2:
        raise ValueError("Only repository root URLs are supported (no tree/blob paths)")

    owner = path_parts[0]
    repo_name = path_parts[1]
    if repo_name.endswith(".git"):
        repo_name = repo_name[:-4]

    if not owner or not repo_name:
        raise ValueError("Repository owner and name are required")

    if not _NAME_RE.fullmatch(owner) or not _NAME_RE.fullmatch(repo_name):
        raise ValueError("Repository URL contains unsupported characters")

    clone_url = f"https://github.com/{owner}/{repo_name}.git"
    return clone_url, owner, repo_name


def is_github_repo_url(target: str) -> bool:
    """Return True when target is a supported public GitHub repo URL."""
    try:
        _normalise_github_repo_url(target)
    except ValueError:
        return False
    return True


def clone_public_github_repo(scan_id: str, repo_url: str) -> dict[str, str]:
    """Clone public GitHub repository into backend-managed storage.

    Args:
        scan_id: Scan identifier used for namespacing clone location
        repo_url: User-provided public GitHub repository URL

    Returns:
        Mapping with source URL and resolved repository path

    Raises:
        ValueError: If URL is invalid or clone operation fails
    """
    clone_url, owner, repo_name = _normalise_github_repo_url(repo_url)

    scan_root = REPO_CLONE_ROOT / scan_id
    repo_path = scan_root / f"{owner}__{repo_name}"

    scan_root.mkdir(parents=True, exist_ok=True)
    if repo_path.exists():
        shutil.rmtree(repo_path)

    depth = max(1, REPO_CLONE_DEPTH)
    cmd = [
        "git",
        "clone",
        "--depth",
        str(depth),
        "--filter=blob:none",
        "--single-branch",
        clone_url,
        str(repo_path),
    ]

    logging.info("Cloning GitHub repository for scan %s: %s", scan_id, clone_url)

    try:
        result = subprocess.run(
            cmd,
            check=False,
            capture_output=True,
            text=True,
            timeout=REPO_CLONE_TIMEOUT_SECONDS,
        )
    except subprocess.TimeoutExpired as exc:
        raise ValueError(
            "Repository clone timed out. Try a smaller repository."
        ) from exc

    if result.returncode != 0:
        stderr = (result.stderr or "").strip()
        message = stderr[:400] if stderr else "Unknown git clone error"
        raise ValueError(f"Repository clone failed: {message}")

    return {
        "source_url": repo_url.strip(),
        "clone_url": clone_url,
        "repo_path": str(Path(repo_path).resolve()),
    }
