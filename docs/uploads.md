# ไฟล์ที่อัปโหลด — แบนเนอร์ · สลิปโอนเงิน · ใบเสร็จค่าใช้จ่าย

> สร้าง: 2026-09-30 · branch `fix/uploads-slips-receipts` · โค้ดหลัก `src/lib/upload.ts`

---

## 1. เก็บที่ไหน

ทุกไฟล์ผ่าน `saveImages()` (ตรวจ 3 ชั้น: ขนาด ≤ 5 MB → นามสกุล → magic bytes · รับ JPEG / PNG / WEBP / AVIF)
ด้วย driver ค่าเริ่มต้น `localDisk` เขียนลง `public/uploads/<โฟลเดอร์>/<เวลา>-<สุ่ม>.<นามสกุล>` (Next.js serve ได้ที่
`/uploads/<โฟลเดอร์>/...`) · ตั้ง `UPLOAD_DRIVER=s3` ย้ายไป object storage ได้โดยไม่แก้โค้ด (ดู `docs/env.md`)

| ประเภท | โฟลเดอร์ (`UPLOAD_DIRS`) | ฟิลด์ใน DB | อัปโหลดผ่าน |
|---|---|---|---|
| รูปสินค้า | `public/uploads/products/` | `products.product_img[]` | `POST /api/admin/products/images` (มีอยู่แล้ว) |
| แบนเนอร์ | `public/uploads/banners/` | `banners.banner_img` | `POST /api/admin/banners/images` (มีอยู่แล้ว — BACKLOG2 §15) |
| **สลิปโอนเงิน** (ลูกค้า) | **`storage/private/slips/` (ส่วนตัว — §6)** | `payments.slip_image_url` | **`POST /api/shop/payments/[id]/slip`** (ใหม่) |
| **สลิปโอนเงิน** (พนักงาน) | **`storage/private/slips/` (ส่วนตัว — §6)** | `payments.slip_image_url` | **`POST /api/admin/payments/slips`** (ใหม่) |
| **ใบเสร็จค่าใช้จ่าย** | **`storage/private/receipts/` (ส่วนตัว — §6 · ย้ายจาก `public/uploads/receipts/` 2026-10-12)** | `expenses.receipt_url` | **`POST /api/admin/expenses/receipts`** |

`public/uploads/` อยู่ใน `.gitignore` — ไฟล์ไม่เข้า git ต้องสำรองโฟลเดอร์นี้แยกตอน deploy/ย้ายเครื่อง

---

## 2. ปัญหาที่เจอ (ตรวจ DB จริง 2026-09-30 แบบอ่านอย่างเดียว)

| ข้อมูล | สิ่งที่เจอ | ผลกระทบ |
|---|---|---|
| `banners.banner_img` (12 แถว) | **base64 9 แถว** (ใช้งาน 4 · ถูกลบ 5) ก้อนใหญ่สุด ~2.8 MB · ลิงก์ Unsplash 2 · ไฟล์ในระบบ 1 (ถูกลบ ไฟล์ไม่มีบนดิสก์) | DB บวม ทุก query แบนเนอร์ลากรูปทั้งก้อน · §15 แก้แค่ของใหม่ ของเก่าค้าง · ลิงก์ภายนอกหายเมื่อไหร่ก็ได้ |
| `payments.slip_image_url` (29 แถว) | 5 แถวเป็น `/uploads/slip-<id>-<เวลา>.jpg` — **ไม่มีไฟล์นี้ทั้งใน backend และ repo frontend** | แอดมินเปิดดูสลิปไม่ได้ (3 รายการยัง `pending` รอตรวจ) · backend รับ string อะไรก็ได้ ไม่เคยมี endpoint อัปโหลดสลิป |
| `expenses.receipt_url` (8 แถว) | 3 แถวเป็นแค่ชื่อไฟล์ เช่น `02cae48b-….jpg` — **ไม่มีไฟล์จริง** | หน้าค่าใช้จ่ายฝั่ง frontend เป็นช่องพิมพ์ข้อความ ไม่ได้อัปโหลดไฟล์ |

ความเสี่ยงเพิ่ม: ฟิลด์เหล่านี้รับ URL ภายนอกได้ → ใส่ tracking pixel ให้แอดมินเปิดตอนตรวจสลิปได้

---

## 3. สิ่งที่แก้ (ก่อน → หลัง)

### 3.1 endpoint อัปโหลดใหม่

**`POST /api/shop/payments/[id]/slip`** (ลูกค้า — ต้องเป็นเจ้าของรายการชำระเงิน)
```
Content-Type: multipart/form-data
file (หรือ slip) = <รูปสลิป>        promptpay_ref = <ไม่บังคับ>
→ 200 { ...payment, slip_image_url: "/api/files/slips/1790...-a1b2c3d4e5f6.jpg", status: "pending" }
```
อัปโหลด + ผูกกับรายการในคำขอเดียว · ผูกไม่สำเร็จ (เช่น รายการ `paid` ไปแล้ว) → ลบไฟล์ที่เพิ่งเขียนทิ้ง ไม่ค้าง
`PATCH` (JSON) แบบเดิมยังใช้ได้ แต่ `slip_image_url` ต้องเป็นไฟล์ในระบบ

**`POST /api/admin/payments/slips`** (`payments.create`) · **`POST /api/admin/expenses/receipts`** (`reports.create`)
```
Content-Type: multipart/form-data
file = <รูป>   → 200 { url, filename, size }   แล้วนำ url ไปใส่ slip_image_url / receipt_url ตอนสร้าง/แก้
```

### 3.2 ฟิลด์ต้องเป็นไฟล์ในระบบ — `isUploadedUrl(url, dir)`

| ฟิลด์ | ก่อน | หลัง |
|---|---|---|
| `payments.slip_image_url` (`createPayment` / `submitSlip`) | string อะไรก็ได้ ≤ 1000 ตัว | ต้องเป็น `/api/files/slips/<ไฟล์>` (ไฟล์ส่วนตัว — §6) ไม่งั้น 400 |
| `expenses.receipt_url` (`create` / `update`) | string อะไรก็ได้ | ต้องเป็น `/api/files/receipts/<ไฟล์>` (ไฟล์ส่วนตัว — §6 · เดิม `/uploads/receipts/<ไฟล์>`) · **ค่ารุ่นเก่าที่ส่งกลับมาซ้ำตอนแก้ฟิลด์อื่นยังผ่าน** (ไม่บังคับให้แก้ของเก่าก่อนแก้อย่างอื่น) |
| `banners.banner_img` (`create` / `update`) | string ≤ 500 ตัว (บังคับแค่ schema) | ต้องเป็น `/uploads/banners/<ไฟล์>` · ค่ารุ่นเก่าส่งซ้ำได้เหมือนกัน |

`isUploadedUrl` ตรวจรูปแบบแบบเข้ม: โฟลเดอร์ต้องตรง, ชื่อไฟล์ `[A-Za-z0-9._-]` เท่านั้น — ไม่ผ่าน `..` / โฟลเดอร์ย่อย / โดเมนอื่น

### 3.3 สคริปต์ `npm run migrate:upload-files` (`scripts/migrate-upload-files.ts`)

| | ทำอะไร |
|---|---|
| แบนเนอร์ base64 / ลิงก์ภายนอก | ถอด base64 (หรือดาวน์โหลดลิงก์) → `saveImages()` ลง `public/uploads/banners/` → เปลี่ยน `banner_img` เป็น path ใหม่ · ทำทั้งที่ใช้งานและถูกลบ |
| สลิป / ใบเสร็จที่ไม่มีไฟล์จริง | **รายงานอย่างเดียว** — ไฟล์ไม่มีที่ไหนให้กู้ ต้องให้ลูกค้าแนบใหม่ / แอดมินแนบใบเสร็จใหม่ |
| ความปลอดภัย | ค่าเริ่มต้น **dry-run** · `-- --apply` สำรองค่าเดิมลง `scripts/backups/banner-images-*.json` ก่อน · เขียนทีละแถวแบบมีเงื่อนไข (ค่ายังเป็นค่าเดิม) · รูปเสีย/โหลดไม่ได้ → ข้าม + รายงาน · รันซ้ำได้ |

**ผล dry-run กับ DB จริง (2026-09-30, อ่านอย่างเดียว):**

| รายการ | จำนวน | รายละเอียด |
|---|---|---|
| แบนเนอร์ที่จะย้ายเป็นไฟล์ | **11** | base64 9 (ใช้งาน 3 · ถูกลบ 6 · ก้อนใหญ่สุด 2,731 KB) · ลิงก์ Unsplash 2 (ใช้งาน 1 · ถูกลบ 1) · 1 แถว base64 ว่าง (0 KB) จะแปลงไม่ผ่าน → ข้าม |
| แบนเนอร์ชี้ไฟล์ที่ไม่มีจริง | 1 | `/uploads/banners/fake-new-image.jpg` (ถูกลบแล้ว — ข้อมูลทดสอบ) |
| สลิปที่ไม่มีไฟล์จริง | **5** | `/uploads/slip-*.jpg` ทั้งหมด · สถานะ `pending` 3 (แอดมินตรวจไม่ได้ — ต้องให้ลูกค้าแนบใหม่) · `paid` 2 (ตรวจไปแล้ว ไม่กระทบยอด แค่ไม่มีหลักฐานรูป) |
| ใบเสร็จที่ไม่มีไฟล์จริง | **3** | ชื่อไฟล์ลอย ๆ (ใช้งาน 2 · ถูกลบ 1) — แนบใหม่ผ่านหน้าค่าใช้จ่ายเมื่อ frontend ทำปุ่มอัปโหลดแล้ว |

**ยังไม่ได้รัน `--apply` กับ DB จริง** — ลำดับที่แนะนำ: (1) merge + deploy โค้ดนี้ (2) `npm run migrate:upload-files`
ดูแผนอีกรอบ (3) `-- --apply` (4) เปิดหน้าแบนเนอร์ตรวจว่ารูปขึ้นครบ (5) สำรองโฟลเดอร์ `public/uploads/` แยก (ไม่อยู่ใน git)
· 3 สลิป `pending` ที่ไม่มีไฟล์ แจ้งลูกค้าให้แนบใหม่ผ่าน `POST /api/shop/payments/[id]/slip` หลัง frontend ทำปุ่มแล้ว

---

## 4. สิ่งที่ frontend ต้องทำ

> ตรวจกับโค้ด frontend (`main` หลัง frontend PR #59) 2026-10-10 — ครบทุกข้อ

- [x] **หน้าแจ้งชำระเงินของลูกค้า:** อัปโหลดสลิปด้วย `POST /api/shop/payments/[id]/slip` (multipart field `file`) แทนการส่ง `slip_image_url` เป็นข้อความ
  — frontend `SlipPaymentPanel` (ออเดอร์ + พรีออเดอร์)
- [x] **หน้าค่าใช้จ่าย (`ExpenseFormModal`):** เปลี่ยนช่อง `receipt_url` จากช่องพิมพ์เป็นปุ่มอัปโหลด → `POST /api/admin/expenses/receipts` แล้วใส่ `url` ที่ได้ลงฟอร์ม · แสดงรูปจาก `receipt_url` ได้เลย
  — frontend PR #59: `ReceiptUpload` อัปโหลดจริงแล้วเก็บ URL (เดิม `UploadImageBox` ส่ง base64 → `assertReceiptUrl` ตอบ 400 · ลบตัวนั้นแล้ว) ·
  แสดงรูปผ่าน `resolveUploadUrl()` · หมายเหตุ: อัปโหลดต้องมีสิทธิ์ `reports.create` — พนักงานที่มีแค่ `reports.update` แนบใบเสร็จใหม่ไม่ได้ (403)
- [x] **หน้าแบนเนอร์:** อัปโหลดผ่าน `POST /api/admin/banners/images` เท่านั้น (ส่ง base64 / ลิงก์ภายนอกจะได้ 400) — frontend `BannerImageUpload`
- [x] รูปจาก backend อยู่คนละ origin กับ frontend — แสดงด้วย `${API_ORIGIN}${url}` (url ที่ได้เป็น path `/uploads/...`) — frontend `lib/uploads.ts` `resolveUploadUrl()`

## 5. ข้อควรรู้

- ✅ **สลิปเป็นข้อมูลส่วนตัว** — แก้แล้ว 2026-10-01 (§6): ย้ายออกจาก `public/` + เปิดผ่าน route ที่ตรวจสิทธิ์
  (เดิม: `public/uploads/slips/` ใครรู้ URL ก็เปิดได้ — ชื่อไฟล์สุ่มเดายาก แต่ไม่ใช่การป้องกันสิทธิ์จริง) ·
  ใบเสร็จค่าใช้จ่าย (`receipts`) และแบนเนอร์ยังอยู่ใน `public/uploads/` ตามเดิม
- ไม่ลบไฟล์สลิปเก่าเมื่อลูกค้าแนบใหม่ (เก็บเป็นหลักฐาน) · ใบเสร็จ/สลิปไม่ลบไฟล์ตอน soft delete
- บน serverless (Vercel ฯลฯ) `public/` เขียนไม่ได้ตอน runtime → ต้องใช้ `UPLOAD_DRIVER=s3`

---

## 6. สลิปเป็นไฟล์ส่วนตัว — เปิดดูได้เฉพาะผู้มีสิทธิ์ (2026-10-01 · BACKLOG4 Y3)

**ตัดสินใจ:** สลิปโอนเงิน (มีชื่อ/เลขบัญชีลูกค้า) เปิดดูได้เฉพาะผู้ที่ได้รับสิทธิ์เท่านั้น · โค้ด `src/lib/privateFiles.ts`

| | ก่อน | หลัง |
|---|---|---|
| ที่เก็บ (localDisk) | `public/uploads/slips/` — Next.js เสิร์ฟ static ใครรู้ URL ก็เปิดได้ | **`storage/private/slips/`** (นอก `public/` · ตั้งที่อื่นได้ด้วย `PRIVATE_UPLOAD_DIR`) · อยู่ใน `.gitignore` |
| ที่เก็บ (s3) | `<bucket>/slips/…` public URL | key `private/slips/…` ใน bucket `S3_PRIVATE_BUCKET` (ไม่ตั้ง = bucket เดิม) — ⚠️ **bucket นี้ต้องไม่เปิด public** (§6.2) |
| URL ใน DB | `/uploads/slips/<ไฟล์>` | **`/api/files/slips/<ไฟล์>`** |
| เปิดดู | ใครก็ได้ | **`GET /api/files/slips/[filename]`** ตรวจสิทธิ์ทุกครั้ง |
| ตรวจ `slip_image_url` | `isUploadedUrl(…, "slips")` | `isPrivateFileUrl(…, "slips")` — url แบบ `/uploads/slips/…` ถูกปฏิเสธแล้ว |

**สิทธิ์เปิดดู `GET /api/files/slips/[filename]`**

| ผู้เรียก | ผล |
|---|---|
| ไม่ล็อกอิน | 401 |
| ลูกค้าเจ้าของรายการชำระเงินที่แนบสลิปนี้ | ✅ 200 |
| ลูกค้าคนอื่น | 403 |
| เจ้าของร้าน (owner) | ✅ 200 |
| พนักงานที่มีสิทธิ์ `payments.view` | ✅ 200 · ไม่มีสิทธิ์ → 403 |
| สลิปที่ยังไม่ผูกกับรายการ (พนักงานอัปโหลดก่อนสร้างรายการ) | เฉพาะผู้มี `payments.view` |
| ชื่อไฟล์แปลก (`..`, `/`) / ไม่มีไฟล์ | 404 (ตรวจสิทธิ์ก่อนเสมอ — ไม่บอกคนไม่มีสิทธิ์ว่าไฟล์มีอยู่ไหม) |

ตอบกลับพร้อม `Cache-Control: private, no-store` + `X-Content-Type-Options: nosniff` (ไม่ให้ proxy/CDN แคชสลิป)

### 6.1 ใบเสร็จค่าใช้จ่ายเป็นไฟล์ส่วนตัวด้วย (2026-10-12)

ใบเสร็จเป็นเอกสารการเงินภายในร้าน — เดิมอยู่ใน `public/uploads/receipts/` ใครรู้ URL ก็เปิดได้

| | ก่อน | หลัง |
|---|---|---|
| อัปโหลด `POST /api/admin/expenses/receipts` | `saveImages` → `/uploads/receipts/<ไฟล์>` | `savePrivateImage` → **`/api/files/receipts/<ไฟล์>`** |
| เปิดดู | ใครก็ได้ | **`GET /api/files/receipts/[filename]`** — ต้องมีสิทธิ์ `reports.view` (owner ผ่านเสมอ · ลูกค้า 403 · ไม่ล็อกอิน 401 · ไม่มีไฟล์ 404 หลังตรวจสิทธิ์) |
| ตรวจ `receipt_url` | `isUploadedUrl(…, "receipts")` | `isPrivateFileUrl(…, "receipts")` — ค่ารุ่นเก่าส่งกลับซ้ำตอนแก้ฟิลด์อื่นยังผ่าน |
| migration | — | `npm run migrate:upload-files -- --apply` ย้ายใบเสร็จใน `public/uploads/receipts/` + เปลี่ยน `receipt_url` (localDisk) |

### 6.2 bucket ส่วนตัวแยก (`S3_PRIVATE_BUCKET` — 2026-10-12)

`UPLOAD_DRIVER=s3` + ตั้ง `S3_PRIVATE_BUCKET` → ไฟล์ส่วนตัว (สลิป · ใบเสร็จ) ไปอยู่ bucket นี้ (key `private/<dir>/…`)
ส่วนรูปสินค้า · แบนเนอร์ · รูป/วิดีโอรีวิวอยู่ `S3_BUCKET` (เปิด public) · ไม่ตั้ง = bucket เดียวกัน (พฤติกรรมเดิม)
เหตุผล: Cloudflare R2 เปิดอ่านสาธารณะ (r2.dev / custom domain) ได้ทั้ง bucket — ตั้ง prefix `private/` ให้ไม่ public ไม่ได้
```
meowmeecake-public   (เปิด public · S3_PUBLIC_URL_BASE ชี้ที่นี่)   products/ banners/ reviews/
meowmeecake-private  (ไม่เปิด public · อ่านผ่าน backend เท่านั้น)    private/slips/ private/receipts/
```
ย้ายไฟล์ส่วนตัวที่มีอยู่ใน `storage/private/` ขึ้น bucket: คัดลอกเป็น key `private/<dir>/<ไฟล์>` (เช่น `rclone copy storage/private r2:meowmeecake-private/private`) — URL ใน DB ไม่ต้องแก้ (`/api/files/…` เหมือนเดิม)

**migration:** `npm run migrate:upload-files -- --apply` ย้ายสลิปที่ยังอยู่ใน `public/uploads/slips/` ไปที่เก็บส่วนตัว + เปลี่ยน URL
ในรายการชำระเงิน (localDisk) · dry-run กับ DB จริง 2026-10-01: **0 ไฟล์ต้องย้าย** (ยังไม่เคยมีใครอัปโหลดผ่านระบบใหม่) ·
5 สลิปเดิมไม่มีไฟล์อยู่แล้ว (รายงานเหมือนเดิม — §3.3)

**frontend:** แสดงสลิปด้วย `fetch(`${API}${slip_image_url}`, { credentials: "include" })` แล้วทำ blob URL — `<img src>` ตรง ๆ
ข้าม origin จะ**ไม่ส่ง cookie** ถ้าไม่ได้ตั้ง `COOKIE_DOMAIN` เป็น site เดียวกัน (ได้ 401)

**เทส:** `tests/integration/privateSlips.test.ts` (5 เคส — เขียนนอก public · เจ้าของ/ลูกค้าอื่น/ไม่ล็อกอิน · owner/staff
ไม่มีสิทธิ์/มีสิทธิ์ · traversal + ไม่มีไฟล์ = 404 · migration ย้ายไฟล์+URL) · `tests/lib/uploadUrl.test.ts` (+2 เคส `isPrivateFileUrl` /
`isSafeFilename`) · ผลรวม unit 195 ✅ · integration 189 ✅ · `next build` ✅

---

## 7. ลบไฟล์ใน R2 ที่ไม่ได้ใช้แล้ว (2026-10-20)

**ปัญหา:** อัปโหลดรูปเกิดก่อนกดบันทึกฟอร์มเสมอ (สินค้า · แบนเนอร์ · รีวิว · สลิป · ใบเสร็จ) — ยกเลิก/ปิดหน้า = ไฟล์ค้างใน bucket
ตลอดไป · `cleanup:review-media` ทำงานเฉพาะ localDisk (บน s3 ข้าม) → R2 โตเรื่อย ๆ จนชนโควตา

**ทำไมไม่ใช้ lifecycle rule ของ R2:** R2 ลบตามอายุนับจากวันอัปโหลดเท่านั้น ไม่รู้ว่าไฟล์ยังถูกใช้ไหม (R2 ไม่เก็บเวลาเปิดดูล่าสุด) —
ตั้ง 60 วัน = รูปสินค้า/แบนเนอร์ที่ยังใช้อยู่หายไปด้วย · **"ไม่ได้ใช้" = ไม่มีข้อมูลใน DB อ้างถึง**

**โค้ด:** `src/services/storageCleanupService.ts` · endpoint `GET /api/cron/storage-cleanup` · สคริปต์ `npm run cleanup:unused-uploads`

| ขั้น | ทำอะไร |
|---|---|
| 1. หาไฟล์ที่ใช้อยู่ | ไล่ทุก string ในทุก collection (ยกเว้น `userlogs`) เก็บ `<โฟลเดอร์>/<ไฟล์>` ที่เจอ — ไม่ผูกโดเมน (เปลี่ยน `S3_PUBLIC_URL_BASE` เป็น custom domain ได้) · นับ `/uploads/…` · `/api/files/…` · รายการที่ soft delete (กู้คืนได้) ด้วย |
| 2. ไล่ bucket | `S3_BUCKET` + `S3_PRIVATE_BUCKET` · สนใจเฉพาะ key ที่ระบบสร้าง (`<dir>/<ไฟล์>` · `private/<dir>/<ไฟล์>` นามสกุลรูป/วิดีโอ) — key อื่นไม่แตะ |
| 3. ลบ | เฉพาะที่ **ไม่มีใครอ้างถึง และอัปโหลดมานานกว่า 60 วัน** (`?days=` ต่ำสุด 7) · ไม่เกิน 500 ไฟล์ต่อรอบ เก่าสุดก่อน |

**ความปลอดภัย:** ค่าเริ่มต้น dry-run (`?apply=true` / `--apply` ถึงลบจริง) · อ่าน DB ไม่สำเร็จ = error ก่อนแตะ bucket ·
ไม่เจอการอ้างถึงเลยสักไฟล์ = หยุด ไม่ลบ (กันต่อ DB ผิด/DB ว่าง) · ลบไม่สำเร็จรายไฟล์ = รายงานใน `failed` รอบหน้าลองใหม่ ·
สลิป/ใบเสร็จที่ผูกกับรายการแล้วไม่ถูกลบ (ลบเฉพาะที่อัปโหลดแล้วไม่ได้ผูกกับรายการไหนเลย)

**ตั้ง cron:** cron-job.org สัปดาห์ละครั้ง `GET /api/cron/storage-cleanup?apply=true` (docs/DEPLOY-RENDER.md §4) ·
แนะนำเรียกแบบไม่มี `apply` ก่อน 1 ครั้ง ดู `deleted` ในผลลัพธ์ว่าไม่มีไฟล์ที่ยังใช้อยู่

**เทส:** `tests/integration/storageCleanup.test.ts` (4 เคส)
