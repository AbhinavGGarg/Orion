"""FastAPI routes for the floating help chatbot."""

import asyncio
import os
import re
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from langchain_core.messages import HumanMessage

from ..db.scans import scans
from ..services.llm_service import get_llm

router = APIRouter(prefix="/api/chat", tags=["chat"])


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(default="", max_length=8000)


class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=4000)
    history: list[ChatMessage] = []
    scan_id: str | None = None


class ChatResponse(BaseModel):
    answer: str
    llm_used: bool = True


SYSTEM_PROMPT = """
You are the Orion Help Assistant.

Goals:
- Help users run scans, understand statuses, and interpret findings/reports.
- Give practical, concise guidance in plain language.
- Stay honest: if data is missing, say exactly what is missing.

Rules:
- Do not invent scan results, vulnerabilities, or URLs.
- If scan context is available, prioritize it over generic advice.
- Keep answers concise and actionable.
- Default to 2-4 short sentences (around 40-90 words max).
- Never refuse benign product-help questions.
""".strip()


_REFUSAL_PATTERNS = (
    "i can't assist with that",
    "i cannot assist with that",
    "i can't help with that",
    "i cannot help with that",
    "i'm sorry, but i can't",
    "i'm sorry but i can't",
    "cannot comply",
    "can't comply",
    "not able to help with that",
    "unable to assist with that",
)


def _chat_timeout_seconds() -> float:
    raw = os.getenv("CHAT_LLM_TIMEOUT_SECONDS", "6")
    try:
        value = float(raw)
    except ValueError:
        return 9.0
    return max(2.0, min(value, 30.0))


def _summarize_scan_context(scan_id: str | None) -> str:
    if not scan_id:
        return "No scan is currently selected."
    if scan_id not in scans:
        return f"Scan id '{scan_id}' was not found in current runtime memory."

    state = scans[scan_id]
    last_logs = state.log[-5:] if state.log else []
    recent = "\n".join(f"- {line}" for line in last_logs) if last_logs else "- none"

    return (
        f"Scan id: {state.scan_id}\n"
        f"Target: {state.target}\n"
        f"Status: {state.status}\n"
        f"Current agent: {state.current_agent or 'n/a'}\n"
        f"Findings count: {len(state.findings)}\n"
        f"Agents plan: {state.agents_plan}\n"
        f"Recent log lines:\n{recent}"
    )


def _normalize(text: str) -> str:
    return re.sub(r"\s+", " ", text.strip().lower())


def _contains_refusal(answer: str) -> bool:
    normalized = _normalize(answer)
    return any(pattern in normalized for pattern in _REFUSAL_PATTERNS)


def _shorten_answer(answer: str, max_words: int = 70, max_sentences: int = 4) -> str:
    words = answer.split()
    if len(words) <= max_words:
        limited = answer.strip()
    else:
        limited = " ".join(words[:max_words]).strip()

    sentence_parts = re.split(r"(?<=[.!?])\s+", limited)
    if len(sentence_parts) > max_sentences:
        limited = " ".join(sentence_parts[:max_sentences]).strip()

    if limited and limited[-1] not in ".!?":
        limited += "."
    return limited


def _status_snapshot(scan_id: str | None) -> str:
    if not scan_id:
        return (
            "No active scan is linked to this chat right now. "
            "Open a scan page first if you want live status details."
        )
    if scan_id not in scans:
        return (
            f"I can't find scan `{scan_id}` in live memory. "
            "Try refreshing and reopening the scan page."
        )

    state = scans[scan_id]
    return (
        f"Current scan status: {state.status}. "
        f"Current stage: {state.current_agent or 'pending'}. "
        f"Findings so far: {len(state.findings)}."
    )


def _local_help_answer(message: str, scan_id: str | None) -> str:
    text = _normalize(message)

    if any(
        k in text
        for k in (
            "point of this site",
            "point of this website",
            "what is this site",
            "what is this website",
            "what does this site do",
            "what does this website do",
            "what's this website",
            "whats this website",
            "what is orion",
        )
    ):
        return (
            "Orion is an automated security scanning app. "
            "You can scan a website URL or a public GitHub repo, watch agent-by-agent progress, "
            "and get a detailed vulnerability report with findings and remediation guidance."
        )

    if any(k in text for k in ("how do i run", "run a scan", "start a scan", "scan steps")):
        return (
            "To run a scan: 1) paste a website URL or GitHub repo on the homepage, "
            "2) click Run Scan, 3) wait for all agent stages to finish, "
            "4) open the completed scan/report from the progress panel."
        )

    if any(k in text for k in ("status", "progress", "what stage", "is it done", "scan running")):
        return _status_snapshot(scan_id)

    if any(k in text for k in ("why slow", "taking long", "too long", "stuck")):
        return (
            "Long scans are usually caused by deep network checks or model response delays. "
            "Orion now enforces shorter timeouts and fallback paths so progress keeps moving. "
            "If a stage stalls, refresh the scan page and check the latest stage log line."
        )

    if any(k in text for k in ("stream error", "lost connection", "connection lost", "sse", "polling")):
        return (
            "If live stream drops, Orion now falls back to polling automatically. "
            "So scan updates should keep moving instead of freezing."
        )

    if any(k in text for k in ("github", "repo", "repository")):
        return (
            "GitHub scan mode clones the public repo, fingerprints the codebase, runs relevant analysis agents, "
            "then generates a report. Private repos require separate access setup."
        )

    if any(k in text for k in ("report", "findings", "vulnerability", "severity")):
        return (
            "After scan completion, open Detailed Report to review findings by severity, evidence, "
            "attack-chain context, and remediation suggestions."
        )

    return (
        "I can help with running scans, checking status, understanding findings, report navigation, "
        "or troubleshooting connection issues. Ask me one of those and I’ll walk you through it."
    )


def _prefer_local_reply(message: str) -> bool:
    """Route common product-help intents to instant local answers."""
    text = _normalize(message)
    local_keywords = (
        "point of this",
        "what is this",
        "what does this",
        "what is orion",
        "run a scan",
        "start a scan",
        "scan steps",
        "status",
        "progress",
        "stream error",
        "connection lost",
        "github",
        "repo",
        "report",
        "findings",
        "slow",
        "stuck",
        "taking long",
    )
    return any(token in text for token in local_keywords)


async def _invoke_llm_with_timeout(prompt: str) -> str:
    response = await asyncio.wait_for(
        asyncio.to_thread(get_llm().invoke, [HumanMessage(content=prompt)]),
        timeout=_chat_timeout_seconds(),
    )
    return str(response.content or "").strip()


@router.post("/query", response_model=ChatResponse)
async def query_chat(request: ChatRequest) -> ChatResponse:
    """Answer a user help message using the configured Orion LLM provider."""
    user_message = request.message.strip()
    if not user_message:
        raise HTTPException(status_code=400, detail="Chat message cannot be empty.")

    if _prefer_local_reply(user_message):
        return ChatResponse(
            answer=_shorten_answer(_local_help_answer(user_message, request.scan_id)),
            llm_used=False,
        )

    compact_history = [
        f"{item.role}: {item.content.strip()}"
        for item in request.history[-10:]
        if item.content.strip()
    ]
    history_text = "\n".join(compact_history) if compact_history else "No prior messages."
    scan_context = _summarize_scan_context(request.scan_id)

    prompt = (
        f"{SYSTEM_PROMPT}\n\n"
        f"Scan Context:\n{scan_context}\n\n"
        f"Conversation History:\n{history_text}\n\n"
        f"User Message:\n{user_message}\n\n"
        "Assistant Reply:"
    )

    try:
        answer = await _invoke_llm_with_timeout(prompt)
        if not answer or _contains_refusal(answer):
            return ChatResponse(
                answer=_shorten_answer(_local_help_answer(user_message, request.scan_id)),
                llm_used=False,
            )
        return ChatResponse(answer=_shorten_answer(answer), llm_used=True)
    except Exception:  # pylint: disable=broad-except
        return ChatResponse(
            answer=_shorten_answer(_local_help_answer(user_message, request.scan_id)),
            llm_used=False,
        )
