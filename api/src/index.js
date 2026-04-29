require("dotenv").config();
const express = require("express");
const { WebSocketServer } = require("ws");
const http = require("http");
const { transcribe, createStreamingTranscriber } = require("./stt");
const { getReplyStream } = require("./llm");
const { synthesizeStream } = require("./tts");
const { getInitialStage, advanceStage } = require("./salesScript");

const PORT = process.env.PORT || 8080;

const REQUIRED_ENV = ["GROQ_API_KEY", "SARVAM_API_KEY", "DEEPGRAM_API_KEY"];
const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
if (missing.length > 0) {
  console.warn(`[warn] Missing env vars: ${missing.join(", ")}`);
  console.warn("[warn] Copy api/.env.example to api/.env and fill in keys");
}

// Sentence/Clause boundary: [.!?।\n,;] - added clauses for faster TTS trigger
const SENTENCE_END = /[.!?।\n,;]/;

const GREETING =
  "नमस्कार — मैं Arjun Mehta बोल रहा हूँ, CreditQ से. " +
  "हम Indian businesses को help करते हैं कि उनका credit risk covered रहे — " +
  "एक भी defaulter आपकी cashflow को months तक रोक सकता है. " +
  "बताओ, आज कल कितने buyers को credit पे माल दे रहे हो?";

function normalizeForTTS(text) {
  return text
    .replace(/₹/g, " rupees ")
    .replace(/(\d+)-(\d+)/g, "$1 to $2") // 1-12 to 1 to 12
    .replace(/\bLakh\b/gi, " लाख ")
    .replace(/\bCr\b/gi, " करोड़ ")
    .replace(/\bGST\b/gi, " जी एस टी ")
    .replace(/\bMSME\b/gi, " एम एस एम ई ")
    .replace(/\bCIR\b/gi, " सी आई आर ");
}

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (ws, req) => {
  console.log(`[WS] connected: ${req.socket.remoteAddress}`);

  const session = {
    id: null,
    chunks: [],
    headerChunk: null,
    chunkCount: 0,
    totalBytes: 0,
    history: [],
    stage: getInitialStage(),
    turnCount: 0,
    abortController: new AbortController(),
    transcriber: null,
    isProcessing: false,
  };

  function interruptPrevious() {
    session.abortController.abort();
    session.abortController = new AbortController();
    session.isProcessing = false;
  }

  async function greetUser() {
    const signal = session.abortController.signal;
    try {
      console.log(`[Greet] ${session.id}: sending greeting`);
      ws.send(JSON.stringify({ type: "reply", text: GREETING }));
      ws.send(JSON.stringify({ type: "audio.start" }));

      const sentences = GREETING.split(/([.!?।])/).reduce((acc, part, i) => {
        if (i % 2 === 0) acc.push(part);
        else if (acc.length > 0) acc[acc.length - 1] += part;
        return acc;
      }, []).filter(s => s.trim().length > 0);

      const queue = [...sentences];
      console.log(`[Greet] Starting optimized TTS: ${sentences.length} sentences`);
      await streamTtsOptimized(queue, () => true, signal);
      console.log(`[Greet] Optimized TTS complete`);

      if (!signal.aborted && ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: "audio.end" }));
      }
      session.history.push({ role: "assistant", content: GREETING });

      // Speculative warmup: keep LLM connection hot for faster next response
      setTimeout(() => {
        if (session.turnCount === 0) {
          getReplyStream("hello", session.history, session.stage).next()
            .then(() => console.log(`[Greet] ${session.id}: LLM warmup complete`))
            .catch(() => {}); // Ignore errors, this is just warmup
        }
      }, 100);
    } catch (err) {
      if (err.name === "AbortError") {
        console.log(`[Greet] ${session.id}: interrupted`);
      } else {
        console.error(`[Greet] ${err.message}`);
      }
    }
  }

  async function streamSentenceToClient(sentence, signal) {
    if (!sentence || sentence.trim().length < 2) return;
    if (ws.readyState !== ws.OPEN || signal.aborted) return;
    const speechText = normalizeForTTS(sentence.trim());
    console.log(`[TTS] sentence: "${speechText}"`);
    try {
      await synthesizeStream(speechText, async (chunk) => {
        if (signal.aborted) return;
        if (ws.readyState === ws.OPEN) ws.send(Buffer.from(chunk));
      }, signal);
    } catch (err) {
      if (err.name !== "AbortError") throw err;
    }
  }

  // Optimized TTS streamer that pipelines requests
  async function streamTtsOptimized(sentenceQueue, isDone, signal) {
    const jobQueue = [];
    const log = (msg) => console.log(`[${new Date().toISOString().split('T')[1].split('Z')[0]}] ${msg}`);
    
    const startJob = (sentence) => {
      const job = {
        sentence,
        chunks: [],
        done: false,
        promise: null
      };
      
      log(`[TTS] Requesting synthesis: "${sentence.slice(0, 30)}..."`);
      job.promise = (async () => {
        try {
          const speechText = normalizeForTTS(sentence.trim());
          await synthesizeStream(speechText, async (chunk) => {
            if (signal.aborted) return;
            job.chunks.push(chunk);
          }, signal);
        } catch (err) {
          if (err.name !== "AbortError") {
            log(`[TTS] Error for "${sentence.slice(0, 20)}...": ${err.message}`);
          }
        } finally {
          job.done = true;
        }
      })();
      
      jobQueue.push(job);
    };

    while (!isDone() || sentenceQueue.length > 0 || jobQueue.length > 0) {
      if (signal.aborted) break;

      // Start fetching for new sentences in the queue
      while (sentenceQueue.length > 0) {
        startJob(sentenceQueue.shift());
      }

      if (jobQueue.length > 0) {
        const currentJob = jobQueue[0];
        
        // Send buffered chunks
        while (currentJob.chunks.length > 0) {
          const chunk = currentJob.chunks.shift();
          if (ws.readyState === ws.OPEN) {
            const buf = Buffer.from(chunk);
            ws.send(buf);
            if (Math.random() < 0.1) log(`[WS] Sent audio chunk: ${buf.length}B`);
          }
        }

        if (currentJob.done && currentJob.chunks.length === 0) {
          log(`[TTS] Finished playing job: "${currentJob.sentence.slice(0, 20)}..."`);
          jobQueue.shift();
        } else {
          // If we have more jobs in queue, they are already fetching in background
          await new Promise(r => setImmediate(r));
        }
      } else {
        await new Promise(r => setImmediate(r));
      }
    }
  }

  async function processSession() {
    interruptPrevious();
    const signal = session.abortController.signal;

    if (session.chunks.length === 0) {
      ws.send(JSON.stringify({ type: "error", message: "No audio received" }));
      return;
    }

    const chunksToProcess = session.headerChunk 
      ? [session.headerChunk, ...session.chunks]
      : [...session.chunks];
    session.chunks = [];

    try {
      const startTime = Date.now();
      const log = (msg) => console.log(`[${new Date().toISOString().split('T')[1].split('Z')[0]}] ${msg}`);
      
      ws.send(JSON.stringify({ type: "processing.start" }));

      const transcript = await transcribe(chunksToProcess);
      if (signal.aborted) return;

      log(`[STT] Transcript received: "${transcript}"`);
      ws.send(JSON.stringify({ type: "transcript", text: transcript }));

      // Signal audio start immediately after transcript (before LLM) for lower latency
      ws.send(JSON.stringify({ type: "audio.start" }));

      session.stage = advanceStage(session.stage, session.turnCount, transcript);
      session.turnCount++;
      log(`[Stage] Moved to ${session.stage}`);

      let fullReply = "";
      let sentenceBuffer = "";
      const sentenceQueue = [];
      let llmDone = false;
      let firstChunkSent = false;
      let firstTokenTime = null;

      // TTS consumer — runs concurrently with LLM producer
      const ttsTask = (async () => {
        log(`[TTS] Started consumer worker`);
        await streamTtsOptimized(sentenceQueue, () => llmDone, signal);
        log(`[TTS] Finished consumer worker`);
      })();

      // LLM producer — pushes sentences without waiting for TTS
      for await (const token of getReplyStream(transcript, session.history, session.stage)) {
        if (signal.aborted) break;
        if (!firstTokenTime) {
          firstTokenTime = Date.now();
          log(`[LLM] First token generated (delay: ${firstTokenTime - startTime}ms)`);
        }
        
        fullReply += token;
        sentenceBuffer += token;
        
        // Stream text token to client immediately
        ws.send(JSON.stringify({ type: "reply.delta", text: token }));

        const match = sentenceBuffer.search(SENTENCE_END);
        const words = sentenceBuffer.trim().split(/\s+/);
        const wordCount = words.length;

        // Dynamic splitting: 2 words for the very first chunk, 10 words for subsequent ones
        const threshold = firstChunkSent ? 10 : 2;

        if (match !== -1 || wordCount >= threshold) {
          let splitPoint = match !== -1 ? match + 1 : sentenceBuffer.length;
          
          if (match === -1 && wordCount >= threshold) {
            const lastSpace = sentenceBuffer.lastIndexOf(" ");
            if (lastSpace !== -1) splitPoint = lastSpace + 1;
          }

          const sentence = sentenceBuffer.slice(0, splitPoint).trim();
          sentenceBuffer = sentenceBuffer.slice(splitPoint);
          if (sentence.length >= 2) {
            log(`[LLM] Queueing chunk: "${sentence.slice(0, 30)}..."`);
            sentenceQueue.push(sentence);
            firstChunkSent = true;
          }
        }
      }

      // Flush remaining
      if (!signal.aborted && sentenceBuffer.trim().length >= 2) {
        log(`[LLM] Queueing final chunk: "${sentenceBuffer.trim().slice(0, 30)}..."`);
        sentenceQueue.push(sentenceBuffer.trim());
      }
      llmDone = true;
      log(`[LLM] Full text generated (total length: ${fullReply.length})`);

      // Wait for TTS consumer to drain
      await ttsTask;

      if (!signal.aborted && ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: "audio.end" }));
        log(`[Pipeline] All processing and playback signals sent`);
      }

      if (!signal.aborted) {
        ws.send(JSON.stringify({ type: "reply", text: fullReply }));

        session.history.push(
          { role: "user", content: transcript },
          { role: "assistant", content: fullReply },
        );
        if (session.history.length > 6) {
          session.history = session.history.slice(-6);
        }

        ws.send(JSON.stringify({ type: "processing.done" }));
      }
    } catch (err) {
      if (err.name === "AbortError") {
        console.log(`[Pipeline] ${session.id}: aborted`);
      } else {
        console.error(`[Pipeline] ${err.message}`);
        ws.send(JSON.stringify({ type: "error", message: err.message }));
      }
    }
  }

  ws.on("message", (data, isBinary) => {
    if (!isBinary) {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === "session.start") {
          session.id = msg.sessionId ?? `s_${Date.now()}`;
          session.chunks = [];
          session.headerChunk = null;
          console.log(`[WS] session.start: ${session.id}`);
          ws.send(JSON.stringify({ type: "session.ready", sessionId: session.id }));
          greetUser();
        } else if (msg.type === "session.end") {
          console.log(
            `[WS] session.end: ${session.id} | chunks=${session.chunkCount}`,
          );
          processSession();
        }
      } catch {
        console.error("[WS] bad control message");
      }
      return;
    }

    if (!session.headerChunk && data.length > 0) {
      session.headerChunk = Buffer.from(data);
    }

    session.chunkCount++;
    session.totalBytes += data.length;
    session.chunks.push(Buffer.from(data));
    if (session.chunkCount % 10 === 0) {
      console.log(
        `[WS] chunk #${session.chunkCount}: total ${session.totalBytes}B`,
      );
    }
  });

  ws.on("close", () => {
    console.log(
      `[WS] closed: ${session.id ?? "no-session"} | turns=${Math.floor(session.history.length / 2)}`,
    );
  });

  ws.on("error", (err) => {
    console.error(`[WS] error: ${err.message}`);
  });
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok", connections: wss.clients.size });
});

server.listen(PORT, () => {
  console.log(`API  http://localhost:${PORT}`);
  console.log(`WS   ws://localhost:${PORT}/ws`);
});
