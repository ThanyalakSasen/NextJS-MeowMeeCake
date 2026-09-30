# MeowMeeCake Backend — BACKLOG 4: ตรวจทั้งระบบรอบใหม่ (2026-10-01)

> ตรวจ: 2026-10-01 · ฐานโค้ดที่ตรวจ: `feat/preorder-round-flow` (รวม PR #52 → #53 → #55) + diff ของ PR #54 (`fix/uploads-slips-receipts`)
> วิธีตรวจ: อ่านโค้ด + รันเทสทั้งหมด (unit 215 · integration 252 ผ่าน) + `npm audit` + CI ทุก PR + query DB จริงแบบอ่านอย่างเดียว
> backlog ก่อนหน้า: [`BACKLOG.md`](BACKLOG.md) · [`BACKLOG2.md`](BACKLOG2.md) · [`BACKLOG3.md`](BACKLOG3.md) (ปิดเกือบครบ — ที่ยังค้างยกมาไว้ที่นี่)

---

## สถานะโดยรวม

| ระดับ | จำนวน | สรุป |
|---|---|---|
| 🔴 ต้องทำก่อนใช้งานจริง | 5 (โค้ด R5 ✅ แก้แล้ว · เหลืองาน deploy R1–R4) | ส่วนใหญ่เป็น **งานตอน deploy** (migration, cron, env, ลำดับ merge) + รายงานแดชบอร์ดไม่นับรายได้พรีออเดอร์ |
| 🟡 ควรแก้ | 11 (✅ Y1 Y4 Y6 แก้แล้ว · เหลือ 8) | ใบผลิตไม่ลดเมื่อยกเลิกพรีออเดอร์ · ผลิตแล้วไม่เพิ่มสต็อกสินค้า · สลิปเปิดสาธารณะ · deprecation · dependency |
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
| อิสระ | #54 สลิป/ใบเสร็จ/แบนเนอร์เป็นไฟล์ | base `main` · **ชนกับ #55 ที่ `package.json` (scripts)** — แก้ตอน merge: เก็บ script ของทั้งสองฝั่ง |

### R2. migration กับ DB จริง (ยังไม่ได้รัน `--apply` เลย — ทดสอบแค่ dry-run)

| ลำดับ | คำสั่ง | ผล dry-run (2026-09-30) | จังหวะ |
|---|---|---|---|
| 1 | `npm run migrate:is-preorder -- --apply` | สินค้า 42 (พรีออเดอร์ 10) · ตัดสินไม่ได้ 0 · prefix ผิด 2 | **ก่อน deploy #52 ทันที** (DB ยังเป็น `product_types` ซึ่ง `main` ไม่รู้จัก — ตอนนี้โค้ด `main` ที่รันกับ DB นี้ทำงานผิดอยู่แล้ว BACKLOG2 §14.1) |
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

---

## 2. 🟡 ควรแก้

| # | เรื่อง | พบ | ผลกระทบ | วิธีแก้ที่เสนอ |
|---|---|---|---|---|
| Y1 | ✅ **ยกเลิก/คืนเงินพรีออเดอร์หลังสร้างใบผลิตแล้ว ใบผลิตไม่ลด** — แก้แล้ว (§7.2) | `cancelPreorder` / `refundPayment` ไม่แตะ `productionitems` (ต่างจากจ่ายช้าที่บวกเข้าให้ — #55 §6.4) | ผลิตเกินจำนวนที่ต้องส่งจริง | ตอนพรีออเดอร์ `paid` ในรอบ `closed` ถูกยกเลิก: ใบผลิตยัง `planned` → ลด `planned_qty` ของรายการ (ไม่ต่ำกว่า 0) · เริ่มผลิตแล้ว → แจ้งร้าน (กลับด้านของ `onPreorderPaid`) |
| Y2 | **ผลิตเสร็จแล้วไม่เพิ่มสต็อกสินค้าสำเร็จรูป** | `productionItemService` หักวัตถุดิบ (`consumeStock`) แต่ไม่เคยเพิ่ม `product_stock_quantity` | ใบผลิตแบบ manual ของสินค้าปกติ (ขนมหน้าร้าน) → ต้องไปปรับสต็อกเองทุกครั้ง · ถ้าลืม ขายไม่ได้/สต็อกไม่ตรง | **ต้องตัดสินใจ:** เมื่อรายการผลิต `done` + สินค้าปกติ → `increaseStock(actual_qty ?? planned_qty × yield)` (พรีออเดอร์ไม่มีสต็อก — ข้าม) |
| Y3 | **สลิปโอนเงินเปิดสาธารณะ** | `public/uploads/slips/` เสิร์ฟ static ใครก็ได้ถ้ารู้ URL (#54) | ข้อมูลส่วนตัว (ชื่อ/เลขบัญชี) · ชื่อไฟล์สุ่มเดายาก แต่ไม่ใช่การกันสิทธิ์จริง | ย้ายสลิปออกนอก `public/` + route อ่านไฟล์ที่ตรวจสิทธิ์ (เจ้าของรายการ / staff `payments.view`) หรือ S3 private + signed URL |
| Y4 | ✅ **mongoose: option `new: true` เลิกใช้แล้ว** — แก้แล้ว (§7.4) | 25 จุดใน `src/` · เทสขึ้น warning ทุกรอบ | mongoose รุ่นถัดไปอาจเลิกรองรับ | เปลี่ยนเป็น `returnDocument: "after"` ทีเดียวทั้งไฟล์ (พฤติกรรมเท่าเดิม) |
| Y5 | **dependency มีช่องโหว่ (high)** | `npm audit`: `postcss ≤ 8.5.22` ผ่าน `next` (XSS ใน stringify + อ่านไฟล์ .map ผ่าน sourceMappingURL) | backend นี้เป็น API ล้วน ไม่ประมวลผล CSS จาก user → ความเสี่ยงจริงต่ำ (build-time) | `npm audit fix --force` = อัป Next 16 (breaking) · หรือ `overrides.postcss` ≥ เวอร์ชันที่แก้แล้ว + รันเทส/บิลด์ |
| Y6 | ✅ **staff ทุกคนลบแจ้งเตือนของร้านได้** — แก้แล้ว (§7.3) | `DELETE /api/admin/notifications/[id]` เช็คแค่ล็อกอิน (`requireAuth`) | แจ้งเตือนสำคัญ (สต็อก, โควตา LINE, ปิดรอบ) หายโดยเจ้าของไม่เห็น | จำกัด DELETE เฉพาะ owner (หรือ permission ใหม่) · PATCH อ่านแล้วให้ทุกคนได้เหมือนเดิม |
| Y7 | **พรีออเดอร์ข้อมูลเก่าไม่มีกำหนดชำระ** | พรีออเดอร์ก่อน #55 มี `payment_due_at: null` | ไม่ถูกยกเลิกตามกำหนด (ถูกยกเลิกตอนปิดรอบแทน) | ถ้าต้องการ: สคริปต์ backfill `payment_due_at` = min(created + N ชม., close) สำหรับรอบที่ยังเปิด |
| Y8 | **state ในหน่วยความจำ ไม่แชร์ข้าม instance** | `rateLimit` · permission cache · delivery-zone cache · cache โควตา LINE | หลาย instance / serverless: rate limit หลวม · โควตา LINE ตัดสินจากค่า cache ต่าง instance | ตั้ง instance เดียว หรือย้ายไป Redis (แก้เฉพาะไฟล์ lib ละตัว — ออกแบบไว้แล้ว) |
| Y9 | `variant_stock` ไม่เคยถูกเช็ค/ตัด (ยกมาจาก BACKLOG2 §9) | DB มี variant 0 ตัว (ตอนนั้น) | ถ้าเริ่มใช้ variant แบบจำกัดจำนวน จะขายเกิน | ตัด/คืน `variant_stock` คู่กับ `product_stock_quantity` ใน `deductStockForOrder`/`restockForOrder` |
| Y10 | `audit-money-units` ให้ false positive หลัง fix (ยกมาจาก BACKLOG2 §16.1) | ใช้ `updated_at` ตัดสิน | ถ้าทำตามรายงาน เงินจะ ×100 ซ้ำ | ให้ audit เทียบกับ `scripts/backups/money-fix-*.json` หรือเตือนเมื่อพบ marker |
| Y11 | ต้นทางที่เขียน DB ตรงนอกแอป (BACKLOG2 §16 + `product_type: "ready"` ที่เจอ 2026-09-30) | ยังมีการเขียน DB ตรง ๆ (ชิโอะปังนูเทลล่า แก้ล่าสุด 2026-09-30) | ราคา/ประเภทเพี้ยนซ้ำได้ | หาคน/เครื่องมือที่ต่อ DB ตรง (Compass/สคริปต์เก่า/แอปรุ่นเก่า) · แยก DB user อ่านอย่างเดียวสำหรับเครื่องมือ |

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
4. **ต้องตัดสินใจก่อน:** **Y2** (ผลิตเสร็จเพิ่มสต็อกอัตโนมัติไหม) · **Y3** (ย้ายสลิปเป็น private) · **Y5** (อัป Next 16 หรือ override postcss)
5. ที่เหลือ (Y7–Y11, G*) ตามความจำเป็น

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

**เหลือ (ต้องตัดสินใจ):** Y2 ผลิตเสร็จเพิ่มสต็อกอัตโนมัติไหม · Y3 ย้ายสลิปเป็น private · Y5 อัป Next 16 หรือ override postcss
