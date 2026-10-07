import {
  AccessToken,
  RoomAgentDispatch,
  RoomConfiguration,
} from "livekit-server-sdk";
import { requireEnv } from "@/lib/env";

export async function POST() {
  try {
    const id = crypto.randomUUID().slice(0, 8);
    const room = `humbot-avatar-${id}`;
    const token = new AccessToken(
      requireEnv("LIVEKIT_API_KEY"),
      requireEnv("LIVEKIT_API_SECRET"),
      { identity: `user-${id}`, ttl: "1h" },
    );
    token.addGrant({ roomJoin: true, room, canPublish: false, canPublishData: true, canSubscribe: true });
    // Explicit dispatch: the named worker joins only this room. sync_streams keeps
    // the avatar's audio and video in sync in the browser.
    token.roomConfig = new RoomConfiguration({
      agents: [new RoomAgentDispatch({ agentName: "synthesia-avatar-agent" })],
      syncStreams: true,
    });
    return Response.json({
      url: requireEnv("LIVEKIT_URL"),
      token: await token.toJwt(),
      room,
    });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
