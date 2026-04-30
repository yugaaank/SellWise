const { Agent, setGlobalDispatcher } = require("undici");

// High-performance connection pooling for Sarvam API
const dispatcher = new Agent({
  keepAliveTimeout: 60000,
  keepAliveMaxTimeout: 60000,
  maxSockets: 100,
  pipelining: 10
});
setGlobalDispatcher(dispatcher);

async function synthesize(text) {
  const apiKey = process.env.SARVAM_API_KEY;
  if (!apiKey) throw new Error("SARVAM_API_KEY not configured");

  const response = await fetch("https://api.sarvam.ai/text-to-speech", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-subscription-key": apiKey,
    },
    body: JSON.stringify({
      inputs: [text],
      target_language_code: "hi-IN",
      speaker: "shubh",
      model: "bulbul:v3",
      pace: 1.0,
      speech_sample_rate: 24000,
      output_audio_codec: "linear16",
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
    body: JSON.stringify({
      text,
      target_language_code: "hi-IN",
      speaker: "shubh",
      model: "bulbul:v3",
      pace: 1.0,
      speech_sample_rate: 24000,
      output_audio_codec: "linear16",
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
    // Check for abort signal during streaming (for barge-in)
    if (signal?.aborted) {
      reader.cancel();
      throw new Error("TTS aborted");
    }
    
    const { done, value } = await reader.read();
    if (done) break;
    await onChunk(value);
  }
}

module.exports = { synthesize, synthesizeStream };
