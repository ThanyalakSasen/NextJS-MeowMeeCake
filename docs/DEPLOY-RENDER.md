# Deploy บน Render (แพ็กเกจฟรี) — MeowMeeCake Backend

> ทางเลือกฟรีสำหรับนำเสนอโปรเจกต์ · ทางหลัก (VPS) → [`DEPLOY.md`](DEPLOY.md) · ความหมายของ env ทุกตัว → [`env.md`](env.md)
> config อยู่ที่ [`render.yaml`](../render.yaml) — ไม่ต้องแก้โค้ด

| ส่วน | ใช้อะไร (ฟรี) |
|---|---|
| แอป | Render Web Service `plan: free` · region Singapore |
| ฐานข้อมูล | MongoDB Atlas M0 |
| ไฟล์อัปโหลด | Cloudflare R2 (`UPLOAD_DRIVER=s3`) — Render free ไม่มีดิสก์ถาวร ไฟล์ในเครื่องหายทุกครั้งที่ deploy/รีสตาร์ท |
| cron | cron-job.org ยิง `/api/cron/*` |

**ข้อจำกัดที่ต้องรู้**

- เซิร์ฟเวอร์หลับเมื่อไม่มีคนเรียก ~15 นาที (ปลุกครั้งแรกช้า ~1 นาที) — cron ทุก 5 นาที (§4) ทำให้แทบไม่หลับ
- RAM 512 MB · CPU น้อย → ช้ากว่า VPS แต่พอสำหรับนำเสนอ
- ไม่มี IP คงที่ → Atlas ต้องเปิด `0.0.0.0/0`
- frontend กับ backend อยู่คนละโดเมน (`*.onrender.com` / `*.vercel.app`) → cookie ล็อกอินเป็น `SameSite=None` (อัตโนมัติจาก `ALLOWED_ORIGINS` — `src/lib/session.ts`) · **Safari / iPhone อาจบล็อก cookie แบบนี้ → ล็อกอินแล้วหลุด** ทดสอบและนำเสนอด้วย Chrome

---

## 1. MongoDB Atlas

1. Database Access → สร้าง user ใหม่สำหรับ production (รหัสผ่านสุ่มยาว ๆ)
2. Network Access → Add IP Address → `0.0.0.0/0` (Render free ไม่มี IP คงที่)
3. Connect → Drivers → คัดลอก connection string → ใช้เป็น `MONGODB_URI` (ใส่ชื่อ DB ท้าย URL เช่น `.../meowmeecake?retryWrites=true&w=majority`)

## 2. Cloudflare R2

1. R2 → สร้าง bucket 2 อัน:
   - `meowmeecake-public` — รูปสินค้า/แบนเนอร์/รีวิว → Settings → **Public access: เปิด** (r2.dev subdomain) → คัดลอก URL `https://pub-xxxx.r2.dev`
   - `meowmeecake-private` — สลิปโอนเงิน/ใบเสร็จ → **ห้ามเปิด public**
2. R2 → Manage API Tokens → Create token สิทธิ์ **Object Read & Write** จำกัดเฉพาะ 2 bucket นี้ → ได้ Access Key ID + Secret
3. Endpoint = `https://<ACCOUNT_ID>.r2.cloudflarestorage.com` (ดู Account ID ในหน้า R2)

### 2.1 ย้ายไฟล์เดิมขึ้น R2 (`npm run migrate:uploads-to-s3`)

ไฟล์ที่อัปโหลดไว้ก่อนหน้าอยู่ใน `public/uploads/` + `storage/private/` บนเครื่อง dev และ DB เก็บ URL เป็น `/uploads/…`
→ บน Render ไม่มีไฟล์เหล่านี้ (รูปเดิมไม่ขึ้น) · สคริปต์ `scripts/migrate-uploads-to-s3.ts` ทำให้:

| ใน DB | ไฟล์บนเครื่อง | ขึ้น bucket | URL ใน DB |
|---|---|---|---|
| `/uploads/<dir>/<ไฟล์>` (สินค้า · แบนเนอร์ · รีวิว · ร้าน) | `public/uploads/<dir>/` | `S3_BUCKET` key `<dir>/<ไฟล์>` | เปลี่ยนเป็น `<S3_PUBLIC_URL_BASE>/<dir>/<ไฟล์>` |
| `/api/files/<dir>/<ไฟล์>` (สลิป · ใบเสร็จ) | `storage/private/<dir>/` | `S3_PRIVATE_BUCKET` key `private/<dir>/<ไฟล์>` | ไม่เปลี่ยน |
| `/uploads/slips/…` · `/uploads/receipts/…` | — | ไม่แตะ — รายงานให้รัน `npm run migrate:upload-files -- --apply` ก่อน | — |
| `/products/<ไฟล์>` · `/pictures/<ไฟล์>` (backend ฝั่งลูกค้าตัวเก่า) | `<legacy-root>/<dir>/` | `S3_BUCKET` key `<dir>/<ไฟล์>` | เปลี่ยนเป็น `<S3_PUBLIC_URL_BASE>/<dir>/<ไฟล์>` |
| `/uploads/slip-…` (สลิปของ backend เก่า) | `<legacy-root>/uploads/` | `S3_PRIVATE_BUCKET` key `private/slips/<ไฟล์>` | เปลี่ยนเป็น `/api/files/slips/<ไฟล์>` |

หาทุกฟิลด์ทุก collection ให้เอง (ยกเว้น `userlogs`) · ไม่ลบไฟล์บนเครื่อง · รันซ้ำได้ ·
`/uploads/<dir>/…` ที่ไม่มีใน `public/uploads/` ของเราจะหาใน `<legacy-root>/uploads/<dir>/` ต่อ (รีวิว · โลโก้ร้านของ backend เก่า)

`<legacy-root>` = โฟลเดอร์ `public` ของ backend ฝั่งลูกค้าตัวเก่า (พอร์ต 4000) ส่งด้วย `--legacy-root=<path>` ·
ไม่ส่ง = path ของ backend เก่าถูกนับเป็น "ไฟล์ที่ไม่มีบนเครื่อง" ไม่แตะ

รันบน**เครื่อง dev** (ที่มีโฟลเดอร์ `public/uploads/`) โดยชี้ไป DB + bucket ของ production:

1. ใส่ใน `.env.local` ชั่วคราว: `MONGODB_URI` (Atlas production) + `S3_ENDPOINT` · `S3_BUCKET` · `S3_PRIVATE_BUCKET` ·
   `S3_PUBLIC_URL_BASE` · `S3_ACCESS_KEY_ID` · `S3_SECRET_ACCESS_KEY` (ชุดเดียวกับ Render) — **ไม่ต้อง**ตั้ง `UPLOAD_DRIVER`
2. `npm run migrate:upload-files` → ถ้ามีสลิป/ใบเสร็จต้องย้าย → `-- --apply` (ย้ายเป็นไฟล์ส่วนตัวบนเครื่องก่อน)
3. `npm run migrate:uploads-to-s3 -- --legacy-root=<path>/backend/public` (dry-run) → ดูจำนวนไฟล์ / ค่าที่จะเปลี่ยน / ไฟล์ที่ไม่มีบนเครื่อง
4. คำสั่งเดิม + `--apply` → ค่าเดิมสำรองไว้ที่ `scripts/backups/uploads-to-s3-*.json`
5. เปิดหน้าสินค้า/แบนเนอร์ → รูปต้องขึ้นจาก `https://pub-…r2.dev/…` · คืนค่า `.env.local` เป็นของ dev

> frontend (`resolveUploadUrl()` — frontend `src/lib/uploads.ts`) ปล่อย URL แบบเต็ม (`https://…`) ผ่านตรง ๆ แล้ว — ไม่ต้องแก้ frontend

## 3. สร้าง service บน Render

1. push `render.yaml` ขึ้น GitHub (branch `main`)
2. Render → **New → Blueprint** → เลือก repo `NextJS-MeowMeeCake` → Render อ่าน `render.yaml` แล้วถามค่าที่เป็น `sync: false`
3. กรอกตามตารางด้านล่าง (ช่องที่ยังไม่รู้ค่า เช่น URL frontend เว้นไว้ก่อน แล้วค่อยกลับมาใส่ที่แท็บ Environment ได้ — แก้แล้ว Render deploy ใหม่ให้เอง)
4. รอ build เสร็จ → เปิด `https://meowmeecake-api.onrender.com/api/health` ต้องได้ `{"ok":true,"db":"connected"}`

> URL จริงของ service อาจไม่ใช่ `meowmeecake-api.onrender.com` ถ้าชื่อซ้ำ — ดูที่หน้า service แล้วแทน `<API>` ในตารางด้วย URL นั้น

### รายการ env

**ตั้งให้อัตโนมัติจาก `render.yaml` (ไม่ต้องกรอก)**

| ตัวแปร | ค่า |
|---|---|
| `NODE_VERSION` | `22` |
| `MONGOMS_DISABLE_POSTINSTALL` | `1` |
| `LOG_LEVEL` | `info` |
| `JWT_SECRET` · `SESSION_SECRET` · `NEXTAUTH_SECRET` · `CRON_SECRET` | Render สุ่มให้ (`CRON_SECRET` ต้องคัดลอกไปใส่ cron-job.org — §4) |
| `UPLOAD_DRIVER` | `s3` |
| `S3_REGION` | `auto` |
| `EMAIL_SERVICE` | `gmail` |

**ต้องกรอก**

| ตัวแปร | ต้องมี? | ค่า |
|---|---|---|
| `MONGODB_URI` | ✅ ไม่ตั้ง = แอปไม่ขึ้น | จาก §1 |
| `S3_ENDPOINT` | ✅ | `https://<ACCOUNT_ID>.r2.cloudflarestorage.com` |
| `S3_BUCKET` | ✅ | `meowmeecake-public` |
| `S3_PRIVATE_BUCKET` | ✅ | `meowmeecake-private` |
| `S3_PUBLIC_URL_BASE` | ✅ | `https://pub-xxxx.r2.dev` (ไม่มี `/` ท้าย) |
| `S3_ACCESS_KEY_ID` · `S3_SECRET_ACCESS_KEY` | ✅ | จาก §2 |
| `ALLOWED_ORIGINS` | ✅ ถ้า frontend แยกโดเมน | URL ของ frontend ทุกตัว คั่นด้วย `,` เช่น `https://meowmee-admin.vercel.app,https://meowmee-shop.vercel.app` (ไม่มี `/` ท้าย) |
| `NEXTAUTH_URL` | หน้าเว็บลูกค้า | URL หน้าเว็บลูกค้า (ที่เบราว์เซอร์เห็น) |
| `STOREFRONT_URL` | ไม่บังคับ | URL หน้าเว็บลูกค้า (ลิงก์ในอีเมล/LINE) — ไม่ตั้ง = ใช้ `NEXTAUTH_URL` |
| `ADMIN_APP_URL` | ไม่บังคับ | URL เว็บหลังร้าน (แนบลิงก์ในข้อความ LINE ถึงเจ้าของร้าน) |
| `EMAIL_USER` · `EMAIL_PASS` | สมัครสมาชิก/ลืมรหัสผ่าน | Gmail + **App Password** (ไม่ใช่รหัส Gmail ปกติ) |
| `GOOGLE_CLIENT_ID` · `GOOGLE_CLIENT_SECRET` | Google login | จาก Google Cloud Console · เพิ่ม redirect URI `{NEXTAUTH_URL}/api/auth/callback/google` |
| `LINE_CHANNEL_ACCESS_TOKEN` · `LINE_TARGET_ID` | แจ้งเตือน LINE | Messaging API channel ([`LINE.md`](LINE.md)) |
| `LINE_LOGIN_CHANNEL_ID` · `LINE_LOGIN_CHANNEL_SECRET` | ผูก/ล็อกอิน LINE | LINE Login channel · **ใช้ secret ที่หมุนใหม่แล้ว** (ค่าเดิมเคยรั่ว — BACKLOG5) |
| `LINE_LOGIN_CALLBACK_URL` | ผูก LINE | `https://<API>/api/shop/me/line/callback` (เพิ่มใน LINE Console ด้วย) |
| `LINE_LINK_RETURN_URL` | ผูก LINE | `<หน้าเว็บลูกค้า>/profile` |
| `LINE_AUTH_CALLBACK_URL` | ล็อกอินด้วย LINE | `https://<API>/api/auth/line/callback` (เพิ่มใน LINE Console ด้วย) |
| `LINE_AUTH_RETURN_URL` | ล็อกอินด้วย LINE | `<frontend>/login/line` |
| `PROMPTPAY_ID` | ไม่บังคับ | เลขพร้อมเพย์ — ไม่ตั้งได้ถ้าตั้งในหลังร้าน (ข้อมูลร้าน) แล้ว |

ฟีเจอร์ไหนไม่ใช้ (เช่น LINE) เว้นว่างได้ — แอปยังขึ้น แค่ฟีเจอร์นั้นใช้ไม่ได้ ตัวแปรเสริมอื่น ๆ (ค่าส่ง fallback, อายุ cache ฯลฯ) ดู [`env.md`](env.md)

## 4. cron-job.org

สมัคร [cron-job.org](https://cron-job.org) → ตั้ง timezone บัญชีเป็น **Asia/Bangkok** → สร้าง job ละ 1 endpoint:

- URL: `https://<API>/api/cron/<ชื่อ>` · method `GET`
- Advanced → Headers: `Authorization` = `Bearer <CRON_SECRET>` (คัดลอกจากแท็บ Environment ของ Render)

| endpoint | ตาราง | ทำอะไร |
|---|---|---|
| `order-expiry` | ทุก 5 นาที | ยกเลิกออเดอร์เว็บที่เลยกำหนดชำระ + คืนสต็อก (ช่วยปลุกเซิร์ฟเวอร์ไปด้วย) |
| `preorder-rounds` | ทุก 15 นาที | เปิด/ปิดรอบพรีออเดอร์ · ยกเลิกคนไม่จ่าย · สร้างใบสั่งผลิต |
| `preorder-reminders` | ทุกวัน 18:00 | เตือนลูกค้าก่อนวันรับพรีออเดอร์ทาง LINE |
| `data-integrity` | ทุกวัน 07:30 | ตรวจข้อมูลสินค้าผิดปกติ แจ้งเจ้าของร้าน |
| `monthly-summary` | วันที่ 1 08:00 | สรุปยอดเดือนที่แล้ว |

ทดสอบ: กด "Test run" ของ `preorder-reminders` → ต้องได้ 200 (ถ้า 401 = `CRON_SECRET` ไม่ตรง)

> `cleanup:review-media` (ลบรูปรีวิวที่ค้าง) ไม่มี endpoint — Render free ไม่มี shell/cron ให้รันสคริปต์ · ไม่จำเป็นสำหรับนำเสนอ ถ้าต้องการรันจากเครื่อง dev ที่ตั้ง env ชุดเดียวกับ production: `npm run cleanup:review-media`

## 5. ตรวจรับ

- [ ] `/api/health` → `{"ok":true,"db":"connected"}`
- [ ] ล็อกอินบัญชี owner ผ่าน frontend (Chrome) ได้ · ถ้า 401 ตรวจ `ALLOWED_ORIGINS` ตรงกับ URL frontend ทุกตัวอักษร
- [ ] อัปโหลดรูปสินค้า → URL ที่ได้ขึ้นต้นด้วย `S3_PUBLIC_URL_BASE` และเปิดเห็นรูป
- [ ] ลูกค้าอัปโหลดสลิป → เปิดได้ผ่าน `/api/files/slips/…` เท่านั้น (เปิดตรงจาก R2 ไม่ได้)
- [ ] cron-job.org แสดงผลรัน 200 ทุก job
- [ ] ก่อนนำเสนอ: เปิด `/api/health` ทิ้งไว้ให้เซิร์ฟเวอร์ตื่นก่อน
