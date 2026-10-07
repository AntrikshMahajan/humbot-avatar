// Shared constants for the Synthesia interactive avatar over LiveKit.
// The avatar worker joins the room under this identity and answers on it.
export const AVATAR_IDENTITY = "synthesia-avatar-agent";
export const ROOM_PREFIX = "humbot-avatar-";
// LiveKit byte-stream topic the avatar worker reads speech audio from.
export const AUDIO_STREAM_TOPIC = "lk.audio_stream";
// Participant attribute naming whose audio the avatar publishes on behalf of.
export const ATTRIBUTE_PUBLISH_ON_BEHALF = "lk.publish_on_behalf";
// OpenAI "pcm" TTS output: 24 kHz, 16-bit little-endian, mono.
export const TTS_SAMPLE_RATE = 24000;
