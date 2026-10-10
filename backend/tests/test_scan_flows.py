"""End-to-end smoke tests for scan pipeline behavior."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.core.data_models import ScanState
from backend.db.scans import scans
from backend.services import graph_service, scan_service
from backend.services.planner_service import ScanPlan, plan


class _DummyResponse:
    def __init__(self, content: str):
        self.content = content


class _DummyLLM:
    def with_config(self, _cfg):
        return self

    def invoke(self, messages):
        text = "\n".join(str(getattr(msg, "content", msg)) for msg in messages)
        lower = text.lower()

        if "construct the attack chain graph" in lower or "attack chain" in lower:
            return _DummyResponse(
                json.dumps(
                    {
                        "nodes": [
                            {
                                "id": "node_1",
                                "label": "Surface Observation",
                                "type": "service",
                                "finding_ref": "Demonstration finding",
                            }
                        ],
                        "edges": [],
                        "narrative": "Single-step observation chain for demo output.",
                        "mermaid": 'flowchart LR\n  node_1["Surface Observation"]',
                    }
                )
            )

        if "agent:" in lower and "output:" in lower:
            return _DummyResponse(
                json.dumps(
                    [
                        {
                            "severity": "low",
                            "title": "Demonstration finding",
                            "description": (
                                "Mock parser produced one finding for pipeline validation."
                            ),
                            "evidence": "mock-evidence",
                            "remediation": "mock-remediation",
                            "component": "Mock Component",
                        }
                    ]
                )
            )

        return _DummyResponse(
            "# Vulnerability Report -- mock\n\n## Executive Summary\n"
            "Pipeline validation report."
        )


class _DummyTool:
    def __init__(self, fn):
        self._fn = fn

    def invoke(self, args):
        return self._fn(args)


class ScanFlowSmokeTests(unittest.IsolatedAsyncioTestCase):
    """Validate both URL and repo scan flows complete with useful output."""

    def setUp(self):
        scans.clear()

    async def test_url_scan_produces_findings_and_report(self):
        scan_id = "test-url-scan"
        scans[scan_id] = ScanState(scan_id=scan_id, target="https://scanme.nmap.org")

        with patch.object(graph_service, "get_llm", return_value=_DummyLLM()), patch.object(
            graph_service,
            "run_httpx",
            _DummyTool(
                lambda _args: {
                    "results": [
                        {
                            "status-code": 200,
                            "title": "Example Domain",
                            "content-type": "text/html",
                            "webserver": "ECS",
                            "tech": ["ECS", "HTTP/2"],
                        }
                    ],
                    "error": "",
                }
            ),
        ), patch.object(
            graph_service,
            "run_nmap",
            _DummyTool(lambda _args: {"output": "", "error": ""}),
        ), patch.object(
            graph_service,
            "run_whatweb",
            _DummyTool(lambda _args: {"output": "[]", "error": ""}),
        ):
            await scan_service.run_scan_background(scan_id, "https://scanme.nmap.org")

        state = scans[scan_id]
        self.assertEqual(state.status.value, "complete")
        self.assertGreaterEqual(len(state.findings), 1)
        self.assertTrue(state.report.strip())
        self.assertTrue(any("Recon complete" in log_line for log_line in state.log))

    async def test_repo_scan_path_resolves_and_completes(self):
        with tempfile.TemporaryDirectory() as td:
            repo_root = Path(td)
            (repo_root / "app.py").write_text("print('hello')\n", encoding="utf-8")

            scan_id = "test-repo-url"
            target = "https://github.com/acme/demo-repo"
            scans[scan_id] = ScanState(scan_id=scan_id, target=target)

            with patch.object(graph_service, "get_llm", return_value=_DummyLLM()), patch.object(
                graph_service,
                "plan",
                return_value=ScanPlan(
                    target_type="repo",
                    architecture_summary="Mock Repo",
                    threat_model="Mock threat model",
                    agents=["static"],
                ),
            ), patch.object(
                graph_service,
                "run_bandit",
                _DummyTool(lambda _args: {"output": "issue: insecure call", "error": ""}),
            ), patch.object(
                graph_service,
                "run_semgrep",
                _DummyTool(
                    lambda _args: {
                        "results": [{"check_id": "x", "extra": {"message": "x"}}],
                        "error": "",
                    }
                ),
            ), patch.object(
                scan_service,
                "is_github_repo_url",
                side_effect=lambda value: value.startswith("https://github.com/"),
            ), patch.object(
                scan_service,
                "clone_public_github_repo",
                return_value={
                    "source_url": target,
                    "repo_path": str(repo_root),
                },
            ):
                await scan_service.run_scan_background(scan_id, target)

        state = scans[scan_id]
        self.assertEqual(state.status.value, "complete")
        self.assertEqual(state.target_type, "repo")
        self.assertEqual(state.resolved_target, str(repo_root))
        self.assertGreaterEqual(len(state.findings), 1)
        self.assertTrue(state.report.strip())

    async def test_url_planner_uses_deterministic_fast_order(self):
        with patch(
            "backend.services.planner_service._fingerprint_url",
            return_value="Target URL: https://scanme.nmap.org",
        ):
            generated = plan("https://scanme.nmap.org")

        self.assertEqual(generated.target_type, "url")
        self.assertEqual(generated.agents[:3], ["recon", "sqli", "xss"])
        self.assertEqual(generated.agents[-2:], ["attack_chain", "report"])

    async def test_url_scan_generates_observation_results_when_clean(self):
        scan_id = "test-url-clean-observations"
        target = "https://scanme.nmap.org"
        scans[scan_id] = ScanState(scan_id=scan_id, target=target)

        with patch.object(graph_service, "get_llm", return_value=_DummyLLM()), patch.object(
            graph_service,
            "plan",
            return_value=ScanPlan(
                target_type="url",
                architecture_summary="Mock URL",
                threat_model="Mock threat model",
                agents=["recon", "sqli", "xss"],
            ),
        ), patch.object(
            graph_service,
            "_llm_interpret",
            return_value=[],
        ), patch.object(
            graph_service,
            "_probe_url_headers",
            return_value={
                "status": 200,
                "final_url": target,
                "headers": {},
                "error": "",
            },
        ), patch.object(
            graph_service,
            "run_httpx",
            _DummyTool(
                lambda _args: {
                    "results": [{"status-code": 200, "title": "Example Domain"}],
                    "error": "",
                }
            ),
        ), patch.object(
            graph_service,
            "run_nmap",
            _DummyTool(lambda _args: {"output": "80/tcp open http", "error": ""}),
        ), patch.object(
            graph_service,
            "run_whatweb",
            _DummyTool(lambda _args: {"output": "[]", "error": ""}),
        ), patch.object(
            graph_service,
            "run_sqlmap",
            _DummyTool(lambda _args: {"output": "not injectable", "vulnerable": False}),
        ), patch.object(
            graph_service,
            "run_dalfox",
            _DummyTool(lambda _args: {"output": "no xss", "vulnerable": False}),
        ):
            await scan_service.run_scan_background(scan_id, target)

        state = scans[scan_id]
        self.assertEqual(state.status.value, "complete")
        self.assertGreaterEqual(len(state.findings), 1)
        severities = {f.severity.value for f in state.findings}
        self.assertIn("info", severities)
        self.assertIn("low", severities)


if __name__ == "__main__":
    unittest.main()  # pragma: no cover
