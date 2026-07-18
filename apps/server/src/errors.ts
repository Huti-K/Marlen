import type { ApiErrorCode } from "@trailin/shared";
import type { FastifyInstance } from "fastify";
import { errorMessage } from "./utils/util.js";

/**
 * An error that already knows which HTTP status it deserves. Throw one of the
 * helpers below from anywhere under a route and the handler registered by
 * registerErrorHandler turns it into the API's standard `{ error }` body.
 *
 * `code` marks a failure the user can fix in the app (the web client turns it
 * into a click-through on the error toast); most errors don't carry one.
 *
 * Anything else that escapes a route is a bug, and becomes a 500.
 */
export class AppError extends Error {
  readonly code?: ApiErrorCode;

  constructor(
    message: string,
    readonly statusCode: number,
    options?: { cause?: unknown; code?: ApiErrorCode },
  ) {
    super(message, { cause: options?.cause });
    this.name = "AppError";
    this.code = options?.code;
  }
}

/** The request was malformed or asked for something nonsensical. */
export const badRequest = (message: string): AppError => new AppError(message, 400);

/** The thing addressed by the URL doesn't exist. */
export const notFound = (message: string): AppError => new AppError(message, 404);

/** The request is valid but conflicts with the current state (e.g. a login already running). */
export const conflict = (message: string): AppError => new AppError(message, 409);

/**
 * An upstream dependency failed: Pipedream, a mail provider, the model API.
 * An AppError cause passes through unwrapped — it already knows its status,
 * message, and code, and flattening it to a 502 would lose all three.
 */
export const upstreamError = (message: string, cause?: unknown): AppError =>
  cause instanceof AppError ? cause : new AppError(message, 502, { cause });

/**
 * Await a single-row select and throw notFound(message) if it came back
 * empty — the guard every PATCH/DELETE/action route runs before it mutates
 * or acts on a row that might not exist.
 */
export async function requireRow<T>(rows: Promise<T[]>, message: string): Promise<T> {
  const [row] = await rows;
  if (!row) throw notFound(message);
  return row;
}

/**
 * Duck-typed HTTP status off whatever an upstream SDK call threw — e.g.
 * PipedreamError from @pipedream/sdk, which every mail-provider driver's
 * calls (through pipedream/connect.ts's proxyRequest) ultimately throw.
 * Lets a route tell "that id doesn't exist upstream" (404) apart from a real
 * outage before deciding between notFound and upstreamError. Undefined when
 * the thrown value carries no numeric statusCode.
 */
export function upstreamStatusCode(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const status = (error as { statusCode?: unknown }).statusCode;
  return typeof status === "number" ? status : undefined;
}

/**
 * Map a failure from a provider call reached through the Pipedream proxy:
 * an upstream 404 means the addressed id doesn't exist there anymore — a
 * client-facing 404 (with the given message), not an outage — while anything
 * else genuinely failed upstream and becomes a 502. An AppError already
 * thrown deliberately by the route (a notFound for a missing account, a
 * badRequest for an unsupported capability) passes through as-is.
 */
export function toProviderError(error: unknown, notFoundMessage: string): AppError {
  if (error instanceof AppError) return error;
  if (upstreamStatusCode(error) === 404) return notFound(notFoundMessage);
  return upstreamError(errorMessage(error), error);
}

/** The `{ error }` envelope every non-2xx API response uses. `requestId` ties it to the logs. */
export interface ErrorResponse {
  error: string;
  requestId: string;
  /** Present when the failure is user-fixable in the app (see AppError.code). */
  code?: ApiErrorCode;
}

function statusOf(error: unknown): number {
  if (error instanceof AppError) return error.statusCode;
  if (typeof error !== "object" || error === null) return 500;
  const candidate = error as { statusCode?: unknown; validation?: unknown };
  // Fastify's own schema validation failures.
  if (candidate.validation) return 400;
  if (typeof candidate.statusCode === "number" && candidate.statusCode >= 400) {
    return candidate.statusCode;
  }
  return 500;
}

/**
 * One error shape for the whole API. Without this, an unexpected throw falls
 * through to Fastify's default handler, which answers with
 * `{ statusCode, error: "Internal Server Error", message }` — and since the web
 * client reads the `error` field (see apps/web/src/lib/api.ts), the user is
 * shown the string "Internal Server Error" while the real message is dropped.
 *
 * The real message is included even on a 500: Trailin runs on the user's own
 * machine, so the person reading the error is the person running the server.
 */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, req, reply) => {
    const statusCode = statusOf(error);

    if (statusCode >= 500) {
      req.log.error({ err: error }, "request failed");
    } else {
      req.log.warn({ err: error, statusCode }, "request rejected");
    }

    // A hijacked reply (the SSE streams) or a partially written response can't
    // be given a body — the log line above is all we can do.
    if (reply.raw.headersSent) return;

    const body: ErrorResponse = { error: errorMessage(error), requestId: String(req.id) };
    if (error instanceof AppError && error.code) body.code = error.code;
    reply.code(statusCode).send(body);
  });
}
