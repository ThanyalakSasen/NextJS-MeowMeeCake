# MeowMeeCake Backend — BACKLOG 4: ตรวจทั้งระบบรอบใหม่ (2026-10-01)

> ตรวจ: 2026-10-01 · ฐานโค้ดที่ตรวจ: `feat/preorder-round-flow` (รวม PR #52 → #53 → #55) + diff ของ PR #54 (`fix/uploads-slips-receipts`)
> วิธีตรวจ: อ่านโค้ด + รันเทสทั้งหมด (unit 215 · integration 252 ผ่าน) + `npm audit` + CI ทุก PR + query DB จริงแบบอ่านอย่างเดียว
> backlog ก่อนหน้า: [`BACKLOG.md`](BACKLOG.md) · [`BACKLOG2.md`](BACKLOG2.md) · [`BACKLOG3.md`](BACKLOG3.md) (ปิดเกือบครบ — ที่ยังค้างยกมาไว้ที่นี่)
>
> **สถานะล่าสุด / งานที่เหลือ → [§8](#8-สถานะคงเหลือ-2026-10-01)** (โค้ดใน repo นี้ไม่มีอะไรต้องแก้แล้ว — เหลืองาน merge / deploy / ตัดสินใจ)

---

## สถานะโดยรวม

| ระดับ | จำนวน | สรุป |
|---|---|---|
| 🔴 ต้องทำก่อนใช้งานจริง | 7 (โค้ด R5 ✅ แก้แล้ว · เหลืองาน deploy R1–R4 + R6 · **R7 เปลี่ยนเก็บเงินเป็นบาท — ต้องรัน `migrate:money-to-baht` ตอน deploy**) | ส่วนใหญ่เป็น **งานตอน deploy** (migration, cron, env, ลำดับ merge) + รายงานแดชบอร์ดไม่นับรายได้พรีออเดอร์ |
| 🟡 ควรแก้ | 11 (✅ แก้ครบ Y1–Y11 · Y11 ฝั่งโค้ดเสร็จ เหลือตั้ง DB user ที่ Atlas) | ใบผลิตไม่ลดเมื่อยกเลิกพรีออเดอร์ · ผลิตแล้วไม่เพิ่มสต็อกสินค้า · สลิปเปิดสาธารณะ · deprecation · dependency |
| 🟢 เล็กน้อย / ต่อยอด | 15 | race ที่เกิดยาก · index · ฟีเจอร์ต่อยอด |
| ✅ ตรวจแล้วไม่พบปัญหา | — | สิทธิ์ทุก route · CI ทุก PR · cron auth · upload validation · IDOR ฝั่ง shop (§5) |

---

## 1. 🔴 ต้องทำก่อนใช้งานจริง

### R1. ลำดับ merge + conflict

| ลำดับ | PR | หมายเหตุ |
|---|---|---|
| 1 | #52 `is_preorder` + เลขออเดอร์ ORD-/POS-/PRE- | base `main` |
| 2 | #53 แจ้งเตือน LINE | base #52 → retarget `main` อัตโนมัติถ้าลบ branch #52 ตอน merge |
| 3 | #55 flow รอบพรีออเดอร์ + วงจรอัตโนมัติ | base #53 |
| อิสระ | #54 สลิป/ใบเสร็จ/แบนเนอร์เป็นไฟล์ + สลิปส่วนตัว | base `main` · **ชนกับ #55 ที่ `package.json` (scripts) และ `.env.example` (ท้ายไฟล์)** — แก้ตอน merge: เก็บของทั้งสองฝั่ง |
| อิสระ | #56 postcss override + audit 0 | base `main` · ไม่ชนกับใคร |
| 4 | #57 Y7–Y11 + เงินเป็นบาท (`fix/backlog4-y7-y11`) | base #55 · ชนกับ #54 ที่ `package.json` + `.env.example` — **`.env.example` เก็บทั้งสองฝั่ง · `package.json` ใช้ฝั่ง #57 แล้วเพิ่มแค่ `"migrate:upload-files"` — ⚠️ ห้ามเก็บ `"migrate:money-to-satang"` ที่ฝั่ง #54 ยังมี** (#57 ลบทิ้งแล้ว — สคริปต์ถูกบล็อก · docs/money-units.md) · ทดลอง merge #57+#54 แบบนี้แล้ว (2026-10-01): typecheck ✅ · เทส 514 ✅ |

**ตรวจรวมทุก PR แล้ว (2026-10-01):** merge #52→#53→#55 + #54 + #56 ลง branch ชั่วคราว → typecheck ✅ · lint 0 error · unit 223 ✅ ·
integration 271 ✅ · `next build` ✅ · `npm audit` 0 · ไม่เหลือ `new: true` / `product_types` ในโค้ดรัน

### R2. migration กับ DB จริง

> ⚠️ **อัปเดต 2026-10-01:** `migrate:is-preorder --apply` **ถูกรันกับ DB จริงแล้ว** เมื่อ 2026-10-01 00:11 (เวลาไทย) — ไม่ใช่จาก agent
> (agent รันแค่ dry-run ~18:30 ของ 30 ก.ย. · เทสใช้ DB ในหน่วยความจำ) · หลักฐาน: `scripts/backups/is-preorder-2026-09-30T17-11-12-921Z.json`
> (42 รายการ) · ตรวจ DB (อ่านอย่างเดียว): สินค้า 42/42 มี `is_preorder` (พรีออเดอร์ 10) · ไม่เหลือ `product_types`/`product_type` —
> **ผลตรงกับ dry-run ทุกตัว** · ⚠️ ผลที่ตามมา: ตอนนี้ DB เป็นรูปแบบ `is_preorder` แล้ว แต่ **ยังไม่มีโค้ดที่ merge แล้วตัวไหนอ่าน `is_preorder`**
> (`main` ใช้ `product_type`) → โค้ด `main` ที่รันกับ DB นี้ (dev/deploy) บันทึกสินค้าไม่ได้และมองพรีออเดอร์เป็นสินค้ามีสต็อก —
> **merge + deploy #52 เร็วที่สุด**

| ลำดับ | คำสั่ง | ผล dry-run (2026-09-30) | จังหวะ |
|---|---|---|---|
| 1 | ~~`npm run migrate:is-preorder -- --apply`~~ | ✅ **รันแล้ว 2026-10-01 00:11** — 42 (พรีออเดอร์ 10) ตรงกับ dry-run | เหลือ: merge + deploy #52 ให้โค้ดตรงกับ DB |
| 2 | `PATCH /api/admin/products/<_id> { "is_preorder": true }` × 2 | `pos-1626294`, `pos-1626338` → `pre-` | หลัง deploy #52 · ⚠️ รหัสเปลี่ยน พิมพ์ป้ายใหม่ |
| 3 | `npm run migrate:upload-files -- --apply` | แบนเนอร์ 11 · สลิปไม่มีไฟล์ 5 · ใบเสร็จไม่มีไฟล์ 3 | หลัง deploy #54 · สำรอง `public/uploads/` แยก |

### R3. ตัวตั้งเวลา (cron) — ไม่ตั้ง = ฟีเจอร์ไม่ทำงาน

| งาน | ความถี่ | endpoint / script | ไม่ตั้งแล้วเกิดอะไร |
|---|---|---|---|
| วงจรรอบพรีออเดอร์ (เปิด/ปิดรอบ · ยกเลิกคนไม่จ่าย · สร้างใบผลิต) | ทุก 15 นาที | `GET /api/cron/preorder-rounds` / `npm run cron:preorder-rounds` | รอบไม่เปิด/ปิดเอง · คนไม่จ่ายไม่ถูกยกเลิกตามกำหนด (แอดมินกดปิดเองยังได้ครบ) |
| เตือนก่อนวันรับ | วันละครั้ง ~18:00 | `GET /api/cron/preorder-reminders` / `npm run remind:preorders` | ลูกค้าไม่ได้ LINE เตือน |

ทั้งสอง endpoint ต้องตั้ง `CRON_SECRET` (ไม่ตั้ง = ปิด endpoint) — [`preorder-round-flow.md`](preorder-round-flow.md) §6.6 · [`LINE.md`](LINE.md) §9.7

### R4. env + ค่าตั้งภายนอกบน production

- [ ] secret ใหม่สำหรับ production (`JWT_SECRET` ฯลฯ — BACKLOG §6 ข้อค้าง)
- [ ] `LINE_*` ทั้งหมด + `LINE_LOGIN_CALLBACK_URL` / `LINE_LINK_RETURN_URL` เป็น **โดเมนจริง https** + เพิ่ม Callback URL ในแท็บ LINE Login (LINE.md §8.3)
- [ ] `CRON_SECRET` · `PREORDER_PAYMENT_DEADLINE_HOURS` (ค่าเริ่มต้น 24) · ตัวเลือก `LINE_NOTIFY_POS_ORDERS` / `LINE_OWNER_QUOTA_RESERVE` / `PREORDER_REMINDER_DAYS_BEFORE`
- [ ] deploy แบบ serverless → ต้อง `UPLOAD_DRIVER=s3` (`public/` เขียนไม่ได้) และ rate limit / cache in-memory ไม่แชร์ข้าม instance (Y8)
- [ ] ทดสอบเชื่อม LINE ลูกค้าจริง end-to-end ด้วยมือ (LINE.md §7)

### R5. ✅ แดชบอร์ดภาพรวมไม่นับรายได้พรีออเดอร์ (โค้ด) — แก้แล้ว 2026-10-01 (§7.1)

- **พบ:** `dashboardService.overview` (รายได้/ส่วนลด/จำนวนออเดอร์/ต้นทุน COGS/กำไร) · `salesByDay` · `topProducts` อ่านแค่
  collection `orders` — **พรีออเดอร์ (`preorders`/`preorderitems`) ไม่ถูกนับเลย** · มีแค่ `revenueByChannel` (ใหม่ใน #52) ที่นับ
- **ผลกระทบ:** ร้านขายซาวโดว์ผ่านพรีออเดอร์เป็นหลัก → รายได้/กำไรในหน้าแรกต่ำกว่าจริง ตัดสินใจผิดได้
- **วิธีแก้:** รวม `preorders` (paid) เข้า revenue/orders · `preorderitems` (ของ preorder ที่ paid) เข้า COGS + top products ·
  salesByDay รวมทั้งสองแหล่ง · แยกยอดได้ด้วย field `source` ถ้าหน้าจอต้องการ · เพิ่มเทสเทียบผลรวมกับ `revenueByChannel`

### R6. รูปที่อัปโหลดหลัง deploy เปิดไม่ได้ (404) ภายใต้ `next start` — พบ 2026-10-01

- **พบ (ทดสอบจริง):** `next build` → `next start` → เขียนไฟล์ใหม่ลง `public/uploads/banners/` → `GET /uploads/banners/<ไฟล์>` = **404**
  (favicon ที่มีตอน build = 200) · `next start` เสิร์ฟเฉพาะไฟล์ใน `public/` ที่มีอยู่ตอน build · ใน `npm run dev` ใช้ได้ จึงไม่เคยเห็น
- **ผลกระทบ:** บน production (localDisk) รูปสินค้า / แบนเนอร์ / ใบเสร็จที่อัปโหลดหลัง deploy **เปิดไม่ได้ทั้งหมด** จนกว่าจะ build ใหม่ ·
  รวมแบนเนอร์ที่ `migrate:upload-files` เขียนเป็นไฟล์ด้วย · สลิปไม่โดน (ไฟล์ส่วนตัวอ่านผ่าน route — PR #54)
- **แก้ (ตอน deploy — ไม่ต้องแก้โค้ด):** ให้ nginx เสิร์ฟ `/uploads/` เองจากดิสก์ (`location /uploads/ { alias …/public/uploads/; }`) —
  config เต็มใน [`DEPLOY.md`](DEPLOY.md) §6 · ทางเลือกในโค้ด (ถ้าไม่มี nginx): route `GET /uploads/[...path]` อ่านไฟล์จากดิสก์เอง หรือใช้ `UPLOAD_DRIVER=s3`

### R7. ✅ ราคาสินค้าหน่วยปนกัน (บาท/สตางค์) — ต้นเหตุคือ FrontOffice เขียน DB ตรงเป็นบาท → เปลี่ยนทั้งระบบเก็บเป็นบาท

- **พบ (2026-10-01, `check:data-integrity` Y11 อ่านอย่างเดียว):** `product_price` สินค้าทั้ง 42 ตัวเป็นค่าบาท (คัพเค้ก `35`) ขณะที่ backend
  อ่านเป็นสตางค์ → แสดง/คิดเงิน 0.35 บาท · `sale_price` 7 ตัวเป็นสตางค์ · ราคารอบพรีออเดอร์ `366/650/400` เป็นบาท · ออเดอร์
  `ORD-1790786142302-M2PY` ยอด `55` · แก้ช่วง 2026-09-30 22:19–23:35 น. ไม่มี userlog (เหมือน BACKLOG2 §16 เมื่อ 09-24)
- **ต้นเหตุ (ผู้ใช้ยืนยัน 2026-10-01):** แอป **FrontOffice ต่อ MongoDB ตัวเดียวกันโดยตรง** และเขียนเงินเป็นบาท ไม่ใช่การแก้ด้วยมือ/ของรุ่นเก่า
- **ตัดสินใจ:** เก็บเงิน **เป็นบาททั้งระบบ** ("ดึงราคา 35 ก็เป็น 35" — FrontOffice ไม่ต้องแก้) → รายละเอียดก่อน/หลังทั้งหมด [`money-units.md`](money-units.md)
  - โค้ด: `src/lib/money.ts` `toSatang`/`toBaht` = ปัด 2 ตำแหน่ง · ปัดยอดทุกจุดที่คูณ/รวม · ตัวตรวจ Y11 ใช้เกณฑ์บาท
  - ข้อมูล: `npm run migrate:money-to-baht` (dry-run บน DB จริง: ÷100 347 ค่า · ไม่แตะ 75 ค่าที่เป็นบาทแล้ว · ต้องดูเอง 1)
    ⚠️ **ผู้ใช้ต้องรัน `--apply` เอง ตอน deploy พร้อมโค้ดใหม่** (หยุด backend + FrontOffice ก่อน — money-units.md §4)
  - สคริปต์ยุคสตางค์ 6 ตัวถูกบล็อก · ลบ `fix:baht-prices` (×100) ที่เคยเสนอไว้ — ตอนนี้ราคา `35` ถูกต้องแล้ว
- **ยังควรทำ:** FrontOffice ต่อ DB ตรง = ไม่มี userlog/validation/ตัดสต็อกผ่าน backend — ระยะยาวให้เรียก API · ให้ FrontOffice ใช้ DB user ของตัวเอง
  (DEPLOY §สำรองข้อมูล → ผู้ใช้ DB)

---

## 2. 🟡 ควรแก้

| # | เรื่อง | พบ | ผลกระทบ | วิธีแก้ที่เสนอ |
|---|---|---|---|---|
| Y1 | ✅ **ยกเลิก/คืนเงินพรีออเดอร์หลังสร้างใบผลิตแล้ว ใบผลิตไม่ลด** — แก้แล้ว (§7.2) | `cancelPreorder` / `refundPayment` ไม่แตะ `productionitems` (ต่างจากจ่ายช้าที่บวกเข้าให้ — #55 §6.4) | ผลิตเกินจำนวนที่ต้องส่งจริง | ตอนพรีออเดอร์ `paid` ในรอบ `closed` ถูกยกเลิก: ใบผลิตยัง `planned` → ลด `planned_qty` ของรายการ (ไม่ต่ำกว่า 0) · เริ่มผลิตแล้ว → แจ้งร้าน (กลับด้านของ `onPreorderPaid`) |
| Y2 | ✅ **ผลิตเสร็จแล้วไม่เพิ่มสต็อกสินค้าสำเร็จรูป** — แก้แล้ว (§7.6) | `productionItemService` หักวัตถุดิบ (`consumeStock`) แต่ไม่เคยเพิ่ม `product_stock_quantity` | ใบผลิตแบบ manual ของสินค้าปกติ (ขนมหน้าร้าน) → ต้องไปปรับสต็อกเองทุกครั้ง · ถ้าลืม ขายไม่ได้/สต็อกไม่ตรง | **ต้องตัดสินใจ:** เมื่อรายการผลิต `done` + สินค้าปกติ → `increaseStock(actual_qty ?? planned_qty × yield)` (พรีออเดอร์ไม่มีสต็อก — ข้าม) |
| Y3 | ✅ **สลิปโอนเงินเปิดสาธารณะ** — แก้แล้วใน PR #54 (§7.7) | `public/uploads/slips/` เสิร์ฟ static ใครก็ได้ถ้ารู้ URL (#54) | ข้อมูลส่วนตัว (ชื่อ/เลขบัญชี) · ชื่อไฟล์สุ่มเดายาก แต่ไม่ใช่การกันสิทธิ์จริง | ย้ายสลิปออกนอก `public/` + route อ่านไฟล์ที่ตรวจสิทธิ์ (เจ้าของรายการ / staff `payments.view`) หรือ S3 private + signed URL |
| Y4 | ✅ **mongoose: option `new: true` เลิกใช้แล้ว** — แก้แล้ว (§7.4) | 25 จุดใน `src/` · เทสขึ้น warning ทุกรอบ | mongoose รุ่นถัดไปอาจเลิกรองรับ | เปลี่ยนเป็น `returnDocument: "after"` ทีเดียวทั้งไฟล์ (พฤติกรรมเท่าเดิม) |
| Y5 | ✅ **dependency มีช่องโหว่ (high)** — แก้แล้วใน PR #56 (§7.8) | `npm audit`: `postcss ≤ 8.5.22` ผ่าน `next` (XSS ใน stringify + อ่านไฟล์ .map ผ่าน sourceMappingURL) | backend นี้เป็น API ล้วน ไม่ประมวลผล CSS จาก user → ความเสี่ยงจริงต่ำ (build-time) | `npm audit fix --force` = อัป Next 16 (breaking) · หรือ `overrides.postcss` ≥ เวอร์ชันที่แก้แล้ว + รันเทส/บิลด์ |
| Y6 | ✅ **staff ทุกคนลบแจ้งเตือนของร้านได้** — แก้แล้ว (§7.3) | `DELETE /api/admin/notifications/[id]` เช็คแค่ล็อกอิน (`requireAuth`) | แจ้งเตือนสำคัญ (สต็อก, โควตา LINE, ปิดรอบ) หายโดยเจ้าของไม่เห็น | จำกัด DELETE เฉพาะ owner (หรือ permission ใหม่) · PATCH อ่านแล้วให้ทุกคนได้เหมือนเดิม |
| Y7 | ✅ **พรีออเดอร์ข้อมูลเก่าไม่มีกำหนดชำระ** — แก้แล้ว (§7.9) | พรีออเดอร์ก่อน #55 มี `payment_due_at: null` | ไม่ถูกยกเลิกตามกำหนด (ถูกยกเลิกตอนปิดรอบแทน) | ถ้าต้องการ: สคริปต์ backfill `payment_due_at` = min(created + N ชม., close) สำหรับรอบที่ยังเปิด |
| Y8 | ✅ **state ในหน่วยความจำ ไม่แชร์ข้าม instance** — ตัดสินใจรัน instance เดียว (§7.10) | `rateLimit` · permission cache · delivery-zone cache · cache โควตา LINE | หลาย instance / serverless: rate limit หลวม · โควตา LINE ตัดสินจากค่า cache ต่าง instance | ตั้ง instance เดียว หรือย้ายไป Redis (แก้เฉพาะไฟล์ lib ละตัว — ออกแบบไว้แล้ว) |
| Y9 | ✅ `variant_stock` ไม่เคยถูกเช็ค/ตัด (ยกมาจาก BACKLOG2 §9) — แก้แล้ว (§7.11) | DB มี variant 0 ตัว (ตอนนั้น) | ถ้าเริ่มใช้ variant แบบจำกัดจำนวน จะขายเกิน | ตัด/คืน `variant_stock` คู่กับ `product_stock_quantity` ใน `deductStockForOrder`/`restockForOrder` |
| Y10 | ✅ `audit-money-units` ให้ false positive หลัง fix (ยกมาจาก BACKLOG2 §16.1) — แก้แล้ว (§7.12) · เลิกใช้หลังเปลี่ยนเป็นบาท (R7) | ใช้ `updated_at` ตัดสิน | ถ้าทำตามรายงาน เงินจะ ×100 ซ้ำ | ให้ audit เทียบกับ `scripts/backups/money-fix-*.json` หรือเตือนเมื่อพบ marker |
| Y11 | ✅ ต้นทางที่เขียน DB ตรงนอกแอป (BACKLOG2 §16 + `product_type: "ready"` ที่เจอ 2026-09-30) — ตรวจรายวัน + แจ้งร้าน (§7.13) · พบเกิดซ้ำจริง → R7 | ยังมีการเขียน DB ตรง ๆ (ชิโอะปังนูเทลล่า แก้ล่าสุด 2026-09-30) | ราคา/ประเภทเพี้ยนซ้ำได้ | หาคน/เครื่องมือที่ต่อ DB ตรง (Compass/สคริปต์เก่า/แอปรุ่นเก่า) · แยก DB user อ่านอย่างเดียวสำหรับเครื่องมือ |

---

## 3. 🟢 เล็กน้อย / ต่อยอด

| # | เรื่อง | หมายเหตุ |
|---|---|---|
| G1 | `max_order_qty` ต่อคน อาจเกินเล็กน้อยถ้าคนเดิมยิง 2 คำขอพร้อมกันเป๊ะ | โควตารอบยังกันแบบ atomic · preorder-round-flow §3.2 |
| G2 | จ่ายช้าพร้อมกับตอนปิดรอบกำลังสร้างใบผลิต → อาจนับซ้ำ/สร้างใบซ้อน (เกิดยากมาก) | ใส่ unique partial index `productionorders(round_id)` เมื่อ `production_status ≠ cancelled` กันใบซ้อนได้ |
| G3 | ข้อความ LINE ถึงลูกค้าไม่บันทึกลง DB (ดูจาก log เท่านั้น) | LINE.md §8.1 ข้อ 9 |
| G4 | ไม่รู้ว่าลูกค้าบล็อก OA (`linked` ยัง true) | รับ webhook `unfollow` · LINE.md §8.1 ข้อ 10 |
| G5 | ออเดอร์จาก `POST /api/admin/orders` เป็น POS โดยค่าเริ่มต้น | ตั้งใจ · LINE.md §8.1 ข้อ 8 |
| G6 | index สำหรับ query ใหม่ | `preorders.payment_due_at` (cron ทุก 15 นาที) · `users.line_user_id` · `notifications.title` (กันแจ้งซ้ำรายเดือน) — ข้อมูลยังเล็ก ยังไม่เร่ง |
| G7 | `.env.example` ขาดตัวแปรไม่บังคับ | `UPLOAD_DRIVER`, `S3_*`, `DELIVERY_FEE_*`, `DELIVERY_FREE_MIN`, `*_CACHE_TTL_MS` (มีใน `docs/env.md` แล้ว) |
| G8 | lint warning `no-explicit-any` 5 จุดใน `src/app/api/admin/*` (+1 ใน route สถานะรอบ) | ไม่กระทบการทำงาน |
| G9 | `seed.ts` ไม่ให้สิทธิ์เมนูกับ role `staff` เลย (รวม `preorder`) | owner ต้องตั้งเองในหน้าสิทธิ์ · BACKLOG §8 |
| G10 | โปรโมชันใช้กับพรีออเดอร์ไม่ได้ (มีแค่ส่วนลดกรอกมือของแอดมิน) | BACKLOG §8 |
| G11 | พิมพ์ป้ายบาร์โค้ด (label sheet) ยังไม่มี | BACKLOG §7 |
| G12 | เปลี่ยนสถานะพรีออเดอร์ทีละรายการ (ready/completed) — ไม่มี bulk ต่อรอบ | รอบหนึ่งมีหลายสิบรายการ แอดมินกดเยอะ · เพิ่ม `PATCH /api/admin/preorder-rounds/[id]/preorders/status` |
| G13 | `/api/admin/dashboard/revenue-by-type` เป็นชื่อเก่า (alias) | ลบหลัง frontend ย้ายไป `revenue-by-channel` |
| G14 | เปิดรอบที่ปิดแล้วกลับ ทำได้จริงแค่รอบที่ไม่มีใครจ่าย (ใบผลิตสร้างอัตโนมัติ) | ตั้งใจตามที่ตัดสินใจ · ทางเลือก: ยกเลิกใบผลิต `planned` ให้อัตโนมัติตอนเปิดกลับ — preorder-round-flow §6.5 |
| G15 | ใบเสร็จ/สลิปรับเฉพาะรูป ไม่รับ PDF | ใบเสร็จจากร้านค้ามักเป็น PDF · เพิ่มการตรวจ magic bytes `%PDF` |

---

## 4. งานนอก repo นี้

| งาน | ที่มา |
|---|---|
| frontend: ปุ่มเชื่อม LINE, `low_stock_threshold`, หน้าแจ้งเตือน (`link: null`) | [`LINE.md`](LINE.md) §8.2 |
| frontend: อัปโหลดสลิป/ใบเสร็จแทนช่องพิมพ์, แบนเนอร์ผ่าน upload เท่านั้น | [`uploads.md`](uploads.md) §4 |
| frontend: ฟิลด์ `is_preorder` แทน `product_types`, ตัวกรอง `?is_preorder=`, `revenue-by-channel` | BACKLOG2 §14.1 |
| frontend: แสดง `payment_due_at`, `close_result` หลังปิดรอบ, ช่อง `close_date` ตอนเปิดรอบกลับ | [`preorder-round-flow.md`](preorder-round-flow.md) §6.6 |
| ลูกค้า 3 รายที่สลิปไม่มีไฟล์ (สถานะ pending) ต้องแนบใหม่ | [`uploads.md`](uploads.md) §3.3 |
| ตอบ backend: path หน้าจัดการพรีออเดอร์ (ใส่ `link` ในแจ้งเตือน) · path หน้าโปรไฟล์จริง | LINE.md §8.2 ง |

---

## 5. ✅ ตรวจแล้วไม่พบปัญหา (บันทึกไว้กันตรวจซ้ำ)

| ขอบเขต | ผล |
|---|---|
| สิทธิ์ทุก route ใต้ `/api/admin` | ทุกไฟล์ใช้ `withPermission` / `auth: { menu }` หรือตรวจเอง (`attendances` เช็ค self หรือ permission `employees` · `notifications` ล็อกอินอย่างเดียวตามออกแบบ — ยกเว้น DELETE ดู Y6) |
| middleware | `/api/cron/*` ไม่ใช้ session แต่ route บังคับ `CRON_SECRET` · ยกเว้น `/api/shop/me/line/callback` ตรงตัว (path อื่นใน `/api/shop` ยังต้องล็อกอิน — มีเทส) |
| upload | ตรวจขนาด/นามสกุล/magic bytes · `isUploadedUrl` กัน url ภายนอก/traversal (มีเทส) |
| IDOR ฝั่ง `/api/shop` | slip ใหม่ (`POST …/slip`) เช็คเจ้าของก่อนรับไฟล์ · ตรวจ route อื่นแล้วใน BACKLOG2 |
| เงิน | ทุก field เป็นสตางค์ (BACKLOG §3.11) · รายงานใหม่ `revenueByChannel` ผลรวมตรงทุกช่องทาง (มีเทส) |
| ส่งซ้ำ / ทำซ้ำ | เตือนวันรับ, ยกเลิกคนไม่จ่าย, ปิดรอบ, บวกเข้าใบผลิต — ใช้การจอง/เปลี่ยนสถานะแบบมีเงื่อนไข รันซ้ำ/พร้อมกันไม่ทำซ้ำ (มีเทส) |
| CI | ผ่านทุก PR (#52, #53, #54, #55) — typecheck, typecheck:test, lint, unit, integration, build |

---

## 6. ลำดับที่แนะนำ

1. **R1–R4** (งาน deploy) — ทำตามลำดับ merge แล้วรัน migration + ตั้ง cron + env
2. ~~**R5** แดชบอร์ดนับพรีออเดอร์~~ ✅ (§7.1)
3. ~~**Y1** ใบผลิตลดเมื่อยกเลิก · **Y6** จำกัดการลบแจ้งเตือน · **Y4** `returnDocument`~~ ✅ (§7.2–§7.4)
4. ~~**Y2** ผลิตเสร็จเพิ่มสต็อก · **Y3** สลิป private · **Y5** postcss~~ ✅ (§7.6–§7.8 — ตัดสินใจแล้ว 2026-10-01)
5. ~~Y7–Y11 · R7 เงินเป็นบาท~~ ✅ โค้ด (§7.9–§7.15, PR #57) · **ตอน deploy: หยุด backend+FrontOffice → `migrate:money-to-baht --apply` → deploy (money-units.md §4)**
6. G* ตามความจำเป็น · งานที่เหลือทั้งหมดดู §8

---

## 7. บันทึกการแก้ไข (2026-10-01 — commit เข้า PR #55)

### 7.1 R5 — แดชบอร์ดรวมพรีออเดอร์ (`src/services/dashboardService.ts`)

| ฟังก์ชัน | ก่อน | หลัง |
|---|---|---|
| `overview` | revenue / discount / จำนวนออเดอร์ / COGS จาก `orders` + `orderitems` เท่านั้น | รวม `orders` + **`preorders`** (paid) และ COGS จาก `orderitems` + **`preorderitems`** (`cost_per_unit × quantity`) · `orders.by_status` รวมทั้งสองแหล่ง · **เพิ่ม `by_source: { orders, preorders }`** (total / paid / revenue / cogs) |
| `salesByDay` | ยอดรายวันจาก `orders` | รวมทั้งสองแหล่งต่อวัน (เวลาไทย) |
| `topProducts` | อันดับจาก `orderitems` | รวม `orderitems` + `preorderitems` ต่อสินค้า แล้วเรียง/ตัด limit |
| `profit_estimate` | revenue(ออเดอร์) − ค่าใช้จ่าย − COGS(ออเดอร์) → **ต่ำกว่าจริง** | revenue(ทั้งหมด) − ค่าใช้จ่าย − COGS(ทั้งหมด) |

โครงสร้างโค้ด: `SOURCES` (orders / preorders — model, itemModel, fk) + `joinedItems()` (pipeline รายการ join เอกสารแม่)
ใช้ร่วมทั้ง 3 ฟังก์ชัน · **response เดิมไม่เปลี่ยนคีย์** (ค่าเป็นยอดรวมแล้ว) — frontend ไม่ต้องแก้ ถ้าจะแยกแสดงใช้ `by_source`

เทส (`tests/integration/dashboardService.test.ts` +2): ออเดอร์ 90 บาท + พรีออเดอร์ 300 บาท → revenue 390 · ส่วนลด 10 ·
COGS 20 + 120 · จ่ายแล้ว 2 · ทั้งหมด 3 (พรีออเดอร์ค้างจ่ายนับจำนวนแต่ไม่นับเงิน) · `by_source` ถูก · สินค้าพรีออเดอร์ติดอันดับขายดี

### 7.2 Y1 — ยกเลิกพรีออเดอร์ที่นับเข้าใบผลิตแล้ว → ลดใบผลิต

| | ก่อน | หลัง |
|---|---|---|
| ยกเลิกพรีออเดอร์ที่จ่ายแล้วในรอบ `closed` (ใบผลิต `planned`) | คืนเงิน + คืนโควตา แต่ **ใบผลิตยังนับอยู่** → ผลิตเกิน | `onPreorderCancelled` ลด `planned_qty` ของรายการสินค้า (เฉพาะรายการ `pending` ที่ยังไม่ตัดสต็อก) · เหลือ 0 → รายการเป็น `cancelled` · แจ้งร้านในเว็บ |
| ใบผลิตเริ่มผลิตแล้ว (`in_progress`/`done`) | — | ไม่แตะ · แจ้งร้าน "พรีออเดอร์ถูกยกเลิกหลังเริ่มผลิต" |
| ยกเลิกรายการที่ยังไม่จ่าย / รอบยังไม่ปิด | — | ไม่ทำอะไร (ไม่เคยถูกนับ — ใบผลิตนับเฉพาะ paid) |
| เรียกซ้ำ | — | ไม่ลดซ้ำ — ฟิลด์ใหม่ `preorders.removed_from_production_at` จองแบบ atomic |

จุดเรียก: `preorderService.updatePreorderStatus` หลังบันทึก `cancelled` (ครอบทั้ง `cancelPreorder` ของลูกค้า/แอดมิน, ยกเลิกรอบ,
ยกเลิกคนไม่จ่าย) · จำ `wasPaid` **ก่อน** cleanup เพราะ auto-refund เปลี่ยน `payment_status` เป็น `refunded` ใน DB ไปแล้ว ·
best-effort (พังแล้ว log ไม่ทำให้การยกเลิกล้ม) — คู่กลับด้านของ `onPreorderPaid` ([`preorder-round-flow.md`](preorder-round-flow.md) §6.4)

เทส (`tests/integration/preorderLifecycle.test.ts` +3): 5 → ยกเลิก 3 → 2 (คืนเงินแล้ว) · เรียกซ้ำ `skipped` · ยกเลิกอีก 2 → 0 + `cancelled` ·
ใบผลิต `in_progress` ไม่แตะ + แจ้งร้าน · ยังไม่จ่าย / รอบยัง open → `not-counted`

### 7.3 Y6 — ลบแจ้งเตือนเฉพาะเจ้าของร้าน (`src/app/api/admin/notifications/[id]/route.ts`)

| | ก่อน | หลัง |
|---|---|---|
| `DELETE` | ล็อกอินก็ลบได้ (staff ทุกคน) | `requireRole(session, "owner")` — staff ได้ **403** |
| `PATCH` (อ่านแล้ว/ยังไม่อ่าน) | ทุกคน | ทุกคน (เหมือนเดิม) |

เทส (`tests/lib/notificationRoute.test.ts` ใหม่ 3 เคส): staff → 403 ไม่เรียกลบ · ไม่ล็อกอิน → 401 · owner → ลบได้

⚠️ frontend: ซ่อนปุ่มลบแจ้งเตือนเมื่อผู้ใช้ไม่ใช่ owner (ไม่งั้นกดแล้วได้ 403)

### 7.4 Y4 — `new: true` → `returnDocument: "after"`

- 25 จุดใน 12 ไฟล์ (`crudService`, `orderLifecycle`, `address` / `attendance` / `cart` / `orderItem` / `permission` / `product` /
  `promotion` / `promotionUsage` / `review` / `user` service) — พฤติกรรมเท่าเดิม (คืนเอกสารหลังอัปเดต)
- **ผล:** warning `[MONGOOSE] … the \`new\` option … is deprecated` ในเทส integration จาก**ขึ้นทุกรอบ → 0**

### 7.5 ผลรวม

unit 218 ✅ (+3) · integration 257 ✅ (+5) · typecheck ✅ · typecheck:test ✅ · lint 0 error (warning 5 จุดเดิม) · `next build` ✅

**ตัดสินใจแล้ว 2026-10-01:** Y2 เพิ่มอัตโนมัติ (§7.6) · Y3 เปิดดูได้เฉพาะผู้มีสิทธิ์ (§7.7 — ทำใน PR #54) · Y5 เลือก ก. overrides (§7.8 — PR #56)

### 7.6 Y2 — ปิดงานผลิตแล้วเพิ่มสต็อกสินค้าอัตโนมัติ (ตัดสินใจ 2026-10-01 — PR #55)

| | ก่อน | หลัง |
|---|---|---|
| `completeProduction` (in_progress → done) | หักวัตถุดิบอย่างเดียว · สต็อกสินค้าไม่เปลี่ยน → ต้องไปปรับสต็อกเองทุกครั้ง ลืม = ขายไม่ได้/สต็อกไม่ตรง | หักวัตถุดิบ + **เพิ่ม `product_stock_quantity`** ของสินค้าปกติ (`addFinishedGoodsStock` → `productService.increaseStock`) |
| จำนวนที่เพิ่ม | — | `actual_qty` ถ้าส่ง `use_actual` และกรอกไว้ ไม่งั้น `planned_qty` (เดียวกับที่ใช้หักวัตถุดิบ) |
| สินค้าพรีออเดอร์ (`is_preorder: true`) | — | **ไม่เพิ่ม** — ไม่มีสต็อก ของส่งตรงให้ลูกค้าที่สั่ง |
| รายการยกเลิก / จำนวน 0 | — | ข้าม |
| กันเพิ่มซ้ำ | — | ฟิลด์ใหม่ `productionitems.product_stock_added_at` + `product_stock_added_qty` (จองแบบ atomic) |

`done` เป็นสถานะสุดท้ายของใบผลิต (ยกเลิกไม่ได้หลัง done) จึงไม่ต้องมีการคืนสต็อกย้อนกลับ ·
เปลี่ยนสถานะรายการผลิตทีละรายการ (`updateItem`) **ไม่**เพิ่มสต็อก — เพิ่มตอนปิดใบผลิตเท่านั้น

เทส (`tests/integration/productionFinishedStock.test.ts` ใหม่ 3 เคส): สินค้าปกติ 4 + 12 = 16 · พรีออเดอร์ยัง null ·
บันทึก `product_stock_added_qty` · `use_actual` ใช้ 17 แทนแผน 20 · รายการยกเลิกไม่เพิ่ม ·
ผลรวม integration 260 ✅ · `next build` ✅

### 7.7 Y3 — สลิปเปิดดูได้เฉพาะผู้มีสิทธิ์ (ตัดสินใจ 2026-10-01 — ทำใน **PR #54** commit `d897d35`)

| | ก่อน | หลัง |
|---|---|---|
| ที่เก็บ | `public/uploads/slips/` — ใครรู้ URL ก็เปิดได้ | `storage/private/slips/` นอก `public/` (`PRIVATE_UPLOAD_DIR`) · s3: key `private/…` (ตั้ง prefix ให้ไม่ public) |
| URL | `/uploads/slips/…` | `/api/files/slips/…` |
| เปิดดู | ไม่ตรวจอะไรเลย | `GET /api/files/slips/[filename]`: เจ้าของรายการ / owner / staff ที่มี `payments.view` = 200 · อื่น ๆ 403 · ไม่ล็อกอิน 401 · `Cache-Control: private, no-store` |

รายละเอียด + frontend (ต้อง fetch แบบส่ง cookie แล้วทำ blob URL) → [`uploads.md`](uploads.md) §6 · เทส `privateSlips.test.ts` 5 เคส

### 7.8 Y5 — postcss (เลือก ก. overrides 2026-10-01 → **PR #56** · `npm audit` = 0)

**postcss คืออะไร:** เครื่องมือแปลง/ประมวลผลไฟล์ CSS ที่ Next.js ใช้ **ตอน build** (เช่น เติม vendor prefix, รัน Tailwind) — ไม่ได้ทำงานตอนรับ
request จากผู้ใช้ · backend นี้เป็น API ล้วน มี CSS ไฟล์เดียว (`src/app/globals.css` จากตอนสร้างโปรเจกต์) ที่เราเขียนเอง

**ช่องโหว่ที่ `npm audit` เจอ (postcss ≤ 8.5.22 · high):** โจมตีได้เมื่อระบบ **เอา CSS ที่ผู้โจมตีเขียนมาประมวลผล** — (1) CSS ที่แต่งมา
แทรก `</style>` ทำ XSS ในผลลัพธ์ (2) comment `sourceMappingURL` ชี้ไปอ่านไฟล์ `.map` อื่นในเครื่อง · ระบบนี้ไม่เคยรับ CSS จากผู้ใช้
→ **ความเสี่ยงจริงต่ำมาก** แต่ scanner/CI ของ GitHub จะเตือนไปเรื่อย ๆ

**ข้อเท็จจริงเวอร์ชัน:** `next` ทุกรุ่น 15.x (ล่าสุด 15.5.27) ล็อก `postcss@8.4.31` (มีช่องโหว่) · `next@16.3.8` ใช้ `postcss@8.5.23` (แก้แล้ว)

| ทางเลือก | ทำอะไร | ข้อดี | ข้อเสีย |
|---|---|---|---|
| ก. `overrides` (แนะนำ) | `package.json`: `"overrides": { "next": { "postcss": "^8.5.23" } }` แล้ว `npm install` | แก้ช่องโหว่ทันที · เปลี่ยนแค่ minor ใน 8.x · ไม่แตะโค้ด | บังคับเวอร์ชันที่ Next 15 ไม่ได้ทดสอบมา (ความเสี่ยงต่ำ — ยืนยันด้วย build + เทสทั้งหมด) |
| ข. อัป Next 16 | `npm install next@16` + แก้ตาม breaking changes | ได้ของใหม่/แพตช์ครบ · ไม่ต้อง override | งานใหญ่: API/convention เปลี่ยน (AGENTS.md เตือน) · ต้องไล่ middleware/route/config · frontend repo ควรอัปตาม |
| ค. ยอมรับความเสี่ยง | บันทึกไว้ ไม่ทำอะไร | ไม่ต้องทำอะไร | audit เตือนค้าง · ถ้าวันหนึ่งประมวลผล CSS จากผู้ใช้จะเสี่ยงจริง |

พบเพิ่ม: `postcss.config.mjs` อ้างปลั๊กอิน `@tailwindcss/postcss` ที่**ไม่ได้ติดตั้ง** (ค้างจากตอนสร้างโปรเจกต์ · build ยังผ่าน) —
ถ้าเลือก ก./ข. ควรลบไฟล์นี้หรือ config ทิ้งไปด้วย (API ไม่ใช้ Tailwind)

**ทำแล้ว (PR #56, commit `6df01ca`):** `overrides.next.postcss: ^8.5.23` (ได้ 8.5.28) · `npm audit fix` แก้ `brace-expansion` ใน eslint (dev,
ไม่ breaking) · ลบ `postcss.config.mjs` ที่อ้าง Tailwind ซึ่งไม่ได้ติดตั้ง · `npm audit` = **0 vulnerabilities** · typecheck/lint/unit 190/
integration 178/build ผ่าน · ไม่ชนกับ #52/#54/#55

---

## 7.9–7.13 บันทึกการแก้ไข Y7–Y11 (2026-10-01 — branch `fix/backlog4-y7-y11` ต่อจาก PR #55)

### 7.9 Y7 — เติมกำหนดชำระให้พรีออเดอร์เก่า (`scripts/backfill-payment-due.ts`)

| | ก่อน | หลัง |
|---|---|---|
| พรีออเดอร์ก่อน #55 ที่ค้างจ่าย | `payment_due_at: null` → `cancelUnpaidPreorders` ข้าม (กรอง `$ne: null`) ค้างจนปิดรอบ | `npm run backfill:payment-due` เติม = min(สั่ง + `PREORDER_PAYMENT_DEADLINE_HOURS`, ปิดรอบ) — สูตรเดียวกับของใหม่ |
| รายการที่เลยกำหนดไปแล้ว | — | เลื่อนเป็น "ตอนรัน + grace ชม." (ค่าเริ่มต้น = N ชม., `--grace-hours=`) ลูกค้าไม่ถูกยกเลิกทันทีโดยไม่รู้ตัว · รายงานเป็น "เลื่อน" |
| ขอบเขต | — | เฉพาะ `payment_status` pending/failed ที่ไม่ยกเลิก/เสร็จ/ลบ · จ่ายแล้วไม่แตะ · หารอบไม่เจอ = รายงาน ไม่แตะ |
| ความปลอดภัย | — | dry-run ค่าเริ่มต้น · `--apply` backup `scripts/backups/payment-due-*.json` ก่อน · เขียนแบบมีเงื่อนไข `payment_due_at: null` (รันซ้ำได้) |

DB จริง (dry-run 2026-10-01): **0 รายการ** — ยังไม่ต้อง `--apply` (DEPLOY §⑦) · เทส `backfillPaymentDue.test.ts` 2 เคส

### 7.10 Y8 — state ในหน่วยความจำ → รัน instance เดียว (ตัดสินใจ 2026-10-01)

| | ก่อน | หลัง |
|---|---|---|
| ข้อกำหนด | ไม่ได้เขียนไว้ — `pm2 -i max` ได้โดยไม่รู้ผล | [`DEPLOY.md`](DEPLOY.md) §⑤ ห้าม cluster / หลาย instance พร้อมเหตุผล 4 จุด (rate limit · permission cache 30 วิ · delivery-zone cache · โควตา LINE) |
| ตรวจจับ | ไม่มี | `src/instrumentation.ts` (`register()` ตอนเริ่ม) — pm2 `exec_mode=cluster_mode` / `NODE_APP_INSTANCE` ≠ 0 / `VERCEL` → log warn `runtime.multi_instance` |
| แก้ปัญหา | — | DEPLOY แก้ปัญหาที่เจอบ่อย: เจอ log นี้ → `pm2 delete` แล้ว start ใหม่แบบ fork |

ไม่ย้ายไป Redis — ร้านขนาดนี้ instance เดียวพอ · ถ้าต้องขยาย แก้ไฟล์ละตัว (ออกแบบไว้แล้ว)

### 7.11 Y9 — สต็อกแยกต่อ variant + สต็อกสินค้า = ผลรวม (ตัดสินใจ 2026-10-01)

| | ก่อน | หลัง |
|---|---|---|
| สั่งซื้อ (`deductStockForOrder`) | ตัดแค่ `product_stock_quantity` — `variant_stock` ไม่เคยถูกเช็ค/ตัด | รายการมี `variant_id` → ตัด `variant_stock` แบบ atomic (`$gte`) ด้วย · ตัวเลือกไม่พอ = 409 "สต็อกไม่พอสำหรับ X (M)" แม้สต็อกรวมยังเหลือ · ชดเชยคืนทั้งสินค้า+variant ที่ตัดไปแล้ว |
| ยกเลิก (`restockForOrder`) | คืนแค่สินค้า | คืน variant ด้วย · variant ถูกลบไปแล้วแต่สินค้ายังมีตัวเลือกอื่น → ถอนส่วนที่คืนเข้าสินค้า (ผลรวมยังตรง) |
| `checkStockAvailability` | ดูสต็อกสินค้าอย่างเดียว | มี `variant_id` → available = min(สินค้า, variant) |
| ไม่เลือกตัวเลือก | สั่งได้ (ตัดสต็อกรวม ไม่รู้ไซส์) | สินค้ามีตัวเลือก → 400 "กรุณาเลือกตัวเลือกของสินค้า" ทั้งตะกร้า (`cartService.addItem`) และออเดอร์ (`resolveLines` — batch `distinct` ครั้งเดียว) |
| ปรับสต็อกที่ตัวสินค้า (`setStock`/`adjustStock`/`increaseStock`) | ได้ | สินค้ามีตัวเลือก → 409 ให้ปรับที่ตัวเลือก |
| แอดมินแก้ตัวเลือก (`productVariantService`) | `variant_stock` เป็นแค่ตัวเลขเก็บไว้ | สร้างตัวแรก/กู้คืนตัวแรก → สต็อกสินค้า = ผลรวม (`syncStockFromVariants`) · ตัวถัดไป/แก้/ลบ/กู้คืน → `$inc` สต็อกสินค้าตามส่วนต่าง (`applyVariantStockDelta` — ค่าก่อน-หลังจาก `findOneAndUpdate` เดียวกัน) + แจ้งใกล้หมด |
| ปิดงานผลิต (Y2) สินค้ามีตัวเลือก | จะเพิ่มสต็อกรวม (ผลรวมเพี้ยน) | ข้าม + แจ้งเจ้าของร้าน "ต้องเพิ่มสต็อกที่ตัวเลือกเอง" (`product_stock_added_at` ยัง null) |

DB จริงมีตัวเลือก 0 ตัว — ไม่กระทบข้อมูลเดิม · เทส `variantStock.test.ts` 8 เคส · `persistOrder.test.ts` 2 เคสเดิมใส่ `variant_stock` ให้ fixture
(เดิม 0 = ตอนนี้สั่งไม่ได้ตามกติกาใหม่) · **frontend:** ต้องบังคับเลือกตัวเลือก + แสดงสต็อกต่อตัวเลือก (`resolveScan` คืน `variants[].variant_stock` อยู่แล้ว)

### 7.12 Y10 — `audit-money-units` เทียบ backup + marker (`scripts/audit-money-units.ts`)

> ⚠️ **เลิกใช้แล้ว (2026-10-01):** ระบบเก็บเงินเป็นบาท (R7 · [`money-units.md`](money-units.md)) — สคริปต์นี้ตัดสินด้วยสมมติฐานสตางค์
> จึงถูกบล็อกตอนรันจาก CLI (`scripts/_legacyMoney.ts`) · โค้ดและเทสด้านล่างเก็บไว้เป็นประวัติ · ตรวจหน่วยเงินตอนนี้ใช้ `check:data-integrity` (Y11)

| | ก่อน | หลัง |
|---|---|---|
| แถวที่ `fix-money-units` แก้แล้ว | `updated_at` เก่า (fix ไม่แตะ) → BAHT_LIKELY ซ้ำ → รายงานชวน ×100 อีก (114 แถว false positive) | ค่าตรง `new` ใน `scripts/backups/money-fix-*.json` / `product-price-fix-*.json` → **SATANG_FIXED** (ไม่เสนอ ×100) |
| ถูกเขียนกลับเป็นบาท (แบบ §16) | ปนกับข้างบน แยกไม่ออก | ค่าตรง `old` ใน backup → BAHT_LIKELY + note "กลับเป็นค่าก่อนแก้" |
| ถูกแก้หลัง fix | — | ไม่ตรงทั้ง old/new → REVIEW + note |
| แถวที่ fix ตั้งใจไม่แตะ | BAHT_LIKELY | มี marker `money_fix_units_applied` + `updated_at` < เวลา fix + ไม่อยู่ใน backup → REVIEW + note · พิมพ์คำเตือน marker ที่หัวรายงาน |
| โครงสร้าง | `main()` ผูก argv | export `runAudit()` / `loadFixedValues()` (เทสได้) · CLI เหมือนเดิม |

เทส `auditMoneyUnits.test.ts` 3 เคส

### 7.13 Y11 — ตรวจข้อมูลผิดปกติรายวัน + แจ้งร้าน (ตัดสินใจ 2026-10-01)

| | ก่อน | หลัง |
|---|---|---|
| รู้ว่ามีการแก้ DB นอกแอป | รู้ตอนลูกค้า/ผู้ใช้เห็นราคาเพี้ยน (§16 ผ่านไป ~1 วัน) | `src/services/dataIntegrityService.ts` ตรวจทุกเช้า (cron 07:30 — DEPLOY §⑧) → แจ้งเตือน `system`/warning + LINE เจ้าของร้าน (10 รายการแรก) |
| สิ่งที่ตรวจ (อ่านอย่างเดียว) | — | `legacy_fields` (product_type / product_types / delete_at) · `is_preorder_missing` · `price_bad_precision` (ทศนิยม > 2 — สินค้า/ตัวเลือก/ตัวเลือกเสริม) · `price_too_low` (< 1 บาท) · `price_too_high` (> 10,000 บาท — น่าจะเป็นสตางค์) · `sale_not_below_price` · `code_prefix_mismatch` · `stock_invalid` · `variant_stock_sum` (Y9) |
| เรียกใช้ | — | `npm run check:data-integrity` (`--no-notify` = พิมพ์อย่างเดียว · exit 2 เมื่อพบ) · `GET/POST /api/cron/data-integrity` (Bearer `CRON_SECRET`, `?notify=false`) |
| สิทธิ์ DB | user เดียวใช้ทั้งแอปและ Compass | DEPLOY §สำรองข้อมูล → ผู้ใช้ DB: `meowmee-app` readWrite (แอปเท่านั้น) · `meowmee-readonly` read (เครื่องมือ) · Atlas Project Read Only — **ผู้ใช้ต้องตั้งเองที่ Atlas** |

หมายเหตุ: `preparation_heating` / `yield_per_batch` ที่ BACKLOG2 §16 เรียกว่า "ฟิลด์เก่า" **ยังอยู่ใน schema ปัจจุบัน** — ไม่นับเป็นสัญญาณ ·
รันกับ DB จริงครั้งแรกเจอ **R7** ทันที · เทส `dataIntegrity.test.ts` 3 เคส

### 7.14 ผลรวม Y7–Y11

- ไฟล์ใหม่: `scripts/backfill-payment-due.ts` · `scripts/check-data-integrity.ts` · `src/services/dataIntegrityService.ts` · `src/app/api/cron/data-integrity/route.ts` · `src/instrumentation.ts`
- แก้: `productService` · `productVariantService` · `orderService` · `cartService` · `productionOrderService` · `scripts/audit-money-units.ts` · `package.json` (scripts `backfill:payment-due`, `check:data-integrity`) · `docs/DEPLOY.md`
- R7: เก็บเงินเป็นบาท ([`money-units.md`](money-units.md)) — `src/lib/money.ts` + จุดคำนวณยอด · `scripts/migrate-money-to-baht.ts` + `migrateMoneyToBaht.test.ts` 2 เคส · บล็อกสคริปต์ยุคสตางค์ (`scripts/_legacyMoney.ts`) · ปรับเทสเงินทั้งหมดให้ DB เป็นบาท
- เทสใหม่ 18 เคส (variantStock 8 · backfillPaymentDue 2 · auditMoneyUnits 3 · dataIntegrity 3 · migrateMoneyToBaht 2) · รวม 491 ผ่าน (66 ไฟล์) ณ commit เงินเป็นบาท
- หลังรวมงานแจ้งเตือน (module_label · ถ้อยคำใหม่ · เลขออเดอร์ในสลิป · เลิกใช้ employee) + cleanup (§7.15): รวม **500 ผ่าน** (70 ไฟล์) · `next build` ✅ · typecheck 0 · lint 0 error · `next build` ผ่าน
- ทดสอบจริง: `next start` + `NODE_APP_INSTANCE=1` → log `runtime.multi_instance` · `check:data-integrity` / `backfill:payment-due` บน DB จริงแบบอ่านอย่างเดียว (ไม่แจ้ง ไม่เขียน)
- merge: `package.json` scripts ชนกับ #54 เพิ่มอีกจุด (เก็บทั้งสองฝั่ง เหมือน #55)

### 7.15 ล้างฟิลด์เก่า `delete_at` ของสินค้า + คอมเมนต์หน่วยเงิน (2026-10-01)

| | ก่อน | หลัง |
|---|---|---|
| สินค้า 4 ตัวมี `delete_at: null` (ฟิลด์ schema เก่า สะกดผิดของ `deleted_at`) | `check:data-integrity` แจ้ง `legacy_fields` ทุกเช้า | `npm run cleanup:legacy-product-fields` ($unset เฉพาะ `delete_at: null` · มีวันที่ = รายงาน ไม่แตะ · backup · ไม่แตะ `updated_at`) — dry-run บน DB จริง: 4 ตัว (`pos-2726067`, `pos-0126264`, `pos-2826088`, `pos-2626624`) · **ผู้ใช้รัน `--apply` เอง** |
| คอมเมนต์ฟิลด์เงินใน `src/models/*` (22 จุด) | "เก็บเป็นสตางค์ (integer)" — ผิดหลัง R7 ชวนให้เขียนค่าผิดหน่วย | "เงินเป็นบาท ทศนิยมไม่เกิน 2 ตำแหน่ง (docs/money-units.md)" + คงข้อมูลสำคัญ (discount_value ตอน % ไม่ใช่เงิน ฯลฯ) |
| คอมเมนต์การปัดต้นทุนใน `recipeService`/`componentService` | อธิบาย `Math.round` เป็นสตางค์เต็ม | อธิบายการปัด 2 ตำแหน่งแบบบาท |

คอมเมนต์ใน service อื่นที่ยังพูดถึง "สตางค์" (~78 จุด) เป็นคำอธิบายประวัติของ §3.11 — หน่วยจริงดูที่ `src/lib/money.ts` / `money-units.md` ·
เทส `cleanupLegacyProductFields.test.ts` 1 เคส

---

## 8. สถานะคงเหลือ (2026-10-01)

ตรวจซ้ำหลังแก้ทุกรายการแล้ว: **โค้ดและเอกสารใน repo นี้ไม่มีอะไรต้องแก้เพิ่ม** — branch `fix/backlog4-y7-y11` (PR #57) ตรงกับ origin ·
typecheck 0 · lint 0 error · เทส 500 ผ่าน · `next build` ✅ · ทดลอง merge กับ #54 แล้ว (เทส 516 ✅ · แก้ conflict ตาม R1)
· ทดสอบส่ง LINE เจ้าของร้านจริง 7 หมวดสำเร็จ (ข้อความขึ้นต้น "🧪 ทดสอบ" ส่งตรง ไม่เขียน DB)

### 8.1 merge PR (ลำดับ — รายละเอียด [`DEPLOY.md`](DEPLOY.md) §③ / R1)

| ลำดับ | PR | base | หมายเหตุ |
|---|---|---|---|
| 1 | #56 postcss override | `main` | ไม่ชนกับใคร |
| 2 | #52 `is_preorder` + เลขออเดอร์ | `main` | ติ๊ก Delete branch |
| 3 | #53 แจ้งเตือน LINE | #52 → `main` | |
| 4 | #55 flow รอบพรีออเดอร์ | #53 → `main` | |
| 5 | #57 Y7–Y11 + เงินเป็นบาท | #55 → `main` | ต้อง deploy พร้อม `migrate:money-to-baht` (§8.2) |
| อิสระ | #54 สลิป/ไฟล์ | `main` | conflict `package.json` + `.env.example` — **ห้ามเก็บ `migrate:money-to-satang`** |

ปิดแล้ว (2026-10-01 ไม่ merge): #35 (docs BACKLOG.md) · #2 "generate DOC" — branch `develop` **เก็บไว้เฉย ๆ ไม่ merge** (แผน rebuild เป็นเว็บ
Next 16 + antd + i18n ที่ทำถึง D0.5 · ตามหลัง main 175 commit · ดึงเฉพาะไฟล์ได้ด้วย `git checkout origin/develop -- <path>`)

### 8.2 deploy (ผู้ใช้รันเอง — auto mode ของ Claude Code ไม่เขียน DB จริง)

| ขั้น | คำสั่ง / งาน | อ้างอิง |
|---|---|---|
| 1 | หยุด backend + FrontOffice | [`money-units.md`](money-units.md) §4 |
| 2 | `npm run migrate:money-to-baht` (ดูแผน: ÷100 347 · ไม่แตะ 75 · ต้องดูเอง 1) → `-- --apply` | R7 |
| 3 | build + start โค้ดใหม่ (pm2 instance เดียว) แล้วเปิด FrontOffice | DEPLOY §⑤ · Y8 |
| 4 | `npm run cleanup:legacy-product-fields -- --apply` (ลบ `delete_at: null` 4 ตัว) | §7.15 |
| 5 | PATCH `is_preorder: true` สินค้า 2 ตัวที่รหัสยังเป็น `pos-` | DEPLOY §⑦ ข้อ 3 |
| 6 | `npm run check:data-integrity -- --no-notify` → ไม่พบข้อมูลผิดปกติ | Y11 |
| 7 | ตั้ง cron 3 ตัว (รอบพรีออเดอร์ 15 นาที · เตือนวันรับ 18:00 · ตรวจข้อมูล 07:30) | DEPLOY §⑧ |
| 8 | Atlas: แยก DB user (`meowmee-app` / `meowmee-frontoffice` / `meowmee-readonly`) + เปลี่ยนรหัสผ่าน user เดิม | DEPLOY §สำรองข้อมูล |
| 9 | ตรวจรับตาม checklist (รวมตรวจหน่วยเงินหลังย้าย) | DEPLOY §⑨ |
| — | หมุน `LINE_LOGIN_CHANNEL_SECRET` (เคยวางในแชต) · nginx `/uploads/` (R6) · env/โดเมนจริง (`ALLOWED_ORIGINS`, `COOKIE_DOMAIN`, LINE callback/return URL, `ADMIN_APP_URL` สำหรับลิงก์ 🔗 ใน LINE — LINE.md §9.12) | R4 · R6 · LINE.md §8.3 |

### 8.3 รอผู้ใช้/ทีมตัดสินใจ

| เรื่อง | ผลกระทบ | ทางเลือก |
|---|---|---|
| FrontOffice เขียน MongoDB ตรง (R7) | ไม่มี userlog · ไม่ตัดสต็อกผ่าน backend (สต็อก variant Y9 เพี้ยนได้ — Y11 จับ `variant_stock_sum`) · ไม่ผ่าน validation · เลขออเดอร์ `ORD-<timestamp>` ถูกนับช่องทาง "อื่น ๆ" ใน dashboard | ให้ FrontOffice เรียก API ของ backend (ยั่งยืนสุด) · หรืออย่างน้อยใช้เลขออเดอร์รูปแบบ `ORD-YYYYMMDD-xxxxxx` + DB user แยก |
| ออเดอร์ `ORD-1790786142302-M2PY` (pending ยังไม่จ่าย · 55 บาท) | ค้างในระบบ | เจ้าของร้านยกเลิกผ่านหลังบ้าน (ระบบจะแจ้งลูกค้าทาง LINE) หรือติดต่อลูกค้า |
| `WEB-1790317257577` (ยกเลิกแล้ว · หน่วยปนในใบเดียว) | ยอดรวมไม่ลงตัวหลังย้ายหน่วย | ปล่อยไว้ได้ (ยกเลิกแล้ว) หรือแก้มือ |

### 8.4 frontend (repo แยก)

- [ ] หน้าแจ้งเตือน: แสดง `module_label` · เอาตัวกรอง `employee` ออก · ปรับจุดที่เทียบข้อความหัวข้อตามถ้อยคำใหม่ — [`LINE.md`](LINE.md) §8.2 ค., §9.10–9.11
- [ ] สินค้าที่มีตัวเลือก (Y9): บังคับเลือกตัวเลือกก่อนใส่ตะกร้า/สั่ง (ไม่เลือก = 400) · แสดงสต็อกต่อตัวเลือก · ปรับสต็อกที่ตัวเลือก (ที่ตัวสินค้า = 409)
- [ ] ลิงก์จาก LINE: `/owner/orders/manageOrders?id=<orderId>` ต้องเปิดออเดอร์นั้นได้ตรง ๆ · บอก path หน้าจัดการพรีออเดอร์ เพื่อให้แจ้งเตือนพรีออเดอร์มีลิงก์ด้วย — [`LINE.md`](LINE.md) §9.12
- [ ] สลิป: เปิดผ่าน `/api/files/slips/…` แบบส่ง cookie แล้วทำ blob URL (PR #54 — `uploads.md` §6)
- [ ] เชื่อม LINE ลูกค้า + เกณฑ์สินค้าใกล้หมดรายสินค้า + คำถามที่ต้องตอบ backend — [`LINE.md`](LINE.md) §8.2 ก., ข., ง.

### 8.5 ต่อยอด (ไม่เร่ง)

- G1–G15 (§3) · คอมเมนต์ใน service ที่ยังเล่าประวัติ "สตางค์" ~78 จุด (หน่วยจริงดู `src/lib/money.ts` / `money-units.md`)
- ทดสอบแจ้งเตือนฝั่งลูกค้าทาง LINE (ต้องมีบัญชีลูกค้าที่ผูก LINE แล้ว)
