# แผนงาน §3 — คุณภาพ / hardening (ชั้น D)

> อัปเดตล่าสุด: 2026-09-11
> ที่มา: [`BACKLOG.md`](BACKLOG.md) §3 · เป้าหมาย: จัดลำดับ + ระบุวิธี/ไฟล์/effort/ความเสี่ยง
>
> **สถานะ (2026-09-11):** ✅ **D1** (3.6/3.3/3.4/3.1-infra) · ✅ **D2** (3.2/3.9/3.10) · ✅ **D3** (3.3b/integration test/3.7)
> ⬜ เหลือ: 3.1 adopt เพิ่ม + รื้อ `pick()` · D4 (3.8/3.12–3.16) · 3.11 · CI
> สรุปงานที่ทำแล้วทั้งหมด + PR → [`hardening-summary.md`](hardening-summary.md)

**effort:** S ≤ ครึ่งวัน · M ≤ 1–2 วัน · L > 2 วัน (ควรแตกเป็นงานย่อย)

---

## ภาพรวม — จัดกลุ่ม 15 ข้อ

| กลุ่ม | ข้อ | ทำไมจัดกลุ่มนี้ |
|---|---|---|
| **A · Infra / tooling** | 3.6 eslint · 3.3 logger · 3.4 test · 3.1 zod | เป็นฐานให้ข้ออื่น — ทำก่อนได้กำไรทบต้น |
| **B · Security (ก่อน production)** | 3.2 rate-limit login · 3.10 CORS/CSRF · 3.9 Google flow | กันช่องโหว่ที่เปิดสู่ภายนอก |
| **C · Consistency / robustness** | 3.7 response envelope · 3.3 compensation · 3.11 เงินเป็น integer | ความถูกต้อง/คาดเดาได้ของ API |
| **D · Feature / ops (หลัง launch ได้)** | 3.8 address→checkout · 3.12 LINE notify · 3.13 object storage · 3.14 ลบรูป · 3.15 delivery zone DB · 3.16 purchase_cost | ต่อยอดฟีเจอร์ / งาน ops |

---

## เฟส D1 — Infra / tooling (ทำก่อน)

### 3.6 · eslint config — **S**
- **เป้าหมาย:** `next build` เลิก skip lint · จับ unused import / no-floating-promise / no-explicit-any
- **วิธี:** `npm i -D eslint eslint-config-next @typescript-eslint/*` → `eslint.config.mjs` (flat config) extends `next/core-web-vitals` + `next/typescript` · เปิดกฎที่คุ้มค่า: `@typescript-eslint/no-floating-promises` (สำคัญ — โค้ดนี้มี fire-and-forget เยอะ), `no-unused-vars`, `require-await`
- **ไฟล์:** `eslint.config.mjs` (ใหม่), `package.json`
- **ผลพลอยได้:** จับ dead import เช่น `bcrypt` ใน `userModel.ts`, floating promise ใน audit/notify
- **ความเสี่ยง:** ต่ำ · อาจมี warning ค้างเยอะรอบแรก → ตั้ง baseline (`--max-warnings` หรือ disable ทีละกฎ)

### 3.3 · `src/lib/logger.ts` — **S**
- **เป้าหมาย:** แทน `console.error` ที่กระจาย ~20 จุด ด้วย logger เดียว (มี level + context)
- **วิธี:** wrapper บาง ๆ รอบ `pino` (`pino` + `pino-pretty` dev) หรือถ้าไม่อยากเพิ่ม dep → object `{ info, warn, error }` ที่ใส่ timestamp + `JSON.stringify` · export `log` · ให้รับ context object: `log.error("order.refund_failed", { order_id, err })`
- **ไฟล์:** `src/lib/logger.ts` (ใหม่) → ค่อย ๆ แทน `console.error` (grep `console.error` ใน `src/`)
- **ขึ้นกับ:** ไม่มี · **ทำคู่กับ 3.6** (eslint จะช่วยหา console.* ที่ตกหล่น)

### 3.4 · test setup + ชุดแรก — **M**
- **เป้าหมาย:** มี `npm test` + coverage บน logic การเงิน/สต็อก/โปร
- **วิธี:**
  1. `npm i -D vitest mongodb-memory-server @vitest/coverage-v8` + `vitest.config.ts` + script `"test": "vitest"`
  2. **unit (ไม่ต้องมี DB) — เริ่มที่นี่:** `discountEngine` (Percentage/Amount/FreeShipping/reject 0/channel/min) · `productCode` (`generateProductCode`/`isProductCode`) · `deliveryService.calcDeliveryFee`
  3. **integration (mongodb-memory-server):** `orderService.persistOrder` (re-price, snapshot cost, promo atomic claim, compensation) · `promotionUsageService.recordUsage` (usage_limit race, per-user) · `ingredientTransactionService` · `cartService`
  4. helper `tests/setup.ts` — start/stop memory server, `beforeEach` clear collections
- **ไฟล์:** `vitest.config.ts`, `tests/**`, `package.json`
- **ขึ้นกับ:** อยากได้ 3.1 (zod) ก่อนจะได้เทส validation ด้วย แต่ไม่บังคับ
- **ความเสี่ยง:** ต่ำ · แต่ต้องระวัง model ใช้ `mongoose.models.X || model(...)` (cache) — memory server ต้อง connect ก่อน import model หรือ clear ระหว่างเทส

### 3.1 · validation layer (zod) — **M**
- **เป้าหมาย:** validate shape/type ของ body ก่อนถึง service · error message ละเอียด · เลิกพึ่ง `req.json()` ดิบ
- **วิธี:**
  1. `npm i zod` + `src/lib/validate.ts` → `parseBody(req, schema)` / `parseQuery(sp, schema)` ที่ throw `badRequest(msg, { issues })` เมื่อไม่ผ่าน (ต่อกับ `toErrorResponse` เดิม)
  2. schema เก็บใกล้ service: `src/services/orderSchemas.ts` ฯลฯ หรือ `src/schemas/**`
  3. ทยอย adopt: เริ่ม endpoint ที่รับ input ซับซ้อน/เสี่ยง — `POST /api/shop/orders`, `/api/admin/orders`, `/api/shop/cart/items`, `/api/auth/register|login`, `/api/shop/payments`
  4. เพิ่ม option `validate?: { body?: ZodSchema; query?: ZodSchema }` ใน `crudRoutes` factory (`collectionRoutes`/`itemRoutes`) เพื่อครอบ CRUD ทั่วไปทีเดียว
- **ไฟล์:** `src/lib/validate.ts` (ใหม่), `src/lib/crudRoutes.ts`, schema files, route ที่เลือก adopt
- **ขึ้นกับ:** ไม่มี · แต่ **ทำก่อน 3.7/3.8** จะช่วย (address_id, envelope)
- **ความเสี่ยง:** กลาง · ต้องไม่ทำ validation ซ้ำ/ขัดกับ whitelist ใน service เดิม → ให้ zod เป็นด่านแรก, service เลิก re-check type

---

## เฟส D2 — Security (ก่อนขึ้น production)

### 3.2 · rate-limit `/api/auth/login` (+ register/reset) — **S–M**
- **เป้าหมาย:** เพิ่ม IP throttle ทับ account-lockout เดิม (5/15นาที ต่อบัญชี) — กัน credential stuffing ข้ามหลายบัญชีจาก IP เดียว
- **วิธี:**
  - **สั้น (single instance / self-host):** `src/lib/rateLimit.ts` — in-memory sliding window (`Map<key, timestamps[]>` + cleanup) · key = `ip:route` · limit เช่น 10/นาที, 60/ชม. → เกิน = `HttpError 429` (เพิ่ม `tooMany()` ใน `httpError.ts` + จัดการใน `toErrorResponse`)
  - **ถ้ามีหลาย instance / serverless:** ใช้ Upstash Redis (`@upstash/ratelimit`) — เปลี่ยน backend ใน `rateLimit.ts` ที่เดียว
  - เรียกใน login route: `await rateLimit(clientIp(req), "auth:login")` (มี `clientIp` อยู่แล้ว)
- **ไฟล์:** `src/lib/rateLimit.ts` (ใหม่), `src/lib/httpError.ts` (429), `src/lib/apiResponse.ts`, `src/app/api/auth/{login,register}/route.ts`, `.../me/password`
- **ความเสี่ยง:** ต่ำ · ระวัง `clientIp` หลัง proxy (ต้องอ่าน `x-forwarded-for` ตัวแรก — เช็ค `request.ts`)

### 3.10 · CORS / CSRF — **S–M**
- **เป้าหมาย:** ชัดเจนว่ารองรับ same-origin เท่านั้น + กัน CSRF บน mutation
- **วิธี (สมมติ frontend = Next app เดียวกัน = same-origin):**
  - **CORS:** ไม่ต้องเปิด · ถ้าอนาคตแยก origin → เพิ่ม allowlist ใน `middleware.ts` (มี matcher `/api/:path*` อยู่แล้ว) ตอบ `OPTIONS` + `Access-Control-Allow-*` เฉพาะ origin ที่อนุญาต
  - **CSRF:** cookie เป็น `SameSite=Lax` อยู่แล้ว (กัน cross-site form ได้ระดับหนึ่ง) · เสริม: ใน `middleware.ts` สำหรับ method ∈ {POST,PUT,PATCH,DELETE} เช็ค `Origin`/`Referer` host === ตัวเอง ไม่งั้น 403 · (JSON API + ต้อง `Content-Type: application/json` ก็ช่วยกัน form-based CSRF อยู่แล้ว)
- **ไฟล์:** `src/middleware.ts`, (option) `src/lib/session.ts` ตอนตั้ง cookie
- **ขึ้นกับ:** ตัดสินใจสถาปัตยกรรม frontend ก่อน (same-origin ไหม)

### 3.9 · Google login flow — **S (decision + cleanup)**
- **สถานะ:** `loginWithGoogle` รับ ID token จาก Google Identity Services (client-side) — ใช้งานได้จริง
- **แนะนำ:** **คง ID-token flow** (ง่ายกว่า, ไม่ต้อง callback/session state) · แค่:
  - ลบ/แก้ `GOOGLE_CALLBACK_URL` + `GOOGLE_CLIENT_SECRET` ใน `.env.example` ที่ทำให้เข้าใจผิดว่าเป็น code flow
  - เอกสาร frontend: ใช้ `<script src="https://accounts.google.com/gsi/client">` → ส่ง `credential` มาที่ `POST /api/auth/google`
  - ยืนยันฝั่ง server ตรวจ `aud` = `GOOGLE_CLIENT_ID` + `iss` + `exp` (เช็คว่า `authService` ทำครบ)
- **ไฟล์:** `.env.example`, `docs/` (auth), `src/services/authService.ts` (ยืนยันการ verify)

---

## เฟส D3 — Consistency / robustness

### 3.7 · response envelope ให้คงที่ — **S–M**
- **เป้าหมาย:** ทุก list endpoint คืน `data = { items, meta }` เหมือนกัน (ตอนนี้ catalog บางตัวคืน array ตรง ๆ)
- **วิธี:** ไล่ route ที่คืน array — `/api/catalog/banners`, `/catalog/products/[id]/variants`, `.../options`, `/catalog/categories` (บางตัว) — ให้ service คืน `{ items, meta }` หรือ route ห่อ `ok({ items: arr })` · เขียน convention ลง `docs/` + (option) เพิ่ม `okList(items, meta?)` ใน `apiResponse.ts`
- **ไฟล์:** catalog routes + service ที่เกี่ยว, `src/lib/apiResponse.ts`
- **ขึ้นกับ:** ทำหลัง 3.4 (มีเทส regression) จะปลอดภัยกว่า · **breaking change ต่อ frontend** → ประกาศ/ทำพร้อมกัน

### 3.3b · `src/lib/compensation.ts` — **S**
- **เป้าหมาย:** รวม pattern "best-effort rollback" ที่ inline อยู่หลายที่ (`orderService.persistOrder`, `updateOrderStatus`, `preorderService`) เป็น helper เดียว
- **วิธี:** `compensate(steps: Array<() => Promise<void>>)` ที่รันย้อนกลับ + จับ error แต่ละ step ส่งเข้า `logger` · หรือ pattern `Saga`-lite: สะสม undo fn ระหว่างทำ แล้วเรียกตอน catch
- **ไฟล์:** `src/lib/compensation.ts` (ใหม่) → refactor `orderService` / `preorderService`
- **ขึ้นกับ:** 3.3 logger · **ทำหลัง 3.4** (เทสครอบ persistOrder ก่อน refactor)

### 3.11 · เก็บเงินเป็น integer (สตางค์) — **L · เสี่ยงสูง**
- **ปัญหา:** `subtotal`/`discount_amount`/`total_amount`/`unit_price`/`cost_per_unit` เป็น JS float · `round2` ช่วยแสดงผลแต่สะสม error
- **แนะนำ:** **เลื่อนเป็นงานเดี่ยว หลัง launch** — กระทบทุกชั้น + ต้อง migrate ข้อมูลเดิม
- **ถ้าทำ:** field ใหม่เก็บสตางค์ (`*_cents: Int`) · helper `Money` (`toCents`/`fromCents`/`formatTHB`) · แปลงที่ boundary (รับ input บาท → cents, ตอบ → บาท) · migration script คูณ 100 + ปัด · dashboard/report คิดจาก cents
- **ไฟล์:** models (order/orderItem/payment/promotion/expense...), `orderService`, `discountEngine`, `deliveryService`, `dashboardService`, `paymentService`, migration script
- **ความเสี่ยง:** สูงสุดในลิสต์ · ต้องมี 3.4 เทสครอบก่อน + ทำใน branch แยก + freeze feature อื่นชั่วคราว

---

## เฟส D4 — Feature / ops (หลัง launch ได้)

### 3.8 · สมุดที่อยู่เชื่อม checkout — **S–M**
- **วิธี:** `POST /api/shop/orders` + `/api/shop/preorders` รับ `address_id` (นอกจาก `delivery_address` object ดิบ) → ถ้ามี `address_id` → `addressService.getById(userId, id)` แล้ว snapshot ลง order เหมือนเดิม · zod schema: `oneOf([{address_id}, {delivery_address}])`
- **ไฟล์:** `src/services/orderService.ts` (`CreateOrderCommon`, `persistOrder`), `preorderService.ts`, route + schema
- **ขึ้นกับ:** 3.1 zod (ช่วยเยอะ)

### 3.12 · `src/lib/notify.ts` (จุดต่อ LINE) — **S**
- **วิธี:** สร้าง `notify(event, payload)` เป็น **no-op + log** ก่อน · เรียกที่จุดสำคัญ: `paymentService.verifyPayment` (paid), `orderService.updateOrderStatus`, `orderService` auto-refund, `ingredientService` low-stock · ต่อ LINE Messaging API ทีหลังแก้ไฟล์เดียว (env `LINE_*` มีใน `.env.example` แล้ว)
- **ไฟล์:** `src/lib/notify.ts` (ใหม่) + call sites
- **ขึ้นกับ:** 3.3 logger

### 3.13 · อัปโหลด → object storage — **M**
- **วิธี:** abstract `src/lib/upload.ts` เป็น interface `{ put(buf, key) → url, delete(key) }` · impl `localDisk` (ปัจจุบัน) + `s3` (S3/R2/GCS ผ่าน `@aws-sdk/client-s3`) · เลือกด้วย env `UPLOAD_DRIVER` · ถอน `multer` ที่ไม่ได้ใช้ออกจาก `package.json`
- **ไฟล์:** `src/lib/upload.ts`, `src/app/api/admin/products/images/route.ts`, `.env.example`, `package.json`
- **ขึ้นกับ:** ตัดสินใจ hosting (self-host → ข้ามได้ / serverless → จำเป็น)

### 3.14 · ลบรูปสินค้าที่ไม่ใช้ — **S**
- **วิธี:** ตอน `updateProduct` เปลี่ยน `product_img` หรือ `deleteProduct` → เรียก `upload.delete(oldKey)` best-effort · (option) cron กวาดไฟล์กำพร้าใน `public/uploads/products/` เทียบกับ DB
- **ไฟล์:** `src/services/productService.ts`, `src/lib/upload.ts` (มี `delete` จาก 3.13)
- **ขึ้นกับ:** 3.13 (interface มี `delete`)

### 3.15 · delivery zone เป็น DB — **M**
- **วิธี:** model `deliveryZone` (`{ name, match_type: "province"|"zipcode"|"district", values[], fee, free_min }`) + admin CRUD `/api/admin/delivery-zones` · `deliveryService.calcDeliveryFee` อ่านจาก DB (cache ในหน่วยความจำ + TTL) fallback เป็น config เดิมถ้าตารางว่าง
- **ไฟล์:** `src/models/deliveryZoneModel.ts`, `src/services/deliveryService.ts`, routes ใหม่, seed
- **ขึ้นกับ:** ไม่มี · แยกอิสระ

### 3.16 · `purchase_cost` สำหรับสินค้าซื้อมาขายต่อ — **S**
- **วิธี:** เพิ่ม field `productModel.purchase_cost` (Number, default null) · `recipeService.getUnitCostByProduct` → เมื่อไม่มีสูตร ให้ fallback ไป `product.purchase_cost` แทน `null` · dashboard COGS ใช้ได้เลย
- **ไฟล์:** `src/models/productModel.ts`, `src/services/recipeService.ts`, `productService` (validation/whitelist), (option) เพิ่มใน backfill
- **ความเสี่ยง:** ต่ำ · ต้นทุนระดับ variant ยังไม่ทำ (แยก ticket)

---

## ลำดับที่แนะนำ

```
1. 3.6 eslint            (S)  ── ทำเลย ได้กำไรทันที
2. 3.3 logger            (S)  ── คู่กับ 3.6
3. 3.4 test setup + unit (M)  ── ปลดล็อกการ refactor อย่างปลอดภัย
4. 3.1 zod (+ crudRoutes) (M)
   ── ครบเฟส D1 ──
5. 3.2 rate-limit login  (S)  ┐
6. 3.9 Google cleanup    (S)  ├─ ก่อน production
7. 3.10 CORS/CSRF        (S)  ┘
   ── ครบเฟส D2 ──
8. 3.4 integration tests (M)  ── ต่อยอดจากข้อ 3
9. 3.7 response envelope (S)  ── พร้อมประกาศ frontend
10. 3.3b compensation.ts (S)
11. 3.8 address→checkout (S)
12. 3.12 notify.ts       (S)
13. 3.16 purchase_cost   (S)
   ── ที่เหลือ = งานใหญ่/ขึ้นกับ infra ภายนอก ──
14. 3.13 object storage  (M)  → 3.14 ลบรูป (S)
15. 3.15 delivery zone DB (M)
16. 3.11 เงินเป็น integer (L) ── งานเดี่ยว branch แยก มีเทสครอบก่อน
```

**ก่อนขึ้น production อย่างน้อยต้อง:** 3.2 · 3.10 · 3.9 (+ §1 blockers ที่ยังค้าง: seed, sync-indexes, secret)
**ทำได้เรื่อย ๆ หลัง launch:** 3.7 · 3.8 · 3.12 · 3.13–3.16
**ต้องวางแผนเฉพาะ:** 3.11 (risky, ต้องมีเทส + freeze)
