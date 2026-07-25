import type { SttStatus } from "@marlen/shared";
import { modelRegistry } from "../agent/llm/registry.js";
import { badRequest, upstreamError } from "../core/errors.js";
import { moduleLogger } from "../core/logger.js";
import { isHeaderSafe, isRecord } from "../core/utils/util.js";

const log = moduleLogger("stt");

/** OpenAI-compatible transcription endpoints; the first provider with a resolvable API key wins. */
const STT_PROVIDERS = [
  {
    providerId: "openai",
    url: "https://api.openai.com/v1/audio/transcriptions",
    model: "gpt-4o-mini-transcribe",
    keyUrl: "https://platform.openai.com/api-keys",
    free: false,
  },
  {
    providerId: "groq",
    url: "https://api.groq.com/openai/v1/audio/transcriptions",
    model: "whisper-large-v3-turbo",
    keyUrl: "https://console.groq.com/keys",
    free: true,
  },
  {
    providerId: "mistral",
    url: "https://api.mistral.ai/v1/audio/transcriptions",
    model: "voxtral-mini-latest",
    keyUrl: "https://console.mistral.ai/api-keys",
    free: false,
  },
] as const;

// The upload's filename extension is how these APIs sniff the container format.
const EXTENSIONS: Record<string, string> = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mp4": "mp4",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
};

async function resolveProvider(): Promise<
  ((typeof STT_PROVIDERS)[number] & { apiKey: string }) | undefined
> {
  for (const provider of STT_PROVIDERS) {
    try {
      const result = await modelRegistry.getAuth(provider.providerId);
      const apiKey = result?.auth.apiKey;
      if (!apiKey) continue;
      // A key that can't go in an Authorization header (pasted with decoration)
      // counts as unconfigured, so the UI asks for one instead of recording a
      // take that dies on upload.
      if (!isHeaderSafe(apiKey)) {
        log.warn(
          { providerId: provider.providerId },
          "stored API key is not header-safe; ignoring",
        );
        continue;
      }
      return { ...provider, apiKey };
    } catch {
      // A broken credential counts as unconfigured; the next provider may still work.
    }
  }
  return undefined;
}

/** What voice input would transcribe with now, plus where a key for each candidate comes from. */
export async function sttStatus(): Promise<SttStatus> {
  const connected = await resolveProvider();
  return {
    providerId: connected?.providerId ?? null,
    options: STT_PROVIDERS.map(({ providerId, keyUrl, free }) => ({
      id: providerId,
      name: modelRegistry.getProvider(providerId)?.name ?? providerId,
      keyUrl,
      free,
    })),
  };
}

/** Transcribes a voice recording via the first connected provider with a speech API. */
export async function transcribe(
  audio: Buffer,
  mimeType: string,
  language?: string,
): Promise<string> {
  const provider = await resolveProvider();
  if (!provider) {
    throw badRequest(
      "No speech-to-text provider is connected. Voice input needs an OpenAI, Groq, or Mistral API key (Settings).",
    );
  }

  const form = new FormData();
  const extension = EXTENSIONS[mimeType.split(";")[0] ?? ""] ?? "webm";
  // Uint8Array.from re-backs the bytes with a plain ArrayBuffer, which BlobPart requires.
  form.append("file", new Blob([Uint8Array.from(audio)], { type: mimeType }), `audio.${extension}`);
  form.append("model", provider.model);
  if (language) form.append("language", language);

  const response = await fetch(provider.url, {
    method: "POST",
    headers: { authorization: `Bearer ${provider.apiKey}` },
    body: form,
  });
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 300);
    throw upstreamError(
      `${provider.providerId} transcription failed (${response.status}): ${detail}`,
    );
  }

  const payload: unknown = await response.json();
  if (!isRecord(payload) || typeof payload.text !== "string") {
    throw upstreamError(`${provider.providerId} transcription returned an unexpected payload`);
  }
  return payload.text.trim();
}
