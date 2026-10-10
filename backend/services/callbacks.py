"""LangChain callback for streaming LLM tokens into the scan state store.

Rather than making LLM reasoning invisible, this callback appends each
token to ``ScanState.llm_log`` in real time so the SSE stream can push
it to the frontend as it arrives.
"""

import logging

from langchain_core.callbacks import BaseCallbackHandler

from ..db.scans import scans


class ScanStreamCallback(BaseCallbackHandler):
    """Append each LLM token to the live scan state for SSE streaming.

    Attributes:
        scan_id: Identifier of the running scan.
        agent: Current agent name (eg: "static_c", "secrets").
    """

    def __init__(self, scan_id: str, agent: str) -> None:
        super().__init__()
        self.scan_id = scan_id
        self.agent = agent

    # ------------------------------------------------------------------
    # Token streaming

    def on_llm_new_token(self, token: str, **kwargs) -> None:  # type: ignore[override]
        """Append one streamed token to llm_log."""
        if not self.scan_id or not token:
            return
        state = scans.get(self.scan_id)
        if state is None:
            return
        state.llm_log.append(token)

    # ------------------------------------------------------------------
    # Agent lifecycle markers (visible in the log pane)

    def on_llm_start(self, serialized: dict, prompts: list[str], **kwargs) -> None:  # type: ignore[override]
        """Log an LLM-start marker so the frontend knows reasoning began."""
        state = scans.get(self.scan_id)
        if state is None:
            return
        logging.debug(
            "LLM call started for scan %s agent %s",
            self.scan_id,
            self.agent,
        )
        # Push a sentinel so the frontend can open a new reasoning block.
        state.llm_log.append(f"\x00START:{self.agent}")

    def on_llm_end(self, response, **kwargs) -> None:  # type: ignore[override]
        """Log an LLM-end marker so the frontend can close the reasoning block."""
        state = scans.get(self.scan_id)
        if state is None:
            return
        state.llm_log.append("\x00END")
