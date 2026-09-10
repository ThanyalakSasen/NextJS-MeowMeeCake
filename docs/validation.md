# Validation layer (zod) — BACKLOG §3.1

> อัปเดตล่าสุด: 2026-09-10
> ที่มา: [`BACKLOG.md`](BACKLOG.md) §3.1 · แผน: [`hardening-plan.md`](hardening-plan.md) เฟส D1
> สถานะ: 🟡 infra + adopt นำร่อง (`/api/auth/*`) เสร็จ — ทยอย adopt route ที่เหลือ

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
- `<domain>.ts` — schema ต่อโดเมน วางคู่กับ service เช่น `auth.ts`, (ต่อไป) `order.ts`, `cart.ts`, `payment.ts`
- export `type X = z.infer<typeof xSchema>` ไปใช้ที่ route (ไม่ต้องเขียน interface ซ้ำ)

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
| `POST /api/auth/register` | ✅ | `registerBody` (email trim+lowercase, password ≥8, phone `^0\d{8,9}$`) |
| `POST /api/auth/login` | ✅ | `loginBody` |
| `POST /api/shop/orders` (+ GET query) | ⬜ ต่อไป | `order.ts` — `discriminatedUnion("source", ...)` |
| `POST /api/shop/cart/items` · `PATCH .../[id]` | ⬜ | `cart.ts` |
| `POST /api/shop/payments` · `.../slip` | ⬜ | `payment.ts` |
| `POST/PATCH /api/admin/orders*` | ⬜ | `order.ts` (admin variant) |
| CRUD ทั่วไป (units, categories, banners, …) | ⬜ | เพิ่ม option `validate` ใน `crudRoutes` factory |

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

`tests/lib/validate.test.ts` — `parseBody` (ผ่าน / body ไม่ใช่ JSON → 400 / ไม่ผ่าน schema → 400 + issues paths),
`parseQuery` (coerce + default + enum fail), `schemas/auth` (normalize email, password สั้น, อีเมลผิด)
