require("dotenv").config();
const express = require("express");
const { WebSocketServer } = require("ws");
const http = require("http");
const { transcribe } = require("./stt");
const { getReplyStream } = require("./llm");
const { synthesizeStream } = require("./tts");
const { getInitialStage, advanceStage } = require("./salesScript");

const PORT = process.env.PORT || 8080;

const REQUIRED_ENV = ["GROQ_API_KEY", "SARVAM_API_KEY"];
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
    transcriber: null,
    isProcessing: false,
    abortController: null, // For cancelling TTS/LLM operations
  };

  async function greetUser() {
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
      await streamTtsOptimized(queue, () => true);
      console.log(`[Greet] Optimized TTS complete`);

      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: "audio.end" }));
      }
      session.history.push({ role: "assistant", content: GREETING });

      // Speculative warmup
      setTimeout(() => {
        if (session.turnCount === 0) {
          getReplyStream("hello", session.history, session.stage).next()
            .then(() => console.log(`[Greet] ${session.id}: LLM warmup complete`))
            .catch(() => {});
        }
      }, 100);
    } catch (err) {
      console.error(`[Greet] ${err.message}`);
    }
  }

  // Optimized TTS streamer that pipelines requests
  async function streamTtsOptimized(sentenceQueue, isDone, signal) {
    const jobQueue = [];
    const log = (msg) => console.log(`[${new Date().toISOString().split('T')[1].split('Z')[0]}] ${msg}`);
    
    // Check for abort signal
    const checkAbort = () => {
      if (signal?.aborted) {
        throw new Error('TTS aborted');
      }
    };
    
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
            job.chunks.push(chunk);
          }, signal); // Pass abort signal for barge-in
        } catch (err) {
          if (err.message === 'TTS aborted') {
            throw err; // Re-throw to handle upstream
          }
          log(`[TTS] Error for "${sentence.slice(0, 20)}...": ${err.message}`);
        } finally {
          job.done = true;
        }
      })();
      
      jobQueue.push(job);
    };

    while (!isDone() || sentenceQueue.length > 0 || jobQueue.length > 0) {
      checkAbort(); // Check for interrupt signal
      
      // Start fetching for new sentences in the queue
      while (sentenceQueue.length > 0) {
        checkAbort();
        startJob(sentenceQueue.shift());
      }

      if (jobQueue.length > 0) {
        const currentJob = jobQueue[0];
        
        // Send buffered chunks
        while (currentJob.chunks.length > 0) {
          checkAbort();
          const chunk = currentJob.chunks.shift();
          if (ws.readyState === ws.OPEN) {
            ws.send(Buffer.from(chunk));
          }
        }

        if (currentJob.done && currentJob.chunks.length === 0) {
          jobQueue.shift();
        } else {
          await new Promise(r => setImmediate(r));
        }
      } else {
        await new Promise(r => setImmediate(r));
      }
    }
  }

  async function processSession() {
    // Prevent race conditions: don't process if already processing
    if (session.isProcessing) {
      console.log(`[Pipeline] ${session.id}: already processing, skipping`);
      return;
    }
    
    if (session.chunks.length < 3) {
      console.log(`[Pipeline] Ignoring tiny session (${session.chunks.length} chunks)`);
      session.chunks = [];
      session.headerChunk = null;
      session.chunkCount = 0;
      return;
    }

    session.isProcessing = true;
    
    const chunksToProcess = session.headerChunk 
      ? [session.headerChunk, ...session.chunks]
      : [...session.chunks];
    session.chunks = [];
    session.headerChunk = null;
    session.chunkCount = 0;

    try {
      const startTime = Date.now();
      const log = (msg) => console.log(`[${new Date().toISOString().split('T')[1].split('Z')[0]}] ${msg}`);
      
      ws.send(JSON.stringify({ type: "processing.start" }));

      const transcript = await transcribe(chunksToProcess);
      log(`[STT] Transcript received: "${transcript}"`);
      ws.send(JSON.stringify({ type: "transcript", text: transcript }));

      ws.send(JSON.stringify({ type: "audio.start" }));

      session.stage = advanceStage(session.stage, session.turnCount, transcript);
      session.turnCount++;

      let fullReply = "";
      let sentenceBuffer = "";
      const sentenceQueue = [];
      let llmDone = false;
      let firstChunkSent = false;

      // Create abort controller for this turn (for barge-in cancellation)
      session.abortController = new AbortController();
      const signal = session.abortController.signal;
      
      // TTS consumer
      const ttsTask = (async () => {
        try {
          await streamTtsOptimized(sentenceQueue, () => llmDone, signal);
        } catch (err) {
          if (err.message === 'TTS aborted') {
            console.log(`[Pipeline] ${session.id}: TTS cancelled due to interrupt`);
            return;
          }
          throw err;
        }
      })();

      // LLM producer
      try {
        for await (const token of getReplyStream(transcript, session.history, session.stage, signal)) {
          if (signal.aborted) {
            console.log(`[Pipeline] ${session.id}: LLM stream aborted`);
            break;
          }
          
          fullReply += token;
          sentenceBuffer += token;
          
          ws.send(JSON.stringify({ type: "reply.delta", text: token }));

          const match = sentenceBuffer.search(SENTENCE_END);
          const words = sentenceBuffer.trim().split(/\s+/);
          const wordCount = words.length;
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
              sentenceQueue.push(sentence);
              firstChunkSent = true;
            }
          }
        }
      } catch (err) {
        if (err.message === 'LLM aborted') {
          console.log(`[Pipeline] ${session.id}: LLM cancelled due to interrupt`);
        } else {
          throw err;
        }
      }

      if (sentenceBuffer.trim().length >= 2) {
        sentenceQueue.push(sentenceBuffer.trim());
      }
      llmDone = true;

      await ttsTask;

      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: "audio.end" }));
      }

      ws.send(JSON.stringify({ type: "reply", text: fullReply }));

      session.history.push(
        { role: "user", content: transcript },
        { role: "assistant", content: fullReply },
      );
      if (session.history.length > 6) {
        session.history = session.history.slice(-6);
      }

      ws.send(JSON.stringify({ type: "processing.done" }));
    } catch (err) {
      console.error(`[Pipeline] ${err.message}`);
      ws.send(JSON.stringify({ type: "error", message: err.message }));
    } finally {
      session.isProcessing = false;
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
          ws.send(JSON.stringify({ type: "session.ready", sessionId: session.id }));
          greetUser();
        } else if (msg.type === "session.end") {
          processSession();
        } else if (msg.type === "interrupt") {
          // BARGE-IN: User interrupted agent speech
          console.log(`[Barge-in] ${session.id}: received interrupt signal`);
          
          // Cancel ongoing TTS/LLM operations
          if (session.abortController) {
            console.log(`[Barge-in] ${session.id}: aborting current operations`);
            session.abortController.abort();
            session.abortController = null;
          }
          
          // Send audio.end to client to stop playback
          ws.send(JSON.stringify({ type: "audio.end" }));
          
          // DISCARD accumulated chunks from incomplete WebM file
          // When recorder is stopped mid-stream for barge-in, the WebM isn't properly
          // finalized and causes "invalid media file" errors. We discard these partial
          // chunks and wait for the user to complete their new thought naturally.
          if (session.chunks.length > 0) {
            console.log(`[Barge-in] ${session.id}: discarding ${session.chunks.length} incomplete chunks (WebM not finalized)`);
            session.chunks = [];
          }
          
          // Reset header chunk to accept fresh recording from client
          // After barge-in, client starts a NEW MediaRecorder with its own WebM header
          session.headerChunk = null;
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
