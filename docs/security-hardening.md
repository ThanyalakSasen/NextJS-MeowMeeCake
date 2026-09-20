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
| `POST /api/shop/promotions/validate` | `promotions:validate` | 20 / นาที — กันเดารหัสโปรโมชัน (BACKLOG2 §7, เพิ่ม 2026-09-15) |

**ที่ตรวจแล้วไม่ต้อง wire เพิ่ม (BACKLOG2 §7):** `orders/delivery-quote` (ไม่มีค่าลับให้เดา คำนวณเบา) ·
`orders/by-no/[orderNo]` (เดาถูกได้แค่ 403, keyspace ใหญ่เกิน brute-force) · `catalog/**` ทั้งหมด
(read-only, ความเสี่ยง scraping/DoS ทั่วไปเหมือน GET endpoint อื่น ไม่ใช่ของเฉพาะกลุ่มนี้)

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
> แก้ไข 2026-09-12: สลับฝั่งที่ fix port จากดราฟต์แรก — **backend คือฝั่งที่ใช้ port default (3000)**
> เพราะ deploy จริงมักตรึง backend ไว้ port เดิม ส่วน frontend ต้องเลื่อนหนีแทน (ตรงกับ `.env.local`
> จริงทั้งสองฝั่งตอนนี้ — ไม่ใช่แค่แผนอีกต่อไป)
- backend `.env.local`: `ALLOWED_ORIGINS=http://localhost:3001,http://localhost:3002` (origin ของ
  frontend — ใส่ 2 พอร์ตกัน Next auto-เลือกพอร์ตอื่นตอน 3001 ถูกจองอยู่แล้ว), รันที่ port **3000**
  (default ของ `next dev`/`next start` — ไม่ต้องใส่ `-p`)
- frontend `.env.local`: `NEXT_PUBLIC_API_BASE_URL=http://localhost:3000/api` (มี `/api` ต่อท้ายเสมอ —
  backend เสิร์ฟ route จริงใต้ `/api/*`), `NEXT_PUBLIC_API_MOCK=0`, รันที่ port **3001**
  (`next dev -p 3001` — ตั้งไว้ใน `package.json` script `"dev"` ของ frontend แล้ว กัน dev ลืมใส่ `-p`
  แล้วชนกับ backend ที่ใช้ 3000 เหมือนกัน)

### ตั้งค่าตอน deploy (frontend กับ backend คนละโดเมน)
ปัญหา: cookie `session` ถูกตั้งโดย backend จึงผูกกับโดเมนของ backend — ถ้า frontend อยู่คนละ **site**
(คนละ registrable domain) เบราว์เซอร์จะไม่ส่ง cookie นี้ไปให้ frontend เลย (และ `SameSite=None` ก็ถูกบล็อกเป็น
third-party cookie ในหลายเบราว์เซอร์) จึงต้องเลือกโครงสร้างให้ถูก:

| โครงสร้าง | backend | frontend |
|---|---|---|
| **A. subdomain ของ site เดียวกัน (แนะนำ)** เช่น `app.x.com` ↔ `api.x.com` | `COOKIE_DOMAIN=.x.com` + `ALLOWED_ORIGINS=https://app.x.com` → cookie เป็น `Lax; Secure; Domain=.x.com` | ดีฟอลต์ (`NEXT_PUBLIC_AUTH_GATE` ไม่ตั้ง) — `proxy.ts` เห็น cookie และกั้น `/owner` ก่อน render ได้ |
| **B. คนละ site** เช่น `shop.com` ↔ `api.app` | `ALLOWED_ORIGINS=https://shop.com` (ไม่ตั้ง `COOKIE_DOMAIN`) → cookie เป็น `None; Secure` ซึ่งเสี่ยงโดนบล็อกเป็น third-party cookie | `NEXT_PUBLIC_AUTH_GATE=client` — `proxy.ts` เลิกเช็ค cookie (มองไม่เห็นอยู่แล้ว) เหลือด่านฝั่ง client (`OwnerLayout` → `/auth/me`) |
| **C. same-origin** (reverse proxy รวมทั้งสองไว้โดเมนเดียว เช่น `/api/*` → backend) | ไม่ต้องตั้ง `ALLOWED_ORIGINS`/`COOKIE_DOMAIN` (`Lax`, host-only) | ดีฟอลต์ · `NEXT_PUBLIC_API_BASE_URL=/api` |

- `COOKIE_DOMAIN` ต้องขึ้นต้นด้วยจุดและเป็น domain ที่ครอบทั้งสอง host (`.x.com` ครอบ `app.x.com` และ `api.x.com`)
- `Domain` เป็นส่วนของตัวตน cookie: ตอนล้าง (logout / session เสีย) ต้องส่ง `Domain` เดียวกัน — `clearSession()` ทำให้แล้ว
  และ `middleware.ts` ใช้ `clearSession()` (เดิมใช้ `res.cookies.delete()` ซึ่งลบ cookie ที่มี `Domain` ไม่ออก)
- เปลี่ยน `COOKIE_DOMAIN`/`ALLOWED_ORIGINS` ต้อง restart backend เต็ม ๆ (Edge middleware ไม่ hot-reload env)
- ผู้ใช้ที่มี cookie เดิมแบบ host-only ค้างอยู่ตอนเปลี่ยนโครงสร้าง: cookie เก่ากับใหม่ชื่อเดียวกันแต่ Domain ต่างกัน
  จะอยู่คู่กันได้ → ถ้า login แล้ววนกลับหน้า login ให้ล้าง cookie ของเว็บนั้นในเบราว์เซอร์หนึ่งครั้ง

### ยังเปิดค้าง / ถ้าต้องเปลี่ยน
- production: ต้องตั้ง `ALLOWED_ORIGINS` เป็น origin จริงของ frontend ที่ deploy (ไม่ใช่ localhost) —
  `secure: true` บังคับ HTTPS จริงตอนนั้น (ไม่มี localhost exception)
- proxy บางตัว strip `Origin` → การกันจะหลวม (fallback เป็น "ผ่าน") — ยอมรับได้เพราะ same-origin/allowlist
  เช็คที่ cookie (`SameSite`) ยังกันอยู่อีกชั้น
