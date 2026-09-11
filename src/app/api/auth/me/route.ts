/** GET /api/auth/me — ข้อมูลผู้ใช้ที่ล็อกอินอยู่ (ต้องมี session) */
import { ok } from "@/lib/apiResponse";
import { withAuth } from "@/lib/authGuard";
import * as authService from "@/services/authService";

export const GET = withAuth(async (session) => {
  return ok({ user: await authService.me(session) });
});
