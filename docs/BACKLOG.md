# MeowMeeCake Backend — สิ่งที่ต้องแก้ไข / ปรับ / บั๊ก

> อัปเดตล่าสุด: 2026-09-12
> ขอบเขต: ฝั่ง Backend (`src/**`, `scripts/**`) — ยังไม่รวม frontend
> สรุปงานที่ทำแล้ว §2 + §3 (พร้อม PR + ดัชนีเอกสาร) → [`hardening-summary.md`](hardening-summary.md)

## สถานะโดยรวม

| ชั้น | สถานะ |
|---|---|
| Model (`src/models/**`, 37 ไฟล์) | ✅ ใช้อยู่ (มีจุดต้องเพิ่ม index — ดู §6 Migration) |
| Service layer (`src/services/**`) | ✅ 4 โดเมนหลัก + Promotion / Review / Sentiment / Address / Expense / Dashboard + Auth |
| API routes | ✅ `/api/auth` · `/api/catalog` (สาธารณะ อ่านอย่างเดียว) · `/api/shop` (ลูกค้า) · `/api/admin` (พนักงาน + permission) |
| Auth layer (JWT + middleware + RBAC 3 ชั้น) | ✅ ใช้อยู่ |
| `product_type` = `inStore` / `online` / `preorder` | ✅ รองรับทั้งระบบ |
| **§2 บั๊ก / ความถูกต้องข้อมูล (2.1–2.11)** | ✅ **ปิดครบทั้ง 11 ข้อ** — PR [#3](https://github.com/ThanyalakSasen/NextJS-MeowMeeCake/pull/3) **merged** เข้า `addModels` (merge commit `055d71b`) · issue [#4](https://github.com/ThanyalakSasen/NextJS-MeowMeeCake/issues/4) closed — เหลือแค่ขั้น deploy: `npm run sync-indexes` + ลบข้อมูลซ้ำกับ DB จริง (ดู §6) · สรุปรวม → [`data-integrity-fixes.md`](data-integrity-fixes.md) |
| **§2b บั๊ก preorder payment/cancellation (2026-09-12)** | ✅ **แก้ครบ 4/4 + merge เข้า `addModels` แล้ว** (PR [#19](https://github.com/ThanyalakSasen/NextJS-MeowMeeCake/pull/19)) — พบจาก code review เต็ม `src/services/`, มีข้อ 1 ที่เคยเป็นช่องโหว่ความปลอดภัย (จ่ายเงินแทนคนอื่นได้) |
| **§2c บั๊กความทนทาน/correctness เล็กอื่น ๆ (ใหม่ 2026-09-12)** | ✅ **แก้ 2/4 + merge เข้า `addModels` แล้ว** (PR [#22](https://github.com/ThanyalakSasen/NextJS-MeowMeeCake/pull/22) — clearCart error handling, voidTransaction floor guard) · เหลือ 2 ข้อเป็น known-risk/tradeoff ที่ตั้งใจไว้แล้ว ไม่ใช่บั๊กที่ต้องรีบแก้ (ดู 2c.3/2c.4) |
| ระบบสแกนบาร์โค้ด POS | 🟡 core เสร็จ — เหลือ label sheet + รัน backfill กับ DB จริง (ดู §7) |
| อัปโหลดรูปสินค้า | ✅ `POST /api/admin/products/images` (auth + ตรวจ 3 ชั้น) — บันทึกลงดิสก์ (self-host เท่านั้น, ดู §3.13) |
| Preorder (เฟส 5) | 🟡 service + API เสร็จ (ดู §8 · [preorder.md](preorder.md)) — เหลือผูก payment/production/promotion |
| §3 คุณภาพ / hardening | 🟡 ✅ D1/D2/D3 + audit log (PR #5–#12) · ✅ รอบ 4a: CI + lint gate + zod crud-factory/shop routes (PR #13–#17) · ✅ **รอบ 4b เสร็จสมบูรณ์ทั้ง 3 ข้อ** (zod tail ครบ `/admin/orders`+`/admin/attendances`+`/admin/permissions`+`/admin/preorder-rounds*`+`/admin/users`, รื้อ `pick()` 8/8 ไฟล์, `no-explicit-any` error บน `src/lib` ทั้งหมด — lint warning 13→5) · 🟡 รอบ 4c เริ่มแล้ว: ✅ 3.8 · ~~3.12~~ (ล้าสมัย ไม่ต้องทำ) · เหลือ 3.16/3.4 · 4d (3.13–3.15) · 3.11 |
| Notification | ✅ ทำแล้ว (2026-09-12) — `notificationService.ts` + LINE push (`src/lib/line.ts`) + `/api/admin/notifications` · ผูกเข้า order ใหม่/สลิปรอตรวจ/สต็อกใกล้หมด (เดิมตัดออกไว้ก่อน ดู §3.12 ประวัติ) |

**คำสั่งตรวจสอบ:** `npm run typecheck` · `typecheck:test` · `npm run lint` · `npm test` (unit) · `npm run test:integration` · `npm run build` — ปัจจุบันผ่านทั้งหมด

---

## ✅ เสร็จแล้ว (ตั้งแต่รอบรีวิวโค้ด)

| เรื่อง | สรุป |
|---|---|
| **รหัสสินค้า `product_id` + สแกน POS (core)** | ฟิลด์ `productModel.product_id` (`pos-DDYYzzz` / `pre-DDYYzzz`, unique sparse) + `src/lib/productCode.ts` + auto-gen พร้อม retry ใน `createProduct` + `productService.getProductByCode()` / `resolveScan()` + `GET /api/admin/pos/scan` + `scripts/backfill-product-codes.ts` |
| **`product_type` 3 ค่า** | เดิม `"ready"` → เปลี่ยนชื่อเป็น `"inStore"` + เพิ่ม `"online"` · `inStore`/`online` = มีสต็อก (เหมือนกัน), `preorder` = ไม่มีสต็อก · ไล่แก้ทุกที่ (validation, stock functions, dashboard, backfill) → `STOCKABLE_MATCH = { product_type: { $ne: "preorder" } }` |
| **ย้ายอัปโหลดไฟล์ไป admin** | `POST /api/catalog/products` (อัปโหลดแบบไม่ล็อกอิน) → ลบทิ้ง · สร้าง `POST /api/admin/products/images` + `withPermission("products","update")` + `src/lib/upload.ts` (เช็คขนาด ≤5MB / นามสกุล / magic bytes ; JPEG·PNG·WEBP·AVIF) → บันทึก `public/uploads/products/` serve ที่ `/uploads/products/...` · `catalog/products` เหลือ GET · `/public/uploads/` เข้า .gitignore |

---

## 1. 🔴 Blockers — ต้องทำก่อนขึ้น production

| # | เรื่อง | ที่ไฟล์ | รายละเอียด / วิธีแก้ |
|---|---|---|---|
| 1.1 | ~~`JWT_SECRET` เป็น placeholder~~ | `.env.local` | ✅ แก้แล้ว (2026-09-02) — สุ่มค่าใหม่ 48 bytes (base64url) ให้ `JWT_SECRET`, `SESSION_SECRET`, `NEXTAUTH_SECRET` · ยืนยัน `next dev` boot ผ่าน / health 200 / auth 401 · **หมายเหตุ:** ก่อนขึ้น production จริงต้องสุ่มใหม่อีกครั้ง (ค่าปัจจุบันผ่านสายตา assistant แล้ว) และตั้งผ่าน env ของ host ไม่ใช่ commit |
| 1.2 | ยังไม่ได้ seed | — | `npm run seed` (สร้าง role owner/staff/customer, units, หมวดหมู่, owner user) — ถ้าไม่รัน `register`/`login` throw ทันที |
| 1.3 | index เก่าของ `permissions` ค้างใน DB | MongoDB | partial unique index ใหม่ `{role_id, menu_key} where deleted_at:null` จะสร้างไม่ได้ถ้ามี `role_id_1_menu_key_1` / `user_id_1_menu_key_1` เก่า → **`npm run sync-indexes`** จัดการให้ (drop เก่า + สร้างใหม่) |

---

## 2. ✅ บั๊ก / ความถูกต้องข้อมูล — ปิดครบ 11/11 (2.1–2.11)

> ทั้งหมดแก้ในโค้ดแล้ว · typecheck + build ผ่าน · สรุปรวม 2.8–2.11 → [`data-integrity-fixes.md`](data-integrity-fixes.md)
> tracking: PR [#3](https://github.com/ThanyalakSasen/NextJS-MeowMeeCake/pull/3) **merged** (2026-09-07, merge commit `055d71b` เข้า `addModels`) · issue [#4](https://github.com/ThanyalakSasen/NextJS-MeowMeeCake/issues/4) **closed** · branch `Debug-Validate-data` ยังไม่ลบ
> **ค้างเป็นขั้น deploy เท่านั้น:** `npm run sync-indexes` กับ DB จริง (2.3 / 2.4 / 2.10) + ลบ payment `pending` ซ้ำก่อน (2.10) — ดู §6

| # | เรื่อง | ที่ไฟล์ | รายละเอียด / วิธีแก้ |
|---|---|---|---|
| 2.1 | ~~ค่าส่ง (`delivery_fee`) เชื่อ client~~ | — | ✅ แก้แล้ว — `src/services/deliveryService.ts` คิดฝั่ง server จาก **โซนตามจังหวัด** (กทม.+ปริมณฑล = 40 / ต่างจังหวัด = 80 / ยอด ≥ 1500 ส่งฟรี — ปรับผ่าน env `DELIVERY_FEE_*` / `DELIVERY_FREE_MIN`) · `persistOrder` คิดเองเสมอ · `/api/shop/orders` ไม่รับ `delivery_fee` จากลูกค้าแล้ว · แอดมิน override ได้ (`/api/admin/orders` ส่ง `delivery_fee` มา = override) · พรีวิว: `POST /api/shop/orders/delivery-quote` · ดูโครง: `GET /api/admin/delivery-fee` · **ยังไม่มี**: ตารางโซนแบบ DB ที่แอดมินแก้เองได้ (ตอนนี้เป็น config + env) |
| 2.2 | ~~`cost_per_unit` ไม่ถูก snapshot ลง `orderItem`~~ | — | ✅ แก้แล้ว — `recipeService.getUnitCostByProduct()` = `estimated_cost_per_batch / yield_qty` ของ **สูตรล่าสุด** ของสินค้า · `orderService.persistOrder` batch lookup แล้ว snapshot ลง `orderItem.cost_per_unit` ตอนสร้างออเดอร์ · `dashboardService` COGS/กำไรใช้ได้แล้ว · **ข้อจำกัด:** ต้นทุนเป็นระดับ *สินค้า* (ไม่แยกตาม variant) · สินค้าที่ไม่มีสูตร → `null` (dashboard นับเป็น 0) · ไม่มี field "ต้นทุนซื้อมา" สำหรับสินค้าที่ซื้อมาขายต่อ |
| 2.3 | ~~`attendanceModel` index `{user_id, work_date}` ไม่ `unique`~~ | `src/models/attendanceModel.ts` | ✅ แก้แล้ว — เป็น **partial unique** `{ unique: true, partialFilterExpression: { deleted_at: null } }` (soft-deleted ไม่บล็อกการสร้างใหม่) · **ต้องรัน `npm run sync-indexes` กับ DB จริง** |
| 2.4 | ~~`reviewModel.order_item_id` ไม่ `unique`~~ | `src/models/reviewModel.ts` | ✅ แก้แล้ว — partial unique `{ unique: true, partialFilterExpression: { deleted_at: null } }` · **ต้องรัน `npm run sync-indexes`** |
| 2.5 | ~~ตะกร้าไม่ re-price ตอน checkout~~ | — | ✅ แก้แล้ว (2026-09-07) — `createOrderFromCart` เลิกใช้ `price_snapshot` ที่แช่ไว้ · วนแต่ละ cart item → `resolveLine()` (ตัวเดียวกับ path สั่งเอง/POS) → คิด `unit_price` สดจาก `product.sale_price ?? product.product_price` + `variant_price` + Σ `extra_price` ปัจจุบัน + re-validate ว่าสินค้า/variant/option ยังมีอยู่ (สินค้าถูกลบ / เป็น preorder / variant-option หาย → throw ตอน checkout) · รายละเอียด → [`reprice.md`](reprice.md) · **ข้อจำกัด:** ยังเป็น re-price แบบ *เงียบ* (ลูกค้าไม่เห็นว่าราคาเปลี่ยน — ต้องทำที่ `getCartDetail` เพิ่มถ้าจะโชว์) · ยังไม่เช็ค `is_visible === false` · ยิง DB ~1 query/บรรทัด (loop `await`) |
| 2.6 | ~~โปรโมชัน FreeShipping กับออเดอร์ takeaway~~ | — | ✅ แก้แล้ว (2026-09-07) — `computeDiscount` สาขา `FreeShipping`: ถ้า `ctx.delivery_fee <= 0` (ออเดอร์รับเอง หรือได้ส่งฟรีอยู่แล้ว) → `throw unprocessable(...)` แทนที่จะคืน `discount = 0` · ครอบทั้ง path สร้างออเดอร์ (`orderService.persistOrder` → `validateForOrder`) และพรีวิว (`/api/shop/promotions/validate` → `previewForCart`) · รายละเอียด → [`promo-freeshipping.md`](promo-freeshipping.md) · **หมายเหตุ:** ยังมีเคสทั่วไปที่ `discount_amount = 0` จากโปรชนิดอื่น (เช่น Amount/Percentage ที่คิดออกมาเป็น 0) แล้ว order ยังผูก `promotion_id` โดยไม่บันทึก usage — ยังไม่แก้ (นอกสโคป 2.6) |
| 2.7 | ~~ขอบเขตการยกเลิกของลูกค้ากว้างไป~~ | — | ✅ แก้แล้ว (2026-09-07) — เพิ่ม `orderService.CUSTOMER_CANCELABLE_STATUSES = ["pending","confirmed"]` + option `allowedFrom` ใน `cancelOrder()` (เช็คสถานะปัจจุบันก่อน ไม่อยู่ในลิสต์ → `conflict` 409 "ติดต่อร้าน") · route ลูกค้า `/api/shop/orders/[id]/cancel` ส่ง `allowedFrom` เข้าไป · **แอดมิน** (`/api/admin/orders/[id]/status` → `updateOrderStatus` ตรง ๆ) ไม่แตะ — ยังยกเลิกได้จาก `preparing`/`ready` · รายละเอียด → [`order-cancel.md`](order-cancel.md) · เปลี่ยนพฤติกรรมย่อย: ยกเลิกออเดอร์ที่ `cancelled` อยู่แล้วซ้ำ เดิม no-op สำเร็จ → ตอนนี้ 409 |
| 2.8 | ~~ยกเลิกออเดอร์ที่จ่ายเงินแล้ว ไม่ผูกกับการคืนเงิน~~ | — | ✅ แก้แล้ว (2026-09-07) — **ลูกค้า:** `cancelOrder({ allowedFrom })` เช็ค `payment_status === "paid"` → `conflict` 409 "ติดต่อร้านเพื่อขอยกเลิกและคืนเงิน" · **แอดมิน:** `updateOrderStatus` สาขา cancel ถ้า `payment_status === "paid"` → หา payment ที่ `status:"paid"` แล้วเรียก `refundPayment(paymentId, { verified_by: cancelled_by })` (dynamic import เลี่ยง circular) · best-effort (try/catch + log, ไม่ล้มการยกเลิก) · `refundPayment` → `setPaymentStatus(orderId, "refunded")` → `order.payment_status = "refunded"` · เช็ค `=== "paid"` เท่านั้น = ยกเลิกซ้ำไม่คืนเงินซ้ำ · รายละเอียด → [`order-cancel.md`](order-cancel.md) §3 · **หมายเหตุ:** ยังไม่มี audit log แยกสำหรับ auto-refund · ยกเลิกแบบ "ยึดเงิน" (ไม่คืน) ยังไม่รองรับ |
| 2.9 | ~~โปรโมชัน `usage_limit` / `max_user_per_user` ไม่ atomic~~ | — | ✅ แก้แล้ว (2026-09-07) — `promotionUsageService.recordUsage` จองสิทธิ์แบบ atomic: `findOneAndUpdate({ _id, $or:[{usage_limit:null},{ $expr:{ $lt:[{$ifNull:["$used_count",0]},"$usage_limit"] }}] }, { $inc:{ used_count:1 }})` (แนวเดียวกับ preorder quota §8) → จองไม่ได้ = `unprocessable` "ใช้ครบจำนวนแล้ว" · `max_user_per_user`: สร้าง row แล้ว count ใหม่ ถ้าเกิน → ลบ row + rollback `used_count` (optimistic — คนยิงพร้อมกันคนหลังแพ้) · `persistOrder` เรียก `recordUsage` ใน try block ตอนสร้างออเดอร์ — 422 = ล้มออเดอร์ (คืนสต็อก+ลบ), error อื่น = best-effort เดิม · `validateForOrder` ยังมี read-check ไว้ fast-fail + ใช้กับพรีวิว · รายละเอียด → [`concurrency-guards.md`](concurrency-guards.md) · **หมายเหตุ:** per-user ยังเป็น optimistic ไม่ atomic 100% (ไม่มี transaction ทั้ง codebase) |
| 2.10 | ~~สร้าง payment ซ้ำได้หลายใบต่อ 1 ออเดอร์~~ | — | ✅ แก้แล้ว (2026-09-07) — `createPayment` ก่อนสร้างเช็ค payment ที่ยัง active (`status:"pending", deleted_at:null`) ของ order/preorder เดิม → เจอ = `conflict` "มีรายการชำระเงินที่รอตรวจสอบอยู่แล้ว" (แนบ `payment_id` เดิมใน details) · + partial unique index `paymentModel` `{ order_id } where { order_id:{$type:"objectId"}, status:"pending", deleted_at:null }` และ `{ preorder_id }` แบบเดียวกัน (กัน race ระดับ DB, `create` แปลง 11000 → conflict) · รายละเอียด → [`concurrency-guards.md`](concurrency-guards.md) · **ต้องรัน `npm run sync-indexes` กับ DB จริง** — ถ้ามี pending ซ้ำอยู่ก่อน ต้องลบซ้ำก่อน index ถึงจะสร้างผ่าน |
| 2.11 | ~~`discount_amount = 0` ยังผูก `promotion_id` กับออเดอร์~~ | — | ✅ แก้แล้ว (2026-09-07) — เวอร์ชันทั่วไปของ 2.6 · `computeDiscount` เพิ่มเช็คหลัง `round2(Math.max(0, discount))`: ถ้า `discount <= 0` → `throw unprocessable("โปรโมชันนี้ไม่ให้ส่วนลดกับออเดอร์นี้ (ส่วนลดเป็น 0)")` (ครอบทั้ง path สร้างออเดอร์ + พรีวิว เหมือน 2.6) · `persistOrder` ตัด guard `discount_amount > 0` ที่ `recordUsage` → เหลือ `if (appliedPromotion)` เพราะ discount > 0 เสมอเมื่อมี `appliedPromotion` · รายละเอียด → [`promo-freeshipping.md`](promo-freeshipping.md) §4 |

---

## 2b. ✅ บั๊ก preorder payment/cancellation — ปิดครบ 4/4 (2026-09-12)

> พบจาก code review เต็ม `src/services/` (2026-09-12) — ไล่เทียบ `preorderService.ts`/`paymentService.ts` กับ
> `orderService.ts` ที่ path คู่ขนานผ่านมาแล้วทุกจุด (§2.7/2.8) พบว่า preorder **ไม่เคยได้ fix ตาม** เลย
> ทุกข้อ verify แล้วด้วยการอ่านโค้ดจริง (ไม่ใช่แค่รายงานดิบ) — reachable จริงผ่าน API ที่ใช้งานอยู่
> (`/api/shop/payments`, `/api/shop/preorders/[id]/cancel`, `/api/admin/preorders/[id]/status`)
> **แก้ครบทั้ง 4 ข้อแล้ว** บน branch `fix-preorder-payment-ownership` (commit `51f4a75`, `4bc09b1`) —
> ยังไม่ merge เข้า `addModels` · เทสใหม่ `tests/integration/{createPaymentPreorder,cancelPreorder}.test.ts`
> (9 เคส) · `typecheck`/`lint`/`test`/`test:integration`/`build` ผ่านหมดหลังแก้
> **รายละเอียดปัญหา/วิธีแก้/เหตุผลที่แก้แบบนี้ (ทีละข้อ) → [`preorder-payment-hardening.md`](preorder-payment-hardening.md)**

| # | เรื่อง | ที่ไฟล์ | รายละเอียด / วิธีแก้ |
|---|---|---|---|
| 2b.1 | ~~**สร้าง payment ผูกกับพรีออเดอร์คนอื่นได้ (IDOR)**~~ | `src/services/paymentService.ts:94-101` (เทียบ order branch `:86-93`) | ✅ แก้แล้ว (2026-09-12, commit `51f4a75`) — เพิ่ม 3 เช็คให้ branch `preorder` ตรงกับ branch `order` ทุกจุด: ownership (`preorder.user_id === input.user_id` — `input.user_id` มาจาก session เสมอ ไม่ใช่ client-controlled), cancelled-status (`order_status !== "cancelled"`), amount-tolerance (`Math.abs(amount - preorder.total_amount) > AMOUNT_TOLERANCE`) · เทส: `createPaymentPreorder.test.ts` (4 เคส) |
| 2b.2 | ~~ยังไม่ได้เรียก `preorderService.setPaymentStatus()`~~ (เคยบันทึกไว้ที่ §8) | `src/services/paymentService.ts:54-58` (`propagateStatus`) · `preorderService.ts:385` (`setPaymentStatus`) | ✅ แก้แล้ว (2026-09-12, commit `4bc09b1`) — `propagateStatus` branch `preorder_id` เปลี่ยนจากเขียน `preorderModel.updateOne()` ตรง ๆ มาเรียก `preorderService.setPaymentStatus()` แทน (logic auto-advance `order_status` `pending→confirmed` มีอยู่แล้วในฟังก์ชันนี้ตั้งแต่ต้น แค่ไม่เคยถูกเรียก) · เทส: `cancelPreorder.test.ts` เคส "verify payment → auto-confirm" |
| 2b.3 | ~~ยกเลิกพรีออเดอร์ที่จ่ายเงินแล้ว ไม่คืนเงิน ไม่ log~~ (คู่ขนาน §2.8) | `src/services/preorderService.ts` (`updatePreorderStatus` branch cancel) เทียบ `orderService.ts:562-580` | ✅ แก้แล้ว (2026-09-12, commit `4bc09b1`) — เปลี่ยนมาใช้ `Saga` (เหมือน orderService) + เพิ่ม auto-refund เมื่อ `payment_status==="paid"` (หา payment ที่ `paid` แล้วเรียก `paymentService.refundPayment` ผ่าน dynamic import กัน circular import) + `log.warn` ถ้าไม่พบ payment/`cancelled_by` แทนที่จะเงียบสนิท · เทส: `cancelPreorder.test.ts` เคส "แอดมินยกเลิก → auto-refund" |
| 2b.4 | ~~ลูกค้ายกเลิกพรีออเดอร์ที่จ่ายเงินแล้วได้เอง ทุกสถานะ~~ (คู่ขนาน §2.7) | `src/services/preorderService.ts` (`cancelPreorder`) เทียบ `orderService.ts:609-630` (`cancelOrder`) | ✅ แก้แล้ว (2026-09-12, commit `4bc09b1`) — เพิ่ม `CUSTOMER_CANCELABLE_STATUSES = ["pending","confirmed"]` + option `allowedFrom` ใน `cancelPreorder()` (เช็คสถานะปัจจุบัน + block เมื่อ `payment_status==="paid"` → `conflict` 409 "ติดต่อร้าน") · route `/api/shop/preorders/[id]/cancel` ส่ง `allowedFrom` เข้าไปแล้ว (เดิมไม่ส่งเลย) · เทส: `cancelPreorder.test.ts` 3 เคส (จ่ายแล้ว/เกิน allowedFrom/ปกติ) |

**ยังไม่ทำ:** push branch + เปิด PR เข้า `addModels`

---

## 2c. 🟡 บั๊กความทนทาน / correctness เล็กอื่น ๆ (code review 2026-09-12)

> เจอพร้อมกับ §2b รอบเดียวกัน — verify ด้วยการอ่านโค้ดจริงทุกข้อแล้ว ไม่ใช่รายงานดิบจาก agent
> **2c.1–2c.2 แก้แล้ว** บน branch `fix-robustness-2c` — รายละเอียดปัญหา/วิธีแก้/เหตุผล →
> [`order-cart-inventory-robustness.md`](order-cart-inventory-robustness.md) · เทสใหม่
> `tests/integration/{createOrderFromCart,voidTransaction}.test.ts` (5 เคส) ·
> `typecheck`/`lint`/`test`/`test:integration`/`build` ผ่านหมด

| # | เรื่อง | ที่ไฟล์ | รายละเอียด / วิธีแก้ |
|---|---|---|---|
| 2c.1 | ~~`createOrderFromCart` — `clearCart()` ไม่มี try/catch หลังออเดอร์ commit ไปแล้ว~~ | `src/services/orderService.ts:440` | ✅ แก้แล้ว (2026-09-12) — ห่อ `cartService.clearCart(userId)` ด้วย `.catch(err => log.error("order.clear_cart_failed", {...}))` แบบเดียวกับจุดอื่นในไฟล์ (`notificationService.notify(...).catch(...)`) — order ที่ commit สำเร็จแล้วจะไม่ throw ตามถ้า clearCart พัง |
| 2c.2 | ~~`voidTransaction` ย้อนรายการ `receive` ไม่มี floor guard (ค่าติดลบได้)~~ | `src/services/ingredientTransactionService.ts` เทียบ `createTransaction` | ✅ แก้แล้ว (2026-09-12) — เพิ่ม `filter.current_stock = { $gte: -inc }` เมื่อ `inc < 0` (ทิศทางย้อน `receive` เท่านั้น — ย้อน `use` คืนสต็อกไม่มีทางติดลบ ไม่ต้องกัน) ผ่าน `updateOne` atomic เดียวกับ `createTransaction` · ไม่พบ = `throw conflict(...)` แนะนำให้ทำ `adjust` แทน (เลือก throw ไม่ clamp เงียบ ๆ — ดูเหตุผลเต็มในเอกสาร) |
| 2c.3 | ℹ️ `voidTransaction` ไม่มี back-reference กลับไปที่ production item — เสี่ยง double-credit | `src/services/ingredientTransactionService.ts:201` (`ingredientTransactionModel` ไม่มี field `production_item_id`) เทียบ `productionItemService.ts:211,226,263` (`consumeStock`/`reverseStock` เรียก `createTransaction` แต่ไม่ผูก back-ref) | `voidTransaction` เป็น endpoint กลาง (`DELETE /api/admin/ingredient-transactions/[id]`) ใช้ย้อนได้ทุกรายการรวมถึงที่เกิดจาก production (`consumeStock`/`reverseStock`) — เพราะ model ไม่มี field เชื่อมกลับ ถ้าแอดมิน void รายการที่มาจาก production แล้วภายหลัง production นั้นถูกยกเลิกผ่าน `reverseStock` จริง จะสร้างรายการ `"receive"` คืนสต็อกซ้ำอีกรอบ (สต็อกถูกเครดิตสองครั้ง) · **สถานะ:** เป็นความเสี่ยงเชิงสถาปัตยกรรม ยังไม่ได้ตามรอย exploit จริง — ต้องดูเพิ่มว่ามี flow ที่ทำทั้งสองอย่างได้จริงในหน้าแอดมินไหมก่อนตัดสินใจว่าต้องรีบแก้แค่ไหน · **แนวทาง:** เพิ่ม `production_item_id` (nullable) ใน `ingredientTransactionModel` + กัน `voidTransaction` void รายการที่มี back-ref นี้ (ให้ยกเลิกผ่าน production flow แทน) |
| 2c.4 | ℹ️ (ทราบอยู่แล้ว — ไม่ใช่บั๊กที่พลาด) `recordUsage` error ที่ไม่ใช่ 422 ถูก swallow เงียบ | `src/services/orderService.ts:360-371` | โค้ดมีคอมเมนต์ระบุไว้ตรง ๆ ว่าเป็น **การตัดสินใจตั้งใจ** ("error อื่น (transient) = best-effort ไม่ล้มออเดอร์ที่สร้างสำเร็จแล้ว") — ไม่ใช่บั๊กที่หลุดไปโดยไม่รู้ตัวเหมือนข้ออื่น · **ผลข้างเคียงที่ยอมรับไว้แล้ว:** ถ้า `recordUsage` fail แบบ transient (ไม่ใช่ 422 เต็มโควตา) ออเดอร์จะมี `discount_amount`/`promotion_id` ติดอยู่ แต่ไม่มี `PromotionUsages` row / ไม่นับ `used_count` — usage reporting เพี้ยนจากส่วนลดที่ให้จริง (และ `revokeUsage` ตอนยกเลิกจะหาไม่เจอ ไม่มีอะไรให้ revoke) · **แนะนำ (ถ้าจะแก้ต่อ):** เพิ่ม retry สั้น ๆ ก่อน swallow หรือ log แบบ queryable ง่ายกว่านี้ (ตอนนี้ log.error ปกติ) — ไม่ใช่ priority สูง |

---

## 3. 🟡 คุณภาพ / hardening (ชั้น D ในแผน)

> **แผน + effort/ความเสี่ยงต่อข้อ → [`hardening-plan.md`](hardening-plan.md)** · สรุปงานที่ทำ + PR → [`hardening-summary.md`](hardening-summary.md)
>
> **สถานะ (2026-09-11):** ✅ D1 (3.6/3.3/3.4/3.1-infra, PR #5–#6) · ✅ D2 (3.2/3.9/3.10, PR #7) · ✅ D3 (3.3b/3.7 + integration test, PR #8–#11) · ✅ 3.5 (audit log) · ✅ **รอบ 4a** (CI + lint gate + zod crud-factory/shop routes, PR #13–#17)
> ลำดับที่ทำจริง = ตาม [`hardening-plan.md`](hardening-plan.md) §ลำดับ (D3 ย่อยตาม [`hardening-d3-plan.md`](hardening-d3-plan.md) · 4a ตาม [`hardening-4a-plan.md`](hardening-4a-plan.md))

### ลำดับการแก้ที่เหลือ (แนะนำ)

**✅ รอบ 4a — ปิดงาน infra (เสร็จ core, PR #13–#17)** → [`hardening-4a-plan.md`](hardening-4a-plan.md)

1. ✅ **CI pipeline** — `.github/workflows/ci.yml` รัน `typecheck → typecheck:test → lint → test → test:integration → build` ทุก push+PR (PR #13)
2. ✅ **3.6 lint gate** — ลบ `eslint.ignoreDuringBuilds` · `no-explicit-any` `off`→`warn` + `error` บน `src/schemas`+`tests` · เก็บ warning `no-anonymous-default-export` (PR #14)
3. ✅ **3.1 adopt (บางส่วน)** — crud-factory ทั้งหมด (`product-options`/`variants`/`aspects`/`semantic-terms`/`roles`/`components`/`recipes`) + shop `me`/`addresses`/`reviews` + `createInject` inject `created_by` (PR #15–#17)

**รอบ 4b — จบ §3.1 + §3.6** _(แผนละเอียด: [`hardening-4b-plan.md`](hardening-4b-plan.md) — เริ่มแล้ว)_

4. ✅ **`/admin/orders` (POST) + `/admin/attendances` adopt zod** (2026-09-12) — `adminCreateOrderBody` (`.extend()` จาก base ร่วมกับ `createOrderBody`) · `attendance.ts` ใหม่ (`recordAttendanceBody`/`updateAttendanceBody`/`checkInOutBody`) · ยืนยันแล้วไม่มี `PATCH /admin/orders/[id]` จริง (4a-plan เดิมเข้าใจผิด scope) · เทส `tests/lib/schemas.test.ts` + `schemas-admin.test.ts` (+9 → unit 137/17) · lint warning ลดจาก 13 → 12 (`admin/orders/route.ts` เลิกใช้ `any`)
5. ✅ **รื้อ `pick()` / `createFields` / `pickWritable()` ที่ซ้ำ zod — ปิดครบ 8/8** (2026-09-12) — เพิ่ม zod adopt ให้ 5 กลุ่ม route ที่เหลือไปพร้อมกัน (`/admin/orders/[id]/delivery`, `/admin/permissions`, `/admin/preorder-rounds*` + `/admin/preorder-round-items`, `/admin/users`) แล้วถอด `pick()` ตาม: `orderService.updateDelivery`, `permissionService` (create/update), `preorderRoundService` (round + item), `preorderService` (narrow refactor — ไม่ได้รอ adopt เพราะ `pick()` จุดนี้ไม่ใช่ whitelist ที่ทับซ้อนกับ validation ชั้นไหน), `userService` (create/update, ไม่แตะ `updateProfile` ที่ถอดไปแล้วใน B รอบแรก) · **M**
6. ✅ **`no-explicit-any` = `error` บน `src/lib`** (2026-09-12) — แก้ครบ 5 ไฟล์: `refs.ts`(3), `discountEngine.ts`(3), `crudService.ts`(5), `bom.ts`(16, มี interface `IngredientItem`/`ComponentItem` อยู่แล้วแต่ไม่เคยใช้จริง), `crudRoutes.ts`(2 จุด) — **ไม่เหลือ `any` ใน `src/lib/` เลยสักจุด** ไม่ต้องใช้ disable-next-line ที่ไหนเลย · lint warning ลด 13 → 11 (เหลือแต่ใน `src/app/api/**/route.ts`) · (option) `no-floating-promises` ยังไม่ทำ · **S–M**

**รอบ 4c — feature เล็ก + เทสเพิ่ม (หลัง launch ได้)** _(เริ่มแล้ว 2026-09-12)_

7. ✅ **3.8 address_id → checkout** (2026-09-12) — `schemas/order.ts`: เพิ่ม `address_id`/`recipient_name`/`recipient_phone` + `.refine()` บังคับ `oneOf([address_id, delivery_address])` ตอน `order_type==="delivery"` (ทั้ง `createOrderBody`/`adminCreateOrderBody`) · `addressService.resolveDeliverySnapshot(userId, {address_id,recipient_name,recipient_phone,delivery_address})` ใหม่ — สแนปช็อตที่อยู่จากสมุด (`getById` สโคปด้วย userId กัน IDOR) ผสาน recipient_name/phone (สมุดที่อยู่เก็บแค่ตำแหน่ง ไม่เก็บชื่อ/เบอร์ผู้รับ — ต้องส่งแยกมาเผื่อสั่งให้คนอื่น) → คืน flat record เดิมให้ `orderService` ไม่ต้องแก้อะไรเลย (`/api/shop/orders`, `/api/admin/orders` เรียก resolve ก่อนส่งต่อ) · เทส: `tests/integration/resolveDeliverySnapshot.test.ts` (4 เคส) + `tests/lib/schemas.test.ts` (+6 เคส oneOf) · **ยังไม่ทำ (gap ที่รู้ตัว, บันทึกไว้กันลืมแบบ §2b):** `/api/shop/preorders` (POST) เป็น path คู่ขนานที่ยังไม่ zod-adopt เลย ยังใช้ `delivery_address` แบบกรอกเองอย่างเดียว ไม่มี `address_id` — ถ้าจะทำต้อง adopt zod ให้ route นี้ก่อน (งานคนละขนาดกับ 3.8 เดิม)
8. ~~3.12 `src/lib/notify.ts`~~ — ✅ **ล้าสมัยแล้ว ไม่ต้องทำ** — ระบบแจ้งเตือนตัวจริงถูกสร้างเสร็จแล้วก่อนหน้านี้ในเซสชันนี้ (`src/services/notificationService.ts` + `src/lib/line.ts` push เข้า LINE คู่กัน + `/api/admin/notifications` routes) และ wire เข้า `orderService`/`paymentService`/`ingredientTransactionService`/`productService` จริงแล้ว (ยืนยันด้วย grep 2026-09-12) — ไฟล์ `src/lib/notify.ts` ที่ plan เดิมพูดถึงไม่มีอยู่จริง (ไม่เคยสร้างเป็น no-op stub เพราะสร้างของจริงไปเลย)
9. **3.16 `purchase_cost`** — field ใน `productModel` + `getUnitCostByProduct` fallback เมื่อไม่มีสูตร · แก้ COGS/กำไรใน dashboard · **S**
10. **3.4 integration tests เพิ่ม** — `cartService` · `ingredientTransactionService` · `deliveryService.quoteForCart` · **S–M**

**รอบ 4d — ขึ้นกับการตัดสินใจ hosting**

11. **3.13 object storage** — abstract `upload.ts` เป็น interface (`localDisk` + `s3`/R2/GCS) เลือกด้วย env `UPLOAD_DRIVER` · **จำเป็นถ้า deploy serverless** · ถอน `multer` · **M**
12. **3.14 ลบรูปสินค้าที่ไม่ใช้** — `upload.delete(oldKey)` best-effort ตอน `updateProduct`/`deleteProduct` · ต่อจากข้อ 11 · **S**
13. **3.15 delivery zone เป็น DB** — model `deliveryZone` + admin CRUD + cache TTL · fallback config เดิม · **M**

**รอบ 5 — งานเดี่ยวเสี่ยงสูง (branch แยก · ทำท้ายสุด)**

14. **3.11 เงินเป็น integer (สตางค์)** — กระทบทุก model/service + `discountEngine`/`deliveryService`/`dashboardService` + migration ×100 · **ต้องมี integration test ครอบเต็มก่อน + freeze feature อื่น** · **L**

> เกณฑ์จัดลำดับ: (1) ป้องกันการถอยหลังก่อน (CI ✅) → (2) lint/type กั้น build จริง (✅ core) → (3) จบด่าน zod ให้ครบ (4b) → (4) งานเดี่ยวเล็กเสี่ยงต่ำ (4c) → (5) งานที่รอ decision ภายนอก (4d) → (6) migration เสี่ยงสูงท้ายสุด (5)

| # | เรื่อง | หมายเหตุ |
|---|---|---|
| 3.1 | ✅ validation layer (zod) — ครบทุก route ที่วางแผนไว้ (2026-09-12, PR #6/#15–#17 + รอบ 4b เต็ม) | `zod` v4 · `src/lib/validate.ts` · `src/schemas/` (`common`,`auth`,`order`,`cart`,`payment`,`catalog`,`expense`,`inventory`,`promotion`,`sentiment`,`rbac`,`bom`,`user`,`address`,`review`,`attendance`,**`preorderRound`**) · **`crudRoutes` option `validate` + `createInject`** · adopt: `/auth/*` · `/shop/{orders,cart,payments,me,addresses,reviews}` · **crud-factory ทั้งหมด** (units/categories/banners/ingredients/expenses/product-options/variants/aspects/semantic-terms/roles/components/recipes) · `/admin/promotions` · `/admin/orders` (POST + `.../delivery`) · `/admin/attendances` · **`/admin/permissions`, `/admin/preorder-rounds*`, `/admin/preorder-round-items`, `/admin/users`** · ตาราง adopt ราย route → [`validation.md`](validation.md) · รื้อ `pick()`/`createFields` ที่ซ้ำ zod เสร็จครบ 8/8 ไฟล์แล้ว (ดู §3 ข้อ 5) |
| 3.2 | ~~ไม่มี rate-limit ที่ `/api/auth/login`~~ | ✅ แก้แล้ว (2026-09-11) — `src/lib/rateLimit.ts` (in-memory sliding window → `tooMany()` 429 + `retry_after_seconds`) · wire: `auth/login` 10/นาที · `auth/register` 5 · `auth/google` 10 · `shop/me/password` 5 (ต่อ IP, ทับ account-lockout ต่อบัญชี) · `httpError` เพิ่ม `tooMany()` + `TOO_MANY_REQUESTS` · รายละเอียด → [`security-hardening.md`](security-hardening.md) §1 · **หมายเหตุ:** in-memory = ไม่ share ข้าม instance → หลาย instance ต้องเปลี่ยนเป็น Redis (แก้ไฟล์เดียว) |
| 3.3 | ✅ `logger.ts` (2026-09-10) · `compensation.ts` `Saga` + adopt `preorderService.createPreorder` / `orderService.persistOrder` / `updateOrderStatus` cancel (2026-09-11) | **logger:** `src/lib/logger.ts` (JSON บรรทัดเดียว, level, `LOG_LEVEL`, serialize `err`) แทน `console.error` 5 จุด · → [`infra-tooling.md`](infra-tooling.md) §2 · **compensation:** `src/lib/compensation.ts` `Saga` (`onRollback` / `rollback` reverse-order best-effort / `commit`) · adopt `createPreorder` + `persistOrder` + `updateOrderStatus` cancel (แทน nested try/catch + `if (order?._id)` + `.catch(()=>undefined)`) · validate ด้วย integration test (persistOrder + cancelOrder) · → [`hardening-d3-plan.md`](hardening-d3-plan.md) |
| 3.4 | 🟡 unit + integration + CI (2026-09-10 → 2026-09-11) | vitest **2 projects**: `unit` (`tests/lib/`, ไม่ต่อ DB) + `integration` (`tests/integration/`, `mongodb-memory-server`) · scripts: `test` / `test:integration` / `test:all` / `typecheck:test` · **unit 115 / 15 ไฟล์** · **integration 13 / 3 ไฟล์:** `promotionUsage`, `persistOrder`, `cancelOrder` · ✅ **CI** `.github/workflows/ci.yml` (PR #13) รัน `typecheck → typecheck:test → lint → test → test:integration → build` ทุก push+PR · `tests/` exclude จาก `tsconfig.json` หลัก → `tsconfig.test.json` · → [`infra-tooling.md`](infra-tooling.md) §3 · **ยังไม่ทำ:** integration `cartService`/`ingredientTransactionService`/`deliveryService.quoteForCart` |
| 3.5 | ~~audit log แทบว่าง~~ | ✅ แก้แล้ว — `src/lib/audit.ts` (`audit(req, {...})` fire-and-forget) · wire เข้า mutation สำคัญแล้ว: **ออเดอร์** (สร้าง/เปลี่ยนสถานะ/จัดส่ง/ลบ/ลูกค้ายกเลิก) · **payment** (verify/refund/ลบ) · **สต็อก** (ingredient transaction สร้าง/void, product stock PUT/PATCH) · **สิทธิ์** (permission สร้าง/แก้/ถอน/กู้คืน, role CRUD, user สร้าง/ลบ/กู้คืน/ปลดล็อก/ตั้งรหัสผ่าน/เปลี่ยน role) · **การผลิต** (start/complete/cancel, consume/reverse stock) · **แคตตาล็อก** (product CRUD + อัปโหลดรูป, recipe/component/ingredient/promotion/expense CRUD ผ่าน `crudRoutes` option `audit: { entity }`) · **ยังไม่ครอบ:** unit/หมวดหมู่/banner/variant/option/aspect/semantic-term (เพิ่ม `audit:{entity}` ในไฟล์ factory ได้), shop payment create/slip, before/after snapshot (ตอนนี้ log แค่ action + entity_id + details ย่อ) |
| 3.6 | ~~ไม่มี eslint config~~ | ✅ แก้แล้ว (2026-09-10) + lint gate (รอบ 4a PR #14) — `eslint.config.mjs` (ESLint 9 flat) · **ลบ `eslint.ignoreDuringBuilds` แล้ว** (lint = 0 error) · `no-explicit-any` = `warn` ทั้ง repo + `error` บน `src/schemas`+`tests` · เหลือ **13 warning** (`no-explicit-any` ใน `src/app/api/**/route.ts` + `crudRoutes.ts`) → เก็บใน **รอบ 4b** พร้อมยก `src/lib` เป็น `error` · → [`infra-tooling.md`](infra-tooling.md) §1 |
| 3.7 | ~~response envelope ไม่คงที่~~ | ✅ แก้แล้ว (2026-09-11) — มาตรฐาน `data = { items, meta \| null }` ทุก list endpoint · `apiResponse.okList(items, meta?)` + `PageMeta` type · แก้ 7 endpoint ที่ไม่ conform (5 ตัวคืน array เปล่า, `getProducts` key `pagination`→`meta`) + `crudRoutes` GET · **⚠️ BREAKING** ต่อ frontend — ตาราง 7 endpoint ใน [`api-conventions.md`](api-conventions.md) §2 · รายละเอียดเต็ม → [`api-conventions.md`](api-conventions.md) (envelope / status code / validation issues / auth / query params) |
| 3.8 | สมุดที่อยู่ไม่เชื่อม checkout | `shop/orders` รับ `delivery_address` เป็น object ดิบ ไม่รองรับ `address_id` จาก `addressService` |
| 3.9 | ~~Google login = ID token flow เท่านั้น (env บอกใบ้ code flow)~~ | ✅ แก้แล้ว (2026-09-11) — `loginWithGoogle` ใช้ ID-token flow + `jose.jwtVerify` ตรวจ sig/iss/aud/exp ครบอยู่แล้ว · ลบ `GOOGLE_CLIENT_SECRET`/`GOOGLE_CALLBACK_URL` ออกจาก `.env.example` (เหลือ `GOOGLE_CLIENT_ID` + คอมเมนต์) · เพิ่มเช็ค `email_verified === false` → reject (กันสวมสิทธิ์ผ่าน link-by-email) · `docs/env.md` อัปเดต · รายละเอียด → [`security-hardening.md`](security-hardening.md) §2 |
| 3.10 | 🟡 CORS / CSRF — เพิ่ม defense-in-depth (same-origin) | ✅ (2026-09-11) — `src/lib/csrf.ts` `isCsrfSafe(method, origin, host)` + `middleware.ts` block mutation ที่ Origin ข้ามโดเมน → `403 CROSS_ORIGIN` (เสริม cookie `SameSite=Lax` เดิม) · CORS: ยืนยัน API เป็น **same-origin** (ไม่ส่ง `Access-Control-Allow-*`) · รายละเอียด → [`security-hardening.md`](security-hardening.md) §3 · **ยังเปิดค้าง:** ถ้า frontend แยก origin → ต้องเพิ่ม CORS allowlist + preflight + cookie `SameSite=None` + CSRF token จริง |
| 3.11 | เงินเก็บเป็น float | `subtotal` / `discount_amount` / `total_amount` ฯลฯ เป็น JS number มี `round2` ช่วยแสดงผล แต่สะสม error ได้ · พิจารณาเก็บเป็นสตางค์ (integer) |
| 3.12 | จุดต่อ LINE (`src/lib/notify.ts`) | ยังไม่สร้าง — ทำ no-op ไว้ก่อน แล้วเรียก `notify("order.paid", {...})` ที่ paymentService.verify / orderService.status / ingredient low-stock เพื่อให้ต่อ LINE ทีหลังแก้ที่เดียว |
| 3.13 | อัปโหลดเขียนลง `public/uploads/` (`src/lib/upload.ts`) | ใช้ได้เฉพาะ **self-host** · บน serverless (Vercel ฯลฯ) `public/` read-only ตอน runtime → เปลี่ยนเป็น object storage (S3 / Cloudflare R2 / GCS) แก้ที่ `upload.ts` ที่เดียว · `multer` ใน `package.json` ไม่ได้ใช้ (route ใช้ `req.formData()`) — ถอนออกได้ |
| 3.14 | ลบรูปสินค้าที่ไม่ใช้ | ไม่มี endpoint ลบไฟล์ใน `public/uploads/products/` เมื่อแก้ `product_img` หรือลบสินค้า → ไฟล์ค้างสะสม |
| 3.15 | ค่าส่ง = config + env ยังไม่ใช่ DB (`src/services/deliveryService.ts`) | รองรับแค่ 2 โซน (กทม./ต่างจังหวัด) แยกตามชื่อจังหวัดตรง ๆ · อัปเกรด: model `deliveryZone` + admin CRUD (โซนตามรหัสไปรษณีย์/อำเภอ, ค่าส่งตามน้ำหนัก, ส่งฟรีต่อโซน) — แก้เฉพาะ `deliveryService.ts` + เพิ่ม routes |
| 3.16 | ไม่มี "ต้นทุนซื้อมา" สำหรับสินค้าซื้อมาขายต่อ (`productModel`) | `cost_per_unit` มาจากสูตรเท่านั้น · สินค้าที่ไม่ได้ผลิตเอง (น้ำดื่ม, ของฝาก) ไม่มีต้นทุน → COGS/กำไรใน dashboard ต่ำกว่าจริง · เพิ่ม field `purchase_cost` ใน productModel + ให้ `getUnitCostByProduct` fallback ไปใช้ค่านี้เมื่อไม่มีสูตร · ต้นทุนระดับ variant ก็ยังไม่มี |
| 3.17 | `crudRoutes.ts` — `createInject` (กัน mass-assignment ตอน POST) ไม่มีคู่ `updateInject` ฝั่ง PATCH (2026-09-12) | `ItemRoutesOptions` (`src/lib/crudRoutes.ts:143`) ไม่มี field เทียบเท่า `createInject` ของ `CollectionRoutesOptions` (`:106`) — `PATCH` handler (`:160-167`) เรียก `service.update(id, body)` ตรง ๆ ไม่มีจุด inject ค่าจาก session เลย · ตอนนี้ยังไม่มี entity ไหนต้องการ (ยังไม่เจอบั๊กจริง) แต่ถ้ามี field ที่ต้อง derive จาก session ตอนแก้ไข (เช่น `updated_by`) จะต้อง bypass factory หรือ re-implement guard เอง · เพิ่ม `updateInject?: (session: SessionUser) => Record<string, unknown>` ให้ `ItemRoutesOptions` แบบเดียวกัน |
| 3.18 | Checkout N+1 — `resolveLine` วน `await` ทีละบรรทัดในตะกร้า (2026-09-12) | `createOrderFromCart`/`createOrder` (`src/services/orderService.ts:420-437`) วน `for...of` เรียก `await resolveLine(...)` ทีละรายการ — แต่ละครั้งมี query แยก (product/variant/options) ไม่ batch · ตะกร้า 10 ชิ้น = query ทยอย ~30 ครั้งแทนที่จะ batch ด้วย `$in` ครั้งเดียวต่อ collection แล้ว join ใน memory → latency ตอน checkout โตเป็นเส้นตรงตามจำนวนชิ้นในตะกร้า · ยังไม่กระทบจริงตอนนี้ (ตะกร้าปกติไม่ใหญ่) แต่ควรรู้ไว้ก่อนปริมาณคำสั่งซื้อโต |

---

## 4. 🟢 เล็กน้อย

- `src/lib/authGuard.ts`: `requireOwnerOrPermission` / `requireSelfOrRole` กลายเป็น dead code หลังแยก path `/shop` `/admin` (เก็บไว้ได้ ไม่เสียหาย)
- `permissionModel` ยังมี `pre("save")` hook เดิม (ทำงานถูก แต่ redundant กับ `required: true` ของ `role_id`)
- `productModel.product_stock_quantity` default ถูกแก้เป็น `0` (จาก `null`) — `createProduct` ยัง set `null` ให้ preorder ชัดเจน แต่สินค้า preorder ที่สร้างนอก service จะได้ `0`
- ชื่อฟิลด์ `productModel.product_id` (รหัส pos-/pre-) ชนกับ convention `product_id` ที่โมเดลอื่นใช้หมายถึง `_id` (FK) — เวลา query ต้องระวังบริบท
- `bundleModel` + service + routes ถูกลบออกทั้งหมด (ผู้ใช้ตัดฟีเจอร์ Bundle ทิ้ง)

---

## 5. ✅ `product_type` 3 ค่า (`inStore` / `online` / `preorder`) — รายละเอียด

enum = `["inStore", "online", "preorder"]` (เดิม `"ready"` → `"inStore"`)

**หลักที่ใช้:** `inStore` และ `online` = สินค้าที่ **มีสต็อก** (behave เหมือนกัน) · `preorder` = ไม่มีสต็อก ต้องผ่านระบบ Preorders

| จุด | สถานะ |
|---|---|
| `src/lib/productCode.ts` | ✅ `PRODUCT_TYPES`, `ProductType`, `isStockProductType()`, `STOCK_PRODUCT_TYPES` · prefix: `inStore`/`online` → `pos-`, `preorder` → `pre-` |
| `productService` — types / validation / `validateTypeConsistency` / `updateProduct` | ✅ ใช้ `ProductType`, `PRODUCT_TYPES.includes()`, `isStockProductType()` |
| stock functions (`loadStockableProduct`, `setStock`, `adjustStock`, `deductStockForOrder`, `restockForOrder`, `getLowStockProducts`, `checkStockAvailability`) | ✅ ใช้ `STOCKABLE_MATCH = { product_type: { $ne: "preorder" } }` |
| `dashboardService` low-stock count · `admin/products` route · `backfill-product-codes.ts` · comments | ✅ |

**ยังเปิดให้ตัดสินใจ (ไม่ได้ทำ — ถือว่าไม่จำกัด):**
- `inStore` และ `online` สั่งซื้อได้ทุกช่องทาง (ทั้ง `/api/shop` และ POS) — **ยังไม่บังคับช่องทาง** · ถ้าต้องการให้ `inStore` ขายหน้าร้านเท่านั้น / `online` ขายเว็บเท่านั้น → เพิ่ม guard เทียบ `product_type` กับ `channel` ใน `orderService.persistOrder` / `resolveLine` / `cartService.addItem`
- `catalog/products` โชว์ทุก type ที่ `is_visible` — ถ้าต้องซ่อน `inStore` จากเว็บ ให้ frontend กรอง `?product_type=online` หรือเพิ่ม default filter ใน route

---

## 6. Migration checklist (สะสมจากหลายงาน — รันครั้งเดียวก่อนใช้จริง)

```
[x] เปลี่ยน JWT_SECRET / SESSION_SECRET / NEXTAUTH_SECRET ใน .env.local (dev)  — 2026-09-02
[ ] production: สุ่ม secret ใหม่อีกครั้ง ตั้งผ่าน env ของ host (อย่า commit)
[ ] npm run seed
[ ] npm run backfill:product-codes           # เติม product_id (pos-/pre-) ให้สินค้าเก่า
[ ] MongoDB: อัปเดต product_type ของสินค้าเดิมจาก "ready" → "inStore" (ถ้ามีข้อมูลเก่า)
[ ] MongoDB: ลบ payment "pending" ซ้ำ (order_id/preorder_id เดียวกันมีหลายใบ) ให้เหลือใบเดียว — §2.10
[ ] npm run sync-indexes                      # ตรวจข้อมูลซ้ำ + syncIndexes ทุก model
[ ] npm run sync-indexes -- --fix             # ถ้าขั้นบนรายงานว่ามี attendance/review ซ้ำ
```

**`npm run sync-indexes` ทำอะไรให้ครบในคำสั่งเดียว:**
- ตรวจ + รายงาน attendance ซ้ำ (`user_id`+`work_date`) และ review ซ้ำ (`order_item_id`) ในชุด `deleted_at:null`
  → ใส่ `-- --fix` เพื่อ soft-delete รายการที่เก่ากว่า (เก็บอันล่าสุด)
- `Model.syncIndexes()` ทุก model:
  - drop index เก่าของ `permissions` (`role_id_1_menu_key_1` / `user_id_1_menu_key_1`) → §1.3 จบในนี้
  - สร้าง partial unique ของ `attendances` / `reviews` (§2.3 / §2.4)
  - สร้าง partial unique `payments` `uniq_pending_payment_per_order` / `_per_preorder` (§2.10)
    — ถ้ามี pending ซ้ำอยู่ก่อน index นี้จะสร้าง **ไม่ผ่าน** (❌) ต้องลบซ้ำด้วยมือก่อน (`--fix` ยังไม่ครอบ payments)
  - สร้าง unique sparse ของ `products.product_id`
- model ไหน sync ไม่ผ่าน (เช่นยังมีข้อมูลซ้ำ) จะขึ้น ❌ พร้อมเหตุผล

---

## 7. ระบบสแกนบาร์โค้ด POS — สถานะ

| ส่วน | สถานะ |
|---|---|
| ฟิลด์ `productModel.product_id` + unique sparse index | ✅ |
| `src/lib/productCode.ts` (`generateProductCode`, `isProductCode`) | ✅ (YY = ค.ศ. — เปลี่ยนเป็น พ.ศ. ได้บรรทัดเดียว) |
| `productService.createProduct` gen รหัส + retry 20 ครั้ง | ✅ |
| `productService.getProductByCode()` / `resolveScan()` (รับทั้งรหัสและ `_id` → product + ราคา + สต็อก + variants) | ✅ |
| `GET /api/admin/pos/scan?code=` (สิทธิ์ `orders.view`) | ✅ |
| `scripts/backfill-product-codes.ts` + `npm run backfill:product-codes` (รองรับ 3 ค่า) | ✅ (ยังไม่ได้รันกับ DB จริง) |
| POS สร้างบิล | ใช้ `POST /api/admin/orders` เดิม (`source: "items"`, `channel: "instore"`) |
| endpoint/script สร้าง label sheet (พิมพ์บาร์โค้ด Code128/QR จาก DB) | ❌ TODO — render ฝั่ง frontend (`jsbarcode`/`qrcode`) หรือ script ออก PDF |
| frontend: หลังสแกน ถ้ามี variants ให้เลือกก่อนเพิ่มเข้าบิล | ❌ TODO (งาน frontend) |

---

## 8. 🟡 Preorder (เฟส 5) — service + API เสร็จแล้ว

รายละเอียดเต็ม → [`docs/preorder.md`](preorder.md)

**เสร็จแล้ว:**
- `preorderRoundModel.round_status` เพิ่มค่า `"scheduled"` → `["scheduled","open","closed","cancelled"]` (default `scheduled`)
- เพิ่ม menu key `"preorder"` ใน `permissionService.MENU_KEYS`
- `preorderRoundService` — CRUD รอบ + รายการในรอบ, state machine สถานะรอบ, `commitQty/releaseQty` (กันจองเกิน `max_qty_total` ด้วย `$expr` `$inc`)
- `preorderService` — สร้างพรีออเดอร์จากรอบ (ลูกค้า + แอดมินแทนลูกค้า), `PRE-YYYYMMDD-XXXXXX`, ค่าส่งคิดฝั่ง server, snapshot `cost_per_unit`, state machine + คืนโควตาตอนยกเลิก, best-effort compensation
- routes: `/api/catalog/preorder-rounds[/[id]]` (สาธารณะ) · `/api/shop/preorders[/[id]][/cancel]` · `/api/admin/preorder-rounds/*` + `/api/admin/preorder-round-items/[id]` + `/api/admin/preorders/*`
- audit log ครบทุก mutation
- `scripts/seed-preorder-rounds.ts` — รอบตัวอย่าง 4 รอบ (ซาวโดว์) สำหรับเทสฝั่งลูกค้า

**ยังไม่ทำ (ต่อยอด):**
- ผูก `discountEngine`/โปรโมชันกับพรีออเดอร์ (ตอนนี้รองรับเฉพาะ `discount_amount` กรอกมือของแอดมิน)
- ~~`paymentService` — รับ `preorder_id` ได้แล้ว แต่ยังไม่ได้เรียก `preorderService.setPaymentStatus()`~~ →
  **แก้แล้ว** พร้อมอีก 3 บั๊กที่เกี่ยวข้อง (ownership/amount check, ยกเลิกไม่คืนเงิน) → ดูหมวด **§2b** ด้านบน (ก่อน §3)
- `productionOrderService` — `source_type: "preorder"` ยัง reject ไว้ ยังไม่สร้างใบสั่งผลิตจาก `round_id`
- ไม่เลื่อน `round_status` อัตโนมัติตามเวลา (แอดมินกด open/close เอง)
- seed permission ให้ role `staff` เข้าเมนู `preorder` (owner ผ่านอยู่แล้ว)
