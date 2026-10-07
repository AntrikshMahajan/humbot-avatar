"use client";

import { useEffect, useRef, useState } from "react";
import { Room, RoomEvent, Track, type RemoteTrack } from "livekit-client";

type Turn = { role: "user" | "assistant"; text: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function api<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(
    url,
    body ? { method: "POST", body: JSON.stringify(body) } : undefined,
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Request failed");
  return data;
}

export default function Home() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState("");
  const [connection, setConnection] = useState<"idle" | "connecting" | "live">(
    "idle",
  );
  const [busy, setBusy] = useState(false);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const sessionId = useRef<string | null>(null);
  const roomRef = useRef<Room | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => () => void roomRef.current?.disconnect(), []);

  async function waitForReply(baselineAt: string | null) {
    let last = "";
    for (let i = 0; i < 90; i++) {
      await sleep(2000);
      const qs = new URLSearchParams({
        sessionId: sessionId.current!,
        baselineAt: baselineAt ?? "",
      });
      const { content } = await api<{ content: string | null }>(
        `/api/chat/reply?${qs}`,
      );
      // Treat the reply as final once it stops changing between polls.
      if (content && content === last) return content;
      last = content ?? "";
    }
    throw new Error("Humbot took too long to reply");
  }

  async function connectAvatar() {
    setConnection("connecting");
    try {
      const { url, token } = await api<{ url: string; token: string }>(
        "/api/livekit/token",
        {},
      );
      // adaptiveStream off so the browser always pulls the avatar at full resolution.
      const room = new Room({ adaptiveStream: false });
      room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
        if (track.kind === Track.Kind.Video && videoRef.current) {
          track.attach(videoRef.current);
          setConnection("live");
        } else if (track.kind === Track.Kind.Audio && audioRef.current) {
          track.attach(audioRef.current);
        }
      });
      room.on(RoomEvent.AudioPlaybackStatusChanged, () =>
        setAudioBlocked(!room.canPlaybackAudio),
      );
      room.on(RoomEvent.Disconnected, () => setConnection("idle"));
      await room.connect(url, token);
      roomRef.current = room;
      await room.startAudio().catch(() => setAudioBlocked(true));
      // The agent should publish the avatar video within about a minute.
      setTimeout(() => {
        if (roomRef.current === room && !room.remoteParticipants.size) {
          room.disconnect();
          roomRef.current = null;
          setStatus(
            "The avatar agent didn't join. Make sure `python agent.py dev` is running, then try again.",
          );
        }
      }, 60_000);
    } catch (err) {
      setConnection("idle");
      setStatus((err as Error).message);
    }
  }

  async function speak(text: string) {
    const room = roomRef.current;
    if (!room) return;
    await room.localParticipant.publishData(new TextEncoder().encode(text), {
      reliable: true,
      topic: "speak",
    });
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const message = input.trim();
    if (!message || busy) return;
    setInput("");
    setBusy(true);
    // Sending is a user gesture, so the browser lets the avatar's audio play now.
    roomRef.current?.startAudio().catch(() => setAudioBlocked(true));
    setTurns((t) => [...t, { role: "user", text: message }]);
    try {
      setStatus("Humbot is thinking…");
      const sent = await api<{ sessionId: string; baselineAt: string | null }>(
        "/api/chat",
        { message, sessionId: sessionId.current },
      );
      sessionId.current = sent.sessionId;
      const reply = await waitForReply(sent.baselineAt);
      setTurns((t) => [...t, { role: "assistant", text: reply }]);

      await speak(reply);
      setStatus("");
    } catch (err) {
      setStatus((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns, busy]);

  return (
    <main className="mx-auto grid h-dvh w-full max-w-6xl gap-4 p-4 lg:grid-cols-[1.2fr_1fr]">
      <section className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
        <header className="flex items-center gap-2 border-b border-border px-5 py-3">
          <span className="h-2.5 w-2.5 rounded-full bg-accent" />
          <h1 className="text-sm font-semibold tracking-wide">Humbot Avatar</h1>
        </header>
        <div className="relative flex flex-1 items-center justify-center bg-surface-2">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            className={`h-full w-full bg-black object-contain ${
              connection === "live" ? "" : "hidden"
            }`}
          />
          <audio ref={audioRef} autoPlay />
          {audioBlocked && connection === "live" && (
            <button
              onClick={() =>
                roomRef.current
                  ?.startAudio()
                  .then(() => setAudioBlocked(false))
                  .catch(() => {})
              }
              className="absolute right-3 top-3 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg shadow"
            >
              🔊 Enable sound
            </button>
          )}
          {connection !== "live" && (
            <div className="flex flex-col items-center gap-3 px-6 text-center text-muted">
              <div
                className={`flex h-24 w-24 items-center justify-center rounded-full bg-accent/15 text-4xl ${
                  connection === "connecting" ? "animate-pulse" : ""
                }`}
              >
                🧑‍💼
              </div>
              <p className="text-sm">
                {connection === "connecting"
                  ? "Connecting your avatar…"
                  : "Start a live session to talk to your avatar."}
              </p>
              {connection === "idle" && (
                <button
                  onClick={connectAvatar}
                  className="rounded-xl bg-accent px-5 py-2.5 text-sm font-medium text-accent-fg"
                >
                  Start avatar
                </button>
              )}
            </div>
          )}
        </div>
      </section>

      <section className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
        <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-5">
          {turns.length === 0 && (
            <p className="m-auto text-center text-sm text-muted">
              Conversation will appear here.
            </p>
          )}
          {turns.map((t, i) => (
            <p
              key={i}
              className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                t.role === "user"
                  ? "self-end rounded-br-md bg-accent text-accent-fg"
                  : "self-start rounded-bl-md bg-surface-2"
              }`}
            >
              {t.text}
            </p>
          ))}
          {busy && (
            <div className="flex gap-1 self-start rounded-2xl rounded-bl-md bg-surface-2 px-4 py-3">
              <span className="dot h-1.5 w-1.5 rounded-full bg-muted" />
              <span className="dot h-1.5 w-1.5 rounded-full bg-muted" />
              <span className="dot h-1.5 w-1.5 rounded-full bg-muted" />
            </div>
          )}
          <div ref={endRef} />
        </div>
        {status && (
          <p className={`px-5 pb-2 text-xs ${busy ? "text-muted" : "text-red-600"}`}>
            {status}
          </p>
        )}
        <form onSubmit={send} className="flex gap-2 border-t border-border p-3">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask Humbot…"
            className="flex-1 rounded-xl border border-border bg-surface-2 px-4 py-2.5 text-sm text-foreground outline-none placeholder:text-muted focus:border-accent"
          />
          <button
            disabled={busy || !input.trim()}
            className="rounded-xl bg-accent px-5 py-2.5 text-sm font-medium text-accent-fg transition-opacity disabled:opacity-40"
          >
            Send
          </button>
        </form>
      </section>
    </main>
  );
}
