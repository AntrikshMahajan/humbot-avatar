import { requireEnv } from "./env";

export type HumbotMessage = {
  id: string;
  created_at: string | null;
  author: "user" | "assistant";
  content: string;
  error: { message?: string | null } | null;
};

async function humbot<T>(path: string, init?: RequestInit): Promise<T> {
  const base = requireEnv("HUMBOT_API_BASE_URL").replace(/\/$/, "");
  const res = await fetch(`${base}${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${requireEnv("HUMBOT_API_KEY")}`,
    },
  });
  if (!res.ok) {
    throw new Error(`Humbot ${path} failed (${res.status}): ${await res.text()}`);
  }
  return res.json() as Promise<T>;
}

export async function createSession(title = "Avatar chat") {
  const session = await humbot<{ id: string }>("/cowork-sessions", {
    method: "POST",
    body: JSON.stringify({ bot_id: requireEnv("HUMBOT_BOT_ID"), title }),
  });
  return session.id;
}

export function sendMessage(sessionId: string, message: string) {
  return humbot<{ accepted: boolean; run_id: string | null }>(
    `/cowork-sessions/${sessionId}/chat`,
    { method: "POST", body: JSON.stringify({ message }) },
  );
}

export async function listAssistantMessages(sessionId: string) {
  const { results } = await humbot<{ results: HumbotMessage[] }>(
    `/cowork-sessions/${sessionId}/messages?author=assistant&per_page=20`,
  );
  return results
    .filter((m) => m.author === "assistant" && m.created_at)
    .sort((a, b) => a.created_at!.localeCompare(b.created_at!));
}
