const fs = require('fs');
const path = require('path');
const os = require('os');
const { Readable } = require('stream');
const Groq = require('groq-sdk');

// WebM signature: 0x1A 0x45 0xDF 0xA3 (EBML ID)
const WEBM_SIGNATURE = Buffer.from([0x1A, 0x45, 0xDF, 0xA3]);

function isValidWebM(buffer) {
  if (buffer.length < 4) return false;
  return buffer.slice(0, 4).equals(WEBM_SIGNATURE);
}

async function transcribe(chunks) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("GROQ_API_KEY not configured");

  const combined = Buffer.concat(chunks);

  console.log(`[STT] Combined ${chunks.length} chunks, total size: ${combined.length} bytes`);
  console.log(`[STT] First 16 bytes: ${combined.slice(0, 16).toString('hex')}`);
  console.log(`[STT] Valid WebM header: ${isValidWebM(combined)}`);

  if (combined.length < 100) {
    throw new Error(`Audio file too small: ${combined.length} bytes`);
  }

  // Write to temp file - more reliable than File API
  const tempFile = path.join(os.tmpdir(), `audio_${Date.now()}.webm`);

  try {
    fs.writeFileSync(tempFile, combined);
    console.log(`[STT] Wrote ${combined.length} bytes to temp file: ${tempFile}`);

    const groq = new Groq({ apiKey });

    const result = await groq.audio.transcriptions.create({
      file: fs.createReadStream(tempFile),
      model: 'whisper-large-v3-turbo',
      response_format: 'json',
    });

    return result.text;
  } finally {
    // Clean up temp file
    try {
      fs.unlinkSync(tempFile);
    } catch (e) {
      // Ignore cleanup errors
    }
  }
}

module.exports = { transcribe };
