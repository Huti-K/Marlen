import { getOAuthProvider } from "@earendil-works/pi-ai/oauth";
import type { LoginFlowStatus } from "@trailin/shared";
import { credentialStore } from "../auth/credentialStore.js";
import { errorMessage } from "../util.js";

/**
 * Manages the single in-flight OAuth login. pi-ai's login flows are
 * callback-driven (browser URL, device code, text prompts, selections);
 * this bridges them to a poll-and-respond HTTP surface for the web UI.
 */
interface Flow {
  providerId: string;
  providerName: string;
  status: LoginFlowStatus;
  pendingInput?: (value: string) => void;
  pendingSelect?: (optionId: string | undefined) => void;
  abort: AbortController;
}

let flow: Flow | null = null;

export function getLoginStatus(): LoginFlowStatus {
  if (!flow) return { providerId: null, done: true };
  return { ...flow.status };
}

export function startLogin(
  providerId: string,
  log: { info: (msg: string) => void; warn: (msg: string) => void },
): LoginFlowStatus {
  if (flow && !flow.status.done) {
    if (flow.providerId === providerId) return { ...flow.status };
    throw new Error(`A login for "${flow.providerName}" is already in progress. Cancel it first.`);
  }

  const oauthProvider = getOAuthProvider(providerId);
  if (!oauthProvider) {
    throw new Error(`Provider "${providerId}" has no subscription login. Use an API key instead.`);
  }

  const abort = new AbortController();
  const f: Flow = {
    providerId,
    providerName: oauthProvider.name,
    abort,
    status: {
      providerId,
      providerName: oauthProvider.name,
      done: false,
    },
  };
  flow = f;

  const waitForInput = (): Promise<string> =>
    new Promise<string>((resolveInput, rejectInput) => {
      f.pendingInput = resolveInput;
      abort.signal.addEventListener("abort", () => rejectInput(new Error("cancelled")), {
        once: true,
      });
    });

  oauthProvider
    .login({
      signal: abort.signal,
      onAuth: (info) => {
        f.status.authUrl = info.url;
        f.status.instructions = info.instructions;
      },
      onDeviceCode: (info) => {
        f.status.deviceCode = {
          userCode: info.userCode,
          verificationUri: info.verificationUri,
        };
      },
      onPrompt: (prompt) => {
        f.status.prompt = { message: prompt.message, placeholder: prompt.placeholder };
        return waitForInput();
      },
      onManualCodeInput: () => waitForInput(),
      onSelect: (prompt) =>
        new Promise<string | undefined>((resolveSelect) => {
          f.status.select = { message: prompt.message, options: [...prompt.options] };
          f.pendingSelect = resolveSelect;
          abort.signal.addEventListener("abort", () => resolveSelect(undefined), { once: true });
        }),
      onProgress: (message) => log.info(`[llm-auth:${providerId}] ${message}`),
    })
    .then(async (creds) => {
      await credentialStore.modify(providerId, async () => ({ type: "oauth", ...creds }));
      f.status.done = true;
      log.info(`[llm-auth:${providerId}] signed in via ${oauthProvider.name}`);
    })
    .catch((error) => {
      f.status.done = true;
      f.status.error = abort.signal.aborted ? "Login cancelled." : errorMessage(error);
      log.warn(`[llm-auth:${providerId}] login failed: ${f.status.error}`);
    });

  return { ...f.status };
}

/** Answer a pending text prompt / paste a manual authorization code. */
export function provideLoginInput(value: string): void {
  if (!flow || flow.status.done || !flow.pendingInput) {
    throw new Error("No login prompt is waiting for input.");
  }
  const resolveInput = flow.pendingInput;
  flow.pendingInput = undefined;
  flow.status.prompt = undefined;
  resolveInput(value);
}

/** Answer a pending selection (e.g. Codex "browser vs device code"). */
export function provideLoginSelection(optionId: string): void {
  if (!flow || flow.status.done || !flow.pendingSelect) {
    throw new Error("No login selection is pending.");
  }
  const resolveSelect = flow.pendingSelect;
  flow.pendingSelect = undefined;
  flow.status.select = undefined;
  resolveSelect(optionId);
}

export function cancelLogin(): void {
  if (flow && !flow.status.done) {
    flow.abort.abort();
    flow.pendingInput = undefined;
    flow.pendingSelect = undefined;
  }
}
