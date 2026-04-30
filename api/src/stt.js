const Groq = require('groq-sdk');

async function transcribe(chunks) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("GROQ_API_KEY not configured");
  
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

module.exports = { transcribe };
