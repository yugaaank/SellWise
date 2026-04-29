import { useCallback, useRef, useState } from "react";

declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

export type VoiceStatus =
  | "idle"
  | "connecting"
  | "recording"
  | "processing"
  | "error";

export interface VoiceSession {
  chunkCount: number;
  totalBytes: number;
}

export interface UseVoiceCaptureReturn {
  status: VoiceStatus;
  session: VoiceSession;
  transcript: string | null;
  reply: string | null;
  error: string | null;
  isSpeaking: boolean;
  liveTranscript: string | null;
  start: () => Promise<void>;
  sendTurn: () => void;
  stop: () => void;
}

const CHUNK_INTERVAL_MS = 250;
const SILENCE_DURATION_MS = 800; // Time to wait after speech ends
const MIN_SPEECH_DURATION_MS = 300; // Min time to consider it speech, not noise
const PCM_MIME = "audio/l16";

/**
 * Adaptive VAD with dynamic noise floor and SNR-based detection.
 * Tracks background noise continuously and requires minimum SNR for speech detection.
 */
function startSpeechDetection(
  stream: MediaStream,
  ctx: AudioContext,
  onSpeechStart: () => void,
  onSpeechEnd: () => void,
  onVoiceStateChange: (speaking: boolean) => void,
  skipCalibration = false,
): () => void {
  const source = ctx.createMediaStreamSource(stream);

  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024; // Higher resolution for better frequency analysis
  analyser.smoothingTimeConstant = 0.2; // Faster response

  source.connect(analyser);

  const dataArray = new Uint8Array(analyser.frequencyBinCount);
  const sampleRate = ctx.sampleRate;
  const binSize = sampleRate / 2 / analyser.frequencyBinCount;

  // Calculate bin indices for voice band (300Hz - 3000Hz)
  const minBin = Math.floor(300 / binSize);
  const maxBin = Math.ceil(3000 / binSize);

  // VAD state
  let silenceMs = 0;
  let speechMs = 0;
  let isCurrentlySpeaking = false;
  let speechSent = false;

  // Noise tracking
  let noiseFloor = 0;
  const noiseHistory: number[] = [];
  const NOISE_HISTORY_SIZE = 100; // 10 seconds of noise history
  const SPEECH_START_SNR = 6; // Threshold to start speech (6dB)
  const SPEECH_END_SNR = 3; // Lower threshold to end speech (3dB) - hysteresis

  function updateNoiseFloor(rms: number, isSpeech: boolean) {
    // Update noise floor continuously
    if (rms > 0) {
      noiseHistory.push(rms);
      if (noiseHistory.length > NOISE_HISTORY_SIZE) {
        noiseHistory.shift();
      }
      // Use 10th percentile for noise floor (more conservative)
      const sorted = [...noiseHistory].sort((a, b) => a - b);
      const percentile = isSpeech ? 0.05 : 0.15;
      noiseFloor = sorted[Math.floor(sorted.length * percentile)] || rms;
      // Keep noise floor capped
      noiseFloor = Math.min(noiseFloor, 100);
    }
  }

  function calculateSNR(rms: number): number {
    if (noiseFloor <= 0.1) return rms > 5 ? 10 : 0; // Assume speech if rms is high during calibration
    const snr = 20 * Math.log10(rms / noiseFloor);
    return snr;
  }

  function calculateVoiceBandRMS(): number {
    analyser.getByteFrequencyData(dataArray);

    // Debug: log raw data occasionally
    if (Math.random() < 0.02) {
      const maxVal = Math.max(...dataArray);
      const avgVal = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
      console.log(`Raw audio: max=${maxVal}, avg=${avgVal.toFixed(1)}, bins=${dataArray.length}`);
    }

    // Calculate RMS only in voice band (300Hz - 3000Hz)
    let sum = 0;
    let count = 0;
    for (let i = minBin; i <= maxBin && i < dataArray.length; i++) {
      // Weight center frequencies more (around 1000-2000Hz where speech energy is highest)
      const freq = i * binSize;
      const weight = freq >= 800 && freq <= 2000 ? 1.5 : 1.0;
      sum += (dataArray[i] * weight) ** 2;
      count += weight;
    }

    return count > 0 ? Math.sqrt(sum / count) : 0;
  }

  // Calibration period - measure initial noise floor (skip if restarting after agent speech)
  let calibrationFrames = skipCalibration ? 0 : 10; // Reduced to 1 second, or skip entirely
  if (skipCalibration) {
    noiseFloor = 50; // Use moderate default noise floor when skipping calibration
  }

  const timer = setInterval(() => {
    const rms = calculateVoiceBandRMS();

    // During calibration, just collect noise samples (don't set noiseFloor yet)
    if (calibrationFrames > 0) {
      calibrationFrames--;
      if (rms > 0) noiseHistory.push(rms);
      if (calibrationFrames === 0 && noiseHistory.length > 0) {
        // Use 10th percentile of collected samples as initial noise floor
        const sorted = [...noiseHistory].sort((a, b) => a - b);
        noiseFloor = sorted[Math.floor(sorted.length * 0.1)] || sorted[0];
        // Cap noise floor to prevent it being too high
        noiseFloor = Math.min(noiseFloor, 100);
      }
      onVoiceStateChange(false);
      return;
    }

    const snr = calculateSNR(rms);

    // Hysteresis: different thresholds for starting vs ending speech
    const threshold = isCurrentlySpeaking ? SPEECH_END_SNR : SPEECH_START_SNR;
    const detected = snr >= threshold;

    // Debug logging
    console.log(`VAD: rms=${rms.toFixed(1)}, noise=${noiseFloor.toFixed(1)}, snr=${snr.toFixed(1)}dB, detected=${detected}`);

    // Update noise floor tracking
    updateNoiseFloor(rms, detected || isCurrentlySpeaking);

    onVoiceStateChange(detected);

    if (detected) {
      speechMs += 100;
      silenceMs = 0;

      if (!isCurrentlySpeaking && speechMs >= 150) {
        isCurrentlySpeaking = true;
        onSpeechStart();
      }
    } else {
      silenceMs += 100;

      if (isCurrentlySpeaking && silenceMs >= SILENCE_DURATION_MS) {
        if (speechMs >= MIN_SPEECH_DURATION_MS && !speechSent) {
          speechSent = true;
          onSpeechEnd();
        }
        isCurrentlySpeaking = false;
        speechMs = 0;
        speechSent = false;
      }
    }
  }, 100);

  return () => {
    clearInterval(timer);
    try {
      source.disconnect();
      analyser.disconnect();
    } catch (e) {
      // ignore disconnect errors during cleanup
    }
  };
}

// Manages seamless audio chunk playback via Web Audio API
class AudioStreamPlayer {
  private ctx: AudioContext;
  private nextStartTime: number = 0;
  private isEnded: boolean = false;
  private pendingChunks: ArrayBuffer[] = [];
  private isProcessing: boolean = false;
  private gainNode: GainNode;
  private endPromise: Promise<void> | null = null;
  private resolveEnd: (() => void) | null = null;
  private activeSources: Set<AudioBufferSourceNode> = new Set();

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
    this.gainNode = this.ctx.createGain();
    this.gainNode.connect(this.ctx.destination);
    console.log("[AudioPlayer] Initialized");
  }

  async start(): Promise<void> {
    this.nextStartTime = this.ctx.currentTime + 0.1;
    this.isEnded = false;
    this.endPromise = new Promise((resolve) => {
      this.resolveEnd = resolve;
    });
    console.log("[AudioPlayer] Started");
  }

  appendChunk(data: ArrayBuffer): void {
    if (this.isEnded && this.pendingChunks.length === 0) return;
    this.pendingChunks.push(data);
    this.processQueue();
  }

  private async processQueue() {
    if (this.isProcessing || this.pendingChunks.length === 0) {
      this.checkEndCondition();
      return;
    }
    this.isProcessing = true;

    const data = this.pendingChunks.shift()!;
    try {
      const bufferToUse = data.byteLength % 2 === 0 ? data : data.slice(0, data.byteLength - 1);
      const int16Array = new Int16Array(bufferToUse);
      const float32Array = new Float32Array(int16Array.length);
      
      for (let i = 0; i < int16Array.length; i++) {
        float32Array[i] = int16Array[i] / 32768.0;
      }

      const buffer = this.ctx.createBuffer(1, float32Array.length, 24000);
      buffer.getChannelData(0).set(float32Array);

      this.scheduleBuffer(buffer);
    } catch (e) {
      console.error("[AudioPlayer] PCM error:", e);
    } finally {
      this.isProcessing = false;
      // Use setImmediate-like behavior with Promise
      Promise.resolve().then(() => this.processQueue());
    }
  }

  private scheduleBuffer(buffer: AudioBuffer) {
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;

    const localGain = this.ctx.createGain();
    source.connect(localGain);
    localGain.connect(this.gainNode);

    const startTime = Math.max(this.nextStartTime, this.ctx.currentTime);
    const duration = buffer.duration;
    const fadeTime = 0.005;

    localGain.gain.setValueAtTime(0, startTime);
    localGain.gain.linearRampToValueAtTime(1, startTime + fadeTime);
    localGain.gain.setValueAtTime(1, startTime + duration - fadeTime);
    localGain.gain.linearRampToValueAtTime(0, startTime + duration);

    source.start(startTime);
    this.activeSources.add(source);
    
    source.onended = () => {
      this.activeSources.delete(source);
      this.checkEndCondition();
    };

    this.nextStartTime = startTime + duration - fadeTime;
  }

  private checkEndCondition() {
    if (this.isEnded && this.pendingChunks.length === 0 && this.activeSources.size === 0 && !this.isProcessing) {
      console.log("[AudioPlayer] All chunks played, resolving end");
      this.resolveEnd?.();
    }
  }

  async end(): Promise<void> {
    console.log(`[AudioPlayer] End called. Pending=${this.pendingChunks.length}, Active=${this.activeSources.size}`);
    this.isEnded = true;
    this.checkEndCondition();
    await this.endPromise;
  }

  destroy(): void {
    console.log("[AudioPlayer] Destroying");
    this.isEnded = true;
    this.pendingChunks = [];
    this.activeSources.forEach(s => {
      try { s.stop(); } catch(e) {}
    });
    this.activeSources.clear();
  }
}

function getSupportedMimeType(): string {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4",
  ];
  return candidates.find((t) => MediaRecorder.isTypeSupported(t)) ?? "";
}

export function useVoiceCapture(wsUrl: string): UseVoiceCaptureReturn {
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [session, setSession] = useState<VoiceSession>({
    chunkCount: 0,
    totalBytes: 0,
  });
  const [transcript, setTranscript] = useState<string | null>(null);
  const [reply, setReply] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const detectionCleanupRef = useRef<(() => void) | null>(null);
  const sendTurnRef = useRef<(() => void) | null>(null);
  const audioPlayerRef = useRef<AudioStreamPlayer | null>(null);
  const recognitionRef = useRef<any>(null);
  const orphanedChunksRef = useRef<ArrayBuffer[]>([]);

  const startRecorder = useCallback((stream: MediaStream, ws: WebSocket) => {
    // Stop old recorder before creating new one
    const oldRecorder = recorderRef.current;
    if (oldRecorder && oldRecorder.state !== "inactive") {
      oldRecorder.stop();
    }

    const mimeType = getSupportedMimeType();
    const recorder = new MediaRecorder(
      stream,
      mimeType ? { mimeType } : undefined,
    );
    recorderRef.current = recorder;

    recorder.ondataavailable = async (e) => {
      if (e.data.size === 0 || ws.readyState !== WebSocket.OPEN) return;
      const buffer = await e.data.arrayBuffer();
      ws.send(buffer);
      setSession((prev) => ({
        chunkCount: prev.chunkCount + 1,
        totalBytes: prev.totalBytes + buffer.byteLength,
      }));
    };

    recorder.onerror = () => {
      setError("MediaRecorder error");
      setStatus("error");
    };

    recorder.start(CHUNK_INTERVAL_MS);
  }, []);

  const startSpeechRecognition = useCallback(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onresult = (event: any) => {
      let final = "";
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          final += result[0].transcript;
        } else {
          interim += result[0].transcript;
        }
      }
      setLiveTranscript(final + interim);
    };

    recognition.onerror = () => {
      // Ignore errors, just restart if needed
    };

    recognitionRef.current = recognition;
    recognition.start();
  }, []);

  const stopSpeechRecognition = useCallback(() => {
    const recognition = recognitionRef.current;
    if (recognition) {
      recognition.stop();
      recognitionRef.current = null;
    }
    setLiveTranscript(null);
  }, []);

  const startRecordingWithVAD = useCallback(
    (stream: MediaStream, ws: WebSocket, skipVadCalibration = false) => {
      startRecorder(stream, ws);
      startSpeechRecognition();

      const ctx = audioCtxRef.current;
      if (ctx) {
        detectionCleanupRef.current = startSpeechDetection(
          stream,
          ctx,
          () => {
            // Speech Started: Interrupt agent
            if (audioPlayerRef.current) {
              audioPlayerRef.current.destroy();
              audioPlayerRef.current = null;
            }
          },
          () => {
            // Speech Ended: Send turn automatically
            stopSpeechRecognition();
            sendTurnRef.current?.();
          },
          (speaking) => setIsSpeaking(speaking),
          skipVadCalibration,
        );
      }
    },
    [startRecorder, startSpeechRecognition, stopSpeechRecognition],
  );

  const sendTurn = useCallback(() => {
    setIsSpeaking(false);

    const recorder = recorderRef.current;
    const ws = wsRef.current;
    if (!recorder || recorder.state === "inactive" || !ws) return;

    // Pre-warm audio player for incoming response
    audioPlayerRef.current?.destroy();
    const ctx = audioCtxRef.current;
    if (ctx) {
      const player = new AudioStreamPlayer(ctx);
      audioPlayerRef.current = player;
      player.start().catch(console.error);
    }

    setStatus("processing");
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "session.end" }));
    }
  }, []);

  sendTurnRef.current = sendTurn;

  const start = useCallback(async () => {
    setError(null);
    setTranscript(null);
    setReply(null);
    setSession({ chunkCount: 0, totalBytes: 0 });
    setStatus("connecting");

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Mic permission denied");
      setStatus("error");
      return;
    }
    streamRef.current = stream;

    const ctx = new AudioContext();
    if (ctx.state === "suspended") await ctx.resume();
    const silentBuf = ctx.createBuffer(1, 1, ctx.sampleRate);
    const unlocker = ctx.createBufferSource();
    unlocker.buffer = silentBuf;
    unlocker.connect(ctx.destination);
    unlocker.start(0);
    audioCtxRef.current = ctx;

    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const resolvedUrl = wsUrl.startsWith("ws")
      ? wsUrl
      : `${protocol}://${window.location.host}${wsUrl}`;

    const ws = new WebSocket(resolvedUrl);
    wsRef.current = ws;
    ws.binaryType = "arraybuffer";

    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          type: "session.start",
          sessionId: `s_${Date.now()}`,
        }),
      );
      startRecordingWithVAD(stream, ws);
      setStatus("recording");
    };

    ws.onmessage = async (event) => {
      if (event.data instanceof ArrayBuffer) {
        if (audioPlayerRef.current) {
          audioPlayerRef.current.appendChunk(event.data);
        } else {
          console.warn("[WS] Chunk received but player not ready. Buffering.");
          orphanedChunksRef.current.push(event.data);
        }
        return;
      }

      try {
        const msg = JSON.parse(event.data as string) as {
          type: string;
          text?: string;
          message?: string;
        };

        switch (msg.type) {
          case "transcript":
            setTranscript(msg.text ?? null);
            break;

          case "reply":
            setReply(msg.text ?? null);
            break;

          case "audio.start": {
            detectionCleanupRef.current?.();
            detectionCleanupRef.current = null;

            // Stop recording and speech recognition while agent is speaking
            const recorder = recorderRef.current;
            if (recorder && recorder.state !== "inactive") {
              recorder.stop();
            }
            stopSpeechRecognition();

            setIsSpeaking(false);
            setStatus("processing");

            // Use existing pre-warmed player if available, otherwise create one
            let player = audioPlayerRef.current;
            if (!player && audioCtxRef.current) {
              player = new AudioStreamPlayer(audioCtxRef.current);
              audioPlayerRef.current = player;
              await player.start();
            }
            
            // Flush any chunks that arrived early
            if (player && orphanedChunksRef.current.length > 0) {
              console.log(`[WS] Flushing ${orphanedChunksRef.current.length} orphaned chunks to player`);
              orphanedChunksRef.current.forEach(c => player!.appendChunk(c));
              orphanedChunksRef.current = [];
            }
            break;
          }

          case "audio.end": {
            const player = audioPlayerRef.current;
            if (player) {
              await player.end();
              player.destroy();
              audioPlayerRef.current = null;
            }

            const currentStream = streamRef.current;
            const currentWs = wsRef.current;
            if (currentStream && currentWs?.readyState === WebSocket.OPEN) {
              startRecordingWithVAD(currentStream, currentWs, true); // Skip calibration for instant restart
              setStatus("recording");
            }
            break;
          }

          case "error":
            setError(msg.message ?? "Unknown error");
            setStatus("error");
            break;
        }
      } catch {
        // ignore parse errors
      }
    };

    ws.onerror = () => {
      setError("WebSocket connection failed");
      setStatus("error");
      stream.getTracks().forEach((t) => t.stop());
    };

    ws.onclose = () => {
      setStatus((s) => (s === "recording" || s === "processing" ? "idle" : s));
    };
  }, [wsUrl, startRecordingWithVAD, stopSpeechRecognition]);

  const stop = useCallback(() => {
    detectionCleanupRef.current?.();
    detectionCleanupRef.current = null;

    stopSpeechRecognition();

    audioPlayerRef.current?.destroy();
    audioPlayerRef.current = null;

    const recorder = recorderRef.current;
    const ws = wsRef.current;
    const stream = streamRef.current;

    recorderRef.current = null;
    streamRef.current = null;
    wsRef.current = null;

    stream?.getTracks().forEach((t) => t.stop());

    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    }

    if (
      ws &&
      (ws.readyState === WebSocket.OPEN ||
        ws.readyState === WebSocket.CONNECTING)
    ) {
      ws.close();
    }

    audioCtxRef.current?.close();
    audioCtxRef.current = null;

    setStatus("idle");
    setTranscript(null);
    setReply(null);
    setIsSpeaking(false);
  }, [stopSpeechRecognition]);

  return {
    status,
    session,
    transcript,
    reply,
    error,
    isSpeaking,
    liveTranscript,
    start,
    sendTurn,
    stop,
  };
}
