/**
 * POST /api/auth/logout — ล้าง session cookie
 * (เขียน userLog LOGOUT ให้ด้วยถ้ายังมี session ที่ตรวจผ่าน)
 */
import type { NextRequest } from "next/server";
import { ok, route } from "@/lib/apiResponse";
import { clearSession, getSession } from "@/lib/session";
import { clientIp } from "@/lib/request";
import * as userLogService from "@/services/userLogService";

export const POST = route(async (req: NextRequest) => {
  const session = getSession(req);
  if (session) {
    await userLogService.writeLog({
      user_id: session.user_id,
      action: "ออกจากระบบ",
      action_type: "LOGOUT",
      ip_address: clientIp(req),
    });
  }
  return clearSession(ok({ loggedOut: true }));
});
