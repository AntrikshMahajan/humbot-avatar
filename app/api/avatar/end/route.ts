import { RoomServiceClient } from "livekit-server-sdk";
import { requireEnv } from "@/lib/env";
import { ROOM_PREFIX } from "@/lib/livekit";

// Closing the room ends the Synthesia session and frees its concurrency slot.
export async function POST(request: Request) {
  // Sent with navigator.sendBeacon, which posts a text/plain body.
  const { room } = JSON.parse(await request.text());
  if (typeof room !== "string" || !room.startsWith(ROOM_PREFIX)) {
    return Response.json({ error: "invalid room" }, { status: 400 });
  }
  try {
    const host = requireEnv("LIVEKIT_URL").replace(/^wss:/, "https:").replace(/^ws:/, "http:");
    const client = new RoomServiceClient(
      host,
      requireEnv("LIVEKIT_API_KEY"),
      requireEnv("LIVEKIT_API_SECRET"),
    );
    await client.deleteRoom(room);
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
