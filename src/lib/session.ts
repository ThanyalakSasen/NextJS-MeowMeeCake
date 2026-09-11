/**
 * session — ชนิดข้อมูล session + ตัวช่วยจัดการ cookie
 *
 * ระบบ auth แบ่ง 2 ชั้น:
 *   1. middleware (src/middleware.ts, รันบน Edge)  — ตรวจลายเซ็น JWT ใน cookie แล้วแนบข้อมูล
 *      ผู้ใช้ที่ผ่านการตรวจแล้วลงใน request header USER_HEADER
 *   2. route handler (รันบน Node)                  — อ่าน header นั้นผ่าน getSession() ตัดสินใจเรื่องสิทธิ์
 *
 * getSession() จึง "เชื่อ" header ที่ middleware แนบมา (middleware ลบ header ปลอมจาก client ทิ้งก่อนเสมอ)
 */
import type { NextRequest } from "next/server";
import type { NextResponse } from "next/server";

export type RoleType = "owner" | "staff" | "customer";

export interface SessionUser {
  user_id: string;
  role_id: string;
  role_type: RoleType;
  email: string;
}

export const SESSION_COOKIE = "session";
/** header ที่ middleware ใช้ส่งข้อมูลผู้ใช้ที่ผ่านการตรวจแล้วเข้ามาให้ route handler */
export const USER_HEADER = "x-mmc-user";

/** อ่าน session จาก header ที่ middleware แนบมา — null ถ้าไม่มี/ผิดรูปแบบ */
export function getSession(req: NextRequest): SessionUser | null {
  const raw = req.headers.get(USER_HEADER);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as SessionUser;
    if (!parsed?.user_id || !parsed?.role_type) return null;
    return parsed;
  } catch {
    return null;
  }
}

function cookieMaxAgeSeconds(): number {
  const days = Number(process.env.JWT_COOKIE_EXPIRE) || 7;
  return days * 24 * 60 * 60;
}

/**
 * true = ตั้งค่า ALLOWED_ORIGINS ไว้ (frontend แยก origin จริง — src/lib/cors.ts)
 * โหมดนี้ cookie ต้องเป็น SameSite=None (ไม่งั้นเบราว์เซอร์ไม่ส่ง cookie ข้าม origin มาด้วย)
 * ซึ่งสเปกบังคับว่าต้องมี Secure คู่กันเสมอ (ไม่ใช่แค่ production — localhost ก็นับเป็น
 * secure context ได้ในเบราว์เซอร์สมัยใหม่ จึงยังทดสอบ cross-origin บนเครื่องได้ผ่าน http)
 */
function crossOriginMode(): boolean {
  return (process.env.ALLOWED_ORIGINS ?? "").trim().length > 0;
}

function cookieOptions(maxAge: number) {
  const cross = crossOriginMode();
  return {
    httpOnly: true,
    sameSite: (cross ? "none" : "lax") as "none" | "lax",
    secure: cross || process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  };
}

/** เซ็ต session cookie ลงบน response */
export function attachSession(res: NextResponse, token: string): NextResponse {
  res.cookies.set(SESSION_COOKIE, token, cookieOptions(cookieMaxAgeSeconds()));
  return res;
}

/** ล้าง session cookie (ตอน logout / token เสีย) */
export function clearSession(res: NextResponse): NextResponse {
  res.cookies.set(SESSION_COOKIE, "", cookieOptions(0));
  return res;
}
