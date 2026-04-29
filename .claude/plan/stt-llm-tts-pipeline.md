# Implementation Plan: STT → LLM → TTS Pipeline

## Task Type
- [x] Fullstack (Backend heavy + Frontend audio playback)

## Free API Stack (Recommended)

| Layer | Service | Free Tier | Latency |
|-------|---------|-----------|---------|
| STT | Groq Whisper large-v3-turbo | ~unlimited | ~300ms |
| LLM | Groq Llama 3.3-70b-versatile | 30 req/min | ~500ms |
| TTS | Sarvam Bulbul v2 | free tier | ~500ms |

Total round-trip: ~1.3s per turn (acceptable for voice agent)

**Why this stack:**
- Single Groq API key covers STT + LLM (both free)
- Sarvam Bulbul: Indian English accent fits creditq.in sales context
- Groq Whisper accepts webm/opus directly — no format conversion needed
- All REST APIs, zero infra

**Alternative TTS if Sarvam quota hit:** Groq PlayAI TTS (new, free tier, streaming)

---

## Architecture

```
Browser mic
  → WS chunks (webm/opus)
  → API: buffer all chunks until session.end
  → Groq Whisper STT → transcript text
  → Groq Llama 3.3-70b (with sales system prompt) → reply text
  → Sarvam Bulbul TTS → audio blob (wav/mp3)
  → WS: send binary audio back to browser
  → Browser: AudioContext.decodeAudioData → play
```

---

## Implementation Steps

### Step 1: API — Buffer chunks + env setup

**Files:**
- `api/package.json` — add `groq-sdk`, `node-fetch` (or native fetch, Node 18+)
- `api/.env` — add `GROQ_API_KEY`, `SARVAM_API_KEY`
- `api/src/index.js` — buffer audio chunks in Map keyed by sessionId

```javascript
// Per-session audio buffer
const sessions = new Map()
// sessions.get(sessionId) = { chunks: Buffer[], chunkCount, totalBytes, ws }

// On session.start: sessions.set(sessionId, { chunks: [], ... })
// On binary message: sessions.get(sessionId).chunks.push(Buffer.from(data))
// On session.end: trigger processSession(sessionId)
```

### Step 2: API — STT via Groq Whisper

```javascript
// api/src/stt.js
const Groq = require('groq-sdk')
const { Blob } = require('buffer')

async function transcribe(audioChunks) {
  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY })
  const audioBuffer = Buffer.concat(audioChunks)
  
  // Groq Whisper accepts webm/opus as File-like object
  const file = new File([audioBuffer], 'audio.webm', { type: 'audio/webm' })
  
  const result = await groq.audio.transcriptions.create({
    file,
    model: 'whisper-large-v3-turbo',
    language: 'en',
    response_format: 'json',
  })
  
  return result.text
}
```

### Step 3: API — LLM via Groq Llama

```javascript
// api/src/llm.js
const Groq = require('groq-sdk')

const SALES_SYSTEM_PROMPT = `You are a helpful sales agent for CreditQ, India's leading credit information platform for MSMEs. 
Keep responses concise (2-3 sentences max) since this is a voice call.
Be friendly, professional, and focus on understanding the customer's credit needs.`

async function getReply(transcript, conversationHistory = []) {
  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY })
  
  const messages = [
    { role: 'system', content: SALES_SYSTEM_PROMPT },
    ...conversationHistory,
    { role: 'user', content: transcript },
  ]
  
  const response = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages,
    max_tokens: 150,  // keep responses short for TTS
    temperature: 0.7,
  })
  
  return response.choices[0].message.content
}
```

### Step 4: API — TTS via Sarvam Bulbul

```javascript
// api/src/tts.js

async function synthesize(text) {
  const response = await fetch('https://api.sarvam.ai/text-to-speech', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-subscription-key': process.env.SARVAM_API_KEY,
    },
    body: JSON.stringify({
      inputs: [text],
      target_language_code: 'en-IN',
      speaker: 'meera',       // Indian English female voice
      model: 'bulbul:v2',
      pitch: 0,
      pace: 1.0,
      loudness: 1.0,
      speech_sample_rate: 22050,
      enable_preprocessing: true,
      eng_interpolation_wt: 128,
    }),
  })
  
  const data = await response.json()
  // Returns base64 encoded WAV
  return Buffer.from(data.audios[0], 'base64')
}
```

### Step 5: API — Wire pipeline in index.js

```javascript
// On session.end:
async function processSession(sessionId, ws) {
  const session = sessions.get(sessionId)
  if (!session || session.chunks.length === 0) return
  
  try {
    ws.send(JSON.stringify({ type: 'processing.start' }))
    
    // STT
    const transcript = await transcribe(session.chunks)
    ws.send(JSON.stringify({ type: 'transcript', text: transcript }))
    
    // LLM
    const reply = await getReply(transcript, session.history ?? [])
    ws.send(JSON.stringify({ type: 'reply', text: reply }))
    
    // TTS
    const audioBuffer = await synthesize(reply)
    ws.send(audioBuffer)  // binary audio
    
    // Save to conversation history
    session.history = [
      ...(session.history ?? []),
      { role: 'user', content: transcript },
      { role: 'assistant', content: reply },
    ]
    
    // Reset chunks for next turn
    session.chunks = []
    
    ws.send(JSON.stringify({ type: 'processing.done' }))
  } catch (err) {
    ws.send(JSON.stringify({ type: 'error', message: err.message }))
  }
}
```

### Step 6: Client — Handle server messages + play audio

```typescript
// In useVoiceCapture.ts — add to ws.onmessage handler:

ws.onmessage = async (event) => {
  if (event.data instanceof ArrayBuffer) {
    // Binary = TTS audio, play it
    const ctx = new AudioContext()
    const audioBuffer = await ctx.decodeAudioData(event.data)
    const source = ctx.createBufferSource()
    source.buffer = audioBuffer
    source.connect(ctx.destination)
    source.start()
    return
  }
  
  const msg = JSON.parse(event.data)
  switch (msg.type) {
    case 'transcript':
      setTranscript(msg.text)
      break
    case 'reply':
      setReply(msg.text)
      break
    case 'processing.start':
      setStatus('processing')
      break
    case 'processing.done':
      setStatus('recording')  // ready for next input
      break
  }
}
```

**New VoiceStatus states:** `'idle' | 'connecting' | 'recording' | 'processing' | 'error'`

### Step 7: Client — Conversation UI

Add to `VoiceButton.tsx`:
- Show transcript (what user said)
- Show reply text (what agent said)
- Show 'processing...' spinner between turns
- Conversation history list (optional for demo)

---

## Key Files

| File | Operation | Description |
|------|-----------|-------------|
| `api/src/index.js` | Modify | Buffer chunks, wire processSession on session.end |
| `api/src/stt.js` | Create | Groq Whisper transcription |
| `api/src/llm.js` | Create | Groq Llama sales agent |
| `api/src/tts.js` | Create | Sarvam Bulbul synthesis |
| `api/.env` | Create | GROQ_API_KEY, SARVAM_API_KEY |
| `api/package.json` | Modify | Add groq-sdk |
| `client/src/hooks/useVoiceCapture.ts` | Modify | Handle onmessage: transcript/reply/audio playback |
| `client/src/components/VoiceButton.tsx` | Modify | Show transcript, reply, processing state |

---

## API Keys Needed

1. **Groq**: https://console.groq.com → free account → API Keys
2. **Sarvam AI**: https://console.sarvam.ai → free account → API Keys

---

## Risks and Mitigation

| Risk | Mitigation |
|------|------------|
| Groq rate limit (30 req/min free) | Add request queuing; show 'rate limited' error |
| Sarvam TTS quota | Fallback to Groq PlayAI TTS (same API key) |
| webm chunk buffering → file too big | Add 30s max session timeout, split long recordings |
| AudioContext suspended (browser autoplay policy) | Resume AudioContext on user gesture (button click) |
| GROQ_API_KEY not set | Validate env vars at startup, fail fast |

---

## SESSION_ID
- CODEX_SESSION: N/A (plan generated by Claude directly)
- GEMINI_SESSION: N/A
