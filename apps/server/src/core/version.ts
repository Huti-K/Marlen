import { CHANGELOG } from "@marlen/shared";
import { env } from "./env.js";

/** The running app version: the desktop shell's, else the newest changelog entry (dev servers). */
export const appVersion: string = env.appVersion ?? CHANGELOG[0]?.version ?? "dev";
