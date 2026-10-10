import json
import os
import unittest
from unittest.mock import patch

import httpx
from langchain_core.messages import HumanMessage

from backend.services.llm_service import get_llm


class GroqProviderTests(unittest.TestCase):
    def setUp(self):
        env = patch.dict(os.environ)
        env.start()
        self.addCleanup(env.stop)
        for name in list(os.environ):
            if name.startswith(("LLM_", "GROQ_", "OPENAI_", "OLLAMA_")):
                del os.environ[name]
        os.environ.update({
            "LLM_PROVIDER": "groq",
            "GROQ_API_KEY": "test-groq-key",
            "OPENAI_API_KEY": "test-openai-key",
            "OPENAI_BASE_URL": "https://unrelated.invalid/v1",
        })

    def test_invocation_uses_groq_endpoint_and_credentials(self):
        def reply(request, **_kwargs):
            self.assertEqual(str(request.url), "https://api.groq.com/openai/v1/chat/completions")
            self.assertEqual(request.headers["authorization"], "Bearer test-groq-key")
            payload = json.loads(request.content)
            self.assertEqual(payload["model"], "openai/gpt-oss-120b")
            self.assertEqual(payload["messages"], [{"role": "user", "content": "Explain TLS."}])
            return httpx.Response(200, request=request, json={
                "id": "chat-test",
                "object": "chat.completion",
                "created": 0,
                "model": payload["model"],
                "choices": [{
                    "index": 0,
                    "message": {"role": "assistant", "content": "TLS encrypts traffic."},
                    "finish_reason": "stop",
                }],
            })

        with patch.object(httpx.Client, "send", side_effect=reply):
            answer = get_llm().invoke([HumanMessage(content="Explain TLS.")])
        self.assertEqual(answer.content, "TLS encrypts traffic.")

    def test_streaming_returns_content_chunks(self):
        def reply(request, **_kwargs):
            self.assertTrue(json.loads(request.content)["stream"])
            events = []
            for token in ["TLS ", "encrypts traffic."]:
                events.append("data: " + json.dumps({
                    "id": "chat-stream",
                    "object": "chat.completion.chunk",
                    "created": 0,
                    "model": "openai/gpt-oss-120b",
                    "choices": [{"index": 0, "delta": {"content": token}, "finish_reason": None}],
                }))
            body = "\n\n".join([*events, "data: [DONE]", ""])
            return httpx.Response(200, request=request, text=body, headers={
                "content-type": "text/event-stream",
            })

        with patch.object(httpx.Client, "send", side_effect=reply):
            chunks = list(get_llm().stream([HumanMessage(content="Explain TLS.")]))
        self.assertEqual("".join(chunk.content for chunk in chunks), "TLS encrypts traffic.")

    def test_model_and_timeout_overrides(self):
        with patch.dict(os.environ, {"GROQ_MODEL": "custom-groq-model", "GROQ_REQUEST_TIMEOUT_SECONDS": "45"}):
            configured = get_llm()
            self.assertEqual(configured.model_name, "custom-groq-model")
            self.assertEqual(configured.request_timeout, 45)
            self.assertEqual(get_llm(request_timeout=90).request_timeout, 90)

    def test_missing_groq_key_does_not_fall_back_to_openai_key(self):
        for missing_key in [None, ""]:
            with self.subTest(key=missing_key):
                if missing_key is None:
                    os.environ.pop("GROQ_API_KEY", None)
                else:
                    os.environ["GROQ_API_KEY"] = missing_key
                with self.assertRaisesRegex(ValueError, "Set GROQ_API_KEY"):
                    get_llm()

    def test_existing_providers_keep_their_configuration(self):
        with patch.dict(os.environ, {"LLM_PROVIDER": "openai", "OPENAI_MODEL": "custom-openai-model"}):
            configured = get_llm()
            self.assertEqual(configured.model_name, "custom-openai-model")
            self.assertEqual(configured.openai_api_base, "https://unrelated.invalid/v1")
        os.environ.pop("LLM_PROVIDER")
        self.assertEqual(get_llm().model, "llama3.1:8b")


if __name__ == "__main__":
    unittest.main()
