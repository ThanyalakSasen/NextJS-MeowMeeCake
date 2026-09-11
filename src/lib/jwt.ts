/**
 * jwt — เซ็น/ตรวจ JWT ของ session ด้วย HS256 (ใช้ lib `jose` — ทำงานได้ทั้ง Edge และ Node)
 * secret มาจาก process.env.JWT_SECRET, อายุจาก JWT_EXPIRE (ค่าเริ่มต้น "7d")
 */
import { SignJWT, jwtVerify } from "jose";
import type { SessionUser } from "./session";

if (!process.env.JWT_SECRET) {
  throw new Error("กรุณากำหนดค่า JWT_SECRET ในไฟล์ .env.local");
}

const SECRET = new TextEncoder().encode(process.env.JWT_SECRET);
const EXPIRE = process.env.JWT_EXPIRE || "7d";

export async function signSession(user: SessionUser): Promise<string> {
  return new SignJWT({
    user_id: user.user_id,
    role_id: user.role_id,
    role_type: user.role_type,
    email: user.email,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(EXPIRE)
    .sign(SECRET);
}

/** คืน SessionUser ถ้า token ถูกต้องและยังไม่หมดอายุ — ไม่งั้น throw */
export async function verifySession(token: string): Promise<SessionUser> {
  const { payload } = await jwtVerify(token, SECRET, { algorithms: ["HS256"] });
  return {
    user_id: String(payload.user_id),
    role_id: String(payload.role_id),
    role_type: payload.role_type as SessionUser["role_type"],
    email: String(payload.email),
  };
}
