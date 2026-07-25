import type { SttProviderOption } from "@marlen/shared";
import { Check, Mic, X } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { IconButton } from "@/components/ui/icon-button";
import { OpenExternalButton } from "@/components/ui/open-external-button";
import { Spinner } from "@/components/ui/spinner";
import { ApiKeyEditor } from "@/features/settings/Providers";
import { api } from "@/lib/api";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

/**
 * Dictation into the composer: press to record, press again to transcribe,
 * Escape or the discard button to drop the take. While recording, the live
 * waveform covers the composer (the surrounding wrapper is the positioned
 * ancestor). The transcript is appended as text the caller owns — a recording
 * is never sent on its own.
 */

type Phase = "idle" | "recording" | "transcribing";

/** First container the browser supports; Chromium takes webm/opus, Safari mp4. */
const MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus",
];

/** Base64 for the JSON body, chunked so a long recording never overruns the argument limit. */
function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

export function VoiceInput({
  onTranscript,
  className,
}: {
  onTranscript: (text: string) => void;
  className?: string;
}) {
  const { t, i18n } = useTranslation();
  const [phase, setPhase] = React.useState<Phase>("idle");
  // Live while recording; the waveform reads its levels, and it is what the
  // overlay switches on. Null in every other phase.
  const [analyser, setAnalyser] = React.useState<AnalyserNode | null>(null);
  // Non-null while the setup dialog is open: the providers a key can be added for.
  const [setupOptions, setSetupOptions] = React.useState<SttProviderOption[] | null>(null);
  const recorderRef = React.useRef<MediaRecorder | null>(null);
  const audioContextRef = React.useRef<AudioContext | null>(null);
  // Set before stop() when the take is discarded, so the stop handler drops the audio.
  const discardedRef = React.useRef(false);

  const send = async (blob: Blob) => {
    setPhase("transcribing");
    try {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      if (bytes.length === 0) return;
      const { text } = await api.transcribe(
        toBase64(bytes),
        blob.type || "audio/webm",
        i18n.resolvedLanguage ?? "en",
      );
      if (text) onTranscript(text);
    } catch (err) {
      toast.error(err);
    } finally {
      setPhase("idle");
    }
  };

  const start = async () => {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      toast.error(t("chat.voice.micBlocked"));
      return;
    }
    const mimeType = MIME_CANDIDATES.find((candidate) => MediaRecorder.isTypeSupported(candidate));
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.onstop = () => {
      // Releasing the tracks is what drops the OS recording indicator.
      for (const track of stream.getTracks()) track.stop();
      void audioContextRef.current?.close();
      audioContextRef.current = null;
      recorderRef.current = null;
      setAnalyser(null);
      if (discardedRef.current) {
        setPhase("idle");
        return;
      }
      void send(new Blob(chunks, { type: recorder.mimeType }));
    };

    const audioContext = new AudioContext();
    const node = audioContext.createAnalyser();
    node.fftSize = 1024;
    audioContext.createMediaStreamSource(stream).connect(node);
    audioContextRef.current = audioContext;

    discardedRef.current = false;
    recorderRef.current = recorder;
    recorder.start();
    setAnalyser(node);
    setPhase("recording");
  };

  const stop = React.useCallback((discard: boolean) => {
    discardedRef.current = discard;
    recorderRef.current?.stop();
  }, []);

  /**
   * Every press re-checks: recording only ever starts with a speech provider
   * connected, and a key removed in Settings brings the setup prompt back
   * rather than a take that fails on upload.
   */
  const press = async () => {
    if (phase !== "idle") return;
    let status: Awaited<ReturnType<typeof api.sttStatus>>;
    try {
      status = await api.sttStatus();
    } catch (err) {
      toast.error(err);
      return;
    }
    if (!status.providerId) {
      setSetupOptions(status.options);
      return;
    }
    await start();
  };

  /** Picks up where the press left off once the dialog has a key saved. */
  const keySaved = async () => {
    setSetupOptions(null);
    const status = await api.sttStatus().catch(() => null);
    if (!status?.providerId) return;
    await start();
  };

  React.useEffect(() => {
    if (phase !== "recording") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") stop(true);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [phase, stop]);

  // Unmounting mid-take drops the audio rather than transcribing into a gone composer.
  React.useEffect(
    () => () => {
      discardedRef.current = true;
      recorderRef.current?.stop();
    },
    [],
  );

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        disabled={phase !== "idle"}
        onClick={() => void press()}
        aria-label={t("chat.voice.start")}
        title={t("chat.voice.start")}
        className={cn("rounded-xl", className)}
      >
        <Mic />
      </Button>

      {phase !== "idle" && (
        <RecordingOverlay
          analyser={analyser}
          onDiscard={() => stop(true)}
          onStop={() => stop(false)}
        />
      )}

      {setupOptions && (
        <VoiceSetupDialog
          options={setupOptions}
          onClose={() => setSetupOptions(null)}
          onSaved={keySaved}
        />
      )}
    </>
  );
}

/* ---------------- Recording overlay ---------------- */

const BAR_WIDTH = 3;
const BAR_GAP = 2;
/** A silent moment still shows a spine of bars rather than an empty strip. */
const MIN_BAR_HEIGHT = 2;
/** Voice sits well under full scale; this lifts a normal speaking level to near-full bars. */
const LEVEL_GAIN = 3.2;
/** One bar per this many ms, so the wave scrolls at a readable pace whatever the frame rate. */
const BAR_INTERVAL_MS = 55;

/**
 * Scrolling amplitude bars for the live recording, newest at the right. Reads
 * the analyser on every frame and samples it into a bar on an interval, so the
 * scroll speed never depends on the display's refresh rate.
 */
function Waveform({ analyser }: { analyser: AnalyserNode }) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    const samples = new Uint8Array(analyser.fftSize);
    const levels: number[] = [];
    let lastBarAt = 0;
    let frame = 0;

    const render = (now: number) => {
      frame = requestAnimationFrame(render);
      analyser.getByteTimeDomainData(samples);
      if (now - lastBarAt >= BAR_INTERVAL_MS) {
        lastBarAt = now;
        let sum = 0;
        for (const sample of samples) {
          const centered = (sample - 128) / 128;
          sum += centered * centered;
        }
        levels.push(Math.min(1, Math.sqrt(sum / samples.length) * LEVEL_GAIN));
      }

      const { width, height } = canvas.getBoundingClientRect();
      if (width === 0 || height === 0) return;
      const ratio = window.devicePixelRatio || 1;
      if (canvas.width !== Math.round(width * ratio)) {
        canvas.width = Math.round(width * ratio);
        canvas.height = Math.round(height * ratio);
      }
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);
      // The canvas inherits the element's `currentColor`, so the wave follows
      // the accent token in both themes.
      context.fillStyle = getComputedStyle(canvas).color;

      const step = BAR_WIDTH + BAR_GAP;
      const capacity = Math.max(1, Math.floor(width / step));
      if (levels.length > capacity) levels.splice(0, levels.length - capacity);
      const scale = height - 4;
      // Always draw the full width: the bars before the take started are the
      // resting baseline, so the wave never opens as a half-empty strip.
      const silent = capacity - levels.length;
      for (let index = 0; index < capacity; index += 1) {
        const level = index < silent ? 0 : (levels[index - silent] ?? 0);
        const barHeight = Math.max(MIN_BAR_HEIGHT, level * scale);
        // Older bars fade out, so the wave reads as flowing rather than static.
        context.globalAlpha = 0.2 + 0.8 * ((index + 1) / capacity);
        context.beginPath();
        context.roundRect(
          index * step,
          (height - barHeight) / 2,
          BAR_WIDTH,
          barHeight,
          BAR_WIDTH / 2,
        );
        context.fill();
      }
      context.globalAlpha = 1;
    };

    frame = requestAnimationFrame(render);
    return () => cancelAnimationFrame(frame);
  }, [analyser]);

  return <canvas ref={canvasRef} className="h-full w-full text-accent" />;
}

function elapsedLabel(ms: number): string {
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * Covers the composer while a take is live: recording dot, elapsed time, the
 * wave, and the two ways out. Sized by the composer it fills, so opening it
 * never moves the layout.
 */
function RecordingOverlay({
  analyser,
  onDiscard,
  onStop,
}: {
  analyser: AnalyserNode | null;
  onDiscard: () => void;
  onStop: () => void;
}) {
  const { t } = useTranslation();
  const [elapsedMs, setElapsedMs] = React.useState(0);

  React.useEffect(() => {
    if (!analyser) return;
    const startedAt = performance.now();
    const timer = window.setInterval(() => setElapsedMs(performance.now() - startedAt), 200);
    return () => window.clearInterval(timer);
  }, [analyser]);

  return (
    <div className="animate-in-up absolute inset-0 z-10 flex items-center gap-3 rounded-2xl bg-surface-2 px-3">
      {analyser ? (
        <>
          <span className="flex shrink-0 items-center gap-2">
            <span className="h-2 w-2 animate-pulse rounded-full bg-destructive" />
            <span className="font-mono text-xs tabular-nums text-muted-foreground">
              {elapsedLabel(elapsedMs)}
            </span>
          </span>
          <div className="h-9 min-w-0 flex-1">
            <Waveform analyser={analyser} />
          </div>
          <IconButton onClick={onDiscard} aria-label={t("chat.voice.discard")}>
            <X className="h-4 w-4" />
          </IconButton>
          <Button
            size="icon-sm"
            className="shrink-0 rounded-xl"
            onClick={onStop}
            aria-label={t("chat.voice.stop")}
            title={t("chat.voice.stop")}
            autoFocus
          >
            <Check />
          </Button>
        </>
      ) : (
        <span className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner />
          <span className="text-shimmer">{t("chat.voice.transcribing")}</span>
        </span>
      )}
    </div>
  );
}

/* ---------------- First-use provider setup ---------------- */

/** Voice input needs a speech provider, so add a key for one right here. */
function VoiceSetupDialog({
  options,
  onClose,
  onSaved,
}: {
  options: SttProviderOption[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = React.useState<string | null>(null);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t("chat.voice.setupTitle")}
      description={t("chat.voice.setupBody")}
    >
      <div className="flex flex-col gap-3">
        {options.map((option) => (
          <div key={option.id} className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">{option.name}</span>
              {option.free && <Badge variant="success">{t("chat.voice.freeTier")}</Badge>}
              <OpenExternalButton
                url={option.keyUrl}
                label={t("chat.voice.getKey", { provider: option.name })}
                className="ml-auto"
              />
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setEditing(editing === option.id ? null : option.id)}
              >
                {t("chat.voice.addKey")}
              </Button>
            </div>
            {editing === option.id && (
              <ApiKeyEditor
                providerId={option.id}
                onDone={onSaved}
                onCancel={() => setEditing(null)}
              />
            )}
          </div>
        ))}
      </div>
    </Dialog>
  );
}
