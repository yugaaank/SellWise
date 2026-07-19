<div align="center">

# SellWise

[![TypeScript](https://img.shields.io/badge/TypeScript-4.0-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Bun](https://img.shields.io/badge/workspace-Bun-000000?logo=bun&logoColor=white)](#architecture)
[![Groq](https://img.shields.io/badge/LLM-Groq-ec4899?logo=ai&logoColor=white)](#how-it-works)
[![License](https://img.shields.io/badge/license-MIT-8b5cf6)](#license)

</div>

`SellWise` is an AI voice sales agent: a browser client talks to a Node API
over WebSocket, and the API drives a live call loop — speech-to-text → LLM
sales script → text-to-speech — using Groq for low-latency inference. The
client and API are a single Bun workspace.

## Why

A sales call is a real-time loop, not a request/response. `SellWise` keeps the
whole loop server-side (transcription, reasoning, and voice synthesis) and
streams audio to the browser over a WebSocket, so the client stays thin and
the latency-sensitive pieces run where Groq is fastest.

## Architecture

```
SellWise/
├── package.jsonai            # Bun workspace: ["client","api"], concurrently dev
├── api/                      # Node (Express + ws) service
│   └── src/
│       ├── index.js         # Express + WebSocket wiring
│       ├── llm.js           # Groq chat → sales responses
│       ├── salesScript.js   # script / stage logic
│       ├── stt.js           # speech-to-text
│       └── tts.js           # text-to-speech
└── client/                   # Vite + TypeScript front end
    ├── src/  index.html  vite.config.ts
```

- **Transport** — `api/src/index.js` opens an Express HTTP server and upgrades
  selected connections to WebSocket (`ws`), streaming audio both ways.
- **Call loop** — `stt.js` turns the caller's audio into text, `llm.js` (Groq
  SDK) generates the next line from `salesScript.js`, and `tts.js` renders it
  back to speech for the client.
- **Deps** — `express`, `groq-sdk`, `ws`, `undenv`/`undici`, `dotenv`; tests
  via `jest` (80% line-coverage threshold).

## Getting started

Requires Bun and a Groq API key.

```bash
cp api/.env.example api/.env      # add GROQ_API_KEY
bun install
bun run dev                        # runs api + client via concurrently
```

Or individually:

```bash
bun run dev:api                   # node --watch src/index.js
bun run dev:client                # vite dev server
```

## License

MIT
