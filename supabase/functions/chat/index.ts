import { createChatHandler } from "./handler.ts";

Deno.serve(createChatHandler({
  url: Deno.env.get("SUPABASE_URL") || "",
  anonKey: Deno.env.get("SUPABASE_ANON_KEY") || "",
  groqKey: Deno.env.get("GROQ_API_KEY") || "",
  model: Deno.env.get("GROQ_MODEL") || "openai/gpt-oss-120b",
}));
