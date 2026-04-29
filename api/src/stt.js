const { createClient } = require("@deepgram/sdk");

/**
 * Deepgram Streaming STT implementation.
 * Provides a live transcriber that processes audio chunks in real-time.
 */
function createStreamingTranscriber(onTranscript) {
  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) throw new Error("DEEPGRAM_API_KEY not configured");

  const deepgram = createClient(apiKey);
  
  const connection = deepgram.listen.live({
    model: "nova-2",
    language: "en-IN",
    smart_format: true,
    interim_results: true,
    endpointing: 300, // Detect end of speech after 300ms
  });

  let fullTranscript = "";

  connection.on("Open", () => {
    console.log("[Deepgram] Connection opened");
  });

  connection.on("Results", (data) => {
    const transcript = data.channel.alternatives[0].transcript;
    if (transcript && data.is_final) {
      fullTranscript += " " + transcript;
      if (data.speech_final) {
        onTranscript(fullTranscript.trim());
        fullTranscript = "";
      }
    }
  });

  connection.on("Error", (err) => {
    console.error("[Deepgram] Error:", err);
  });

  return {
    send: (chunk) => {
      if (connection.getReadyState() === 1) {
        connection.send(chunk);
      }
    },
    finish: () => {
      connection.finish();
    }
  };
}

// Keep the batch function as fallback
async function transcribe(chunks) {
  const Groq = require('groq-sdk');
  const apiKey = process.env.GROQ_API_KEY;
  const groq = new Groq({ apiKey });
  
  const combined = Buffer.concat(chunks);
  const audioFile = new File([combined], 'audio.webm', { type: 'audio/webm' });

  const result = await groq.audio.transcriptions.create({
    file: audioFile,
    model: 'whisper-large-v3-turbo',
    response_format: 'json',
  });

  return result.text;
}

module.exports = { transcribe, createStreamingTranscriber };
