const { Agent } = require("https");

// Persistent agent to reuse TLS connections
const httpsAgent = new Agent({
  keepAlive: true,
  maxSockets: 10,
  timeout: 60000
});

async function synthesize(text) {
  const apiKey = process.env.SARVAM_API_KEY;
  if (!apiKey) throw new Error("SARVAM_API_KEY not configured");

  const response = await fetch("https://api.sarvam.ai/text-to-speech", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-subscription-key": apiKey,
    },
    // keepalive property for Node 18+ global fetch
    keepalive: true,
    body: JSON.stringify({
      inputs: [text],
      target_language_code: "hi-IN",
      speaker: "shubh",
      model: "bulbul:v3",
      pace: 1.0,
      speech_sample_rate: 24000,
      output_audio_codec: "pcm", // raw PCM is best for streaming
      enable_preprocessing: false,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Sarvam TTS ${response.status}: ${body}`);
  }

  const data = await response.json();
  return Buffer.from(data.audios[0], "base64");
}

async function synthesizeStream(text, onChunk, signal) {
  const apiKey = process.env.SARVAM_API_KEY;
  if (!apiKey) throw new Error("SARVAM_API_KEY not configured");

  const response = await fetch("https://api.sarvam.ai/text-to-speech/stream", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-subscription-key": apiKey,
    },
    keepalive: true,
    body: JSON.stringify({
      text,
      target_language_code: "hi-IN",
      speaker: "shubh",
      model: "bulbul:v3",
      pace: 1.0,
      speech_sample_rate: 24000,
      output_audio_codec: "pcm", // raw PCM is best for streaming
      enable_preprocessing: false,
    }),
    signal,
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Sarvam TTS stream ${response.status}: ${body}`);
  }

  const reader = response.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    await onChunk(value);
  }
}

module.exports = { synthesize, synthesizeStream };
