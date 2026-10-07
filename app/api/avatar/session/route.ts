import { ROOM_PREFIX } from "@/lib/livekit";
import { startAvatarSession, SynthesiaError } from "@/lib/synthesia";

// Synthesia may take a while to cold-start the avatar worker.
export const maxDuration = 60;

export async function POST(request: Request) {
  const { room, identity } = await request.json();
  if (
    typeof room !== "string" ||
    !room.startsWith(ROOM_PREFIX) ||
    typeof identity !== "string" ||
    !identity.startsWith("user-")
  ) {
    return Response.json({ error: "invalid room or identity" }, { status: 400 });
  }
  try {
    return Response.json(await startAvatarSession(room, identity));
  } catch (e) {
    const status = e instanceof SynthesiaError ? e.status : 500;
    return Response.json({ error: (e as Error).message }, { status });
  }
}
