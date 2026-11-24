import {
  assertSameOrigin,
  errorResponse,
  getCookie,
  json,
  rateLimit,
  setCookie,
  visitorId,
  attachVisitor,
} from "@/lib/http";
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

function finish(request: Request, response: Response) {
  const visitor = visitorId(request);
  if (visitor.isNew) attachVisitor(response, visitor.id);
  return response;
}

export async function GET(request: Request) {
  try {
    const status = await hostStatus();
    if (!status.setup) {
      return finish(request, json({ setup: false, authenticated: false }));
    }
    const session = sessionOf(request);
    if (!session) {
      return finish(request, json({ setup: true, authenticated: false }));
    }
    const state = await getHostState(session);
    return finish(request, json({ setup: true, authenticated: true, ...state }));
  } catch (error) {
    return finish(request, errorResponse(error));
  }
}

export async function POST(request: Request) {
  const visitor = visitorId(request);
  try {
    assertSameOrigin(request);
    const body = (await request.json()) as {
      action?: string;
      pin?: string;
      setupSecret?: string;
      themes?: { id: string; name: string; quota: number }[];
      open?: boolean;
    };
    const action = body.action ?? "";

    if (action === "setup") {
      rateLimit(`host-setup:${visitor.id}`, 5, 15 * 60_000);
      rateLimit("host-setup", 20, 15 * 60_000);
      const { session } = await setupHost(String(body.pin ?? ""), String(body.setupSecret ?? ""));
      const response = json({ ok: true });
      setCookie(response, "host_session", session);
      if (visitor.isNew) attachVisitor(response, visitor.id);
      return response;
    }
    if (action === "login") {
      rateLimit(`host-login:${visitor.id}`, 8, 15 * 60_000);
      rateLimit("host-login", 40, 15 * 60_000);
      const { session } = await loginHost(String(body.pin ?? ""));
      const response = json({ ok: true });
      setCookie(response, "host_session", session);
      if (visitor.isNew) attachVisitor(response, visitor.id);
      return response;
    }

    const session = sessionOf(request);
    if (action === "save") {
      await saveThemes(session, body.themes ?? [], Boolean(body.open));
      return finish(request, json({ ok: true }));
    }
    if (action === "open") {
      await openEvent(session);
      return finish(request, json({ ok: true }));
    }
    if (action === "reveal") {
      return finish(request, json(await reveal(session)));
    }
    if (action === "reset") {
      await resetEvent(session);
      return finish(request, json({ ok: true }));
    }
    return finish(request, json({ error: "未知操作", code: "bad_action" }, 400));
  } catch (error) {
    const response = errorResponse(error);
    if (visitor.isNew) attachVisitor(response, visitor.id);
    return response;
  }
}
