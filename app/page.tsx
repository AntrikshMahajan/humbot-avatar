"use client";

import { useEffect, useRef, useState } from "react";
import { Room, RoomEvent, Track, type RemoteTrack } from "livekit-client";
import { AUDIO_STREAM_TOPIC, AVATAR_IDENTITY, TTS_SAMPLE_RATE } from "@/lib/livekit";

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
  const roomName = useRef<string | null>(null);
  const liveRef = useRef(false);
  const speakQueue = useRef<Promise<unknown>>(Promise.resolve());

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

  function endAvatar() {
    const room = roomRef.current;
    roomRef.current = null;
    liveRef.current = false;
    room?.disconnect();
    // Closing the room ends the Synthesia session and frees its slot.
    if (roomName.current) {
      navigator.sendBeacon("/api/avatar/end", JSON.stringify({ room: roomName.current }));
      roomName.current = null;
    }
  }

  useEffect(() => {
    const leave = () => endAvatar();
    window.addEventListener("pagehide", leave);
    return () => {
      window.removeEventListener("pagehide", leave);
      leave();
    };
  }, []);

  async function connectAvatar() {
    setConnection("connecting");
    setStatus("");
    try {
      const { url, token, room: name, identity } = await api<{
        url: string;
        token: string;
        room: string;
        identity: string;
      }>("/api/livekit/token", {});
      // adaptiveStream off so the browser always pulls the avatar at full resolution.
      const room = new Room({ adaptiveStream: false });
      room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
        if (track.kind === Track.Kind.Video && videoRef.current) {
          track.attach(videoRef.current);
          liveRef.current = true;
          setConnection("live");
          setStatus("");
        } else if (track.kind === Track.Kind.Audio && audioRef.current) {
          track.attach(audioRef.current);
        }
      });
      room.on(RoomEvent.AudioPlaybackStatusChanged, () =>
        setAudioBlocked(!room.canPlaybackAudio),
      );
      // The avatar reports playback progress to us over RPC; just acknowledge.
      room.registerRpcMethod("lk.playback_started", async () => "ok");
      room.registerRpcMethod("lk.playback_finished", async () => "ok");
      room.on(RoomEvent.Disconnected, () => setConnection("idle"));
      await room.connect(url, token);
      roomRef.current = room;
      roomName.current = name;
      await room.startAudio().catch(() => setAudioBlocked(true));

      // Ask Synthesia to start the avatar in this room.
      setStatus("Starting your avatar…");
      await api("/api/avatar/session", { room: name, identity });

      // The avatar should publish video within about a minute and a half.
      setTimeout(() => {
        if (roomRef.current === room && !liveRef.current) {
          endAvatar();
          setConnection("idle");
          setStatus("The avatar didn't start in time. Please try again.");
        }
      }, 90_000);
    } catch (err) {
      endAvatar();
      setConnection("idle");
      setStatus((err as Error).message);
    }
  }

  // Streams a spoken reply to the avatar: OpenAI speech (24 kHz mono PCM) is piped
  // through a LiveKit byte stream that the avatar lip-syncs to.
  async function speakNow(text: string) {
    const room = roomRef.current;
    if (!room) return;
    const res = await fetch("/api/tts", { method: "POST", body: JSON.stringify({ text }) });
    if (!res.ok || !res.body) {
      throw new Error((await res.json().catch(() => null))?.error ?? "Text-to-speech failed");
    }
    const writer = await room.localParticipant.streamBytes({
      name: `AUDIO_${Date.now()}`,
      topic: AUDIO_STREAM_TOPIC,
      destinationIdentities: [AVATAR_IDENTITY],
      attributes: { sample_rate: String(TTS_SAMPLE_RATE), num_channels: "1" },
    });
    const reader = res.body.getReader();
    let carry = new Uint8Array(0);
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        let bytes = new Uint8Array(carry.length + value.length);
        bytes.set(carry);
        bytes.set(value, carry.length);
        // Keep samples whole: 16-bit PCM needs an even number of bytes.
        const even = bytes.length - (bytes.length % 2);
        carry = bytes.slice(even);
        bytes = bytes.slice(0, even);
        for (let i = 0; i < bytes.length; i += 9600) {
          await writer.write(bytes.slice(i, i + 9600));
        }
      }
    } finally {
      await writer.close();
    }
  }

  function speak(text: string) {
    // One utterance at a time, in order.
    const next = speakQueue.current.then(() => speakNow(text));
    speakQueue.current = next.catch(() => {});
    return next;
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
            // Overlay the stage and toggle with inline style, so the placeholder
            // layout never depends on the video's size or a utility class.
            style={{ display: connection === "live" ? "block" : "none" }}
            className="absolute inset-0 h-full w-full bg-black object-contain"
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
