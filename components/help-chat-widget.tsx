"use client";

import { useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { MessageCircle, Send, X } from "lucide-react";
import { apiUrl } from "@/lib/api";

type ChatRole = "user" | "assistant";

interface ChatEntry {
  role: ChatRole;
  content: string;
}

interface ChatResponse {
  answer: string;
  llm_used: boolean;
}

const CHAT_REQUEST_TIMEOUT_MS = 12000;

function extractScanId(pathname: string): string | null {
  const match = pathname.match(/^\/(?:scan|report)\/([^/]+)/);
  return match?.[1] ?? null;
}

function localFallbackAnswer(message: string): string {
  const text = message.trim().toLowerCase();
  if (
    text.includes("point of this site")
    || text.includes("point of this website")
    || text.includes("what does this site do")
    || text.includes("what does this website do")
    || text.includes("what is this website")
    || text.includes("what is polaris")
  ) {
    return "Polaris is an AI security scanner. It checks website URLs and public GitHub repos, shows live stage-by-stage progress, and produces a report with findings plus remediation guidance.";
  }
  if (text.includes("status") || text.includes("progress")) {
    return "Ask me from an active scan page and I can help explain the stage, current status, and what happens next.";
  }
  if (text.includes("slow") || text.includes("stuck") || text.includes("taking long")) {
    return "If a scan feels slow, check the active stage in Agent Progress. Network-heavy checks can take longer, but Polaris now uses tighter timeouts and fallbacks to keep scans moving.";
  }
  if (text.includes("run") || text.includes("start")) {
    return "Paste a website URL or public GitHub repository on the homepage, click Run Scan, then open the completed scan report when the pipeline finishes.";
  }
  return "I can help with running scans, scan status, findings, and reports. Ask me one of those and I’ll give you a quick step-by-step answer.";
}

export function HelpChatWidget() {
  const pathname = usePathname();
  const scanId = useMemo(() => extractScanId(pathname), [pathname]);

  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<ChatEntry[]>([
    {
      role: "assistant",
      content:
        "Need help? Ask me about running scans, scan status, or understanding findings.",
    },
  ]);

  async function sendMessage() {
    const trimmed = input.trim();
    if (!trimmed || loading) return;

    const nextMessages: ChatEntry[] = [...messages, { role: "user", content: trimmed }];
    setMessages(nextMessages);
    setInput("");
    setLoading(true);

    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), CHAT_REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(apiUrl("/api/chat/query"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          message: trimmed,
          history: nextMessages.slice(-10).map((m) => ({ role: m.role, content: m.content })),
          scan_id: scanId,
        }),
      });

      if (!response.ok) {
        throw new Error("Chat request failed.");
      }

      const data: ChatResponse = await response.json();
      setMessages((prev) => [...prev, { role: "assistant", content: data.answer }]);
    } catch (error) {
      const isTimeout = error instanceof DOMException && error.name === "AbortError";
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: isTimeout
            ? localFallbackAnswer(trimmed)
            : "Chat is temporarily unavailable. Please try again in a moment.",
        },
      ]);
    } finally {
      window.clearTimeout(timer);
      setLoading(false);
    }
  }

  return (
    <div className="fixed bottom-5 right-5 z-[70]">
      {open ? (
        <div className="surface-panel flex h-[31rem] w-[22rem] flex-col overflow-hidden border-white/15 bg-[#050c18]/95 shadow-[0_25px_60px_-32px_rgba(34,211,238,0.45)] backdrop-blur-xl">
          <header className="flex items-center justify-between border-b border-white/10 px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-white">Polaris Assistant</p>
              <p className="text-[11px] font-mono uppercase tracking-wider text-cyan-200/75">
                Help & Support
              </p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/15 bg-white/8 text-slate-200 transition-colors hover:bg-white/12"
              aria-label="Close chat"
            >
              <X className="h-4 w-4" />
            </button>
          </header>

          <div className="flex-1 space-y-2 overflow-y-auto px-3 py-3">
            {messages.map((message, index) => (
              <div
                key={`${message.role}-${index}`}
                className={`max-w-[90%] rounded-xl border px-3 py-2 text-sm leading-relaxed ${
                  message.role === "user"
                    ? "ml-auto border-cyan-300/35 bg-cyan-300/12 text-cyan-50"
                    : "mr-auto border-white/12 bg-white/[0.04] text-slate-200"
                }`}
              >
                {message.content}
              </div>
            ))}
            {loading ? (
              <div className="mr-auto inline-flex items-center gap-2 rounded-xl border border-white/12 bg-white/[0.04] px-3 py-2 text-xs text-slate-300">
                <span className="status-dot animate-pulse bg-cyan-300" />
                thinking...
              </div>
            ) : null}
          </div>

          <footer className="border-t border-white/10 p-3">
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void sendMessage();
                  }
                }}
                placeholder="Ask for help..."
                className="h-10 flex-1 rounded-lg border border-white/12 bg-[#070f1d] px-3 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-cyan-300/45"
              />
              <button
                type="button"
                onClick={() => void sendMessage()}
                disabled={!input.trim() || loading}
                className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-cyan-300/35 bg-cyan-300/15 text-cyan-100 transition-colors hover:bg-cyan-300/24 disabled:cursor-not-allowed disabled:opacity-50"
                aria-label="Send message"
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
          </footer>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-2 rounded-full border border-cyan-300/40 bg-cyan-300/18 px-4 py-2 text-sm font-semibold text-cyan-50 shadow-[0_10px_28px_-16px_rgba(34,211,238,0.8)] transition-colors hover:bg-cyan-300/26"
        >
          <MessageCircle className="h-4 w-4" />
          Need Help?
        </button>
      )}
    </div>
  );
}
