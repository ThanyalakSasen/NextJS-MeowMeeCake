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
| `DELIVERY_FREE_MIN` | ไม่ | `1500` | `src/services/deliveryService.ts` | ยอดสั่งซื้อ (บาท) ที่ถึงแล้วส่งฟรี |
| `DELIVERY_FEE_METRO` | ไม่ | `40` | `src/services/deliveryService.ts` | ค่าส่ง กรุงเทพฯ + ปริมณฑล (นนทบุรี/ปทุมธานี/สมุทรปราการ/สมุทรสาคร/นครปฐม) |
| `DELIVERY_FEE_UPCOUNTRY` | ไม่ | `80` | `src/services/deliveryService.ts` | ค่าส่งต่างจังหวัด (จังหวัดอื่นทั้งหมด) |

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
| `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL` | สำหรับ OAuth **redirect/code flow** · ตอนนี้ `/api/auth/google` ใช้แบบ **ID token** (Google Identity Services) ซึ่งต้องการแค่ `GOOGLE_CLIENT_ID` |
| `SESSION_SECRET` | เผื่อระบบ session แบบเก่า (express-session ฯลฯ) · โค้ดปัจจุบันใช้ JWT ล้วน — **ควรตั้งเป็นค่าสุ่ม** เผื่อใช้ทีหลัง |
| `NEXTAUTH_SECRET`, `NEXTAUTH_URL` | เผื่อย้ายไปใช้ NextAuth.js · **ควรตั้งเป็นค่าสุ่ม** |
| `EMAIL_SERVICE`, `EMAIL_USER`, `EMAIL_PASS` | ส่งอีเมลยืนยัน / reset password (ยังไม่ทำ) |
| `LINE_CHANNEL_ACCESS_TOKEN`, `LINE_TARGET_ID` | แจ้งเตือนผ่าน LINE (ยังไม่ทำ — ดู `docs/BACKLOG.md` §3.12) |

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
