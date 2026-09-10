# Security hardening — rate-limit · Google flow · CORS/CSRF

> อัปเดตล่าสุด: 2026-09-11
> ที่มา: [`BACKLOG.md`](BACKLOG.md) §3.2 / §3.9 / §3.10 · แผน: [`hardening-plan.md`](hardening-plan.md) เฟส D2
> เฟส D2 = 3 ข้อที่ควรทำก่อนขึ้น production · อิสระต่อกัน

---

## 1. Rate-limit `/api/auth/*` (BACKLOG §3.2)

### ปัญหาเดิม
มี account-lockout ต่อบัญชี (5 ครั้ง / 15 นาที ใน `authService`) แต่**ไม่มี IP throttle** —
credential stuffing ที่กระจายหลายบัญชีจาก IP เดียวไม่โดนกัน

### สิ่งที่ทำ

**`src/lib/rateLimit.ts`** — in-memory sliding window (ไม่เพิ่ม dependency):
```ts
rateLimit(clientIp(req), "auth:login", { limit: 10, windowMs: 60_000 });
```
- นับ 1 ครั้ง/การเรียก · เกิน `limit` ใน `windowMs` → `throw tooMany()` (HttpError **429**)
- key = `${ip}:${scope}` · `ip = null` (หา IP ไม่เจอ) → ข้าม (best-effort)
- เก็บใน `Map` ในหน่วยความจำ + sweep ทุก ~1 นาที · **รีเซ็ตเมื่อ restart, ไม่ share ข้าม instance**
  → หลาย instance / serverless: เปลี่ยน backend เป็น Redis (แก้เฉพาะไฟล์นี้)
- ใช้คู่กับ account-lockout — คนละชั้น (อันนี้ต่อ IP)
- error 429 ไหลผ่าน `toErrorResponse` เดิมอัตโนมัติ (ใช้ `err.status`/`err.code`) — เพิ่มแค่
  `tooMany()` + `"TOO_MANY_REQUESTS"` ใน `httpError.ts` · `details.retry_after_seconds`

**wire เข้า:**
| route | scope | limit |
|---|---|---|
| `POST /api/auth/login` | `auth:login` | 10 / นาที |
| `POST /api/auth/register` | `auth:register` | 5 / นาที |
| `POST /api/auth/google` | `auth:google` | 10 / นาที |
| `PATCH /api/shop/me/password` | `me:password` | 5 / นาที |

**เทส:** `tests/lib/rateLimit.test.ts` — ถึง limit → 429, `ip=null` ไม่จำกัด, แยก bucket ตาม ip+scope, sliding window นับใหม่หลังพ้น window

### งานต่อ
- ถ้า deploy หลาย instance → Redis backend (`@upstash/ratelimit` หรือ ioredis)
- พิจารณาชั้น global ที่ `middleware.ts` (ทุก `/api/*`) เป็น backstop กว้าง ๆ

---

## 2. Google login flow (BACKLOG §3.9)

### สถานะ
`authService.loginWithGoogle` ใช้ **ID-token flow** อยู่แล้ว (รับ `credential` = ID token จาก
Google Identity Services ฝั่ง frontend) — `jwtVerify(credential, GOOGLE_JWKS, { issuer, audience })`
ของ `jose` ตรวจให้ครบ: signature (JWKS) · `iss` (accounts.google.com) · `aud` (=== `GOOGLE_CLIENT_ID`) · `exp`

แต่ `.env.example` เดิมมี `GOOGLE_CLIENT_SECRET` + `GOOGLE_CALLBACK_URL` ที่ทำให้เข้าใจผิดว่าเป็น redirect/code flow

### สิ่งที่ทำ
- **`.env.example`** — ลบ `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL` · เหลือ `GOOGLE_CLIENT_ID`
  พร้อมคอมเมนต์อธิบาย ID-token flow (frontend โหลด `accounts.google.com/gsi/client` → ส่ง `credential`)
- **`authService.loginWithGoogle`** — เพิ่มเช็ค `claims.email_verified === false` → `badRequest`
  (กันผูก/สร้างบัญชีด้วยอีเมลที่ Google ยังไม่ยืนยัน — ป้องกันสวมสิทธิ์ผ่านการ link by email)
- **`docs/env.md`** — อัปเดตแถว Google vars

### ยังเปิดค้าง
- ถ้าจะรองรับ redirect/code flow ในอนาคต (เช่น ต้องการ refresh token / offline access) ค่อยเพิ่ม
  `GOOGLE_CLIENT_SECRET` + callback route กลับมา

---

## 3. CORS / CSRF (BACKLOG §3.10)

_(เพิ่มใน commit ถัดไป)_
