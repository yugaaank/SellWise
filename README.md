# SlipWise (AI Sales Agent)

A customizable, real-time AI-powered voice sales agent designed as a generic B2B/B2C solution. The agent interacts in natural English, adapting to conversational flow with low latency and smart barge-in support.

## Key Features

- **Real-time Voice Interaction:** Low-latency speech-to-speech conversation.
- **Natural English Support:** Clear, professional English conversation flow tuned for sales.
- **Adaptive VAD (Voice Activity Detection):** Smart detection of speech even in noisy environments.
- **Barge-in Support:** Users can interrupt the agent while it is speaking, and the agent will immediately stop and listen.
- **Configurable Sales Logic:** Automatically advances through customizable sales stages (Greeting, Discovery, Pitch, Objection Handling, Closing).

## Tech Stack

- **Frontend:** React, Vite, TypeScript, Web Audio API, MediaRecorder.
- **Backend:** Node.js, Express, WebSockets.
- **STT (Speech-to-Text):** Groq (Whisper Large V3 Turbo).
- **LLM (Large Language Model):** Groq (Llama 3.1 8B Instant).
- **TTS (Text-to-Speech):** Sarvam AI (Bulbul:v3).

## Prerequisites

1. **Groq API Key:** [Get it here](https://console.groq.com/).
2. **Sarvam AI API Key:** [Get it here](https://dashboard.sarvam.ai/).
3. **Bun:** Ensure you have `bun` installed for package management.

## Setup

1. **Install Dependencies:**
   Run the following in the project root:
   ```bash
   bun install
   ```

2. **Configure Environment Variables:**
   Create a `.env` file in the `api/` directory:
   ```bash
   cp api/.env.example api/.env
   ```
   Fill in your API keys in `api/.env`:
   ```env
   GROQ_API_KEY=your_groq_api_key_here
   SARVAM_API_KEY=your_sarvam_api_key_here
   PORT=8080
   ```

## Running the Project

Run both the API and the Client concurrently from the root directory using Bun:

```bash
bun run dev
```

- **API:** Running on [http://localhost:8080](http://localhost:8080)
- **Frontend:** Running on [http://localhost:5173](http://localhost:5173) (default Vite port)

## How to Use

1. Open the frontend in your browser.
2. Click the **Voice Button** (allow microphone permissions).
3. The agent will greet you and initiate the sales flow.
4. **Speak naturally.** The agent will detect when you stop speaking and process your request.
5. **Interrupt if needed.** If you start talking while the agent is speaking, it will stop and respond to your new input.
6. The conversation history and transcriptions are displayed on the screen for debugging.

## Project Structure

- `api/src/index.js`: Main WebSocket and Express server logic.
- `api/src/stt.js`: Groq Whisper integration.
- `api/src/llm.js`: Groq Llama integration with system prompts for the generic sales agent.
- `api/src/tts.js`: Sarvam AI TTS streaming integration.
- `client/src/hooks/useVoiceCapture.ts`: Core frontend logic for audio recording, VAD, and barge-in.
- `client/src/components/VoiceButton.tsx`: The main interaction UI.

## Troubleshooting

- **Mic Permission:** Ensure you have granted microphone access to the browser.
- **API Errors:** Check the backend console for `401` (Unauthorized) or `429` (Rate Limit) errors if the agent stops responding.
- **Audio Lag:** Ensure you have a stable internet connection as the audio is streamed in real-time.
