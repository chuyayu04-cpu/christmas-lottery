import { assertSameOrigin, errorResponse, getCookie, json, rateLimit, setCookie } from "@/lib/http";
import { draw } from "@/lib/lottery";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    rateLimit(request, "draw", 20, 60_000);
    const body = (await request.json()) as { name?: string };
    const token = getCookie(request, "lottery_token");
    const result = await draw({ name: String(body.name ?? ""), token });
    const response = json(result);
    setCookie(response, "lottery_token", result.token);
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
