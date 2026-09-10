# สรุปงาน Backend hardening — §2 + §3 (2026-09-07 → 2026-09-11)

> อัปเดตล่าสุด: 2026-09-11
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
| **§3 D4 — feature/ops** (3.8 · 3.12–3.16) | ⬜ หลัง launch | — |
| **§3 3.11 เงินเป็น integer** | ⬜ งานเดี่ยว | — |

ทุก PR merge เข้า branch `addModels` · ทุก commit ผ่าน `typecheck` · `typecheck:test` · `lint` · `test` (unit) · `test:integration` · `build`

**ลำดับที่ทำจริง** = ตามแผน [`hardening-plan.md`](hardening-plan.md) §ลำดับที่แนะนำ:
D1 (3.6 → 3.3 → 3.4 → 3.1 infra) → D2 (3.2 → 3.9 → 3.10) →
D3 (**3.3b compensation → integration test → 3.7 envelope** ตาม [`hardening-d3-plan.md`](hardening-d3-plan.md)) → 3.5 audit log

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

## ที่เหลือ (ยังไม่ทำ)

> **ลำดับที่แนะนำสำหรับงานที่เหลือ → [`BACKLOG.md`](BACKLOG.md) §3 "ลำดับการแก้ที่เหลือ"**
> รอบ 4a (CI → 3.6 cleanup → 3.1 adopt เพิ่ม) · รอบ 4b (3.8 · 3.12 · 3.16 · integration test เพิ่ม) · รอบ 4c (3.13→3.14 · 3.15) · รอบ 5 (3.11)

### §3.1 zod — adopt เพิ่ม
recipes / product-options / product-variants / aspects / semantic-terms / reviews / attendances ·
shop reviews/addresses/me · admin orders (custom route) · **รื้อ `pick()` / `Number()` ใน service** (ให้ zod เป็นด่านเดียว)

### §3.4 integration test — เพิ่ม
`cartService` · `ingredientTransactionService` · `deliveryService.quoteForCart` · **CI pipeline**
(`typecheck → typecheck:test → lint → test → test:integration → build`)

### §3.6 — เก็บงานค้าง
เปิด `@typescript-eslint/no-explicit-any` (pass แยก, ไล่ใส่ type ให้ `.lean<T>()`) → ลบ `/* eslint-disable */` เหมาไฟล์ →
เปิด `reportUnusedDisableDirectives` กลับ → เปิด type-aware `no-floating-promises` → ลบ `eslint.ignoreDuringBuilds`

### §3 D4 — หลัง launch → [`hardening-plan.md`](hardening-plan.md) §4
3.8 address→checkout · 3.12 `notify.ts` (LINE) · 3.13 object storage → 3.14 ลบรูปที่ไม่ใช้ ·
3.15 delivery zone เป็น DB · 3.16 `purchase_cost`

### §3.11 — งานเดี่ยว
เก็บเงินเป็น integer (สตางค์) · branch แยก · ต้องมี integration test ครอบ + freeze feature อื่น

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
| [`hardening-plan.md`](hardening-plan.md) | แผน §3 ทั้งหมด (D1–D4) |
| [`infra-tooling.md`](infra-tooling.md) | §3.6 eslint · §3.3 logger · §3.4 testing |
| [`validation.md`](validation.md) | §3.1 zod — สถานะ adopt ราย route |
| [`security-hardening.md`](security-hardening.md) | §3.2 rate-limit · §3.9 Google · §3.10 CSRF |
| [`hardening-d3-plan.md`](hardening-d3-plan.md) | §3.7 envelope + §3.3b compensation (D3.1–D3.6 + D3.4b) |
| [`Summary.md`](Summary.md) · [`env.md`](env.md) · [`auditLog.md`](auditLog.md) · [`preorder.md`](preorder.md) | สูตรเงิน · env vars · audit log · preorder |
