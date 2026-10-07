import { listAssistantMessages } from "@/lib/humbot";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const sessionId = params.get("sessionId");
  const baselineAt = params.get("baselineAt");
  if (!sessionId) return Response.json({ error: "sessionId is required" }, { status: 400 });
  try {
    const fresh = (await listAssistantMessages(sessionId)).filter(
      (m) => !baselineAt || m.created_at! > baselineAt,
    );
    const latest = fresh.at(-1);
    if (latest?.error) {
      return Response.json(
        { error: latest.error.message ?? "Humbot run failed" },
        { status: 502 },
      );
    }
    return Response.json({ content: latest?.content ?? null });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
