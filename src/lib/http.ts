import { LotteryError } from "./lottery";

export function json(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: { "cache-control": "private, no-store" },
  });
}

export function errorResponse(error: unknown): Response {
  if (error instanceof LotteryError) {
    return json({ error: error.message, code: error.code }, error.status);
  }
  console.error(error);
  return json({ error: "伺服器忙碌，請稍後再試", code: "internal" }, 500);
}

export function getCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) {
      try {
        return decodeURIComponent(rest.join("="));
      } catch {
        return rest.join("=");
      }
    }
  }
  return undefined;
}

export function setCookie(response: Response, name: string, value: string, maxAge = 60 * 60 * 24 * 30) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  response.headers.append(
    "set-cookie",
    `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`,
  );
}

function canonicalHost(host: string): string {
  let value = host.trim().toLowerCase();
  if (value.startsWith("[")) {
    const end = value.indexOf("]");
    const name = end >= 0 ? value.slice(0, end + 1) : value;
    return name === "[::1]" ? "localhost" : name;
  }
  value = value.replace(/:\d+$/, "");
  if (value === "127.0.0.1") return "localhost";
  return value;
}

function addHost(allowed: Set<string>, raw: string | null | undefined) {
  if (!raw) return;
  allowed.add(canonicalHost(raw));
}

function publicHostsFromProxy(request: Request): string[] {
  const hosts: string[] = [];
  const forwardedHost = request.headers.get("x-forwarded-host");
  if (forwardedHost) {
    const parts = forwardedHost
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    if (parts.length > 0) hosts.push(parts[parts.length - 1]);
  }
  const forwarded = request.headers.get("forwarded");
  if (forwarded) {
    for (const part of forwarded.split(",")) {
      const match = /host="?([^";,\s]+)"?/i.exec(part);
      if (match) hosts.push(match[1]);
    }
  }
  return hosts;
}

export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return;
  let originUrl: URL;
  try {
    originUrl = new URL(origin);
  } catch {
    throw new LotteryError("來源不被允許", "forbidden", 403);
  }
  const originHost = canonicalHost(originUrl.host);
  const allowed = new Set<string>();
  try {
    addHost(allowed, new URL(request.url).host);
  } catch {
    // ignore malformed request URL
  }
  addHost(allowed, request.headers.get("host"));
  for (const host of publicHostsFromProxy(request)) addHost(allowed, host);
  if (!allowed.has(originHost)) {
    throw new LotteryError("來源不被允許", "forbidden", 403);
  }
}

const hits = new Map<string, { count: number; resetAt: number }>();
const MAX_BUCKETS = 256;

function pruneHits(now: number) {
  for (const [id, value] of hits) {
    if (value.resetAt < now) hits.delete(id);
  }
  if (hits.size <= MAX_BUCKETS) return;
  const extra = hits.size - MAX_BUCKETS;
  const oldest = [...hits.entries()].sort((a, b) => a[1].resetAt - b[1].resetAt);
  for (let i = 0; i < extra; i += 1) hits.delete(oldest[i][0]);
}

/** Global, non-IP bucket. Callers must not key this on client-controlled headers. */
export function rateLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  pruneHits(now);
  const current = hits.get(key);
  if (!current || current.resetAt < now) {
    hits.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  current.count += 1;
  if (current.count > limit) {
    throw new LotteryError("操作太頻繁，請稍候再試", "rate_limited", 429);
  }
}
