# API conventions — MeowMeeCake Backend

> อัปเดตล่าสุด: 2026-09-11
> ครอบ: รูปแบบ response / error / list / auth / query params ของทุก endpoint ใต้ `/api/*`
> ที่มา: BACKLOG §3.7 · [`hardening-d3-plan.md`](hardening-d3-plan.md) D3.5

---

## 1. Response envelope

ทุก response เป็น JSON และมี key `success` เสมอ

### สำเร็จ
```json
{ "success": true, "data": <payload> }
```
- `ok(data)` → 200 · `created(data)` → 201 · `noContent()` → 204 (ไม่มี body)
- `data` เป็นอะไรก็ได้ (object / array / ค่าเดี่ยว) แล้วแต่ endpoint — **ยกเว้น list ดู §2**

### ล้มเหลว
```json
{ "success": false, "error": { "code": "<CODE>", "message": "<ข้อความ>", "details": <any|null> } }
```
- สร้างจาก `toErrorResponse()` ใน `src/lib/apiResponse.ts` — แปลง `HttpError` / Mongoose error / error อื่นให้อัตโนมัติ
- `message` เป็นภาษาไทย เหมาะโชว์ผู้ใช้ · `details` ใช้เสริม (เช่น field ที่ผิด — ดู §4)

---

## 2. List endpoints — `data = { items, meta }`

**กติกาเดียว:** endpoint ที่คืน "รายการ" → `data` เป็น object เสมอ

```json
{
  "success": true,
  "data": {
    "items": [ ... ],
    "meta": {
      "page": 1, "limit": 20, "total": 57,
      "totalPages": 3, "hasNextPage": true, "hasPrevPage": false
    }
  }
}
```

| กรณี | `meta` |
|---|---|
| endpoint ที่ **paginate** (`?page=&limit=`) | object ตามด้านบน (จาก `buildMeta`) |
| endpoint ที่คืน **ลิสต์เต็ม** (ไม่ paginate — เช่น `catalog/banners`, `catalog/units`, round items) | `null` |

**Frontend rule เดียว:** อ่าน `res.data.items` เสมอ · ถ้าจะทำ pagination อ่าน `res.data.meta`

**Helper (backend):** `okList(items, meta?)` ใน `src/lib/apiResponse.ts` — `meta` ไม่ใส่ = `null`
`crudRoutes` (collection GET) และ list route ทั้งหมดใช้ผ่านนี้ · service คืน `{ items, meta }` (`buildMeta` / `crudService.list`)

### ⚠️ Breaking change (2026-09-11)
endpoint เหล่านี้เปลี่ยนรูปแบบ `data`:

| endpoint | เดิม | ใหม่ |
|---|---|---|
| `GET /api/catalog/banners` | `data` = array | `data.items` |
| `GET /api/catalog/units` | `data` = array | `data.items` |
| `GET /api/catalog/products/[id]/variants` | `data` = array | `data.items` |
| `GET /api/catalog/products/[id]/options` | `data` = array | `data.items` |
| `GET /api/admin/preorder-rounds/[id]/items` | `data` = array | `data.items` |
| `GET /api/catalog/products` | `data.pagination` | `data.meta` |
| `GET /api/admin/products` | `data.pagination` | `data.meta` |

endpoint อื่น ๆ ที่เป็น `{ items, meta }` อยู่แล้ว (crud factory, `/shop/orders`, `/shop/payments`, `/admin/promotions`, `/catalog/categories`, `/shop/preorders`, ...) — **ไม่เปลี่ยน**

---

## 3. HTTP status codes

| status | `error.code` | ใช้เมื่อ | helper (`src/lib/httpError.ts`) |
|---|---|---|---|
| 400 | `BAD_REQUEST` | input ผิดรูปแบบ / ไม่ผ่าน zod / ObjectId ผิด | `badRequest()` |
| 400 | `VALIDATION_ERROR` | Mongoose schema validation fail | (auto) |
| 400 | `INVALID_VALUE` | Mongoose CastError | (auto) |
| 401 | `UNAUTHORIZED` / `SESSION_INVALID` | ไม่ได้ล็อกอิน / เซสชันเสีย | `unauthorized()` · middleware |
| 403 | `FORBIDDEN` | ล็อกอินแล้วแต่ไม่มีสิทธิ์ (role / permission) | `forbidden()` |
| 403 | `CROSS_ORIGIN` | mutation จาก origin ข้ามโดเมน (CSRF guard) | middleware |
| 404 | `NOT_FOUND` | ไม่พบทรัพยากร | `notFound()` |
| 409 | `CONFLICT` / `DUPLICATE_KEY` | ขัดแย้งสถานะ / unique ซ้ำ | `conflict()` · (auto 11000) |
| 422 | `UNPROCESSABLE` | ผ่าน validation แต่ไม่ผ่าน business rule (โปรฯ, state machine, quota) | `unprocessable()` |
| 429 | `TOO_MANY_REQUESTS` | เกิน rate-limit | `tooMany()` — `details.retry_after_seconds` |
| 500 | `INTERNAL_ERROR` | error ที่ไม่ได้จัดการ (log ผ่าน `logger` แล้ว) | (auto) |

---

## 4. Validation errors (zod)

body/query ที่ไม่ผ่าน zod schema → **400** พร้อม `details.issues`

```json
{ "success": false, "error": {
  "code": "BAD_REQUEST",
  "message": "ข้อมูลที่ส่งมาไม่ผ่านการตรวจสอบ",
  "details": { "issues": [
    { "path": "email", "message": "อีเมลไม่ถูกต้อง", "code": "invalid_format" },
    { "path": "items.0.quantity", "message": "...", "code": "too_small" }
  ] } } }
```
- `path` = จุดที่ผิด (dot notation, index ของ array) → frontend map ไปแต่ละ field ได้
- ดู [`validation.md`](validation.md) สำหรับสถานะ adopt ราย route

---

## 5. Auth

- session = **JWT ใน cookie `session`** (`httpOnly`, `SameSite=Lax`, `Secure` ใน production)
- `middleware.ts` (Edge): ตรวจลายเซ็น JWT → แนบ `x-mmc-user` · กั้น namespace หยาบ ๆ
  (`/api/shop/*` ต้องล็อกอิน · `/api/admin/*` ต้อง role ∈ {owner, staff}) · CSRF same-origin guard
- route handler: `withAuth` (ต้องล็อกอิน) · `withPermission(menu, action)` (ตรวจสิทธิ์เมนูจาก DB) · `requireOwner` (เจ้าของข้อมูลเท่านั้น)
- ดู [`security-hardening.md`](security-hardening.md) สำหรับ rate-limit / CSRF / Google flow

---

## 6. Query params ของ list

| param | ความหมาย | default |
|---|---|---|
| `page` | หน้า (เริ่ม 1) | 1 |
| `limit` | ต่อหน้า (clamp 1–100) | 20 |
| `sortBy` | ฟิลด์เรียง (ต้องอยู่ใน whitelist ของ route ไม่งั้น 400) | ตาม route |
| `sortOrder` | `asc` / `desc` | `desc` |
| `search` | ค้นข้อความ (ฟิลด์ตาม route) | — |
| `includeDeleted` | รวม soft-deleted (`true`/`1`) — เฉพาะ admin | `false` |

parse ด้วย `parsePagination` / `parseSort` ใน `src/lib/queryParams.ts` · enum เฉพาะทาง (`order_status` ฯลฯ) parse ด้วย zod (`parseQuery`)

---

## 7. Soft delete

model ส่วนใหญ่มี `deleted_at` (null = ใช้งานอยู่) · list ปกติกรอง `deleted_at: null` ให้ · ลบ = set `deleted_at` · กู้คืนผ่าน `POST /api/admin/<resource>/[id]/restore`
