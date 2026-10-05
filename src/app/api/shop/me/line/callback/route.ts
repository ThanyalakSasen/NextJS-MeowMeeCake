/**
 * GET /api/shop/me/line/callback — LINE Login redirect กลับมาที่นี่ (ตั้งเป็น LINE_LOGIN_CALLBACK_URL)
 *   query: code, state (หรือ error ถ้าลูกค้ากดยกเลิก)
 *   ตรวจ state ต้องเป็นของ user เดียวกับ session (กัน CSRF) → แลก code เป็น LINE userId → เก็บลงบัญชี
 *   จบแล้ว redirect ไป LINE_LINK_RETURN_URL?line=linked|cancelled|error (ไม่ตั้ง = ตอบ JSON แทน)
 *
 * ตรวจ session เอง (ไม่ใช้ withAuth) — ลูกค้าอยู่หน้า LINE นาน/session หมดอายุระหว่างนั้น ต้องพากลับหน้าโปรไฟล์
 * ด้วย ?line=error&reason=login_required แทนการโชว์ JSON 401 ดิบ ๆ ในเบราว์เซอร์ (docs/LINE.md §9.8)
 * — middleware ยกเว้น path นี้ไว้ให้ถึง route ได้แม้ไม่มี/มี session เสีย (SELF_AUTH_PATHS)
 */
import { NextResponse, type NextRequest } from "next/server";
import { ok, route } from "@/lib/apiResponse";
import { log } from "@/lib/logger";
import { exchangeCodeForLineUserId, lineLoginConfig, verifyLinkState } from "@/lib/lineLogin";
import { getSession } from "@/lib/session";
import { assertSessionStillValid } from "@/lib/authGuard";
import * as userService from "@/services/userService";

type LinkResult = "linked" | "cancelled" | "error";

function finish(result: LinkResult, reason?: "login_required"): NextResponse {
  const returnUrl = process.env.LINE_LINK_RETURN_URL;
  if (!returnUrl) {
    return ok({ line: result, ...(reason ? { reason } : {}) }, result === "error" ? 400 : 200);
  }
  const url = new URL(returnUrl);
  url.searchParams.set("line", result);
  if (reason) url.searchParams.set("reason", reason);
  return NextResponse.redirect(url);
}

export const GET = route(async (req: NextRequest) => {
  const params = req.nextUrl.searchParams;
  if (params.get("error")) return finish("cancelled"); // ลูกค้ากดไม่ยินยอมในหน้า LINE

  const raw = getSession(req);
  // ตรวจบัญชีกับ DB ด้วย (ปิด/ลบ/เปลี่ยนรหัสแล้ว = ต้องล็อกอินใหม่ — BACKLOG5 Y1)
  const session = raw ? await assertSessionStillValid(raw).catch(() => null) : null;
  if (!session) return finish("error", "login_required");

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
