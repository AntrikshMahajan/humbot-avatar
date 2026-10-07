import { requireEnv } from "@/lib/env";

// Streams raw 24 kHz 16-bit mono PCM speech straight from OpenAI to the browser,
// which forwards it to the avatar.
export async function POST(request: Request) {
  const { text } = await request.json();
  if (typeof text !== "string" || !text.trim()) {
    return Response.json({ error: "text is required" }, { status: 400 });
  }
  try {
    const upstream = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${requireEnv("OPENAI_API_KEY")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini-tts",
        voice: process.env.TTS_VOICE || "alloy",
        input: text,
        response_format: "pcm",
      }),
    });
    if (!upstream.ok || !upstream.body) {
      return Response.json(
        { error: `OpenAI TTS failed (${upstream.status}): ${await upstream.text()}` },
        { status: 502 },
      );
    }
    return new Response(upstream.body, {
      headers: { "Content-Type": "application/octet-stream", "Cache-Control": "no-store" },
    });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
