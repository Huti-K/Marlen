/**
 * onOffice CRM integration types. onOffice is a native (non-Pipedream)
 * integration authenticated with an API user's token + secret; neither is ever
 * returned to the browser.
 */

/** onOffice credential state, as shown in Settings. */
export interface OnOfficeStatus {
  configured: boolean;
  /** Where the active credentials come from: saved in the app or .env. */
  source: "settings" | "env" | null;
  /** The active API endpoint (the stable monthly one, or the latest override). */
  apiUrl: string;
}

/** Body of PUT /api/onoffice. Either field may be omitted to keep the saved one. */
export interface OnOfficeConfigInput {
  token?: string;
  secret?: string;
}
