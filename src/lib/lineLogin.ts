/**
 * lineLogin — ผูกบัญชี LINE ของลูกค้าเข้ากับบัญชีในเว็บผ่าน LINE Login (OAuth 2.0 authorization code)
 * เพื่อให้ได้ LINE userId ไว้ push แจ้งเตือนหาลูกค้า (src/lib/line.ts + customerNotifyService)
 *
 * flow:
 *   1. ลูกค้าที่ล็อกอินแล้วเรียก GET /api/shop/me/line → ได้ authorize_url (state = JWT ผูก user_id, อายุ 10 นาที)
 *   2. frontend พาไปหน้า LINE → ลูกค้ากดยินยอม → LINE redirect กลับ LINE_LOGIN_CALLBACK_URL พร้อม code/state
 *   3. GET /api/shop/me/line/callback ตรวจ state (ต้องเป็น user เดียวกับ session) → แลก code เป็น id_token →
 *      ให้ LINE ตรวจ id_token → ได้ sub (= LINE userId) เก็บลง users.line_user_id → redirect กลับ frontend
 *
 * ตั้งค่าใน .env.local (LINE Login channel ต้องอยู่ Provider เดียวกับ Messaging API channel ของ
 * LINE_CHANNEL_ACCESS_TOKEN — userId ของคนเดียวกันจะเป็นค่าเดียวกันเฉพาะภายใน Provider เดียวกัน):
 *   LINE_LOGIN_CHANNEL_ID / LINE_LOGIN_CHANNEL_SECRET
 *   LINE_LOGIN_CALLBACK_URL  — URL ของ /api/shop/me/line/callback (ต้องลงทะเบียนใน LINE Developers Console)
 *   LINE_LINK_RETURN_URL     — หน้า frontend ที่จะพากลับหลังผูกเสร็จ (แนบ ?line=linked|error)
 */
import { SignJWT, jwtVerify } from "jose";

const AUTHORIZE_URL = "https://access.line.me/oauth2/v2.1/authorize";
const TOKEN_URL = "https://api.line.me/oauth2/v2.1/token";
const VERIFY_URL = "https://api.line.me/oauth2/v2.1/verify";
const STATE_AUDIENCE = "line-link";
const STATE_TTL = "10m";

interface LineLoginConfig {
  channelId: string;
  channelSecret: string;
  callbackUrl: string;
}

/** คืน config ถ้าตั้งค่าครบ — null ถ้ายังไม่ได้ตั้ง (ให้ route ตอบ error ที่อ่านรู้เรื่องแทน crash) */
export function lineLoginConfig(): LineLoginConfig | null {
  const channelId = process.env.LINE_LOGIN_CHANNEL_ID;
  const channelSecret = process.env.LINE_LOGIN_CHANNEL_SECRET;
  const callbackUrl = process.env.LINE_LOGIN_CALLBACK_URL;
  if (!channelId || !channelSecret || !callbackUrl) return null;
  return { channelId, channelSecret, callbackUrl };
}

function stateSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("กรุณากำหนดค่า JWT_SECRET ในไฟล์ .env.local");
  return new TextEncoder().encode(secret);
}

/** state = JWT ที่ผูก user_id ไว้ — กันคนอื่นเอา callback ของตัวเองมาผูก LINE เข้าบัญชีเรา (CSRF) */
export async function signLinkState(userId: string): Promise<string> {
  return new SignJWT({ uid: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setAudience(STATE_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(STATE_TTL)
    .sign(stateSecret());
}

/** คืน user_id ใน state ถ้าถูกต้องและยังไม่หมดอายุ — null ถ้าไม่ผ่าน */
export async function verifyLinkState(state: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(state, stateSecret(), {
      algorithms: ["HS256"],
      audience: STATE_AUDIENCE,
    });
    return typeof payload.uid === "string" ? payload.uid : null;
  } catch {
    return null;
  }
}

/**
 * bot_prompt=aggressive — ถามให้เพิ่ม LINE OA เป็นเพื่อนไปในขั้นตอนเดียวกัน (push หาลูกค้าได้เฉพาะคนที่
 * เป็นเพื่อนกับ OA แล้วเท่านั้น) · ใช้ได้เมื่อผูก OA ไว้กับ LINE Login channel ในหน้า Console แล้ว
 */
export function buildAuthorizeUrl(config: LineLoginConfig, state: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: config.channelId,
    redirect_uri: config.callbackUrl,
    state,
    scope: "openid profile",
    bot_prompt: "aggressive",
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

/** แลก authorization code → id_token → ให้ LINE ตรวจ id_token แล้วคืน LINE userId (sub) */
export async function exchangeCodeForLineUserId(config: LineLoginConfig, code: string): Promise<string> {
  const tokenRes = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: config.callbackUrl,
      client_id: config.channelId,
      client_secret: config.channelSecret,
    }),
  });
  if (!tokenRes.ok) {
    const body = await tokenRes.text().catch(() => "");
    throw new Error(`LINE token ${tokenRes.status}: ${body.slice(0, 300)}`);
  }
  const { id_token } = (await tokenRes.json()) as { id_token?: string };
  if (!id_token) throw new Error("LINE ไม่คืน id_token (ต้องขอ scope openid)");

  // ให้ LINE ตรวจ signature/aud/exp ของ id_token เอง — ไม่ต้องดูแล key เอง
  const verifyRes = await fetch(VERIFY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ id_token, client_id: config.channelId }),
  });
  if (!verifyRes.ok) {
    const body = await verifyRes.text().catch(() => "");
    throw new Error(`LINE verify ${verifyRes.status}: ${body.slice(0, 300)}`);
  }
  const { sub } = (await verifyRes.json()) as { sub?: string };
  if (!sub) throw new Error("id_token ไม่มี sub");
  return sub;
}
