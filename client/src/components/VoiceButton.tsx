import { useVoiceCapture } from "../hooks/useVoiceCapture";
import type { VoiceStatus } from "../hooks/useVoiceCapture";
import "./VoiceButton.css";

interface Props {
  wsUrl: string;
}

const STATUS_LABEL: Record<VoiceStatus, string> = {
  idle: "Ready",
  connecting: "Connecting...",
  recording: "Speak now",
  processing: "Processing...",
  error: "Error",
};

export default function VoiceButton({ wsUrl }: Props) {
  const {
    status,
    transcript,
    reply,
    error,
    isSpeaking,
    liveTranscript,
    start,
    stop,
  } = useVoiceCapture(wsUrl);

  const isIdle = status === "idle" || status === "error";
  const isRecording = status === "recording";
  const isConnecting = status === "connecting";

  return (
    <div className="voice-container">
      {/* Controls */}
      {isIdle ? (
        <button className="voice-btn voice-btn--start" onClick={start}>
          Start Call
        </button>
      ) : (
        <div className="call-row">
          <button
            className="voice-btn voice-btn--end"
            onClick={stop}
            disabled={isConnecting}
          >
            End Call
          </button>
        </div>
      )}

      {/* Status + wave indicator */}
      <div className="voice-status">
        <span className={`status-dot status-dot--${status}`} />
        <span>{STATUS_LABEL[status]}</span>
      </div>

      {/* Voice wave (visible while recording) */}
      {isRecording && (
        <div className={`voice-wave ${isSpeaking ? "voice-wave--active" : ""}`}>
          {[0, 1, 2, 3, 4].map((i) => (
            <span key={i} className="voice-wave-bar" />
          ))}
        </div>
      )}

      {/* Live speech while recording */}
      {isRecording && liveTranscript && (
        <div className="voice-transcript voice-transcript--live">
          <span className="conv-label">You (speaking...)</span>
          <p>{liveTranscript}</p>
        </div>
      )}

      {/* Conversation */}
      {transcript && (
        <div className="voice-transcript">
          <span className="conv-label">You</span>
          <p>{transcript}</p>
        </div>
      )}

      {reply && (
        <div className="voice-reply">
          <span className="conv-label">Agent</span>
          <p>{reply}</p>
        </div>
      )}

      {error && <p className="voice-error">{error}</p>}
    </div>
  );
}
