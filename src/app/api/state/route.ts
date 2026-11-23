import { getCookie, json } from "@/lib/http";
import { getMyResult, getPublicState } from "@/lib/lottery";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const token = getCookie(request, "lottery_token");
  const [state, mine] = await Promise.all([getPublicState(), getMyResult(token)]);
  return json({ ...state, mine });
}
