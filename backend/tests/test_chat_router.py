"""Tests for Orion help chat behavior."""

import unittest
from unittest.mock import patch

from backend.core.data_models import ScanState
from backend.db.scans import scans
from backend.routers import chat_router


class _DummyResponse:
    def __init__(self, content: str):
        self.content = content


class _DummyLLM:
    def __init__(self, content: str):
        self._content = content

    def invoke(self, _messages):
        return _DummyResponse(self._content)


class ChatRouterTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        scans.clear()

    async def test_returns_local_answer_when_llm_refuses(self):
        request = chat_router.ChatRequest(
            message="whats the point of this site?",
            history=[],
            scan_id=None,
        )

        with patch.object(
            chat_router,
            "get_llm",
            return_value=_DummyLLM("I'm sorry, but I can't assist with that request."),
        ):
            response = await chat_router.query_chat(request)

        self.assertFalse(response.llm_used)
        self.assertIn("Orion is an automated security scanning app", response.answer)

    async def test_uses_status_snapshot_with_scan_context(self):
        scan_id = "scan-ctx-1"
        scans[scan_id] = ScanState(
            scan_id=scan_id,
            target="https://scanme.nmap.org",
            status="running",
            current_agent="recon",
        )

        request = chat_router.ChatRequest(
            message="what is the scan status right now?",
            history=[],
            scan_id=scan_id,
        )

        with patch.object(
            chat_router,
            "get_llm",
            side_effect=RuntimeError("llm unavailable"),
        ):
            response = await chat_router.query_chat(request)

        self.assertFalse(response.llm_used)
        self.assertIn("Current scan status: ScanStatus.running", response.answer)
        self.assertIn("Current stage: recon", response.answer)

    async def test_understands_point_of_website_variant(self):
        request = chat_router.ChatRequest(
            message="whats the point of this website?",
            history=[],
            scan_id=None,
        )

        with patch.object(
            chat_router,
            "get_llm",
            return_value=_DummyLLM("I'm sorry, but I can't assist with that request."),
        ):
            response = await chat_router.query_chat(request)

        self.assertFalse(response.llm_used)
        self.assertIn("automated security scanning app", response.answer.lower())


if __name__ == "__main__":
    unittest.main()
