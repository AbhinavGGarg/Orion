"""Background scan executor."""

import asyncio
import time

from ..core.data_models import ScanStatus
from ..db.scans import scans
from .graph_service import SCAN_GRAPH, GraphState
from .repo_ingest_service import clone_public_github_repo, is_github_repo_url


def _resolve_target(scan_id: str, target: str) -> str:
    """Resolve scan target into a runtime-accessible path or URL.

    Args:
        scan_id: Scan identifier
        target: Original target value from API request

    Returns:
        Target value to pass to planner and graph execution
    """
    state = scans[scan_id]

    if not is_github_repo_url(target):
        state.resolved_target = target
        return target

    state.log.append("Importing public GitHub repository...")
    clone_info = clone_public_github_repo(scan_id=scan_id, repo_url=target)

    state.source_repo_url = clone_info["source_url"]
    state.resolved_target = clone_info["repo_path"]
    state.log.append(f"Repository imported to: {state.resolved_target}")
    return state.resolved_target


async def run_scan_background(scan_id: str, target: str) -> None:
    """Execute the scan graph in a background thread."""
    state = scans[scan_id]
    state.status = ScanStatus.running
    state.started_at = time.time()
    state.log.append(f"Scan started for target: {target}")

    try:
        resolved_target = _resolve_target(scan_id=scan_id, target=target)
        if resolved_target != target:
            state.log.append("Running analysis on imported repository snapshot")

        await asyncio.to_thread(
            SCAN_GRAPH.invoke,
            GraphState(
                scan_id=scan_id,
                target=resolved_target,
                display_target=target,
            ),
        )
        # report + status are set inside graph_service.py report_node
    except (OSError, RuntimeError, ValueError) as e:
        state.status = ScanStatus.failed
        state.log.append(f"Scan failed: {e!r}")
