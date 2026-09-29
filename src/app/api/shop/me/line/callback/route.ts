/**
 * GET /api/shop/me/line/callback — LINE Login redirect กลับมาที่นี่ (ตั้งเป็น LINE_LOGIN_CALLBACK_URL)
 *   query: code, state (หรือ error ถ้าลูกค้ากดยกเลิก)
 *   ตรวจ state ต้องเป็นของ user เดียวกับ session (กัน CSRF) → แลก code เป็น LINE userId → เก็บลงบัญชี
 *   จบแล้ว redirect ไป LINE_LINK_RETURN_URL?line=linked|cancelled|error (ไม่ตั้ง = ตอบ JSON แทน)
 */
import { NextResponse, type NextRequest } from "next/server";
import { ok } from "@/lib/apiResponse";
import { withAuth } from "@/lib/authGuard";
import { log } from "@/lib/logger";
import { exchangeCodeForLineUserId, lineLoginConfig, verifyLinkState } from "@/lib/lineLogin";
import * as userService from "@/services/userService";

type LinkResult = "linked" | "cancelled" | "error";

function finish(result: LinkResult): NextResponse {
  const returnUrl = process.env.LINE_LINK_RETURN_URL;
  if (!returnUrl) return ok({ line: result }, result === "error" ? 400 : 200);
  const url = new URL(returnUrl);
  url.searchParams.set("line", result);
  return NextResponse.redirect(url);
}

export const GET = withAuth(async (session, req: NextRequest) => {
  const params = req.nextUrl.searchParams;
  if (params.get("error")) return finish("cancelled"); // ลูกค้ากดไม่ยินยอมในหน้า LINE

  const config = lineLoginConfig();
  const code = params.get("code");
  const state = params.get("state");
  if (!config || !code || !state) return finish("error");

  const stateUserId = await verifyLinkState(state);
  if (stateUserId !== session.user_id) {
    log.warn("line_link.state_mismatch", { user_id: session.user_id });
    return finish("error");
  }

  try {
    const lineUserId = await exchangeCodeForLineUserId(config, code);
    await userService.linkLineAccount(session.user_id, lineUserId);
    return finish("linked");
  } catch (err) {
    log.error("line_link.failed", { user_id: session.user_id, err });
    return finish("error");
  }
});
