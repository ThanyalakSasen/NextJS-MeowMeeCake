# MeowMeeCake Backend — สิ่งที่ต้องแก้ไข / ปรับ / บั๊ก

> อัปเดตล่าสุด: 2026-09-07
> ขอบเขต: ฝั่ง Backend (`src/**`, `scripts/**`) — ยังไม่รวม frontend

## สถานะโดยรวม

| ชั้น | สถานะ |
|---|---|
| Model (`src/models/**`, 37 ไฟล์) | ✅ ใช้อยู่ (มีจุดต้องเพิ่ม index — ดู §6 Migration) |
| Service layer (`src/services/**`) | ✅ 4 โดเมนหลัก + Promotion / Review / Sentiment / Address / Expense / Dashboard + Auth |
| API routes | ✅ `/api/auth` · `/api/catalog` (สาธารณะ อ่านอย่างเดียว) · `/api/shop` (ลูกค้า) · `/api/admin` (พนักงาน + permission) |
| Auth layer (JWT + middleware + RBAC 3 ชั้น) | ✅ ใช้อยู่ |
| `product_type` = `inStore` / `online` / `preorder` | ✅ รองรับทั้งระบบ |
| **§2 บั๊ก / ความถูกต้องข้อมูล (2.1–2.11)** | ✅ **ปิดครบทั้ง 11 ข้อ** — PR [#3](https://github.com/ThanyalakSasen/NextJS-MeowMeeCake/pull/3) **merged** เข้า `addModels` (merge commit `055d71b`) · issue [#4](https://github.com/ThanyalakSasen/NextJS-MeowMeeCake/issues/4) closed — เหลือแค่ขั้น deploy: `npm run sync-indexes` + ลบข้อมูลซ้ำกับ DB จริง (ดู §6) · สรุปรวม → [`data-integrity-fixes.md`](data-integrity-fixes.md) |
| ระบบสแกนบาร์โค้ด POS | 🟡 core เสร็จ — เหลือ label sheet + รัน backfill กับ DB จริง (ดู §7) |
| อัปโหลดรูปสินค้า | ✅ `POST /api/admin/products/images` (auth + ตรวจ 3 ชั้น) — บันทึกลงดิสก์ (self-host เท่านั้น, ดู §3.13) |
| Preorder (เฟส 5) | 🟡 service + API เสร็จ (ดู §8 · [preorder.md](preorder.md)) — เหลือผูก payment/production/promotion |
| §3 คุณภาพ / hardening | 🟡 ทำแล้ว: audit log (3.5) · ยังค้าง ~15 ข้อ (zod, rate-limit, test, eslint ฯลฯ) |
| Notification | ❌ ตัดออก (แจ้งเตือนผ่าน LINE แยกภายหลัง — ดู §3.12) |

**คำสั่งตรวจสอบ:** `npm run typecheck` · `npm run lint` · `npm test` · `npm run build` — ปัจจุบันผ่านทั้งหมด

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

## 3. 🟡 คุณภาพ / hardening (ชั้น D ในแผน)

> **แผนงาน + ลำดับ + effort/ความเสี่ยงต่อข้อ → [`hardening-plan.md`](hardening-plan.md)**
> ก่อน production อย่างน้อย: 3.2 · 3.9 · 3.10 · ทำก่อนได้กำไรทบต้น: 3.6 → 3.3 → 3.4 → 3.1 · งานเดี่ยวเสี่ยงสูง: 3.11

| # | เรื่อง | หมายเหตุ |
|---|---|---|
| 3.1 | 🟡 validation layer (zod) — infra + `/auth/*` + `/shop/*` + `crudRoutes` option + admin CRUD หลักตัว (2026-09-11) | `zod` v4 · `src/lib/validate.ts` (`parseBody`/`parseQuery`/`parse` → `badRequest(400, { issues })` เข้าทาง `route()` เดิม) · `src/schemas/` (`common`,`auth`,`order`,`cart`,`payment`,`catalog`,`expense`,`inventory`,`promotion`) · **`crudRoutes` option `validate: { create, update }`** · adopt: `/auth/register`+`/login` · `/shop/orders`(POST+GET) · `/shop/cart/items`(+`/[id]`) · `/shop/payments`(+`/[id]/slip`) · `/admin/{units,product-categories,banners,ingredients,ingredient-categories,component-categories,expenses}`(+`/[id]`) · `/admin/promotions`(POST+PATCH) · **72 tests / 8 ไฟล์** · รายละเอียด → [`validation.md`](validation.md) · **ยังไม่ทำ:** recipes (BOM ซ้อน) · product-options/variants · aspects/semantic-terms/reviews/attendances · admin orders custom route · shop reviews/addresses/me · รื้อ `pick()`/`Number()` ใน service |
| 3.2 | ~~ไม่มี rate-limit ที่ `/api/auth/login`~~ | ✅ แก้แล้ว (2026-09-11) — `src/lib/rateLimit.ts` (in-memory sliding window → `tooMany()` 429 + `retry_after_seconds`) · wire: `auth/login` 10/นาที · `auth/register` 5 · `auth/google` 10 · `shop/me/password` 5 (ต่อ IP, ทับ account-lockout ต่อบัญชี) · `httpError` เพิ่ม `tooMany()` + `TOO_MANY_REQUESTS` · รายละเอียด → [`security-hardening.md`](security-hardening.md) §1 · **หมายเหตุ:** in-memory = ไม่ share ข้าม instance → หลาย instance ต้องเปลี่ยนเป็น Redis (แก้ไฟล์เดียว) |
| 3.3 | 🟡 `src/lib/logger.ts` — ✅ แก้แล้ว (2026-09-10) · `compensation.ts` — ยังไม่ทำ | **logger:** `src/lib/logger.ts` (JSON บรรทัดเดียว, level `debug/info/warn/error`, `LOG_LEVEL` env, serialize `err`) แทน `console.error` 5 จุด (`apiResponse` / `orderService` ×3 / `userLogService`) · `no-console` rule กันเพิ่ม · รายละเอียด → [`infra-tooling.md`](infra-tooling.md) §2 · **ยังไม่ทำ:** `src/lib/compensation.ts` (best-effort rollback helper — ดู `hardening-plan.md` D3.3b) |
| 3.4 | 🟡 ไม่มี test → มี unit ชุดแรกแล้ว (2026-09-10) | vitest + `@vitest/coverage-v8` (+ `mongodb-memory-server` เตรียมไว้) · `npm test` / `test:watch` / `test:cov` · `vitest.config.mts` (alias `@`, dummy `MONGODB_URI`) · **35 tests / 4 ไฟล์** ใน `tests/lib/`: `discountEngine` (§2.6/2.11), `productCode`, `deliveryService`, `queryParams` · รายละเอียด → [`infra-tooling.md`](infra-tooling.md) §3 · **ยังไม่ทำ:** integration test (mongodb-memory-server) สำหรับ `orderService.persistOrder` / `promotionUsageService.recordUsage` / `cartService` — task แยก |
| 3.5 | ~~audit log แทบว่าง~~ | — | ✅ แก้แล้ว — `src/lib/audit.ts` (`audit(req, {...})` fire-and-forget) · wire เข้า mutation สำคัญแล้ว: **ออเดอร์** (สร้าง/เปลี่ยนสถานะ/จัดส่ง/ลบ/ลูกค้ายกเลิก) · **payment** (verify/refund/ลบ) · **สต็อก** (ingredient transaction สร้าง/void, product stock PUT/PATCH) · **สิทธิ์** (permission สร้าง/แก้/ถอน/กู้คืน, role CRUD, user สร้าง/ลบ/กู้คืน/ปลดล็อก/ตั้งรหัสผ่าน/เปลี่ยน role) · **การผลิต** (start/complete/cancel, consume/reverse stock) · **แคตตาล็อก** (product CRUD + อัปโหลดรูป, recipe/component/ingredient/promotion/expense CRUD ผ่าน `crudRoutes` option `audit: { entity }`) · **ยังไม่ครอบ:** unit/หมวดหมู่/banner/variant/option/aspect/semantic-term (เพิ่ม `audit:{entity}` ในไฟล์ factory ได้), shop payment create/slip, before/after snapshot (ตอนนี้ log แค่ action + entity_id + details ย่อ) |
| 3.6 | ~~ไม่มี eslint config~~ | ✅ แก้แล้ว (2026-09-10) — `eslint.config.mjs` (flat config, ESLint 9 + `eslint-config-next` 15) · `npm run lint` / `lint:fix` · `next.config.ts` `eslint.ignoreDuringBuilds: true` **ชั่วคราว** (ลบเมื่อ lint สะอาด) · เก็บ dead import (`bcrypt` ใน userModel, `Model` ใน productionOrderService) + `prefer-const` · เหลือ 1 warning (`import/no-anonymous-default-export` ใน productService) · รายละเอียด → [`infra-tooling.md`](infra-tooling.md) §1 |
| 3.7 | response envelope ไม่คงที่ | ส่วนใหญ่ `data = { items, meta }` แต่ catalog บางตัว (`/catalog/banners`, `/catalog/products/[id]/variants`, `.../options`, `/catalog/categories`) คืน `data = [...]` ตรง ๆ → frontend เดายาก · เลือกมาตรฐานเดียว |
| 3.8 | สมุดที่อยู่ไม่เชื่อม checkout | `shop/orders` รับ `delivery_address` เป็น object ดิบ ไม่รองรับ `address_id` จาก `addressService` |
| 3.9 | ~~Google login = ID token flow เท่านั้น (env บอกใบ้ code flow)~~ | ✅ แก้แล้ว (2026-09-11) — `loginWithGoogle` ใช้ ID-token flow + `jose.jwtVerify` ตรวจ sig/iss/aud/exp ครบอยู่แล้ว · ลบ `GOOGLE_CLIENT_SECRET`/`GOOGLE_CALLBACK_URL` ออกจาก `.env.example` (เหลือ `GOOGLE_CLIENT_ID` + คอมเมนต์) · เพิ่มเช็ค `email_verified === false` → reject (กันสวมสิทธิ์ผ่าน link-by-email) · `docs/env.md` อัปเดต · รายละเอียด → [`security-hardening.md`](security-hardening.md) §2 |
| 3.10 | 🟡 CORS / CSRF — เพิ่ม defense-in-depth (same-origin) | ✅ (2026-09-11) — `src/lib/csrf.ts` `isCsrfSafe(method, origin, host)` + `middleware.ts` block mutation ที่ Origin ข้ามโดเมน → `403 CROSS_ORIGIN` (เสริม cookie `SameSite=Lax` เดิม) · CORS: ยืนยัน API เป็น **same-origin** (ไม่ส่ง `Access-Control-Allow-*`) · รายละเอียด → [`security-hardening.md`](security-hardening.md) §3 · **ยังเปิดค้าง:** ถ้า frontend แยก origin → ต้องเพิ่ม CORS allowlist + preflight + cookie `SameSite=None` + CSRF token จริง |
| 3.11 | เงินเก็บเป็น float | `subtotal` / `discount_amount` / `total_amount` ฯลฯ เป็น JS number มี `round2` ช่วยแสดงผล แต่สะสม error ได้ · พิจารณาเก็บเป็นสตางค์ (integer) |
| 3.12 | จุดต่อ LINE (`src/lib/notify.ts`) | ยังไม่สร้าง — ทำ no-op ไว้ก่อน แล้วเรียก `notify("order.paid", {...})` ที่ paymentService.verify / orderService.status / ingredient low-stock เพื่อให้ต่อ LINE ทีหลังแก้ที่เดียว |
| 3.13 | อัปโหลดเขียนลง `public/uploads/` | `src/lib/upload.ts` | ใช้ได้เฉพาะ **self-host** · บน serverless (Vercel ฯลฯ) `public/` read-only ตอน runtime → เปลี่ยนเป็น object storage (S3 / Cloudflare R2 / GCS) แก้ที่ `upload.ts` ที่เดียว · `multer` ใน `package.json` ไม่ได้ใช้ (route ใช้ `req.formData()`) — ถอนออกได้ |
| 3.14 | ลบรูปสินค้าที่ไม่ใช้ | ไม่มี endpoint ลบไฟล์ใน `public/uploads/products/` เมื่อแก้ `product_img` หรือลบสินค้า → ไฟล์ค้างสะสม |
| 3.15 | ค่าส่ง = config + env (ยังไม่ใช่ DB) | `src/services/deliveryService.ts` | รองรับแค่ 2 โซน (กทม./ต่างจังหวัด) แยกตามชื่อจังหวัดตรง ๆ · อัปเกรด: model `deliveryZone` + admin CRUD (โซนตามรหัสไปรษณีย์/อำเภอ, ค่าส่งตามน้ำหนัก, ส่งฟรีต่อโซน) — แก้เฉพาะ `deliveryService.ts` + เพิ่ม routes |
| 3.16 | ไม่มี "ต้นทุนซื้อมา" สำหรับสินค้าซื้อมาขายต่อ | `productModel` | `cost_per_unit` มาจากสูตรเท่านั้น · สินค้าที่ไม่ได้ผลิตเอง (น้ำดื่ม, ของฝาก) ไม่มีต้นทุน → COGS/กำไรใน dashboard ต่ำกว่าจริง · เพิ่ม field `purchase_cost` ใน productModel + ให้ `getUnitCostByProduct` fallback ไปใช้ค่านี้เมื่อไม่มีสูตร · ต้นทุนระดับ variant ก็ยังไม่มี |

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
- `paymentService` — รับ `preorder_id` ได้แล้ว แต่ยังไม่ได้เรียก `preorderService.setPaymentStatus()` (มี hook `setPaymentStatus` รออยู่)
- `productionOrderService` — `source_type: "preorder"` ยัง reject ไว้ ยังไม่สร้างใบสั่งผลิตจาก `round_id`
- ไม่เลื่อน `round_status` อัตโนมัติตามเวลา (แอดมินกด open/close เอง)
- seed permission ให้ role `staff` เข้าเมนู `preorder` (owner ผ่านอยู่แล้ว)
