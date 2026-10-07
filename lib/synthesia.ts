import { AccessToken } from "livekit-server-sdk";
import { requireEnv } from "./env";
import { ATTRIBUTE_PUBLISH_ON_BEHALF, AVATAR_IDENTITY } from "./livekit";

// Synthesia Interactive Avatars REST API (same calls as Synthesia's LiveKit plugin).
const SYNTHESIA_URL = "https://developers.synthesia.io";
const DEFAULT_AVATAR_ID = "7572faa9-15da-400d-8227-ef1ab8932523"; // Kenji

export class SynthesiaError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function wsUrl(url: string) {
  return url.replace(/^https:/, "wss:").replace(/^http:/, "ws:");
}

/**
 * Starts an avatar session that joins `room` and publishes video, and audio on
 * behalf of `publisherIdentity` (the browser that streams the speech audio).
 */
export async function startAvatarSession(room: string, publisherIdentity: string) {
  const livekitUrl = wsUrl(requireEnv("LIVEKIT_URL"));
  const token = new AccessToken(
    requireEnv("LIVEKIT_API_KEY"),
    requireEnv("LIVEKIT_API_SECRET"),
    {
      identity: AVATAR_IDENTITY,
      name: "Synthesia avatar",
      ttl: "6h",
      attributes: { [ATTRIBUTE_PUBLISH_ON_BEHALF]: publisherIdentity },
    },
  );
  token.kind = "agent";
  token.addGrant({
    roomJoin: true,
    room,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  });

  const rawId = process.env.SYNTHESIA_AVATAR_ID || DEFAULT_AVATAR_ID;
  const res = await fetch(`${SYNTHESIA_URL}/api/interactive-avatars/sessions`, {
    method: "POST",
    cache: "no-store",
    headers: {
      Authorization: requireEnv("SYNTHESIA_API_KEY"),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      avatarIds: [rawId.startsWith("av_") ? rawId : `av_${rawId}`],
      livekitUrl,
      livekitToken: await token.toJwt(),
    }),
  });

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const detail =
      body?.error?.message ?? body?.detail ?? body?.message ?? body?.context ?? body?.error;
    throw new SynthesiaError(
      typeof detail === "string" ? detail : `Synthesia returned ${res.status}`,
      res.status,
    );
  }
  return { sessionId: (body?.sessionId ?? body?.session_id) as string | undefined };
}
