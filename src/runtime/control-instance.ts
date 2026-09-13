import { createServer } from "node:net";

export async function isKoordynatorControl(url: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  try {
    const response = await fetchImpl(`${url.replace(/\/$/, "")}/api/health`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(1500)
    });
    if (!response.ok) return false;
    const body = await response.json() as Record<string, unknown>;
    return body.ok === true
      && typeof body.version === "string"
      && body.liveChatBillingPolicy === "STRICT_PROVENANCE";
  } catch {
    return false;
  }
}

export async function isPortAvailable(host: string, port: number): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const probe = createServer();
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    probe.unref();
    probe.once("error", () => finish(false));
    probe.listen(port, host, () => {
      probe.close(() => finish(true));
    });
  });
}

export async function chooseControlPort(
  host: string,
  preferred: number,
  explicit: boolean,
  available: (host: string, port: number) => Promise<boolean> = isPortAvailable
): Promise<number> {
  if (await available(host, preferred)) return preferred;
  if (explicit) throw new Error("KOORDYNATOR_CONTROL_PORT_IN_USE");

  const max = Math.min(preferred + 20, 65535);
  for (let port = preferred + 1; port <= max; port += 1) {
    if (await available(host, port)) return port;
  }
  throw new Error("KOORDYNATOR_CONTROL_NO_FREE_PORT");
}
