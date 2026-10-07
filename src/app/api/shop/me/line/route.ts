/**
 * /api/shop/me/line — ผูกบัญชี LINE เพื่อรับแจ้งเตือนออเดอร์ (src/lib/lineLogin.ts)
 *   GET    — สถานะการผูก { linked, authorize_url } · frontend พาไป authorize_url เพื่อเริ่มผูก
 *            (authorize_url อายุ 10 นาที · null ถ้าเซิร์ฟเวอร์ยังไม่ได้ตั้งค่า LINE Login)
 *   DELETE — ยกเลิกผูก (เลิกรับแจ้งเตือนทาง LINE) · บัญชีที่สมัครด้วย LINE และไม่มีรหัสผ่าน/Google = 409
 *            (LINE เป็นทางเข้าเดียว — userService.unlinkLineAccount)
 */
import { ok } from "@/lib/apiResponse";
import { withAuth } from "@/lib/authGuard";
import { buildAuthorizeUrl, lineLoginConfig, signLinkState } from "@/lib/lineLogin";
import * as userService from "@/services/userService";

export const GET = withAuth(async (session) => {
  const user = await userService.getUserById(session.user_id);
  const config = lineLoginConfig();
  const authorize_url = config
    ? buildAuthorizeUrl(config, await signLinkState(session.user_id))
    : null;
  return ok({ linked: Boolean((user as { line_user_id?: string | null }).line_user_id), authorize_url });
});

export const DELETE = withAuth(async (session) => {
  await userService.unlinkLineAccount(session.user_id);
  return ok({ linked: false });
});
