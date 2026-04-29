# Implementation Plan: Voice Fixes (3 Issues)

## Fix 1: Audio Not Audible — AudioContext Autoplay Policy

### Root Cause
`getAudioContext()` is called lazily from `ws.onmessage` (async event).
Browser autoplay policy blocks `AudioContext` created outside a user gesture.
`resume()` called from async context has no effect.

### Fix
Create `AudioContext` directly inside `start()` — this executes synchronously within the button-click user gesture.
Play a 0-duration silent buffer immediately to unlock it (browser "stamps" the context as gesture-activated).

```typescript
// In start() — right after getUserMedia, before WebSocket:
const ctx = new AudioContext()
// Unlock with silent 1-sample buffer (required on Chrome/Safari)
const unlock = ctx.createBuffer(1, 1, ctx.sampleRate)
const unlocker = ctx.createBufferSource()
unlocker.buffer = unlock
unlocker.connect(ctx.destination)
unlocker.start(0)
audioCtxRef.current = ctx
```

Remove `getAudioContext()` helper — replace all usages with direct `audioCtxRef.current`.

---

## Fix 2: Continuous Conversation — Silence Detection Auto-Send

### Approach
`AnalyserNode` monitors mic RMS level every 100ms.
When RMS < threshold for 1.5s AND user has spoken ≥300ms → auto-call `sendTurn()`.
Reset silence counter when speech resumes.
Add `isSpeaking` boolean state for UI visual cue.

```typescript
const SILENCE_THRESHOLD = 12   // RMS (0-255 scale) below = silence
const SILENCE_DURATION_MS = 1500  // 1.5s of silence → send
const MIN_SPEECH_MS = 300         // guard: must have spoken ≥300ms first

function startSilenceDetection(stream: MediaStream, ctx: AudioContext, onSilence: () => void) {
  const source = ctx.createMediaStreamSource(stream)
  const analyser = ctx.createAnalyser()
  analyser.fftSize = 256
  source.connect(analyser)           // only connects to analyser, not speakers

  const dataArray = new Uint8Array(analyser.frequencyBinCount)
  let silenceMs = 0
  let speechMs = 0
  let fired = false

  const timer = setInterval(() => {
    if (fired) return
    analyser.getByteFrequencyData(dataArray)
    const rms = Math.sqrt(
      dataArray.reduce((sum, v) => sum + v * v, 0) / dataArray.length
    )
    if (rms >= SILENCE_THRESHOLD) {
      speechMs += 100
      silenceMs = 0
    } else {
      silenceMs += 100
      if (silenceMs >= SILENCE_DURATION_MS && speechMs >= MIN_SPEECH_MS) {
        fired = true
        clearInterval(timer)
        onSilence()
      }
    }
  }, 100)

  return () => clearInterval(timer)  // cleanup fn
}
```

Store cleanup fn in a ref. Call it in `sendTurn()` and `stop()`.

**UI change:** Show animated "speaking" indicator when `rms >= SILENCE_THRESHOLD`.
Remove "Send" as primary button; keep it only as a small fallback/override.
New flow: Start Call → speak → [agent hears silence] → auto-sends → Processing → audio plays → ready again.

---

## Fix 3: Agent Speaks First — Server Greeting on session.start

### Backend
On `session.start`, after sending `session.ready`, call `synthesize()` with a hardcoded greeting.
No LLM call needed for greeting — hardcoded = faster, no tokens used.

```javascript
// api/src/index.js
const GREETING = "Hello! I'm an AI sales assistant for CreditQ. " +
  "We help businesses like yours check buyer creditworthiness and protect against bad debts. " +
  "How can I help you today?"

// In session.start handler:
session.id = msg.sessionId ?? `s_${Date.now()}`
ws.send(JSON.stringify({ type: 'session.ready', sessionId: session.id }))
// Agent speaks first
greetUser(ws, session)

async function greetUser(ws, session) {
  try {
    ws.send(JSON.stringify({ type: 'reply', text: GREETING }))
    const audio = await synthesize(GREETING)
    ws.send(audio)
    session.history.push({ role: 'assistant', content: GREETING })
    ws.send(JSON.stringify({ type: 'processing.done' }))
  } catch (err) {
    console.error(`[Greet] ${err.message}`)
  }
}
```

### Frontend
Client is already in `'recording'` state when greeting arrives.
When binary audio arrives → play it → restart recorder.
Bug: client starts recording immediately in `ws.onopen` BEFORE greeting arrives.
Fix: don't start recorder in `ws.onopen`. Instead start recorder only after greeting audio finishes playing (or after `processing.done`).
State on connection: `'connecting'` → on `session.ready` → `'waiting_for_greeting'` → after audio plays → `'recording'`.
Simplest impl: add `'waiting'` state OR just keep recorder off until first `processing.done`.

Actually simpler: start recorder in `ws.onopen` but the silence detection has `MIN_SPEECH_MS = 300ms` guard, so even if silence detector runs during greeting playback it won't auto-send (no speech detected yet).

---

## Key Files

| File | Operation | Description |
|------|-----------|-------------|
| `client/src/hooks/useVoiceCapture.ts` | Modify | AudioContext unlock in start(), silence detection, isSpeaking state |
| `client/src/components/VoiceButton.tsx` | Modify | Remove Send as primary, add speaking indicator |
| `client/src/components/VoiceButton.css` | Modify | Speaking pulse animation |
| `api/src/index.js` | Modify | greetUser() on session.start |

---

## Risks and Mitigation

| Risk | Mitigation |
|------|------------|
| Safari AudioContext still blocked | Check `ctx.state` after unlock; show "tap to enable audio" if still suspended |
| Silence threshold too sensitive (triggers on room noise) | Threshold=12 tunable; can expose as config constant |
| Silence detection fires during agent audio playback | Stop silence detection interval when `sendTurn()` is called; restart only after `processing.done` |
| Greeting TTS fails (Sarvam error) | Wrap in try/catch; if greeting fails, just skip it — don't block the session |
