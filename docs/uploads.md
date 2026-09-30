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
| **สลิปโอนเงิน** (ลูกค้า) | `public/uploads/slips/` | `payments.slip_image_url` | **`POST /api/shop/payments/[id]/slip`** (ใหม่) |
| **สลิปโอนเงิน** (พนักงาน) | `public/uploads/slips/` | `payments.slip_image_url` | **`POST /api/admin/payments/slips`** (ใหม่) |
| **ใบเสร็จค่าใช้จ่าย** | `public/uploads/receipts/` | `expenses.receipt_url` | **`POST /api/admin/expenses/receipts`** (ใหม่) |

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
→ 200 { ...payment, slip_image_url: "/uploads/slips/1790...-a1b2c3d4e5f6.jpg", status: "pending" }
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
| `payments.slip_image_url` (`createPayment` / `submitSlip`) | string อะไรก็ได้ ≤ 1000 ตัว | ต้องเป็น `/uploads/slips/<ไฟล์>` (s3: `<S3_PUBLIC_URL_BASE>/slips/<ไฟล์>`) ไม่งั้น 400 |
| `expenses.receipt_url` (`create` / `update`) | string อะไรก็ได้ | ต้องเป็น `/uploads/receipts/<ไฟล์>` · **ค่ารุ่นเก่าที่ส่งกลับมาซ้ำตอนแก้ฟิลด์อื่นยังผ่าน** (ไม่บังคับให้แก้ของเก่าก่อนแก้อย่างอื่น) |
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

- [ ] **หน้าแจ้งชำระเงินของลูกค้า:** อัปโหลดสลิปด้วย `POST /api/shop/payments/[id]/slip` (multipart field `file`) แทนการส่ง `slip_image_url` เป็นข้อความ
- [ ] **หน้าค่าใช้จ่าย (`ExpenseFormModal`):** เปลี่ยนช่อง `receipt_url` จากช่องพิมพ์เป็นปุ่มอัปโหลด → `POST /api/admin/expenses/receipts` แล้วใส่ `url` ที่ได้ลงฟอร์ม · แสดงรูปจาก `receipt_url` ได้เลย
- [ ] **หน้าแบนเนอร์:** อัปโหลดผ่าน `POST /api/admin/banners/images` เท่านั้น (ส่ง base64 / ลิงก์ภายนอกจะได้ 400)
- [ ] รูปจาก backend อยู่คนละ origin กับ frontend — แสดงด้วย `${API_ORIGIN}${url}` (url ที่ได้เป็น path `/uploads/...`)

## 5. ข้อควรรู้

- **สลิปเป็นข้อมูลส่วนตัว** (ชื่อ/เลขบัญชี) แต่ `public/uploads/` เปิดให้ใครก็ดาวน์โหลดได้ถ้ารู้ URL — ชื่อไฟล์สุ่ม
  (`<เวลา>-<hex 12 ตัว>`) เดาได้ยาก แต่ไม่ใช่การป้องกันสิทธิ์จริง · ถ้าต้องการปิดจริงต้องย้ายสลิปออกจาก `public/`
  แล้วเสิร์ฟผ่าน route ที่ตรวจสิทธิ์ (ยังไม่ทำ)
- ไม่ลบไฟล์สลิปเก่าเมื่อลูกค้าแนบใหม่ (เก็บเป็นหลักฐาน) · ใบเสร็จ/สลิปไม่ลบไฟล์ตอน soft delete
- บน serverless (Vercel ฯลฯ) `public/` เขียนไม่ได้ตอน runtime → ต้องใช้ `UPLOAD_DRIVER=s3`
