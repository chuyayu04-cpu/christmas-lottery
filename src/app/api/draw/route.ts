import { assertSameOrigin, attachVisitor, errorResponse, getCookie, json, rateLimit, setCookie, visitorId } from "@/lib/http";
import { draw } from "@/lib/lottery";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const visitor = visitorId(request);
  try {
    assertSameOrigin(request);
    rateLimit(`draw:${visitor.id}`, 20, 60_000);
    rateLimit("draw", 120, 60_000);
    const body = (await request.json()) as { name?: string };
    const token = getCookie(request, "lottery_token");
    const result = await draw({ name: String(body.name ?? ""), token });
    const response = json(result);
    setCookie(response, "lottery_token", result.token);
    if (visitor.isNew) attachVisitor(response, visitor.id);
    return response;
  } catch (error) {
    const response = errorResponse(error);
    if (visitor.isNew) attachVisitor(response, visitor.id);
    return response;
  }
}
