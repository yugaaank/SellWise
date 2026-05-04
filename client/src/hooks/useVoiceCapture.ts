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
  | "speaking"
  | "interrupting"
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
const SILENCE_DURATION_MS = 600; // Snappier response
const MIN_SPEECH_DURATION_MS = 150; // Min time to consider it speech, not noise
const VAD_TICK_MS = 100;
const MIN_ABSOLUTE_RMS = 6;
const NOISE_HISTORY_SIZE = 80;
const START_HANGOVER_TICKS = 2;
const END_HANGOVER_TICKS = 6;
const CALIBRATION_TICKS = 8;
const SPEECH_BAND_MIN_HZ = 180;
const SPEECH_BAND_MAX_HZ = 3400;

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
  isPlaybackMode = false,
): () => void {
  const source = ctx.createMediaStreamSource(stream);

  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.05;

  source.connect(analyser);

  const dataArray = new Uint8Array(analyser.frequencyBinCount);
  const sampleRate = ctx.sampleRate;
  const binSize = sampleRate / 2 / analyser.frequencyBinCount;

  const minBin = Math.max(1, Math.floor(SPEECH_BAND_MIN_HZ / binSize));
  const maxBin = Math.min(dataArray.length - 1, Math.ceil(SPEECH_BAND_MAX_HZ / binSize));
  const lowBandMaxBin = Math.max(1, Math.floor(180 / binSize));

  let silenceMs = 0;
  let speechMs = 0;
  let isCurrentlySpeaking = false;
  let speechSent = false;
  let startConfidence = 0;
  let endConfidence = 0;
  let speechScoreEma = 0;

  let noiseFloor = 0;
  const noiseHistory: number[] = [];
  const SPEECH_START_SCORE = isPlaybackMode ? 14 : 8;
  const SPEECH_END_SCORE = isPlaybackMode ? 9 : 5;
  const SPEECH_DETECTION_FLOOR = isPlaybackMode ? 10 : 4;

  function pushNoiseSample(value: number) {
    if (!Number.isFinite(value) || value <= 0) return;
    noiseHistory.push(value);
    if (noiseHistory.length > NOISE_HISTORY_SIZE) {
      noiseHistory.shift();
    }
    const sorted = [...noiseHistory].sort((a, b) => a - b);
    const idx = Math.max(0, Math.floor(sorted.length * 0.2));
    const nextFloor = sorted[idx] ?? value;
    noiseFloor = noiseFloor === 0 ? nextFloor : noiseFloor * 0.92 + nextFloor * 0.08;
    noiseFloor = Math.min(Math.max(noiseFloor, 3), 120);
  }

  function calculateVoiceBandMetrics(): { rms: number; lowRatio: number; bandRatio: number } {
    analyser.getByteFrequencyData(dataArray);
    let bandEnergy = 0;
    let totalEnergy = 0;
    let lowBandEnergy = 0;
    let peak = 0;
    for (let i = minBin; i <= maxBin && i < dataArray.length; i++) {
      const value = dataArray[i];
      const energy = value * value;
      bandEnergy += energy;
      totalEnergy += energy;
      peak = Math.max(peak, value);
    }
    for (let i = 1; i <= lowBandMaxBin && i < dataArray.length; i++) {
      const value = dataArray[i];
      lowBandEnergy += value * value;
      totalEnergy += value * value;
    }

    const rms = bandEnergy > 0 ? Math.sqrt(bandEnergy / Math.max(1, maxBin - minBin + 1)) : 0;
    const lowRatio = totalEnergy > 0 ? lowBandEnergy / totalEnergy : 0;
    const bandRatio = totalEnergy > 0 ? bandEnergy / totalEnergy : 0;
    const peakBoost = peak > 0 ? Math.min(8, peak / 16) : 0;

    return { rms: rms + peakBoost, lowRatio, bandRatio };
  }

  let calibrationFrames = skipCalibration ? 0 : CALIBRATION_TICKS;
  if (skipCalibration) {
    noiseFloor = isPlaybackMode ? 12 : 8;
  }

  const timer = setInterval(() => {
    const { rms, lowRatio, bandRatio } = calculateVoiceBandMetrics();

    // During calibration, collect an initial floor from idle mic input.
    if (calibrationFrames > 0) {
      calibrationFrames--;
      if (rms > 0) pushNoiseSample(rms);
      if (calibrationFrames === 0 && noiseHistory.length > 0) {
        const sorted = [...noiseHistory].sort((a, b) => a - b);
        const idx = Math.max(0, Math.floor(sorted.length * 0.2));
        noiseFloor = Math.min(Math.max(sorted[idx] ?? sorted[0] ?? 5, 3), 120);
      }
      onVoiceStateChange(false);
      return;
    }

    const safeNoiseFloor = Math.max(noiseFloor, 1);
    const snr = 20 * Math.log10(Math.max(rms, 1) / safeNoiseFloor);
    const bandDominance = 10 * Math.log10(Math.max(bandRatio, 0.0001) / Math.max(lowRatio, 0.0001));
    const rawScore = snr + bandDominance;
    speechScoreEma = speechScoreEma === 0 ? rawScore : speechScoreEma * 0.7 + rawScore * 0.3;

    const isLoudEnough = rms >= Math.max(MIN_ABSOLUTE_RMS, noiseFloor * 1.35);
    const candidateSpeech =
      isLoudEnough &&
      speechScoreEma >= (isCurrentlySpeaking ? SPEECH_END_SCORE : SPEECH_START_SCORE);
    const detected =
      candidateSpeech || (isCurrentlySpeaking && rms >= noiseFloor * 1.15);

    if (!isCurrentlySpeaking && !detected && rms > 0 && rms < noiseFloor * 1.2) {
      pushNoiseSample(rms);
    }

    if (detected && rms >= SPEECH_DETECTION_FLOOR) {
      speechMs += 100;
      silenceMs = 0;
      startConfidence = Math.min(startConfidence + 1, START_HANGOVER_TICKS);
      endConfidence = 0;

      if (!isCurrentlySpeaking && startConfidence >= START_HANGOVER_TICKS && speechMs >= MIN_SPEECH_DURATION_MS) {
        isCurrentlySpeaking = true;
        onSpeechStart();
      }
    } else {
      silenceMs += 100;
      startConfidence = 0;
      endConfidence = Math.min(endConfidence + 1, END_HANGOVER_TICKS);

      if (isCurrentlySpeaking && endConfidence >= END_HANGOVER_TICKS && silenceMs >= SILENCE_DURATION_MS) {
        if (speechMs >= MIN_SPEECH_DURATION_MS && !speechSent) {
          speechSent = true;
          onSpeechEnd();
        }
        isCurrentlySpeaking = false;
        speechMs = 0;
        speechSent = false;
      }
    }

    onVoiceStateChange(isCurrentlySpeaking);
  }, VAD_TICK_MS);

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
    this.nextStartTime = this.ctx.currentTime + 0.4; // Increased to 400ms for jitter buffer
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
    const fadeTime = 0.008; // Increased fade for smoother stitching

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

    this.nextStartTime = startTime + duration - fadeTime; // Overlap by fadeTime
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

  const isAgentSpeakingRef = useRef(false);
  const isInterruptingRef = useRef(false); // Guard to prevent multiple interrupt calls

  const sendInterrupt = useCallback(async () => {
    // Prevent multiple concurrent interrupts
    if (isInterruptingRef.current) {
      console.log("[Barge-in] Already interrupting, ignoring duplicate");
      return;
    }
    isInterruptingRef.current = true;
    // CRITICAL: Stop the recorder first to prevent sending chunks from new recording
    // while server is processing the interrupt. This ensures clean WebM boundaries.
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      console.log("[Barge-in] Stopping recorder before sending interrupt");
      
      // Wait for onstop event to ensure final chunk is sent
      await new Promise<void>((resolve) => {
        const checkInactive = () => {
          if (recorder.state === "inactive") {
            resolve();
          } else {
            setTimeout(checkInactive, 50);
          }
        };
        recorder.onstop = () => resolve();
        recorder.stop();
        // Fallback: check state after short delay
        setTimeout(checkInactive, 100);
      });
      
      // Small delay to let final chunk arrive at server
      await new Promise(r => setTimeout(r, 100));
    }
    
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      console.log("[Barge-in] Sending interrupt signal");
      ws.send(JSON.stringify({ type: "interrupt" }));
    }
    
    // Immediately stop local audio playback
    audioPlayerRef.current?.destroy();
    audioPlayerRef.current = null;
    
    // Clear orphaned chunks
    orphanedChunksRef.current = [];
    
    setStatus("interrupting");
    setIsSpeaking(false);
    
    // Reset guard after a delay to allow future interrupts
    setTimeout(() => {
      isInterruptingRef.current = false;
    }, 500);
  }, []);

  const startRecordingWithVAD = useCallback(
    (stream: MediaStream, ws: WebSocket, skipVadCalibration = false, isPlaybackMode = false) => {
      startRecorder(stream, ws);
      startSpeechRecognition();

      const ctx = audioCtxRef.current;
      if (ctx) {
        detectionCleanupRef.current = startSpeechDetection(
          stream,
          ctx,
          () => {
            // Speech Started
            if (isPlaybackMode && isAgentSpeakingRef.current && !isInterruptingRef.current) {
              // BARGE-IN DETECTED: User spoke while agent was speaking
              console.log("[Barge-in] User interrupted agent");
              sendInterrupt().catch(console.error);
            }
          },
          () => {
            // Speech Ended: Send turn automatically (only when not in playback mode)
            if (!isPlaybackMode) {
              stopSpeechRecognition();
              sendTurnRef.current?.();
            }
          },
          (speaking) => setIsSpeaking(speaking),
          skipVadCalibration,
          isPlaybackMode,
        );
      }
    },
    [startRecorder, startSpeechRecognition, stopSpeechRecognition, sendInterrupt],
  );

  const sendTurn = useCallback(() => {
    setIsSpeaking(false);
    setTranscript(null);
    setReply(null);

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
          case "processing.start":
            setTranscript(null);
            setReply(null);
            setStatus("processing");
            break;

          case "transcript":
            setTranscript(msg.text ?? null);
            break;

          case "reply.delta":
            setReply((prev) => (prev || "") + (msg.text ?? ""));
            break;

          case "reply":
            setReply(msg.text ?? null);
            break;

          case "audio.start": {
            // Mark agent as speaking for barge-in detection
            isAgentSpeakingRef.current = true;
            
            // Stop MediaRecorder but keep microphone stream alive for barge-in detection
            const recorder = recorderRef.current;
            if (recorder && recorder.state !== "inactive") {
              recorder.stop();
            }
            stopSpeechRecognition();

            setIsSpeaking(false);
            setStatus("speaking");

            // Restart VAD in playback mode (higher thresholds to detect barge-in)
            const currentStream = streamRef.current;
            if (currentStream && audioCtxRef.current) {
              // Clean up old VAD first
              detectionCleanupRef.current?.();
              // Start new VAD in playback mode with higher SNR thresholds
              detectionCleanupRef.current = startSpeechDetection(
                currentStream,
                audioCtxRef.current,
                () => {
                  // BARGE-IN: User spoke during agent speech
                  if (isInterruptingRef.current) return; // Guard
                  console.log("[Barge-in] Detected user speech during playback");
                  sendInterrupt().catch(console.error);
                },
                () => {
                  // Speech ended during playback - no action needed
                  // (we don't auto-send turn during agent speech)
                },
                (speaking) => setIsSpeaking(speaking),
                true, // skipCalibration
                true, // isPlaybackMode - higher SNR thresholds
              );
            }

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
            // Agent finished speaking
            isAgentSpeakingRef.current = false;
            
            const player = audioPlayerRef.current;
            if (player) {
              await player.end();
              player.destroy();
              audioPlayerRef.current = null;
            }

            const currentStream = streamRef.current;
            const currentWs = wsRef.current;
            if (currentStream && currentWs?.readyState === WebSocket.OPEN) {
              // Restart recording in normal mode (not playback mode)
              startRecordingWithVAD(currentStream, currentWs, true, false);
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
