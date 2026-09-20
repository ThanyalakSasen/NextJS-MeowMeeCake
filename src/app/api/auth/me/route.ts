/**
 * GET /api/auth/me — ข้อมูลผู้ใช้ที่ล็อกอินอยู่ (ต้องมี session)
 *   { user, permissions } — permissions = สิทธิ์ทุกเมนูของบทบาทตัวเอง { [menu_key]: { can_view, can_create, ... } }
 *   owner ได้ true หมด · staff ตามตาราง permissions · ให้ frontend ซ่อน/แสดงเมนู (ตัวบังคับสิทธิ์จริงยังอยู่ที่ route handler)
 */
import { ok } from "@/lib/apiResponse";
import { withAuth } from "@/lib/authGuard";
import * as authService from "@/services/authService";
import * as permissionService from "@/services/permissionService";

export const GET = withAuth(async (session) => {
  const [user, permissions] = await Promise.all([
    authService.me(session),
    permissionService.getMenuAccess(session),
  ]);
  return ok({ user, permissions });
});
