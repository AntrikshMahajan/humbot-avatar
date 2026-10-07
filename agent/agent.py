"""LiveKit agent: puts the Synthesia interactive avatar in the room and speaks
whatever text the web app sends on the "speak" data topic (the text comes from Humbot).

Run from this folder:  python agent.py dev
"""

import asyncio
import logging
import os

from dotenv import load_dotenv
from livekit import agents, rtc
from livekit.agents import Agent, AgentSession, JobExecutorType
from livekit.plugins import synthesia
from livekit.plugins import openai

# Share the env files with the Next.js app (.env.local wins over .env).
root = os.path.join(os.path.dirname(__file__), "..")
load_dotenv(os.path.join(root, ".env.local"))
load_dotenv(os.path.join(root, ".env"))

logger = logging.getLogger("humbot-avatar")

SPEAK_TOPIC = "speak"
AGENT_NAME = "synthesia-avatar-agent"  # must match the dispatch in the token route
# Default gallery avatar (Kenji); override with SYNTHESIA_AVATAR_ID.
AVATAR_ID = os.getenv("SYNTHESIA_AVATAR_ID") or "7572faa9-15da-400d-8227-ef1ab8932523"


async def entrypoint(ctx: agents.JobContext):
    await ctx.connect()

    # No STT/LLM on purpose: Humbot is the brain, this only voices its replies.
    session = AgentSession(
        tts=openai.TTS(voice=os.getenv("TTS_VOICE", "alloy"))
    )

    # Attach the avatar BEFORE session.start(); the order matters.
    avatar = synthesia.AvatarSession(
        synthesia.AvatarConfig(avatar_ids=[AVATAR_ID]),
        join_timeout=60,
    )
    # Plans allow few concurrent avatar sessions; a stale one can linger for a
    # while, so wait it out instead of crashing.
    for attempt in range(1, 9):
        try:
            await avatar.start(session, room=ctx.room)
            break
        except synthesia.SynthesiaError as e:
            if not e.retryable or attempt == 8:
                raise
            delay = e.retry_after or 20
            logger.warning("avatar start failed (%s), retrying in %ss", e, delay)
            await asyncio.sleep(delay)
    await session.start(
        agent=Agent(instructions="Speak only the text you are given."),
        room=ctx.room,
    )

    @ctx.room.on("data_received")
    def on_data(packet: rtc.DataPacket):
        if packet.topic != SPEAK_TOPIC:
            return
        text = packet.data.decode("utf-8").strip()
        if text:
            session.say(text)


if __name__ == "__main__":
    agents.cli.run_app(
        agents.WorkerOptions(
            entrypoint_fnc=entrypoint,
            agent_name=AGENT_NAME,
            # Hosts like Render health-check the port in $PORT, so serve on it.
            # One avatar session at a time, so skip the pool of pre-warmed worker
            # processes (4 by default in production) that needs well over 512 MB.
            num_idle_processes=0,
            job_executor_type=JobExecutorType.THREAD,
            host="0.0.0.0",
            **({"port": int(os.environ["PORT"])} if os.getenv("PORT") else {}),
        )
    )
