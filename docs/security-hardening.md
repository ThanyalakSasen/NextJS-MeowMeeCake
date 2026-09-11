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

### บริบท
- session cookie เป็น `httpOnly` + **`SameSite=Lax`** (same-origin) หรือ **`SameSite=None; Secure`**
  (เมื่อเปิดโหมด cross-origin ด้วย `ALLOWED_ORIGINS`) + `secure` (prod หรือ cross-origin) อยู่แล้ว
- **2026-09-11: เปิดรองรับ frontend แยก origin จริงแล้ว** (NextJS-MeowMeeCake-Frontend, โปรเจกต์แยก) —
  ดูหัวข้อ "frontend แยก origin" ด้านล่าง แทนที่สมมติฐาน same-origin เดิม

### สิ่งที่ทำ (defense-in-depth)

**`src/lib/cors.ts`** (ใหม่) — `isAllowedOrigin(origin)` / `corsHeaders(origin)`:
- อ่าน allowlist จาก env `ALLOWED_ORIGINS` (comma-separated) — ไม่ตั้ง = ไม่มี origin ไหนผ่าน (ปิดโหมดนี้)
- `corsHeaders` คืน `Access-Control-Allow-Origin/-Credentials` + `Vary: Origin` เฉพาะ origin ที่อยู่ใน allowlist

**`src/lib/csrf.ts`** — `isCsrfSafe(method, originHeader, host)`:
- safe method (GET/HEAD/OPTIONS) → ผ่าน
- ไม่มี `Origin` header → ผ่าน (client ที่ไม่ใช่เบราว์เซอร์)
- `Origin` host === host ของคำขอ → ผ่าน
- `Origin` อยู่ใน `ALLOWED_ORIGINS` allowlist → ผ่าน
- อื่น ๆ (cross-origin นอก allowlist / `Origin: "null"` / ค่าเพี้ยน) → **ไม่ผ่าน**

**`src/middleware.ts`**:
- ตอบ preflight `OPTIONS` เองที่ Edge (204 + `Access-Control-Allow-*` เมื่อ origin อยู่ใน allowlist)
- `!isCsrfSafe(...)` → `403 CROSS_ORIGIN` เหมือนเดิม (ครอบทุก `/api/*` รวม `/api/auth/*`)
- แนบ `Access-Control-Allow-*` ลงทุก response (สำเร็จ/ปฏิเสธ) ผ่าน helper `respond()` เมื่อ origin อยู่ใน allowlist

**`src/lib/session.ts`** — `attachSession`/`clearSession`: เมื่อ `ALLOWED_ORIGINS` ไม่ว่าง → cookie เป็น
`sameSite: "none"` + `secure: true` เสมอ (สเปกบังคับคู่กัน — `localhost` เป็น secure context ในเบราว์เซอร์
สมัยใหม่ จึงทดสอบผ่าน `http://localhost` ได้โดยไม่ต้อง HTTPS)

**เทส:** `tests/lib/csrf.test.ts` (+ allowlist case), `tests/lib/cors.test.ts` (ใหม่)

### ตั้งค่าใช้งาน (dev, 2 โปรเจกต์แยกกัน)
- backend `.env.local`: `ALLOWED_ORIGINS=http://localhost:3000` (origin ของ frontend), รันที่ port 4000
  (`next dev -p 4000` — ต้องคนละ port กับ frontend)
- frontend `.env.local`: `NEXT_PUBLIC_API_BASE_URL=http://localhost:4000`, `NEXT_PUBLIC_API_MOCK=0`

### ยังเปิดค้าง / ถ้าต้องเปลี่ยน
- production: ต้องตั้ง `ALLOWED_ORIGINS` เป็น origin จริงของ frontend ที่ deploy (ไม่ใช่ localhost) —
  `secure: true` บังคับ HTTPS จริงตอนนั้น (ไม่มี localhost exception)
- proxy บางตัว strip `Origin` → การกันจะหลวม (fallback เป็น "ผ่าน") — ยอมรับได้เพราะ same-origin/allowlist
  เช็คที่ cookie (`SameSite`) ยังกันอยู่อีกชั้น
