# สรุปงาน Backend hardening — §2 + §3 (2026-09-07 → 2026-09-12)

> อัปเดตล่าสุด: 2026-09-12
> **เอกสารนี้ = จุดเริ่มอ่าน** · แต่ละหัวข้อลิงก์ไปเอกสารรายละเอียด + PR
> master tracker → [`BACKLOG.md`](BACKLOG.md) · มาตรฐาน API → [`api-conventions.md`](api-conventions.md)

---

## ภาพรวม

| กลุ่ม | สถานะ | PR |
|---|---|---|
| **§2 บั๊ก / ความถูกต้องข้อมูล (2.1–2.11)** | ✅ ปิดครบ 11/11 | #3 |
| **§3 D1 — infra/tooling** (3.6 eslint · 3.3 logger · 3.4 test · 3.1 zod) | ✅ (3.1 = infra + adopt หลัก) | #5 #6 |
| **§3 D2 — security** (3.2 rate-limit · 3.9 Google · 3.10 CSRF) | ✅ | #7 |
| **§3 D3 — consistency/robustness** (3.3b Saga · integration test · 3.7 envelope) | ✅ | #8 #9 #10 #11 |
| **§3 3.5 audit log** | ✅ (นอกชุด D — `src/lib/audit.ts`) → [`auditLog.md`](auditLog.md) | — |
| **§3 รอบ 4a — ปิด infra** (CI · lint gate · zod crud-factory + shop routes · `createInject`) | ✅ core → [`hardening-4a-plan.md`](hardening-4a-plan.md) | #13–#17 |
| **§3 รอบ 4b — จบ 3.1/3.6** (`/admin/orders`+`/admin/attendances`+อีก 5 กลุ่ม route zod · รื้อ `pick()` 8/8 · `no-explicit-any` error บน `src/lib`) | ✅ → [`hardening-4b-plan.md`](hardening-4b-plan.md) | #20 #21 |
| **§2b บั๊ก preorder payment/cancellation** (IDOR + auto-refund/auto-confirm 4 ข้อ) | ✅ → [`preorder-payment-hardening.md`](preorder-payment-hardening.md) | #19 |
| **§2c บั๊กความทนทาน** (clearCart error handling · voidTransaction floor guard) | ✅ → [`order-cart-inventory-robustness.md`](order-cart-inventory-robustness.md) | #22 |
| **§3 รอบ 4c** (3.8 address_id→checkout · ~~3.12~~ ล้าสมัย · 3.16 purchase_cost · 3.4 integration test เพิ่ม) | ✅ → [`hardening-4c-plan.md`](hardening-4c-plan.md) | #23–#25 |
| **§3 รอบ 4d — feature/ops** (3.13 object storage abstraction · 3.14 ลบรูปที่ไม่ใช้ · 3.15 delivery zone เป็น DB) | ✅ → [`hardening-4d-plan.md`](hardening-4d-plan.md) | #28 |
| **§3 3.11 เงินเป็น integer** | 🟡 เฟส 2/5 (Order+Preorder+Payment+Expense) → [`hardening-5-money-phase1.md`](hardening-5-money-phase1.md) | — |

ทุก PR merge เข้า branch `addModels` · ทุก commit ผ่าน `typecheck` · `typecheck:test` · `lint` · `test` (unit) · `test:integration` · `build` · **CI (`.github/workflows/ci.yml`) รันครบทุกขั้นทุก PR ตั้งแต่ #13**

**ลำดับที่ทำจริง** = ตามแผน [`hardening-plan.md`](hardening-plan.md) §ลำดับที่แนะนำ:
D1 (3.6 → 3.3 → 3.4 → 3.1 infra) → D2 (3.2 → 3.9 → 3.10) →
D3 (**3.3b compensation → integration test → 3.7 envelope** ตาม [`hardening-d3-plan.md`](hardening-d3-plan.md)) → 3.5 audit log →
รอบ 4a (CI #13 → 3.6 cleanup #14 → 3.1 crud-factory #15/#16 → shop routes + `createInject` #17) →
รอบ 4b (zod tail + `pick()` cleanup + `no-explicit-any` บน `src/lib` #20/#21) →
§2b/§2c (พบจาก code review เต็ม `src/services/` #19/#22 — ดู [`hardening-4c-plan.md`](hardening-4c-plan.md) §0 เรื่องที่ทั้งสองอันเคยรายงานผิดว่า merge แล้วทั้งที่ยังไม่ merge) →
รอบ 4c (address_id→checkout · purchase_cost · integration test เพิ่ม #23–#25) →
รอบ 4d (object storage abstraction · ลบรูปที่ไม่ใช้ · delivery zone เป็น DB #28)

---

## §2 — บั๊ก / ความถูกต้องข้อมูล (PR #3, issue #4)

| # | เรื่อง | สรุปวิธีแก้ | เอกสาร |
|---|---|---|---|
| 2.1 | ค่าส่งเชื่อ client | `deliveryService` คิดฝั่ง server (โซนตามจังหวัด) · route ไม่รับ `delivery_fee` | — |
| 2.2 | `cost_per_unit` ไม่ snapshot | `recipeService.getUnitCostByProduct` → snapshot ลง `orderItem` ตอนสร้าง | — |
| 2.3 / 2.4 | attendance / review index ไม่ unique | partial unique `{ ..., deleted_at: null }` · **ต้อง `sync-indexes`** | — |
| 2.5 | ตะกร้าไม่ re-price ตอน checkout | `createOrderFromCart` วน `resolveLine()` คิดราคาสด แทน `price_snapshot` | [`reprice.md`](reprice.md) |
| 2.6 | FreeShipping + takeaway | `computeDiscount`: `delivery_fee <= 0` → `throw unprocessable` | [`promo-freeshipping.md`](promo-freeshipping.md) |
| 2.7 | ลูกค้ายกเลิกออเดอร์กว้างไป | `CUSTOMER_CANCELABLE_STATUSES` + `allowedFrom` ใน `cancelOrder()` | [`order-cancel.md`](order-cancel.md) |
| 2.8 | ยกเลิกออเดอร์ paid ไม่คืนเงิน | ลูกค้า: block 409 · แอดมิน: auto-refund (`refundPayment`) | [`order-cancel.md`](order-cancel.md) §3 · [`data-integrity-fixes.md`](data-integrity-fixes.md) |
| 2.9 | promo `usage_limit` ไม่ atomic | `recordUsage` จองสิทธิ์ atomic (`$expr $lt` + `$inc`) + rollback | [`concurrency-guards.md`](concurrency-guards.md) |
| 2.10 | payment ซ้ำต่อออเดอร์ | เช็ค active payment + partial unique index `uniq_pending_payment_per_*` | [`concurrency-guards.md`](concurrency-guards.md) |
| 2.11 | โปรฯ ส่วนลด 0 ยังผูก `promotion_id` | `computeDiscount`: `discount <= 0` → reject | [`promo-freeshipping.md`](promo-freeshipping.md) §4 |

**deploy note:** `sync-indexes` กับ DB จริง (2.3/2.4/2.10) + ลบ payment `pending` ซ้ำก่อน (2.10)

---

## §3 D1 — infra / tooling → [`infra-tooling.md`](infra-tooling.md), [`validation.md`](validation.md)

### 3.6 ESLint (PR #5)
`eslint.config.mjs` flat config (ESLint 9 + `eslint-config-next` 15) · `npm run lint` / `lint:fix` ·
`next.config.ts` `eslint.ignoreDuringBuilds: true` **ชั่วคราว** (ลบเมื่อ lint สะอาด) ·
ตอนนี้ 0 error, 1 warning (`import/no-anonymous-default-export` ใน `productService.ts:797`)

### 3.3 Logger (PR #5)
`src/lib/logger.ts` — JSON บรรทัดเดียว, level `debug/info/warn/error`, `LOG_LEVEL` env, serialize `err` ·
แทน `console.error` 5 จุด · `no-console` rule กันเพิ่ม

### 3.4 Testing (PR #5, #9, #11)
- **vitest 2 projects:** `unit` (`tests/lib/`, ไม่ต่อ DB) · `integration` (`tests/integration/`, `mongodb-memory-server`)
- scripts: `test` (unit) · `test:integration` · `test:all` · `typecheck:test` (`tsconfig.test.json` — `tests/` ถูก exclude จาก `tsc`/`next build` หลัก)
- **unit: 91 tests / 12 ไฟล์** — `discountEngine`, `productCode`, `deliveryService`, `queryParams`, `validate`, `schemas`, `catalog`, `schemas-admin`, `rateLimit`, `csrf`, `compensation`, `apiResponse`
- **integration: 13 tests / 3 ไฟล์** — `promotionUsage` (§2.9 atomic + concurrency), `persistOrder` (compensation), `cancelOrder` (auto-refund / revoke)
- **ยังไม่ครอบ:** `cartService`, `ingredientTransactionService`, `deliveryService.quoteForCart` · CI pipeline

### 3.1 Validation (zod) (PR #6) → [`validation.md`](validation.md)
- `src/lib/validate.ts` — `parseBody` / `parseQuery` / `parse` → `badRequest(400, { issues })` เข้าทาง `route()` เดิม
- `src/schemas/` — `common`, `auth`, `order`, `cart`, `payment`, `catalog`, `expense`, `inventory`, `promotion`
- **`crudRoutes` option `validate: { create, update }`**
- **adopt แล้ว:** `/auth/register`+`/login` · `/shop/orders`(POST+GET) · `/shop/cart/items`(+`/[id]`) ·
  `/shop/payments`(+`/[id]/slip`) · `/admin/{units,product-categories,banners,ingredients,ingredient-categories,component-categories,expenses}`(+`/[id]`) · `/admin/promotions`(POST+PATCH)
- **ยังไม่ adopt:** recipes (BOM ซ้อน) · product-options/variants · aspects/semantic-terms/reviews/attendances · shop reviews/addresses/me · admin orders (custom) · **รื้อ `pick()`/`Number()` ใน service**

---

## §3 D2 — security → [`security-hardening.md`](security-hardening.md) (PR #7)

| # | สรุป |
|---|---|
| **3.2** rate-limit | `src/lib/rateLimit.ts` — in-memory sliding window → `tooMany()` **429** + `retry_after_seconds` · wire: `auth/login` 10/นาที · `register` 5 · `google` 10 · `me/password` 5 (ต่อ IP, ทับ account-lockout) · `httpError` +`tooMany()`/`TOO_MANY_REQUESTS` · **หมายเหตุ:** in-memory → หลาย instance ต้องเปลี่ยนเป็น Redis (แก้ไฟล์เดียว) |
| **3.9** Google flow | `loginWithGoogle` = ID-token flow (jose verify sig/iss/aud/exp ครบ) + เพิ่มเช็ค `email_verified === false` → reject · `.env.example` ลบ `GOOGLE_CLIENT_SECRET`/`CALLBACK_URL` |
| **3.10** CORS/CSRF | `src/lib/csrf.ts` `isCsrfSafe()` + `middleware.ts` block mutation ที่ Origin ข้ามโดเมน → **403** (เสริม cookie `SameSite=Lax`) · CORS: ยืนยัน same-origin (ไม่ส่ง `Access-Control-Allow-*`) |

---

## §3 D3 — consistency / robustness → [`hardening-d3-plan.md`](hardening-d3-plan.md)

### 3.3b Compensation `Saga` (PR #8, #9, #11)
- `src/lib/compensation.ts` — class `Saga`: `onRollback(label, undo)` / `rollback()` (undo **ย้อนลำดับ** best-effort — step ที่ fail → `log.error("saga.rollback_step_failed")`) / `commit()`
- **adopt:** `preorderService.createPreorder` · `orderService.persistOrder` · `orderService.updateOrderStatus` (cancel branch)
- แทน nested try/catch + `if (order?._id)` + `.catch(() => undefined)` ที่กลืน error เงียบ
- validate ด้วย integration test (`persistOrder` compensation, `cancelOrder`)

### 3.7 Response envelope (PR #10) — ⚠️ **BREAKING** → [`api-conventions.md`](api-conventions.md) §2
- มาตรฐาน: list endpoint ทุกตัว → `data = { items, meta | null }`
- `apiResponse.okList(items, meta?)` + `PageMeta` type
- **7 endpoint เปลี่ยนรูป `data`:** `catalog/banners` · `catalog/units` · `catalog/products/[id]/variants` · `.../options` · `admin/preorder-rounds/[id]/items` (array → `.items`) · `catalog/products` · `admin/products` (`.pagination` → `.meta`)
- endpoint อื่นที่เป็น `{ items, meta }` อยู่แล้ว = ไม่แตะ

### `docs/api-conventions.md` (PR #10) — เอกสารอ้างอิงถาวร
envelope · list · HTTP status ↔ `error.code` · zod `details.issues` · auth · query params · soft delete

---

## §3.5 — audit log (นอกชุด D) → [`auditLog.md`](auditLog.md)

`src/lib/audit.ts` — `audit(req, {...})` fire-and-forget · wire เข้า mutation สำคัญแล้ว:
ออเดอร์ (สร้าง/เปลี่ยนสถานะ/จัดส่ง/ลบ/ลูกค้ายกเลิก) · payment (verify/refund/ลบ) ·
สต็อก (ingredient transaction, product stock PUT/PATCH) · สิทธิ์ (permission/role/user CRUD + ปลดล็อก/ตั้งรหัสผ่าน) ·
การผลิต (start/complete/cancel + consume/reverse) · แคตตาล็อก (product + recipe/component/ingredient/promotion/expense ผ่าน `crudRoutes` option `audit: { entity }`)
**ยังไม่ครอบ:** unit/หมวดหมู่/banner/variant/option/aspect/semantic-term · shop payment create/slip · before/after snapshot

---

## รอบ 4a — ปิด infra (✅ core เสร็จ, PR #13–#17) → [`hardening-4a-plan.md`](hardening-4a-plan.md)

| ข้อ | ทำแล้ว | PR |
|---|---|---|
| **CI pipeline** | `.github/workflows/ci.yml` — typecheck/typecheck:test/lint/test/test:integration/build ทุก push+PR (Node 22, cache mongo binary) | #13 |
| **3.6 lint gate** | ลบ `eslint.ignoreDuringBuilds` · `no-explicit-any` `off`→`warn` ทั้ง repo + `error` บน `src/schemas`+`tests` · เก็บ warning `no-anonymous-default-export` | #14 |
| **3.1 zod — crud-factory** | `product-options`/`product-variants`/`aspects`/`semantic-terms`/`roles` (#15) · `components`/`recipes` BOM (#16) — schema `catalog`/`sentiment`/`rbac`/`bom.ts` | #15 #16 |
| **3.1 zod — shop custom routes** | `PATCH /shop/me` · `POST/PATCH /shop/addresses` · `POST/PATCH /shop/reviews` — schema `user`/`address`/`review.ts` | #17 |
| **createInject** | `collectionRoutes` option ใหม่ → `components`/`recipes` `created_by` inject จาก session (ไม่รับจาก body) | #17 |

test: unit 91→**115** / 15 ไฟล์ · lint = **0 error / 13 warning** (`no-explicit-any` ใน `src/app/api/**/route.ts` + `crudRoutes.ts`)

---

## รอบ 4b — จบ §3.1 + §3.6 (✅ เสร็จสมบูรณ์, PR #20–#21) → [`hardening-4b-plan.md`](hardening-4b-plan.md)

| ข้อ | ทำแล้ว | PR |
|---|---|---|
| **A. zod tail** | `/admin/orders` (POST) + `/admin/attendances` (4 route) + อีก 5 กลุ่ม route ที่พบว่ายังไม่ adopt ระหว่างทำ B2 (`.../delivery`, `/admin/permissions`, `/admin/preorder-rounds*`+`preorder-round-items`, `/admin/users`) | #20 #21 |
| **B. รื้อ `pick()`** | ปิดครบ **8/8 service** ที่เคย whitelist ซ้ำกับ zod — บทเรียนสำคัญ: ต้องเช็คการ adopt เป็น**ต่อฟังก์ชัน**ไม่ใช่ต่อไฟล์ | #20 #21 |
| **C. `no-explicit-any` = error บน `src/lib`** | 5 ไฟล์ (`refs`/`discountEngine`/`crudService`/`bom`/`crudRoutes`) — ไม่เหลือ `any` เลยสักจุด ไม่ต้อง disable-next-line ที่ไหนเลย | #20 #21 |

test: unit 137→**149** / 17 ไฟล์ · lint = **0 error / 5 warning** (ลดจาก 13 — เหลือแต่ใน route layer)

## §2b — บั๊ก preorder payment/cancellation (✅ เสร็จ 4/4, PR #19) → [`preorder-payment-hardening.md`](preorder-payment-hardening.md)

พบจาก code review เต็ม `src/services/` ไล่เทียบ `preorderService`/`paymentService` กับ `orderService`
ที่ path คู่ขนานผ่าน hardening §2 มาแล้ว — preorder ไม่เคยได้ fix ตามเลย รวมช่องโหว่ IDOR 1 ข้อ
(สร้าง payment ผูกกับพรีออเดอร์คนอื่นได้) + data-integrity 3 ข้อ (ไม่ auto-confirm/auto-refund/customer
cancel guard) — เทสใหม่ 9 เคส

## §2c — บั๊กความทนทาน/correctness เล็ก (✅ เสร็จ 2/4 ที่เป็นบั๊กจริง, PR #22) → [`order-cart-inventory-robustness.md`](order-cart-inventory-robustness.md)

`clearCart` ไม่กัน error หลัง order commit แล้ว · `voidTransaction` ย้อนรายการ `receive` ไม่มี floor
guard (ค่าติดลบได้) — อีก 2 ข้อที่พบพร้อมกัน (double-credit risk เชิงสถาปัตยกรรม, `recordUsage` swallow
error) เป็น known-risk/tradeoff ที่ตั้งใจไว้แล้ว ไม่ใช่บั๊กที่ต้องรีบแก้

## รอบ 4c — feature เล็ก + เทสเพิ่ม (✅ เสร็จสมบูรณ์, PR #23–#25) → [`hardening-4c-plan.md`](hardening-4c-plan.md)

| ข้อ | ทำแล้ว | PR |
|---|---|---|
| **3.8** address_id → checkout | `oneOf(address_id, delivery_address)` + `addressService.resolveDeliverySnapshot()` — ไม่แตะ `orderService` เลย | #23 |
| ~~**3.12** `src/lib/notify.ts`~~ | ล้าสมัย — ระบบแจ้งเตือนจริง (`notificationService.ts`+LINE) ถูกสร้างและ wire เสร็จแล้วก่อนหน้านี้ | — |
| **3.16** `purchase_cost` | field ใหม่ใน `productModel` + fallback ใน `getUnitCostByProduct` เมื่อไม่มีสูตร (แก้ COGS/กำไรใน dashboard ที่เคยนับเป็น 0 เงียบ ๆ) | #24 |
| **3.4** integration test เพิ่ม | `cartService`/`ingredientTransactionService`/`deliveryService.quoteForCart` (19 เคสใหม่) | #25 |

test: unit **155** / integration 27→**56** · lint = **0 error / 5 warning** (ไม่เปลี่ยนจาก 4b)

---

## รอบ 4d — object storage + ลบรูปที่ไม่ใช้ + delivery zone เป็น DB (✅ เสร็จสมบูรณ์, PR #28) → [`hardening-4d-plan.md`](hardening-4d-plan.md)

| ข้อ | ทำแล้ว | PR |
|---|---|---|
| **3.13** object storage abstraction | `upload.ts` เป็น `UploadDriver` interface — `localDisk` ดีฟอลต์ (พฤติกรรมเดิมทุกประการ) + `s3` (S3-compatible, lazy import) เลือกผ่าน env `UPLOAD_DRIVER` · ถอน `multer` ที่ไม่เคยถูกใช้ | #28 |
| **3.14** ลบรูปสินค้าที่ไม่ใช้ | `updateProduct` diff รูปเก่า/ใหม่แล้วลบเฉพาะที่หายไป · `hardDeleteProduct` ลบทั้งหมด (soft delete ไม่ลบ — ยัง restore ได้) | #28 |
| **3.15** delivery zone เป็น DB | `deliveryZoneModel`+`deliveryZoneService` (cache TTL invalidate ทันทีตอนแก้) + `/api/admin/delivery-zones` · `calcDeliveryFee` เป็น async เช็ค DB ก่อน fallback env เดิมถ้ายังไม่ตั้งค่า | #28 |

test: unit 155→**163** / integration 56→**79** · ก่อนลงมือ 3.13 ถามผู้ใช้เรื่องแผน hosting ก่อน (ไม่เดา) — เลือกทำแบบเผื่ออนาคต (`localDisk` ดีฟอลต์ + `s3` driver พร้อมใช้เมื่อจำเป็น)

---

## รอบ 5 — เงินเป็น integer (สตางค์) — 🟡 เฟส 2/5 (2026-09-12) → [`hardening-5-money-phase1.md`](hardening-5-money-phase1.md)

สำรวจก่อนลงมือพบเงินกระจายใน 17 model — แบ่งเป็น 5 เฟสตามโดเมนที่ผูกกันจริงทางโค้ด (ทำทีเดียวเสี่ยงเกิน
รีวิวไหว) ถามผู้ใช้เรื่อง API contract ก่อน: **DB เก็บสตางค์ แต่ API ยังบาททศนิยมเหมือนเดิม** (ไม่ breaking)

| เฟส | ขอบเขต | สถานะ |
|---|---|---|
| 1 | Order+OrderItem+Preorder+PreorderItem+Payment+PromotionUsages+dashboardService | ✅ เสร็จ |
| 2 | Expense (`expenseModel.amount`) | ✅ เสร็จ |
| 3 | Delivery zone (`deliveryZoneModel.fee`) | ⬜ |
| 4 | Recipe/Component/Ingredient cost (+ `cost_per_unit` ที่ปล่อยเป็นบาทไว้ในเฟส 1) | ⬜ |
| 5 | Promotion definition + Product pricing (`product_price`/`variant_price`/`extra_price`/`cartItemModel`) | ⬜ |

เฟส 1 ต้องรวม order+preorder เข้าด้วยกันเพราะ `paymentModel` เป็น collection กลางที่ใช้ร่วมกัน (แยกแปลง
ไม่ได้ — จะกำกวมว่า doc ไหนหน่วยอะไร) · migration script `npm run migrate:money-to-satang` · เจอ+แก้บั๊ก
ใน `tests/integration/setup.ts` ไปด้วย (afterEach เดิมไม่เคลียร์ raw collection ที่ไม่ผ่าน mongoose model)

เฟส 2 (Expense) โดดเดี่ยวตามคาด — `dashboardService` ไม่ต้องแก้เลยสักบรรทัด แต่**เจอบั๊กสำคัญ**ใน
migration script เอง: marker เดิมเป็นก้อนเดียวทั้งไฟล์ ถ้า DB เคยรันเฟส 1 ไปแล้วจะข้ามทั้งไฟล์รวมถึง
`expenseModel` ที่เพิ่งเพิ่มมาด้วย (เงียบ ไม่มี error) — แก้เป็น marker แยกต่อ collection ก่อน merge

test unit 163→171→**171** (ไม่เปลี่ยนจาก money.test.ts) / integration 82→**89**

---

## ที่เหลือ (ยังไม่ทำ)

> **ลำดับ → [`BACKLOG.md`](BACKLOG.md) §3 "ลำดับการแก้ที่เหลือ"** — รอบ 4b/4c/4d ปิดครบแล้ว, รอบ 5
> (3.11) เหลือ 3 เฟสจาก 5 (ดูตารางด้านบน)

### §1 Blockers — ขั้น deploy (ไม่ใช่โค้ด)
`npm run seed` · `npm run backfill:product-codes` · MongoDB `product_type` เดิม → `inStore` ·
ลบ payment `pending` ซ้ำ · `npm run sync-indexes` · สุ่ม production secret ใหม่ (ตั้งผ่าน env host)

---

## ดัชนีเอกสาร (`docs/`)

| ไฟล์ | เนื้อหา |
|---|---|
| [`BACKLOG.md`](BACKLOG.md) | master tracker — สถานะทุกข้อ §1–§8 |
| [`hardening-summary.md`](hardening-summary.md) | **ไฟล์นี้** — สรุป §2 + §3 พร้อม PR/ลิงก์ |
| [`api-conventions.md`](api-conventions.md) | มาตรฐาน response / status / list / auth / query |
| [`data-integrity-fixes.md`](data-integrity-fixes.md) | §2.8–2.11 เชิงลึก |
| [`reprice.md`](reprice.md) · [`promo-freeshipping.md`](promo-freeshipping.md) · [`order-cancel.md`](order-cancel.md) · [`concurrency-guards.md`](concurrency-guards.md) | §2.5 / §2.6+2.11 / §2.7+2.8 / §2.9+2.10 |
| [`preorder-payment-hardening.md`](preorder-payment-hardening.md) | §2b — IDOR + auto-refund/auto-confirm พรีออเดอร์ (PR #19) |
| [`order-cart-inventory-robustness.md`](order-cart-inventory-robustness.md) | §2c — clearCart error handling + voidTransaction floor guard (PR #22) |
| [`hardening-plan.md`](hardening-plan.md) | แผน §3 ทั้งหมด (D1–D4) |
| [`hardening-d3-plan.md`](hardening-d3-plan.md) | §3.7 envelope + §3.3b compensation (D3.1–D3.6 + D3.4b) |
| [`hardening-4a-plan.md`](hardening-4a-plan.md) | รอบ 4a — CI + 3.6 lint gate + 3.1 crud-factory/shop routes (PR #13–#17) |
| [`hardening-4b-plan.md`](hardening-4b-plan.md) | รอบ 4b — zod tail ครบ (`/admin/orders`+อีก 5 กลุ่ม) · รื้อ `pick()` 8/8 · `no-explicit-any` บน `src/lib` (PR #20–#21) |
| [`hardening-4c-plan.md`](hardening-4c-plan.md) | รอบ 4c — address_id→checkout · purchase_cost · integration test เพิ่ม (+ §0 บทเรียนเรื่อง §2b/§2c ที่เคยรายงานผิดว่า merge แล้ว) (PR #23–#25) |
| [`hardening-4d-plan.md`](hardening-4d-plan.md) | รอบ 4d — object storage abstraction · ลบรูปที่ไม่ใช้ · delivery zone เป็น DB (PR #28) |
| [`hardening-5-money-phase1.md`](hardening-5-money-phase1.md) | รอบ 5 §3.11 เฟส 1-2 — เงินเป็นสตางค์: Order+Preorder+Payment+Expense · แผนเฟสที่เหลือ |
| [`infra-tooling.md`](infra-tooling.md) | §3.6 eslint · §3.3 logger · §3.4 testing |
| [`validation.md`](validation.md) | §3.1 zod — สถานะ adopt ราย route |
| [`security-hardening.md`](security-hardening.md) | §3.2 rate-limit · §3.9 Google · §3.10 CSRF |
| [`Summary.md`](Summary.md) · [`env.md`](env.md) · [`auditLog.md`](auditLog.md) · [`preorder.md`](preorder.md) | สูตรเงิน · env vars · audit log · preorder |
