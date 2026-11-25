import { assertSameOrigin, clientKey, errorResponse, getCookie, json, rateLimit, readJsonBody, setCookie } from "@/lib/http";
import { draw } from "@/lib/lottery";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DRAW_BODY_MAX = 2 * 1024;

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const key = clientKey(request);
    const body = await readJsonBody<{ name?: string }>(request, DRAW_BODY_MAX);
    rateLimit(`draw:${key}`, 20, 60_000);
    rateLimit("draw", 240, 60_000);
    const token = getCookie(request, "lottery_token");
    const result = await draw({ name: String(body.name ?? ""), token });
    const response = json(result);
    setCookie(response, "lottery_token", result.token);
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
