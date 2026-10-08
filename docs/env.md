# Environment Variables — MeowMeeCake Backend

> อัปเดตล่าสุด: 2026-09-02

ตัวแปรสภาพแวดล้อมของฝั่ง backend อ่านมาจากไฟล์ **`.env.local`** ที่ root ของโปรเจกต์

- `.env.local` — ค่าจริง **ถูก `.gitignore` ไว้** ไม่ commit เข้า repo
- `.env.example` — เทมเพลต (ค่าเป็น placeholder) commit เข้า repo ได้ ใช้เป็นแม่แบบตอน setup เครื่องใหม่

Next.js โหลด `.env.local` ให้อัตโนมัติตอน `next dev` / `next build`
สคริปต์ที่รันด้วย `tsx` (เช่น `npm run seed`) โหลดผ่าน `scripts/_env.ts` → `process.loadEnvFile()`

---

## 1. ตัวแปรที่โค้ดใช้จริง

| ตัวแปร | จำเป็น | ค่าเริ่มต้น | อ่านที่ไฟล์ | คำอธิบาย |
|---|---|---|---|---|
| `MONGODB_URI` | ✅ ใช่ | — | `src/lib/dbConnect.ts` | connection string ของ MongoDB · **ถ้าไม่ตั้ง แอป throw ทันทีตอนโหลด** |
| `JWT_SECRET` | ✅ ใช่ | — | `src/lib/jwt.ts` | กุญแจลับเซ็น/ตรวจ JWT ของ session (HS256) · **ถ้าไม่ตั้ง แอป throw** · ต้องเป็นค่าสุ่มยาว (ดู §3) |
| `JWT_EXPIRE` | ไม่ | `7d` | `src/lib/jwt.ts` | อายุ token เช่น `7d`, `12h`, `30m` (รูปแบบของ lib `jose`) |
| `JWT_COOKIE_EXPIRE` | ไม่ | `7` | `src/lib/session.ts` | อายุ cookie `session` เป็น**จำนวนวัน** (ตัวเลขล้วน) |
| `NODE_ENV` | อัตโนมัติ | `development` | `src/lib/session.ts` | Next.js ตั้งให้เอง (`production` ตอน `next build`/`start`) · ใช้เปิด flag `Secure` ของ cookie เมื่อเป็น production |
| `GOOGLE_CLIENT_ID` | เฉพาะ Google login | — | `src/services/authService.ts` | Client ID จาก Google Cloud Console · ใช้เป็น `audience` ตอน verify Google ID token ที่ `POST /api/auth/google` · ถ้าไม่ตั้ง endpoint นั้นจะตอบ error |
| `DELIVERY_FREE_MIN` | ไม่ | `1500` | `src/services/deliveryService.ts` | ยอดสั่งซื้อ (บาท) ที่ถึงแล้วส่งฟรี (ใช้เสมอ ไม่ว่าโซนจะมาจาก DB หรือ fallback) · **เฉพาะหลังร้าน/POS** — ออเดอร์จากหน้าเว็บคิดจาก ShippingZones ไม่มีส่งฟรีตามยอด (customer-backend-merge.md §8.7) |
| `NEXTAUTH_SECRET` | สำหรับหน้าเว็บลูกค้า | — | `src/lib/nextAuth.ts` · `src/middleware.ts` | กุญแจเซ็น session ของ next-auth · ไม่ตั้ง = middleware ไม่อ่าน session next-auth (ล็อกอินผ่านหน้าเว็บลูกค้าไม่ได้) · ใช้ค่าเดียวกับ backend ฝั่งลูกค้าถ้าไม่อยากให้ลูกค้าหลุดตอนสลับ (customer-backend-merge.md §8.9) |
| `NEXTAUTH_URL` | สำหรับหน้าเว็บลูกค้า | — | next-auth | URL ที่เบราว์เซอร์เห็น (หน้าเว็บลูกค้า — เรียก /api ผ่าน rewrites) · callback OAuth = `{NEXTAUTH_URL}/api/auth/callback/{google,line}` |
| `GOOGLE_CLIENT_SECRET` | ถ้าเปิด Google ใน next-auth | — | `src/lib/nextAuth.ts` | คู่กับ `GOOGLE_CLIENT_ID` · ไม่ตั้ง = next-auth ไม่มีปุ่ม Google (`/api/auth/google` แบบ ID-token ของหลักยังใช้ได้) |
| `STOREFRONT_URL` | ไม่ | `NEXTAUTH_URL` | `src/lib/storefront.ts` | URL หน้าเว็บลูกค้าในลิงก์อีเมล (`/customer/verify-email` · `/customer/reset-password`) + ลิงก์หน้าคำสั่งซื้อท้ายข้อความ LINE ถึงลูกค้า (`customerNotifyService.withDocLink`) · ไม่ได้ตั้งทั้งคู่ = LINE ไม่แนบลิงก์ |
| `EMAIL_USER`, `EMAIL_PASS` | สมัคร/ลืมรหัสผ่าน | — | `src/lib/mailer.ts` | บัญชีส่งอีเมล (Gmail ใช้ App Password) · ไม่ตั้ง = สมัครสมาชิก/ลืมรหัสผ่านตอบ 502 |
| `EMAIL_SERVICE` หรือ `EMAIL_HOST` + `EMAIL_PORT` | ไม่ | `gmail` | `src/lib/mailer.ts` | ผู้ให้บริการของ nodemailer หรือ SMTP เอง (port 465 = TLS) |
| `RECOMMENDATION_CACHE_TTL_MS` | ไม่ | `180000` | `src/services/recommendation/recommendationEngine.ts` | อายุ cache แคตตาล็อกของระบบแนะนำสินค้า (ms) · `0` = ปิด (เทส) · แก้สินค้าแล้วผลแนะนำเปลี่ยนภายในเวลานี้ |
| `PROMPTPAY_ID` | ไม่ | — | `src/services/promptpayService.ts` | เลขพร้อมเพย์สำหรับ QR หน้าชำระเงินของลูกค้า — **ใช้เมื่อ `StoreProfile.promptpay_id` ยังไม่ได้ตั้ง** · ไม่ตั้งทั้งคู่ = หน้าชำระเงินไม่มี QR (`qr_error`) |
| `DELIVERY_FEE_METRO` | ไม่ | `40` | `src/services/deliveryService.ts` | **fallback เท่านั้น** (BACKLOG §3.15) — ใช้ต่อเมื่อยังไม่มีโซนไหนตั้งไว้ใน `/api/admin/delivery-zones` เลย ปกติแอดมินแก้ค่าส่งผ่านหน้านั้นแทน ไม่ต้องแก้ env+redeploy แล้ว · ค่าส่ง กรุงเทพฯ + ปริมณฑล (นนทบุรี/ปทุมธานี/สมุทรปราการ/สมุทรสาคร/นครปฐม) |
| `DELIVERY_FEE_UPCOUNTRY` | ไม่ | `80` | `src/services/deliveryService.ts` | **fallback เท่านั้น** เช่นเดียวกับข้างบน — ค่าส่งต่างจังหวัด (จังหวัดอื่นทั้งหมด) |
| `DELIVERY_ZONE_CACHE_TTL_MS` | ไม่ | `60000` | `src/services/deliveryZoneService.ts` | อายุ cache ของโซนค่าจัดส่งจาก DB (มิลลิวินาที) — ตั้งเป็น `0` ปิด cache ได้ (ใช้ตอนเทส) |
| `PERMISSION_CACHE_TTL_MS` | ไม่ | `30000` | `src/services/permissionService.ts` | อายุ cache ของ `getEffectivePermissions()` ต่อ role (มิลลิวินาที, BACKLOG3 §7) — invalidate ทันทีทุกจุดที่เขียน permission อยู่แล้ว TTL เป็นแค่ backstop · ตั้งเป็น `0` ปิด cache ได้ (ใช้ตอนเทส) · หลาย instance พร้อมกันต้องเปลี่ยนเป็น Redis เหมือน `rateLimit.ts` |
| `UPLOAD_DRIVER` | ไม่ | `localDisk` | `src/lib/upload.ts` | `localDisk` (เขียนลง `public/uploads/` — self-host เท่านั้น) หรือ `s3` (S3-compatible: AWS S3 / Cloudflare R2 / GCS interop — จำเป็นถ้า deploy serverless) |
| `PRIVATE_UPLOAD_DIR` | ไม่ | `storage/private` | `src/lib/privateFiles.ts` | ที่เก็บไฟล์ส่วนตัว (สลิปโอนเงิน) นอก `public/` — เปิดดูได้ผ่าน `/api/files/slips/…` ที่ตรวจสิทธิ์เท่านั้น · s3 ใช้ key `private/…` ใน bucket เดิม (ตั้ง prefix นี้ให้ไม่ public) — ดู [`uploads.md`](uploads.md) §6 |
| `S3_BUCKET` | เฉพาะ `UPLOAD_DRIVER=s3` | — | `src/lib/upload.ts` | ชื่อ bucket ปลายทาง |
| `S3_REGION` | ไม่ | `auto` | `src/lib/upload.ts` | region ของ bucket (R2 ใช้ `auto` ได้) |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | เฉพาะ `UPLOAD_DRIVER=s3` | — | `src/lib/upload.ts` | credential เข้าถึง bucket |
| `S3_ENDPOINT` | เฉพาะ R2/GCS | — | `src/lib/upload.ts` | ใส่เมื่อไม่ได้ใช้ AWS S3 ตรงๆ (เช่น `https://<account>.r2.cloudflarestorage.com`) |
| `S3_PUBLIC_URL_BASE` | เฉพาะ `UPLOAD_DRIVER=s3` **(บังคับ — `save()` throw ถ้าไม่ตั้ง)** | — | `src/lib/upload.ts` | โดเมนอ่านไฟล์กลับ (CDN หรือ bucket public url) — ใช้ประกอบ url ที่คืนให้ client และแกะกลับเป็น key ตอนลบไฟล์ (ไม่ตั้ง = ลบไฟล์จริงไม่ได้เลยเงียบ ๆ ตลอดไป ดู [`BACKLOG2.md`](BACKLOG2.md) §6) |

### ตัวอย่างค่า (`.env.local`)

```dotenv
# ── จำเป็น ──────────────────────────────────────────────
MONGODB_URI=mongodb://127.0.0.1:27017/meowmeecake
# หรือ Atlas:
# MONGODB_URI=mongodb+srv://<user>:<pass>@<cluster>/meowmeecake?retryWrites=true&w=majority

JWT_SECRET=Uzz0nALzbzbwylmt74Ml0jc0DOUttd1RbnulIWBzJTDedmZmMzgWx1D-M5iG51Ye
JWT_EXPIRE=7d
JWT_COOKIE_EXPIRE=7

# ── เฉพาะเมื่อเปิดใช้ Google login ──────────────────────
GOOGLE_CLIENT_ID=556882585770-xxxxxxxx.apps.googleusercontent.com
```

> `NODE_ENV` **ไม่ต้อง**ใส่ใน `.env.local` — Next.js จัดการเอง

---

## 2. ตัวแปรที่มีใน `.env.local` แต่โค้ด backend **ยังไม่ได้ใช้**

มีมาจากงานเดิม/เผื่ออนาคต — เก็บไว้ได้ แต่ปัจจุบันไม่มีผลกับ API

| ตัวแปร | ไว้ทำอะไร (ในอนาคต) |
|---|---|
| `GOOGLE_CALLBACK_URL` | ไม่ใช้ — next-auth กำหนด callback เอง (`{NEXTAUTH_URL}/api/auth/callback/google`) |
| `SESSION_SECRET` | เผื่อระบบ session แบบเก่า (express-session ฯลฯ) · โค้ดปัจจุบันใช้ JWT ล้วน — **ควรตั้งเป็นค่าสุ่ม** เผื่อใช้ทีหลัง |
| `LINE_CHANNEL_ACCESS_TOKEN`, `LINE_TARGET_ID` | แจ้งเตือนผ่าน LINE (เจ้าของร้าน + ลูกค้า) — ดู [`LINE.md`](LINE.md) |
| `LINE_LOGIN_CHANNEL_ID`, `LINE_LOGIN_CHANNEL_SECRET`, `LINE_LOGIN_CALLBACK_URL`, `LINE_LINK_RETURN_URL` | ลูกค้าผูกบัญชี LINE (LINE Login) — ดู [`LINE.md`](LINE.md) |
| `LINE_AUTH_CALLBACK_URL`, `LINE_AUTH_RETURN_URL` | ล็อกอินด้วย LINE จาก frontend แยก origin (`GET /api/auth/line` → `/api/auth/line/callback` → ตั้ง cookie `session` → กลับหน้า `/login/line` ของ frontend) · callback ต้องลงทะเบียนเพิ่มใน LINE Developers Console · ไม่ตั้ง = ปิด (400) — `src/lib/lineLogin.ts` |
| `ADMIN_APP_URL` | ไม่บังคับ — URL เว็บหลังร้าน (เช่น `https://app.example.com`) · ตั้งแล้วข้อความ LINE ถึงเจ้าของร้านแนบลิงก์ `🔗` ไปหน้าออเดอร์/สินค้า/วัตถุดิบที่เกี่ยวข้อง · ไม่ตั้ง = ไม่แนบ (docs/LINE.md §9.12) |
| `LINE_NOTIFY_POS_ORDERS` | `true` = ออเดอร์หน้าร้าน (POS) ส่ง LINE หาเจ้าของร้านด้วย · ไม่ตั้ง = บันทึกในหน้าแจ้งเตือนเว็บอย่างเดียว — ดู [`LINE.md`](LINE.md) §9.5 |
| `LINE_OWNER_QUOTA_RESERVE` | จำนวนข้อความ LINE ที่กันไว้ให้เจ้าของร้านต่อเดือน (ค่าเริ่มต้น 30) — โควตาเหลือเท่านี้แล้วหยุดส่งหาลูกค้า — ดู [`LINE.md`](LINE.md) §9.6 |
| `CRON_SECRET` | secret ของ `/api/cron/*` (header `Authorization: Bearer …`) · ไม่ตั้ง = ปิด endpoint — ดู [`LINE.md`](LINE.md) §9.7 |
| `PREORDER_REMINDER_DAYS_BEFORE` | เตือนลูกค้าก่อนวันรับพรีออเดอร์กี่วัน (ค่าเริ่มต้น 1 · 0 = วันรับ) — ดู [`LINE.md`](LINE.md) §9.7 |
| `PREORDER_PAYMENT_DEADLINE_HOURS` | ชั่วโมงที่ต้องชำระเงินหลังสั่งพรีออเดอร์ (ค่าเริ่มต้น 24 · ไม่เกินเวลาปิดรอบ) เลยแล้วยกเลิกอัตโนมัติ — ดู [`preorder-round-flow.md`](preorder-round-flow.md) §6 |

---

## 3. เรื่อง Secret — ทำไมต้องสุ่ม และสุ่มยังไง

### กุญแจลับคืออะไร

`JWT_SECRET` = **กุญแจที่มีแค่เซิร์ฟเวอร์รู้** ใช้ 2 จังหวะ:

1. **ล็อกอินสำเร็จ** → เซิร์ฟเวอร์เอาข้อมูลผู้ใช้ (`user_id`, `role_type`, ...) มา "ปั๊มตรา" ด้วยกุญแจนี้ → ได้ token ยัดใส่ cookie `session`
2. **ทุก request** → เซิร์ฟเวอร์ตรวจว่าตราบน token ปั๊มด้วยกุญแจนี้จริงไหม ถ้าจริง = เชื่อว่าเป็นผู้ใช้คนนั้น (middleware + `requireAuth`/`requirePermission`)

> เหมือน **ตราประทับของร้าน** บนบัตรพนักงาน — ยามเห็นตราถูกต้องก็ปล่อยเข้า

HS256 ที่ใช้อยู่ **กุญแจเซ็น = กุญแจตรวจ** (ตัวเดียวกัน) → ใครรู้กุญแจ ก็ปั๊มตราปลอมได้

### ทำไม "มีค่าอยู่แล้ว" ไม่พอ

ค่า placeholder เช่น `your-super-secret-jwt-key-change-this-to-random-string` อยู่ในเทมเพลตทั่วอินเทอร์เน็ต = **ตราประทับที่ซื้อได้ตามร้านเครื่องเขียน** ใครก็ปั๊มเองได้

### ตัวอย่างการโจมตี (ถ้า secret เป็น placeholder)

```ts
import { SignJWT } from "jose";

// ผู้โจมตีรู้ secret เพราะมันเป็น placeholder ยอดฮิต
const fakeToken = await new SignJWT({
  user_id: "000000000000000000000001",
  role_id: "...",
  role_type: "owner",              // ← ตั้งเป็นเจ้าของร้าน
  email: "hacker@evil.com",
})
  .setProtectedHeader({ alg: "HS256" })
  .setExpirationTime("7d")
  .sign(new TextEncoder().encode("your-super-secret-jwt-key-change-this-to-random-string"));

// ยัด fakeToken ใส่ cookie: session=<fakeToken>
// → middleware.verifySession() ตรวจ "ลายเซ็นถูกต้อง" ✅ (secret ตรงกัน)
// → เข้า /api/admin/** ได้ทุก endpoint ในฐานะ owner โดยไม่ต้องรู้รหัสผ่านใคร
```

### หลังตั้งค่าสุ่ม

`JWT_SECRET` เป็นค่าสุ่ม 48 bytes (~2³⁸⁴ ความเป็นไปได้) → เดา/ปั๊มตราปลอมไม่ได้ → `verifySession()` เจอลายเซ็นไม่ตรง → ตอบ **401** ทันที

### วิธีสุ่ม

```bash
# สุ่มทีละตัว
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"

# สุ่มทั้ง 3 ตัวพร้อม prefix (ก๊อปไปวางใน .env.local ได้เลย)
node -e "const c=require('crypto');for(const k of ['JWT_SECRET','SESSION_SECRET','NEXTAUTH_SECRET'])console.log(k+'='+c.randomBytes(48).toString('base64url'))"
```

---

## 4. Dev vs Production

| | Dev (`.env.local`) | Production |
|---|---|---|
| ที่เก็บค่า | ไฟล์ `.env.local` บนเครื่อง | ตั้งผ่าน **env ของ host** (Vercel / VPS / Docker) — **อย่า commit** |
| `MONGODB_URI` | local หรือ Atlas dev | cluster production แยกต่างหาก |
| `JWT_SECRET` ฯลฯ | สุ่ม 1 ครั้ง พอ | **สุ่มใหม่** ไม่ใช้ค่าเดียวกับ dev · ถ้า secret รั่ว → เปลี่ยนค่าใหม่ (ผู้ใช้ทุกคนต้องล็อกอินใหม่) |
| cookie `Secure` | ปิด (http) | เปิดอัตโนมัติเมื่อ `NODE_ENV=production` (ต้องเสิร์ฟผ่าน https) |

> ⚠️ ค่า secret ชุดที่อยู่ใน `.env.local` ตอนนี้ ถูกสร้างช่วง dev และผ่านสายตาไปแล้ว — **ก่อนขึ้น production ต้องสุ่มใหม่**

---

## 5. Setup เครื่องใหม่

```bash
cp .env.example .env.local

# 1) ใส่ MONGODB_URI ของคุณ
# 2) สุ่ม secret:
node -e "const c=require('crypto');for(const k of ['JWT_SECRET','SESSION_SECRET','NEXTAUTH_SECRET'])console.log(k+'='+c.randomBytes(48).toString('base64url'))"
#    เอาผลลัพธ์ไปแทนใน .env.local
# 3) (ถ้าใช้ Google login) ใส่ GOOGLE_CLIENT_ID

npm install
npm run seed          # สร้าง role / unit / หมวดหมู่ / owner user
npm run dev
```
