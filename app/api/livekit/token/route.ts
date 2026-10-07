import { AccessToken, RoomConfiguration } from "livekit-server-sdk";
import { requireEnv } from "@/lib/env";
import { ROOM_PREFIX } from "@/lib/livekit";

export async function POST() {
  try {
    const id = crypto.randomUUID().slice(0, 8);
    const room = `${ROOM_PREFIX}${id}`;
    const identity = `user-${id}`;
    const token = new AccessToken(
      requireEnv("LIVEKIT_API_KEY"),
      requireEnv("LIVEKIT_API_SECRET"),
      { identity, ttl: "1h" },
    );
    token.addGrant({
      roomJoin: true,
      room,
      canPublish: true,
      canPublishData: true,
      canSubscribe: true,
    });
    // syncStreams keeps the avatar's audio and video in sync in the browser; the
    // short timeouts close the room (and free the Synthesia session) soon after
    // the visitor leaves.
    token.roomConfig = new RoomConfiguration({
      syncStreams: true,
      emptyTimeout: 30,
      departureTimeout: 15,
    });
    return Response.json({
      url: requireEnv("LIVEKIT_URL"),
      token: await token.toJwt(),
      room,
      identity,
    });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
