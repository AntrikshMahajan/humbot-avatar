import { createSession, listAssistantMessages, sendMessage } from "@/lib/humbot";

export async function POST(request: Request) {
  const { message, sessionId: existing } = await request.json();
  if (typeof message !== "string" || !message.trim()) {
    return Response.json({ error: "message is required" }, { status: 400 });
  }
  try {
    const sessionId: string = existing ?? (await createSession());
    // Remember the newest assistant message so the reply poll can tell old from new.
    const before = await listAssistantMessages(sessionId);
    const baselineAt = before.at(-1)?.created_at ?? null;
    await sendMessage(sessionId, message);
    return Response.json({ sessionId, baselineAt });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
