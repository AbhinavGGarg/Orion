"""Application constants."""

import os
from pathlib import Path

DIVIDER = "-" * 80

_DEFAULT_ALLOWED_TARGETS = (
    "target",
    "localhost",
    "127.0.0.1",
    "example.com",
    "scanme.nmap.org",
    "testphp.vulnweb.com",
    "vulnweb.com",
)

_env_allowed_targets = [
    item.strip()
    for item in os.getenv("ALLOWED_TARGETS", "").split(",")
    if item.strip()
]

# Always include built-in demo-safe defaults even when env vars are stale.
ALLOWED_TARGETS = list(dict.fromkeys([*_env_allowed_targets, *_DEFAULT_ALLOWED_TARGETS]))

REPO_CLONE_ROOT = Path(os.getenv("REPO_CLONE_ROOT", "/tmp/orion/repos")).resolve()
REPO_CLONE_TIMEOUT_SECONDS = int(os.getenv("REPO_CLONE_TIMEOUT_SECONDS", "180"))
REPO_CLONE_DEPTH = int(os.getenv("REPO_CLONE_DEPTH", "1"))
