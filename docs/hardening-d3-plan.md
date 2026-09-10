# แผน D3 — Consistency / robustness (BACKLOG §3.7, §3.3b)

> อัปเดตล่าสุด: 2026-09-11
> สถานะ: **D3 เสร็จทั้งหมด (D3.1–D3.6)** · เหลือ D3.4b (`updateOrderStatus` cancel → Saga) เป็น follow-up
> ที่มา: [`hardening-plan.md`](hardening-plan.md) เฟส D3 · [`BACKLOG.md`](BACKLOG.md) §3.7 / §3.3 · มาตรฐาน API → [`api-conventions.md`](api-conventions.md)

D3 มี 2 งาน อิสระต่อกัน:
1. **§3.7** — response envelope ของ list endpoint ให้เป็นรูปแบบเดียว
2. **§3.3b** — `src/lib/compensation.ts` : รวม pattern best-effort rollback

### ✅ ทำแล้ว
- **D3.1** `src/lib/compensation.ts` — class `Saga`
  - `onRollback(label, undo)` บันทึก undo หลัง action สำเร็จ · `rollback()` รัน undo **ย้อนลำดับ**
    best-effort (undo ที่ throw = `log.error("saga.rollback_step_failed")` แล้วไปต่อ) · `commit()` ทิ้ง undo
  - `tests/lib/compensation.test.ts` — reverse order, commit ปิด rollback, undo throw ไม่ล้ม, rollback ซ้ำไม่รันอีก
- **D3.2** adopt `Saga` ที่ `preorderService.createPreorder`
  - แทน `committed[]` array + nested try/catch + `.catch(() => undefined)` กระจาย
  - undo ที่บันทึก: `releaseQty` (ต่อ line) → `deletePreorder` → `deletePreorderItems`
    → `rollback()` รันย้อน: ลบ items → ลบ preorder → คืนโควตา
  - **แถมแก้บั๊กเล็ก:** เดิม `getPreorderById` ตอนท้ายอยู่ใน try ที่ compensate → ถ้ามัน throw
    จะไป rollback preorder ที่สร้างสำเร็จแล้ว · ตอนนี้ `saga.commit()` **ก่อน** อ่านผลลัพธ์
- **D3.3** integration test (mongodb-memory-server) — **vitest projects** `unit` / `integration`
  - `vitest.config.mts` แยก 2 project · `tests/integration/setup.ts` — top-level await เริ่ม
    `MongoMemoryServer` → ตั้ง `MONGODB_URI` + `mongoose.connect` + pre-populate `global._mongoose`
    (cache ของ `dbConnect`) · `afterEach` เคลียร์ทุก collection
  - `tests/integration/promotionUsage.test.ts` (5) — §2.9: atomic claim, ถึง limit → 422 + used_count
    ไม่ขยับ, **ยิงพร้อมกัน 8 กับ limit=3 → สำเร็จ 3**, `max_user_per_user` rollback, `revokeUsage`
  - `tests/integration/persistOrder.test.ts` (4) — happy path (ยอด/ตัดสต็อก/snapshot), re-price,
    **compensation: สต็อกไม่พอ → throw + ไม่มีออเดอร์ + สต็อกไม่เปลี่ยน**, preorder product → reject
  - scripts: `test` = unit เท่านั้น (เร็ว, ไม่ต้องมี mongo binary) · `test:integration` (โหลด binary
    อัตโนมัติครั้งแรก) · `test:all` · `typecheck:test` (`tsconfig.test.json` — tests ไม่อยู่ใน `tsc`/`next build` หลัก)
- **D3.4** refactor `orderService.persistOrder` ใช้ `Saga`
  - `deductStock` → `onRollback("restock")` · `create order` → `onRollback("delete-order")` ·
    `insertMany` → `onRollback("delete-order-items")` · `recordUsage` (422 → throw) · `commit()` ·
    catch → `saga.rollback()` · แทน nested try/catch + `if (order?._id)` + `.catch(()=>undefined)`
  - validate โดย integration test (compensation case ผ่าน)
  - ตรวจ: typecheck · typecheck:test · lint · unit 86 · integration 9 · build — ผ่าน

- **D3.5** §3.7 response envelope — มาตรฐาน `data = { items, meta|null }` ทุก list endpoint
  - `apiResponse.okList(items, meta?)` + `PageMeta` type (ย้ายมา export จาก `queryParams`)
  - แก้ 7 endpoint ที่ไม่ conform: 5 ตัวคืน array เปล่า → `okList(items)` · `getProducts` เปลี่ยน key
    `pagination` → `meta` → `catalog/products` + `admin/products` ใช้ `okList(items, meta)`
  - `crudRoutes` collection GET → `okList(result.items, result.meta)` (output เดิม — ทำให้ pattern ชัด)
  - endpoint อื่นที่เป็น `{ items, meta }` อยู่แล้ว = ไม่แตะ (`ok({items,meta})` byte-identical กับ `okList`)
  - `tests/lib/apiResponse.test.ts` (+5) — ok/created/okList (meta default null / with meta / `[]`)
  - **⚠️ BREAKING** — ตาราง 7 endpoint ใน [`api-conventions.md`](api-conventions.md) §2
- **D3.6** [`docs/api-conventions.md`](api-conventions.md) — envelope, list, HTTP status + code,
  validation issues, auth, query params, soft delete

### ⬜ ยังไม่ทำ (follow-up)
- **D3.4b** `orderService.updateOrderStatus` (cancel branch) — ยังใช้ `.catch(()=>undefined)`
  · รอ integration test ของ cancel path ก่อน (หลักการเดียวกับ persistOrder D3.4)

---

## 1. §3.7 — Response envelope

### 1.1 สภาพปัจจุบัน (audit)

รูปแบบ success ตอนนี้ = `{ success: true, data: <payload> }` เสมอ — แต่ `data` ของ **list endpoint** ไม่คงที่ 3 แบบ:

| แบบ | endpoint | โค้ด |
|---|---|---|
| `data = [ ... ]` (array เปล่า) | `GET /api/catalog/banners`, `.../products/[id]/variants`, `.../products/[id]/options`, `/api/catalog/units`, `/api/admin/preorder-rounds/[id]/items` | `ok(result.items)` / `ok(items)` |
| `data = { items, pagination }` | `GET /api/catalog/products`, `/api/admin/products` | `productService.getProducts()` ใช้ key `pagination` |
| `data = { items, meta }` ✅ | crud factory GET ทั้งหมด, `/api/shop/orders`, `/api/shop/payments`, `/api/catalog/categories`, `/api/admin/promotions`, ... | `crudService.list()` / `buildMeta()` |

→ frontend ต้องรู้เป็นราย endpoint ว่าจะ `.data` หรือ `.data.items` หรือ `.data.pagination`

### 1.2 มาตรฐานที่เสนอ

**list endpoint ทุกตัว: `data = { items: T[], meta: PageMeta | null }`**

```ts
interface PageMeta {
  page: number; limit: number; total: number;
  totalPages: number; hasNextPage: boolean; hasPrevPage: boolean;
}
```
- endpoint ที่ paginate → `meta` = ค่าจริง
- endpoint ที่คืนลิสต์เต็ม (ไม่ paginate เช่น banners, units, round items) → `meta = null`
- frontend rule เดียว: *"list อ่าน `data.items` เสมอ; ถ้าทำ pagination อ่าน `data.meta`"*

### 1.3 การเปลี่ยนแปลง

**`src/lib/apiResponse.ts`** — เพิ่ม helper + type
```ts
export interface PageMeta { page:number; limit:number; total:number; totalPages:number; hasNextPage:boolean; hasPrevPage:boolean; }

export function okList<T>(items: T[], meta: PageMeta | null = null): NextResponse {
  return NextResponse.json({ success: true, data: { items, meta } }, { status: 200 });
}
```

**routes ที่คืน array เปล่า (5 ตัว)** → `okList(result.items)` / `okList(items)`

**`productService.getProducts()`** — เปลี่ยน return key `pagination` → `meta` (ใช้ `buildMeta` เพื่อให้ shape ตรง)
- consumer: `GET /api/catalog/products`, `GET /api/admin/products` ทั้งคู่ `ok(result)` อยู่แล้ว → เปลี่ยนเป็น `okList(result.items, result.meta)` (หรือปล่อย `ok(result)` ก็ได้ถ้า `result` เป็น `{items, meta}` แล้ว)

**crud factory GET / endpoint ที่เป็น `{items, meta}` อยู่แล้ว** — เปลี่ยนให้เรียก `okList(result.items, result.meta)` เพื่อความสม่ำเสมอ (ไม่เปลี่ยนพฤติกรรม) — optional, ทำได้ทีหลัง

### 1.4 ⚠️ Breaking change

frontend ที่เรียก 7 endpoint นี้ต้องแก้พร้อมกัน:
- 5 endpoint: `res.data` (array) → `res.data.items`
- `catalog/products` + `admin/products`: `res.data.pagination` → `res.data.meta`

**แนวทาง:** ทำเป็น PR เดียว หัวข้อ `BREAKING`, ประกาศ frontend ก่อน merge, หรือทำช่วงที่ frontend ปรับพร้อมกันได้

### 1.5 เอกสาร
สร้าง `docs/api-conventions.md` — envelope success/error, list = `{items, meta}`, `meta` fields, HTTP status ที่ใช้ (400/401/403/404/409/422/429/500)

### 1.6 effort / risk
- **effort:** S–M (โค้ดน้อย, แต่ต้องไล่ครบ + doc)
- **risk:** โค้ดต่ำ · **แต่ breaking กับ frontend** → ต้องประสาน

---

## 2. §3.3b — `src/lib/compensation.ts`

### 2.1 สภาพปัจจุบัน

pattern "best-effort rollback" เขียน inline กระจาย:

| ที่ | ทำ side effect | undo ตอนพลาด |
|---|---|---|
| `orderService.persistOrder` | `deductStockForOrder` → `orderModel.create` → `orderItemModel.insertMany` | `restockForOrder().catch(()=>undefined)` + `if (order?._id) { deleteOne + deleteMany }` |
| `orderService.updateOrderStatus` (cancel) | — | `restockForOrder().catch()` + `revokeUsage().catch()` + auto-refund `try/catch` |
| `preorderService` | `commitQty` (จองโควตา) | `releaseQty` (best-effort ตาม BACKLOG §8) |

ปัญหา: กระจาย, log ไม่สม่ำเสมอ (`.catch(()=>undefined)` = เงียบ), ลำดับ undo ต้องเขียนเองทุกที่

### 2.2 ที่เสนอ

**`src/lib/compensation.ts`**
```ts
import { log } from "./logger";

export class Saga {
  private steps: { label: string; undo: () => Promise<unknown> }[] = [];

  /** บันทึก undo หลัง action ที่มี side effect สำเร็จ */
  onRollback(label: string, undo: () => Promise<unknown>): void {
    this.steps.push({ label, undo });
  }

  /** รัน undo ทั้งหมดแบบ reverse · best-effort (fail = log ต่อ, ไม่ throw) */
  async rollback(): Promise<void> {
    for (let i = this.steps.length - 1; i >= 0; i--) {
      try { await this.steps[i].undo(); }
      catch (err) { log.error("saga.rollback_step_failed", { step: this.steps[i].label, err }); }
    }
    this.steps = [];
  }

  /** ทิ้ง undo (เมื่อทุกขั้นสำเร็จ) */
  commit(): void { this.steps = []; }
}
```

**ตัวอย่าง `persistOrder`**
```ts
const saga = new Saga();
try {
  await productService.deductStockForOrder(stockItems);
  saga.onRollback("restock", () => productService.restockForOrder(stockItems));

  order = await orderModel.create({ ... });
  saga.onRollback("delete-order", () => orderModel.deleteOne({ _id: order._id }));

  await orderItemModel.insertMany(...);
  saga.onRollback("delete-order-items", () => orderItemModel.deleteMany({ order_id: order._id }));

  if (appliedPromotion) {
    try { await promotionUsageService.recordUsage({ ... }); }
    catch (e) { if (isHttpError(e) && e.status === 422) throw e; log.error("order.record_usage_failed", { err: e }); }
  }
  saga.commit();
} catch (err) {
  await saga.rollback();
  throw err;
}
```

ได้: ที่เดียว, undo reverse order อัตโนมัติ, log ผ่าน `logger` สม่ำเสมอ, เลิก `if (order?._id)` / `.catch(()=>undefined)` กระจาย

### 2.3 ⚠️ ลำดับที่ต้องระวัง

`persistOrder` = ฟังก์ชันวิกฤต **แต่ยังไม่มี integration test** (มีแค่ unit ของ schema/engine)
→ refactor ตอนนี้เสี่ยง regression เงียบ

**เสนอลำดับ:**
1. สร้าง `compensation.ts` + test ของ `Saga` เอง (pure — onRollback/rollback reverse order/rollback ต่อแม้ step fail/commit)
2. adopt ที่ **`preorderService`** ก่อน (blast radius เล็กกว่า, มี `commitQty`/`releaseQty` ชัด)
3. เขียน **integration test `persistOrder`** (mongodb-memory-server — ดึงงานนี้จาก D8 ขึ้นมา) ครอบเคส: re-price, snapshot cost, promo atomic claim, **compensation เมื่อ insertMany fail / recordUsage 422 / deductStock ไม่พอ**
4. ค่อย refactor `persistOrder` + `updateOrderStatus` ให้ใช้ `Saga`

### 2.4 effort / risk
- `compensation.ts` + test: **S**
- adopt `preorderService`: **S**
- integration test `persistOrder`: **M**
- refactor `persistOrder`/`updateOrderStatus`: **M** · **risk กลาง–สูง ถ้าไม่มี integration test ก่อน**

---

## 3. ลำดับแนะนำของทั้ง D3

```
D3.1  compensation.ts + Saga test                    (S)   ← ทำได้เลย ไม่ breaking
D3.2  adopt Saga ที่ preorderService                  (S)
D3.3  integration test persistOrder / recordUsage     (M)   ← ปลดล็อก D3.4
D3.4  refactor persistOrder + updateOrderStatus       (M)
────────────────────────────────────────────────────────────
D3.5  §3.7 envelope: apiResponse.okList + audit 7 route (S–M) ← BREAKING, ทำเป็น PR เดียว + ประกาศ frontend
D3.6  docs/api-conventions.md                          (S)
```

**ทำก่อนได้เลยไม่ต้องรอใคร:** D3.1 · D3.2 · D3.3
**ต้องประสาน frontend:** D3.5

---

## 4. คำถามเปิดสำหรับทบทวน

1. §3.7: `meta` ของ endpoint ที่ไม่ paginate → ให้เป็น `null` หรือ synthesize (`{page:1,total:N,totalPages:1,...}`) ?
   - เสนอ `null` — สื่อชัดว่า "ไม่มี pagination"
2. §3.7: จะบังคับ list endpoint ทุกตัวผ่าน `okList` เลย หรือแค่แก้ 7 ตัวที่ผิดมาตรฐาน (ที่เหลือปล่อย `ok(result)` เพราะ shape ตรงอยู่แล้ว) ?
   - เสนอ: แก้ 7 ตัวก่อน + ค่อย ๆ ย้ายที่เหลือมาใช้ `okList` (ไม่เร่ง)
3. §3.3b: จะดึง integration test (D3.3) ขึ้นมาก่อน refactor เลย หรือ refactor `preorderService` อย่างเดียวในรอบนี้แล้วเว้น `persistOrder` ไว้ ?
   - เสนอ: รอบนี้ทำถึง D3.2 · `persistOrder` refactor แยกไปหลังมี integration test
4. timing ของ D3.5 (breaking) — มี frontend ที่ใช้งานอยู่แล้วหรือยัง? ถ้ายัง frontend ยังไม่เสถียร ทำเลยได้ทันที
