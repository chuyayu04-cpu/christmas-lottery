import { assertSameOrigin, errorResponse, getCookie, json, rateLimit, setCookie } from "@/lib/http";
import {
  getHostState,
  hostStatus,
  loginHost,
  openEvent,
  resetEvent,
  reveal,
  saveThemes,
  setupHost,
} from "@/lib/lottery";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function sessionOf(request: Request) {
  return getCookie(request, "host_session");
}

export async function GET(request: Request) {
  try {
    const status = await hostStatus();
    if (!status.setup) return json({ setup: false, authenticated: false });
    const session = sessionOf(request);
    if (!session) return json({ setup: true, authenticated: false });
    const state = await getHostState(session);
    return json({ setup: true, authenticated: true, ...state });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const body = (await request.json()) as {
      action?: string;
      pin?: string;
      themes?: { id: string; name: string; quota: number }[];
      open?: boolean;
    };
    const action = body.action ?? "";

    if (action === "setup") {
      rateLimit(request, "host-setup", 8, 60_000);
      const { session } = await setupHost(String(body.pin ?? ""));
      const response = json({ ok: true });
      setCookie(response, "host_session", session);
      return response;
    }
    if (action === "login") {
      rateLimit(request, "host-login", 8, 60_000);
      const { session } = await loginHost(String(body.pin ?? ""));
      const response = json({ ok: true });
      setCookie(response, "host_session", session);
      return response;
    }

    const session = sessionOf(request);
    if (action === "save") {
      await saveThemes(session, body.themes ?? [], Boolean(body.open));
      return json({ ok: true });
    }
    if (action === "open") {
      await openEvent(session);
      return json({ ok: true });
    }
    if (action === "reveal") {
      return json(await reveal(session));
    }
    if (action === "reset") {
      await resetEvent(session);
      return json({ ok: true });
    }
    return json({ error: "未知操作", code: "bad_action" }, 400);
  } catch (error) {
    return errorResponse(error);
  }
}
