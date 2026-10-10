"""In-memory store for active scans."""

from ..core.data_models import ScanState

scans: dict[str, ScanState] = {}
