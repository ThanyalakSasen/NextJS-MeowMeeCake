/**
 * middleware — ชั้นตรวจตัวตน (authentication) + กั้น namespace หยาบ ๆ รันบน Edge ก่อนถึง route handler
 *
 * โครง path:
 *   /api/auth/*     , /api/health , /api/catalog/*  → สาธารณะ (ไม่ต้องล็อกอิน)
 *   /api/shop/*                                     → ต้องล็อกอิน (ลูกค้า/พนักงานก็ได้)
 *   /api/admin/*                                    → ต้องล็อกอิน + role_type ∈ {owner, staff}
 *
 * หน้าที่:
 *  1. ลบ header x-mmc-user ที่ client อาจแนบปลอมมาทิ้งเสมอ
 *  2. CSRF defense-in-depth: mutation (POST/PUT/PATCH/DELETE) ที่มี Origin ข้ามโดเมน → 403
 *     (เสริม cookie `SameSite=Lax` ที่กัน cross-site cookie อยู่แล้ว)
 *  3. ตรวจลายเซ็น JWT ใน cookie → แนบข้อมูลผู้ใช้ลง header x-mmc-user
 *  4. กั้น namespace ตามตารางข้างบน (role_type อยู่ใน JWT → เช็คได้บน Edge ไม่ต้อง query DB)
 *
 * การตรวจ "สิทธิ์ละเอียด" (Permissions ต้อง query DB) ทำใน route handler ของ /api/admin/* เท่านั้น
 * CORS: API นี้สมมติ same-origin (frontend = Next app เดียวกัน) — ไม่ส่ง Access-Control-Allow-* ให้
 *       ถ้าอนาคตแยก origin ต้องเพิ่ม allowlist + ตอบ preflight ที่นี่
 */
import { NextRequest, NextResponse } from "next/server";
import { verifySession } from "@/lib/jwt";
import { isCsrfSafe } from "@/lib/csrf";
import { SESSION_COOKIE, USER_HEADER, type SessionUser } from "@/lib/session";

const PUBLIC_PREFIXES = ["/api/auth/", "/api/health", "/api/catalog/"];

function isPublic(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p));
}

function deny(code: string, message: string, status: number, clearCookie = false) {
  const res = NextResponse.json(
    { success: false, error: { code, message, details: null } },
    { status }
  );
  if (clearCookie) res.cookies.delete(SESSION_COOKIE);
  return res;
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // CSRF: mutation ต้องมาจาก origin เดียวกัน (ครอบทุก /api/* รวม /api/auth/*)
  if (!isCsrfSafe(req.method, req.headers.get("origin"), req.nextUrl.host)) {
    return deny("CROSS_ORIGIN", "คำขอข้ามโดเมนถูกปฏิเสธ", 403);
  }

  const headers = new Headers(req.headers);
  headers.delete(USER_HEADER); // กัน client ปลอม header

  let user: SessionUser | null = null;
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (token) {
    try {
      user = await verifySession(token);
      headers.set(USER_HEADER, JSON.stringify(user));
    } catch {
      if (!isPublic(pathname)) {
        return deny("SESSION_INVALID", "เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่", 401, true);
      }
    }
  }

  if (pathname.startsWith("/api/admin/")) {
    if (!user) return deny("UNAUTHORIZED", "กรุณาเข้าสู่ระบบ", 401);
    if (user.role_type !== "owner" && user.role_type !== "staff") {
      return deny("FORBIDDEN", "ส่วนนี้สำหรับพนักงานเท่านั้น", 403);
    }
  } else if (pathname.startsWith("/api/shop/")) {
    if (!user) return deny("UNAUTHORIZED", "กรุณาเข้าสู่ระบบ", 401);
  }

  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ["/api/:path*"],
};
