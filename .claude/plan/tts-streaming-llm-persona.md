# Plan: TTS Streaming + LLM Persona + Batch Streaming

## Requirements

1. Switch TTS from non-streaming → Sarvam streaming endpoint (`/text-to-speech/stream`)
2. Improve LLM persona: professional, bilingual Hindi+English, strong self-introduction
3. Stream LLM tokens in sentence-batches → pipe each sentence to TTS immediately (no full-response wait)

---

## Architecture Overview

```
User speaks
  → STT (Groq Whisper)
  → LLM stream (Groq llama-3.3-70b) ← tokens arrive
      → sentence accumulator
          → sentence complete → TTS stream (Sarvam /stream endpoint)
              → MP3 chunks → WS binary frames → client MediaSource
```

Current (blocking):
```
STT → LLM (wait full) → TTS (wait full) → WS audio message (base64)
```

Target (streaming):
```
STT → LLM stream → sentence ready → TTS stream → WS binary chunks
```

---

## Task 1: Server TTS Streaming (`api/src/tts.js`)

### Current
- Calls `https://api.sarvam.ai/text-to-speech` (non-streaming JSON)
- Returns `Buffer.from(data.audios[0], "base64")`

### New: `synthesizeStream(text, onChunk)`
```javascript
async function synthesizeStream(text, onChunk) {
  const response = await fetch("https://api.sarvam.ai/text-to-speech/stream", {
    method: "POST",
    headers: {
      "api-subscription-key": process.env.SARVAM_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text,
      target_language_code: "hi-IN",
      speaker: "shubh",         // changed from "ratan" → "shubh" (better quality)
      model: "bulbul:v3",
      pace: 1.1,
      speech_sample_rate: 22050,
      output_audio_codec: "mp3",
      enable_preprocessing: true,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Sarvam TTS stream ${response.status}: ${body}`);
  }

  const reader = response.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    await onChunk(value); // Uint8Array
  }
}
```

Keep `synthesize` for backward compat → use in greeting (greeting doesn't need streaming yet).

---

## Task 2: WS Protocol Changes (`api/src/index.js`)

### New message types (server → client):
| Type | Direction | Purpose |
|------|-----------|---------|
| `audio.start` | S→C | TTS stream begins for this sentence |
| binary frame | S→C | Raw MP3 chunk bytes |
| `audio.end` | S→C | All chunks for this sentence sent |

### New `processSessionStreaming()` replacing `processSession()`:

```
1. ws.send({ type: "processing.start" })
2. transcript = await transcribe(chunks)
3. ws.send({ type: "transcript", text })
4. advanceStage / turnCount
5. Call getReplyStream(transcript, history, stage) → AsyncGenerator<string>
6. fullReply = ""
7. sentenceBuffer = ""
8. for await (token of stream):
     fullReply += token
     sentenceBuffer += token
     if sentenceBuffer ends with [.!?] + space OR newline:
       sentence = sentenceBuffer.trim()
       sentenceBuffer = ""
       if sentence.length > 0:
         ws.send(JSON.stringify({ type: "audio.start" }))
         await synthesizeStream(sentence, async (chunk) => {
           ws.send(chunk)  // binary Buffer
         })
         ws.send(JSON.stringify({ type: "audio.end" }))
9. flush remaining sentenceBuffer (last sentence without punct)
10. ws.send({ type: "reply", text: fullReply })  // for UI display
11. push to history
12. ws.send({ type: "processing.done" })
```

**Sentence detection regex:** `/[.!?।]\s+|[\n]/` (includes Hindi danda `।`)

---

## Task 3: LLM Streaming (`api/src/llm.js`)

### New `getReplyStream(transcript, history, stage)` → AsyncGenerator

```javascript
async function* getReplyStream(transcript, history = [], stage = 'greeting') {
  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY })
  const stream = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [
      { role: 'system', content: buildSystemPrompt(stage) },
      ...history,
      { role: 'user', content: transcript },
    ],
    max_tokens: 200,
    temperature: 0.75,
    stream: true,
  })
  for await (const chunk of stream) {
    const token = chunk.choices[0]?.delta?.content
    if (token) yield token
  }
}
```

Keep `getReply` (non-streaming) for tests + greeting.

---

## Task 4: LLM Persona Enhancement (`api/src/llm.js`)

### Problems with current persona
- Hindi phrases feel mechanical/injected
- "23 saal ka experience" sounds like a feature dump
- Opening hook too sales-y, not conversational

### New system prompt persona section:
```
You are Arjun Mehta — a senior business credit advisor at CreditQ.
You have spent 15+ years working with Indian MSMEs across manufacturing, 
trading, and services sectors. You are calm, measured, and professional — 
not a pushy salesperson, but a trusted advisor who happens to know that 
unprotected credit is a business killer.

You speak naturally in Hinglish — the way educated Indian professionals 
actually talk on calls. Not translated Hindi, not over-English either. 
Real blend: "Dekhiye, ek cheez clear karte hain — agar aapka buyer 
60-90 din mein pay nahi karta, toh vo effectively aapka capital le ke 
chal raha hai."

You introduce yourself with warmth and authority, not a pitch. 
First 2 sentences: who you are and why you're calling. 
Third sentence: one sharp question to open discovery.
```

### New greeting text in `index.js`:
```javascript
const GREETING =
  "Namaskar — main Arjun Mehta bol raha hoon, CreditQ se. " +
  "Hum Indian businesses ko help karte hain ki unka credit risk covered rahe — " +
  "ek bhi defaulter aapki cashflow ko months tak rok sakta hai. " +
  "Batao, aaj kal kitne buyers ko credit pe maal de rahe ho?";
```

---

## Task 5: Client MediaSource Streaming (`client/src/hooks/useVoiceCapture.ts`)

### New WS message handling for streaming audio:

```typescript
// Refs to add:
const mediaSourceRef = useRef<MediaSource | null>(null)
const sourceBufferRef = useRef<SourceBuffer | null>(null)
const audioPlaybackRef = useRef<HTMLAudioElement | null>(null)
const pendingChunksRef = useRef<Uint8Array[]>([])

// On "audio.start":
//   Create MediaSource + Audio element
//   Wait for sourceopen → addSourceBuffer("audio/mpeg")
//   Set audio.src = URL.createObjectURL(mediaSource)
//   audio.play()

// On binary frame (event.data instanceof ArrayBuffer):
//   chunk = new Uint8Array(event.data)
//   if sourceBuffer not updating: appendBuffer(chunk)
//   else: push to pendingChunksRef queue

// On sourceBuffer "updateend":
//   if pendingChunks.length > 0: appendBuffer(pendingChunks.shift())

// On "audio.end":
//   Wait for all pending chunks to flush
//   mediaSource.endOfStream()
//   On audio "ended": restart recording for next turn
```

**Fallback**: If `MediaSource.isTypeSupported("audio/mpeg")` is false:
- Collect binary chunks into array
- On `audio.end`: Blob("audio/mpeg") → Audio src → play

**Binary vs JSON detection** in `ws.onmessage`:
```typescript
if (event.data instanceof ArrayBuffer) {
  // audio chunk — append to MediaSource
} else {
  const msg = JSON.parse(event.data)
  // handle control messages
}
```

---

## Key Files

| File | Change |
|------|--------|
| `api/src/tts.js` | Add `synthesizeStream(text, onChunk)`, keep `synthesize` |
| `api/src/llm.js` | Add `getReplyStream()`, update persona in `buildSystemPrompt()` |
| `api/src/index.js` | New `processSessionStreaming()`, new `GREETING`, wire new WS protocol |
| `client/src/hooks/useVoiceCapture.ts` | Handle binary frames + `audio.start`/`audio.end`, MediaSource playback |

No new files needed. No breaking changes to existing test files (they test `getReply` non-streaming which stays).

---

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| SourceBuffer race condition (updating while appending) | Queue pending chunks, flush on `updateend` |
| MediaSource not supported (Safari < 17, iOS) | Fallback: collect chunks → Blob → Audio |
| Groq stream token boundaries — sentence splits mid-word | Buffer includes partial token until punct found; regex only matches `[.!?] ` not bare punct |
| Short sentences < 3 words sent to TTS → poor quality | Add min-length gate: skip TTS until ≥ 20 chars or sentence is last |
| `audio.end` before MediaSource ready | Wait for `sourceopen` before any appends; queue chunks before that |

---

## Implementation Order

1. `tts.js` → add `synthesizeStream` (isolated, testable)
2. `llm.js` → add `getReplyStream` + persona update
3. `index.js` → `processSessionStreaming` + new GREETING
4. `useVoiceCapture.ts` → binary frame handling + MediaSource
5. Manual test: browser call, check latency improvement

---

**Plan saved to `.claude/plan/tts-streaming-llm-persona.md`**

**Please review. When ready:**
```
implement this plan
```
