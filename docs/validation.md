# Validation layer (zod) — BACKLOG §3.1

> อัปเดตล่าสุด: 2026-09-11
> ที่มา: [`BACKLOG.md`](BACKLOG.md) §3.1 · แผน: [`hardening-plan.md`](hardening-plan.md) เฟส D1 · PR #6
> สถานะ: 🟡 infra + `crudRoutes` option `validate` + adopt `/auth/*` · `/shop/{orders,cart,payments}` · admin CRUD หลัก + `/admin/promotions` เสร็จ — เหลือ route รอง + รื้อ `pick()`/`Number()` ใน service (ดู §3)

---

## 1. ปัญหาเดิม

ทุก route รับ input ดิบ: `const body = await req.json()` → เช็คเอง `if (!body.x) throw badRequest(...)`
- `req.json()` throw แบบไม่สวยเมื่อ body ว่าง → 500 แทน 400
- ไม่เช็ค type/รูปแบบ (`quantity: "3"` string หลุดถึง service · `sp.get("x") as SomeEnum` แค่ assertion)
- error ไม่บอกว่า field ไหนผิด → frontend โชว์ใต้ช่องกรอกไม่ได้
- service ต้องทำ whitelist (`pick`) + coerce (`Number(...)`) ซ้ำทุกไฟล์

---

## 2. โครงสร้าง

### `src/lib/validate.ts`
```ts
parseBody(req, schema)   // parse req.json() → throw badRequest(400, { issues }) ถ้าไม่ผ่าน
parseQuery(sp, schema)   // parse URLSearchParams (ใช้คู่ z.coerce.*)
parse(value, schema)     // parse ค่าที่ resolve เอง เช่น params ของ dynamic route
```
- fail = `throw badRequest("...", { issues })` → เข้าทาง `apiResponse.route()` / `withAuth()` เดิม
  → `toErrorResponse` ห่อเป็น envelope มาตรฐาน **ไม่ต้องแก้ `apiResponse.ts`**
- `issues` = `{ path, message, code }[]` — frontend map ไปแต่ละ field ได้

**รูปแบบ error ที่ client ได้:**
```json
{ "success": false, "error": {
  "code": "BAD_REQUEST", "message": "ข้อมูลที่ส่งมาไม่ผ่านการตรวจสอบ",
  "details": { "issues": [
    { "path": "email", "message": "อีเมลไม่ถูกต้อง", "code": "invalid_format" },
    { "path": "password", "message": "รหัสผ่านอย่างน้อย 8 ตัวอักษร", "code": "too_small" }
  ] } } }
```

### `src/schemas/`
- `common.ts` — ชิ้นที่ใช้ซ้ำ: `objectId`, `phone`, `deliveryAddress`, `pageQuery`, `sortQuery`, `nonEmpty(max)`
- `<domain>.ts` — `auth.ts` · `order.ts` · `cart.ts` · `payment.ts` · `catalog.ts` (unit/หมวดหมู่/banner) · `expense.ts` · `inventory.ts` (ingredient) · `promotion.ts`
- export `type X = z.infer<typeof xSchema>` ไปใช้ที่ route (ไม่ต้องเขียน interface ซ้ำ)
- schema ที่มี cross-field `.refine()` (`order`, `payment`, `promotion`) → `.partial()` ไม่ได้ตรง ๆ → แยก `base` object ไว้ทำ `promotionUpdate = base.partial()` (PATCH ข้าม refine ข้ามฟิลด์ — service ตรวจซ้ำ)

### `crudRoutes` factory — option `validate`
```ts
// src/app/api/admin/units/route.ts
export const { GET, POST } = collectionRoutes(unitService, {
  ...,
  validate: { create: unitCreate },     // parse body ของ POST
});
// src/app/api/admin/units/[id]/route.ts
export const { GET, PATCH, DELETE } = itemRoutes(unitService, {
  ...,
  validate: { update: unitUpdate },     // ปกติ = createSchema.partial()
});
```
- ไม่ใส่ `validate` = พฤติกรรมเดิม (`req.json().catch(() => ({}))` → service ตรวจ)
- ใส่แล้ว = `parseBody` (บาด JSON / schema ผิด → 400 + issues) ก่อนถึง service
- adopt แล้ว (collection + item): `units`, `product-categories`, `banners`, `ingredients`, `ingredient-categories`, `component-categories`, `expenses` · ที่เหลือแค่เพิ่ม schema + บรรทัด `validate` ในไฟล์ route (ดูตาราง §3)

### รูปแบบ adopt ที่ route
```ts
// ก่อน
const body = await req.json();
for (const f of ["email","password"]) if (!body?.[f]) throw badRequest(...);

// หลัง
import { parseBody } from "@/lib/validate";
import { loginBody } from "@/schemas/auth";
const { email, password } = await parseBody(req, loginBody);   // มี type + normalize (trim/lowercase) แล้ว
```

---

## 3. สถานะการ adopt

| route | สถานะ | schema |
|---|---|---|
| `POST /api/auth/register` | ✅ | `auth.registerBody` (email trim+lowercase, password ≥8, phone `^0\d{8,9}$`) |
| `POST /api/auth/login` | ✅ | `auth.loginBody` |
| `POST /api/shop/orders` | ✅ | `order.createOrderBody` — `source` default `"cart"`, refine (promo อย่างใดอย่างหนึ่ง, `source=items`→ต้องมี items) |
| `GET /api/shop/orders` | ✅ | `order.listOrderQuery` (เฉพาะ enum · page/limit/sort ยังใช้ `parsePagination`/`parseSort`) |
| `POST /api/shop/cart/items` · `PATCH /api/shop/cart/items/[id]` | ✅ | `cart.addCartItemBody` / `cart.updateCartItemBody` (+ `parse(id, objectId)`) |
| `POST /api/shop/payments` · `GET` · `PATCH .../[id]/slip` | ✅ | `payment.createPaymentBody` (xor order/preorder), `listPaymentQuery`, `submitSlipBody` |
| CRUD via factory — `units`, `product-categories`, `banners` | ✅ | `crudRoutes` option `validate: { create, update }` + `catalog.ts` |
| CRUD via factory — `ingredients`, `ingredient-categories`, `component-categories`, `expenses` | ✅ | `inventory.ts` / `catalog.ts` / `expense.ts` |
| `/api/admin/promotions` POST + `[id]` PATCH (custom route) | ✅ | `promotion.ts` — `parseBody` ตรง (refine: end≥start, Percentage ≤100) |
| CRUD via factory — ที่เหลือ (`recipes`, `product-options`, `product-variants`, `aspects`, `semantic-terms`, `reviews`, …) | ⬜ | เพิ่ม schema + บรรทัด `validate` (option พร้อมแล้ว) · recipes มี BOM ซ้อน — ต้องออกแบบ schema เพิ่ม |
| `POST/PATCH /api/admin/orders*` (custom route) | ⬜ | `order.ts` (admin variant — รับ `delivery_fee`/`discount_amount` override ได้) |
| `/api/admin/attendances`, `/api/shop/reviews`, `/api/shop/addresses`, `/api/shop/me` ฯลฯ | ⬜ | ทยอย |
| รื้อ `pick()` / `Number()` ใน service | ⬜ | หลัง adopt ครบ — ให้ zod เป็นด่านเดียว, service เหลือแค่ business rule |

---

## 4. เกณฑ์ที่ใช้

| ประเด็น | ที่เลือก |
|---|---|
| zod เป็นเจ้าของ shape แทน `pick()` ใน service | **ทำทีหลัง** — adopt route ให้ครบก่อน แล้วค่อยรื้อ whitelist (service ยังเช็ค business rule: ของมีจริง, สถานะถูก) |
| key แปลกปลอมใน body | zod strip (default, ทิ้งเงียบ) สำหรับ `/shop` · จะพิจารณา `.strict()` (400) สำหรับ `/admin` |
| `queryParams.ts` เดิม (`parsePagination`/`parseSort`) | เก็บไว้ (ใช้เยอะ) · zod เสริมเฉพาะ query ที่ซับซ้อน · `common.pageQuery`/`sortQuery` = ตัวช่วยสำหรับ route ที่อยาก parse ด้วย zod ล้วน |
| zod version | v4 (`z.email()`, `z.coerce`, `z.record(key, val)`, `.pipe()`) |

---

## 5. เทส

- `tests/lib/validate.test.ts` — `parseBody` (ผ่าน / body ไม่ใช่ JSON → 400 / ไม่ผ่าน schema → 400 + issues paths),
  `parseQuery` (coerce + default + enum fail), `schemas/auth` (normalize email, password สั้น, อีเมลผิด)
- `tests/lib/schemas.test.ts` — `order` (source default, items required, promo xor, enum), `cart` (objectId, quantity),
  `payment` (order/preorder xor, amount > 0, slip ห้ามว่าง)
- `tests/lib/catalog.test.ts` — `unit` (enum, required, update partial), `productCategory`, `banner` (required, `start_date` coerce/reject)
- `tests/lib/schemas-admin.test.ts` — `expense` (enum, amount ≥0), `ingredient` (ObjectId ref, `current_stock` omit ใน update), `promotion` (end≥start, Percentage ≤100), ingredient/component category

ไฟล์เทสฝั่ง validation = `validate`, `schemas`, `catalog`, `schemas-admin` (4 ไฟล์)
รวมทั้ง suite ปัจจุบัน: `npm test` = **91 passed / 12 ไฟล์** · `npm run test:integration` = **13 / 3 ไฟล์** (ดู [`hardening-summary.md`](hardening-summary.md) §3.4)
