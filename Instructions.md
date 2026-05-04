# AI Sales Agent - CreditQ

This project is an AI-powered voice sales agent designed for **CreditQ**, an Indian business credit risk management solution. The agent helps businesses mitigate credit risk by providing information reports, defaulter reporting, and legal support.

## Key Features

- **Real-time Voice Interaction:** Low-latency speech-to-speech conversation.
- **Hinglish Support:** The agent understands and speaks in natural Hinglish (Hindi + English) using Devanagari script for high-quality pronunciation.
- **Adaptive VAD (Voice Activity Detection):** Smart detection of speech even in noisy environments.
- **Barge-in Support:** Users can interrupt the agent while it is speaking, and the agent will immediately stop and listen.
- **Domain Knowledge:** Specialized in Indian MSME credit context (GST, MSME, Lakhs, Crores, etc.).

## Tech Stack

- **Frontend:** React, Vite, TypeScript, Web Audio API, MediaRecorder.
- **Backend:** Node.js, Express, WebSockets.
- **STT (Speech-to-Text):** Groq (Whisper Large V3 Turbo).
- **LLM (Large Language Model):** Groq (Llama 3.1 8B Instant).
- **TTS (Text-to-Speech):** Sarvam AI (Bulbul:v3).

## Prerequisites

1. **Groq API Key:** [Get it here](https://console.groq.com/).
2. **Sarvam AI API Key:** [Get it here](https://dashboard.sarvam.ai/).
3. **Node.js:** v18 or higher recommended.

## Setup

1. **Install Dependencies:**
   Run the following in the project root:
   ```bash
   npm install
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

Run both the API and the Client concurrently from the root directory:

```bash
npm run dev
```

- **API:** Running on [http://localhost:8080](http://localhost:8080)
- **Frontend:** Running on [http://localhost:5173](http://localhost:5173) (default Vite port)

## How to Use

1. Open the frontend in your browser.
2. Click the **Voice Button** (it will request Microphone permissions).
3. The agent will greet you: *"नमस्कार — मैं Arjun Mehta बोल रहा हूँ, CreditQ से..."*
4. **Speak naturally.** The agent will detect when you stop speaking and process your request.
5. **Interrupt if needed.** If the agent is speaking too long, you can just start talking, and it will stop and respond to your new input.
6. The conversation history and transcriptions are displayed on the screen for debugging.

## Sales Logic & Progression

The agent is programmed with a structured sales methodology divided into stages:

1.  **Greeting:** Warm introduction and opening hook.
2.  **Discovery:** Uncovering pain points (e.g., payment delays, bad debts).
3.  **Pitch:** Matching a CreditQ plan (Basic, Silver, Gold, etc.) to the user's needs.
4.  **Objection Handling:** Addressing concerns about cost or necessity.
5.  **Closing:** Moving towards GST registration and account setup.

The agent automatically advances through these stages based on the conversation turn count and specific triggers in the user's responses.

## Hinglish & Natural Pronunciation

To provide a natural experience for Indian business owners, the agent:
- Uses **Devanagari script** for Hindi words (e.g., "देखिए", "बिल्कुल") and **Roman script** for English business terms (e.g., "payment", "GST").
- This hybrid approach ensures the Sarvam AI voice engine pronounces Hinglish with the correct accent and cadence.
- It automatically normalizes currency (₹ to "rupees") and ranges (1-2 to "1 to 2") for better TTS output.

## Project Structure

- `api/src/index.js`: Main WebSocket and Express server logic.
- `api/src/stt.js`: Groq Whisper integration.
- `api/src/llm.js`: Groq Llama integration with system prompts for CreditQ.
- `api/src/tts.js`: Sarvam AI TTS streaming integration.
- `client/src/hooks/useVoiceCapture.ts`: Core frontend logic for audio recording, VAD, and barge-in.
- `client/src/components/VoiceButton.tsx`: The main interaction UI.

## Troubleshooting

- **Mic Permission:** Ensure you have granted microphone access to the browser.
- **API Errors:** Check the backend console for `401` (Unauthorized) or `429` (Rate Limit) errors if the agent stops responding.
- **Audio Lag:** Ensure you have a stable internet connection as the audio is streamed in real-time.
