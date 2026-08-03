import { request as httpRequest } from "node:http";

/**
 * A request with headers nothing sanitizes: `fetch` and Playwright's API
 * client both own the Host header, and the server's DNS-rebinding guard is
 * precisely a rule about Host. Only a raw socket can express the request an
 * attacker's page would make.
 */

export interface RawResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

export function rawRequest(
  baseURL: string,
  path: string,
  headers: Record<string, string> = {},
): Promise<RawResponse> {
  const url = new URL(path, baseURL);
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method: "GET",
        // setHost false, or Node appends its own Host after ours.
        setHost: false,
        headers: { host: url.host, ...headers },
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          body += chunk;
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}
