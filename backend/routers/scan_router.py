"""FastAPI routes for scans."""

import asyncio
import os
import uuid
from urllib.parse import urlparse

from fastapi import APIRouter, BackgroundTasks, HTTPException
from sse_starlette.sse import EventSourceResponse

from ..core.constants import ALLOWED_TARGETS, REPO_CLONE_ROOT
from ..core.data_models import ScanRequest, ScanResponse, ScanState, ScanStatus
from ..db.scans import scans
from ..services.repo_ingest_service import is_github_repo_url
from ..services.scan_service import run_scan_background

router = APIRouter(prefix="/api", tags=["scans"])


def _validate_target(target: str) -> None:
    clone_root = str(REPO_CLONE_ROOT)

    if is_github_repo_url(target):
        return

    if (
        target.startswith("/repos/")
        or target.startswith("/tmp/")
        or target.startswith(f"{clone_root}/")
    ):
        return

    host = urlparse(target).hostname or ""
    scheme = (urlparse(target).scheme or "").lower()
    if scheme not in {"http", "https"}:
        raise HTTPException(
            status_code=400,
            detail="Target must be a valid http(s) URL, public GitHub repo URL, or mounted local path.",
        )
    if not host:
        raise HTTPException(status_code=400, detail="Could not parse target host")
    enforce_allowlist = os.getenv("ENFORCE_TARGET_ALLOWLIST", "false").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }
    if enforce_allowlist and not any(host == t or host.endswith(f".{t}") for t in ALLOWED_TARGETS):
        raise HTTPException(
            status_code=400,
            detail=f"Target '{host}' is not in the allowlist. Allowed: {ALLOWED_TARGETS}",
        )


@router.post("/scan", response_model=ScanResponse)
async def start_scan(
    body: ScanRequest, background_tasks: BackgroundTasks
) -> ScanResponse:
    """Start a new automated penetration test scan."""
    _validate_target(body.target)
    scan_id = str(uuid.uuid4())
    scans[scan_id] = ScanState(scan_id=scan_id, target=body.target)
    background_tasks.add_task(run_scan_background, scan_id, body.target)
    return ScanResponse(scan_id=scan_id)


@router.get("/scan/{scan_id}", response_model=ScanState)
async def get_scan(scan_id: str) -> ScanState:
    """Get current scan state including findings so far."""
    if scan_id not in scans:
        raise HTTPException(status_code=404, detail="Scan not found")
    return scans[scan_id]


@router.get("/scan/{scan_id}/stream")
async def stream_scan(scan_id: str):
    """Server-Sent Events stream — pushes scan state updates every second."""
    if scan_id not in scans:
        raise HTTPException(status_code=404, detail="Scan not found")

    async def generator():
        while True:
            state = scans.get(scan_id)
            if state is None:
                break
            yield {"data": state.model_dump_json()}
            if state.status in (ScanStatus.complete, ScanStatus.failed):
                break
            await asyncio.sleep(1)

    return EventSourceResponse(generator())


@router.get("/scan/{scan_id}/report")
async def get_report(scan_id: str) -> dict:
    """Get the final Markdown vulnerability report."""
    if scan_id not in scans:
        raise HTTPException(status_code=404, detail="Scan not found")
    return {"report": scans[scan_id].report, "status": scans[scan_id].status}


@router.get("/scans")
async def list_scans() -> list[dict]:
    """List all scans (summary only)."""
    return [
        {
            "scan_id": s.scan_id,
            "target": s.target,
            "status": s.status,
            "findings_count": len(s.findings),
        }
        for s in scans.values()
    ]
