# MeowMeeCake Backend — BACKLOG 2: บั๊ก/ความเสี่ยงชุดใหม่

> สร้าง: 2026-09-13 · อัปเดตล่าสุด: 2026-09-15 (§1/§2/§4/§5 แก้ครบแล้ว · §3 เพิ่ม upload.ts audit
> ไม่พบ path traversal, แก้ 1 จุด S3 config gap · เหลือ §6 บางข้อยังไม่ได้ตรวจ)
> ขอบเขต: ฝั่ง Backend (`src/**`, `scripts/**`) — ยังไม่รวม frontend เหมือน [`BACKLOG.md`](BACKLOG.md)
> วิธีตรวจ: อ่านโค้ดจริง + grep หา pattern ที่เคยเป็นบั๊กมาก่อนซ้ำที่อื่น + ตรวจ DB จริง (read-only) เพื่อ
> ยืนยันผลกระทบ — **ไม่ใช่รายงานดิบจาก agent** (ตามธรรมเนียมเดิมของ [`BACKLOG.md`](BACKLOG.md) §2b/§2c/§2d)
> **สถานะ: §1 + §2 + §4 + §5 แก้ครบแล้ว** (2026-09-13/15) — verify ผ่านหมดหลังแก้ทุกรอบ: `typecheck` /
> `typecheck:test` / `lint` (0 error) / `test` (171) / `test:integration` (138) / `build`

## สถานะโดยรวม

| ชั้น | สถานะ |
|---|---|
| **§1 unique index ไม่ partial ซ้ำกับ soft-delete (pattern เดิมจาก §2.3/§2.4/[BACKLOG.md §2d.2])** | ✅ **แก้ครบ 8/8** (2026-09-13) — เปลี่ยนเป็น partial-unique เหมือน `unitModel` ทุกจุด + รัน `sync-indexes` จริงผ่าน 38/38 (ไม่ต้อง cleanup ข้อมูล ยืนยันแล้วว่าไม่มีของซ้ำ) |
| **§2 N+1 query ซ้ำ pattern เดิมจาก §3.18 (checkout)** | ✅ **แก้ครบ 2/2** (2026-09-13) — เพิ่ม `getOrderableRoundItems()`/`addItems()` (พหูพจน์) แบบ batch เหมือน `orderService.resolveLines()` แล้วเปลี่ยน `createPreorder()`/`createProductionOrder()` มาเรียกแทน loop เดิม |
| ownership/IDOR ของ shop routes (`addresses`, `cart/items`, `reviews`) | ✅ ตรวจแล้ว **ไม่พบปัญหา** — ทุกจุด scope ด้วย `user_id` ที่ service layer ถูกต้อง (เทียบกับ `2b.1` ที่เคยพลาด) |
| duplicate-key error handling ทั่วไป (`crudService`/`apiResponse`) | ✅ ตรวจแล้ว **ไม่พบปัญหา** — `toErrorResponse()` แปลง Mongo `11000` เป็น response ที่มีโครงสร้างอยู่แล้ว ไม่ใช่ 500 ดิบ |
| path traversal / file validation (`src/lib/upload.ts`) | ✅ ตรวจแล้ว **ไม่พบ path traversal ที่ใช้ได้จริง** (2026-09-15) — แก้ 1 จุดที่เกี่ยวข้อง: `createS3Driver` ไม่เคยเช็ค `S3_PUBLIC_URL_BASE` (ลบไฟล์ไม่ได้เงียบ ๆ ถ้าลืมตั้ง) |
| **§4 พรีออเดอร์ไม่มีทางอัปเดตสถานะจัดส่งเลย (คู่ขนานกับ `orderService.updateDelivery`)** | ✅ **แก้แล้ว** (2026-09-13) — เพิ่ม `preorderService.updateDelivery()` + `PATCH /api/admin/preorders/[id]/delivery` คู่กับของ order + เทส 6 เคสใหม่ |
| **§5 `crudService.ts` create()/update() ไม่มี default whitelist ถ้า service ลืมระบุ `createFields`** | ✅ **แก้แล้ว** (2026-09-15) — `createFields` เปลี่ยนจาก optional เป็น required ใน `CrudOptions` — compiler เจอ **1 จุดจริง** ที่ยังไม่ระบุ (`notificationService.ts`, ดู §5 ด้านล่าง) |

---

## 1. ✅ Unique index ไม่ partial ซ้ำกับ soft-delete — พบ + แก้แล้ว 8/8 (2026-09-13)

> **pattern เดิม:** โมเดลที่รองรับ soft-delete (`deleted_at`) + restore แต่ยังตั้ง `unique: true` แบบ
> ธรรมดาระดับ field (ไม่ใช่ `schema.index(..., { partialFilterExpression: { deleted_at: null } })`)
> ทำให้เอกสารที่ถูก soft-delete ไปแล้วยังกัน "ค่าเดิม" ไม่ให้ใครใช้ซ้ำได้อีกตลอดกาล — นี่คือบั๊กเดียวกับ
> ที่เจอและแก้แล้วใน §2.3 (`attendanceModel`), §2.4 (`reviewModel`), และ [`BACKLOG.md` §2d.2](BACKLOG.md)
> (`unitModel`) แต่ **ไม่เคยไล่เช็คทั้งโปรเจกต์ว่ามีที่อื่นเป็นซ้ำอีกไหม** — ตรวจครบทุก `unique: true` ใน
> `src/models/*.ts` แล้วพบอีก 8 โมเดลที่เข้าเงื่อนไขเดียวกัน (มี `deleted_at` + มี endpoint restore จริง)
>
> **ยืนยันผลกระทบด้วย DB จริง (read-only aggregate, 2026-09-13):** ทั้ง 8 จุด **ไม่มีข้อมูลซ้ำอยู่เลย
> สักคู่** ทั้งแบบนับทุกสถานะ (all-state) และแบบนับเฉพาะที่ยัง active (`deleted_at:null`) — แปลว่าแก้ตอนนี้
> **ไม่ต้อง cleanup ข้อมูลก่อนเลย** เหมือนที่ต้องทำกับ `unitModel` (ซึ่งท้ายที่สุดก็ไม่ต้อง cleanup
> เหมือนกัน เพราะ partial index กรองเฉพาะ active อยู่แล้ว) — ความเสี่ยงต่ำมาก แก้ตามรูปแบบเดียวกับ
> `unitModel.ts` ได้ทันที (ถอด `unique: true` ระดับ field ออก แล้วเพิ่ม `schema.index(...)` แยก)

| # | Model | Field(s) ที่เคย unique เฉย ๆ | Collection จริง | ผลกระทบถ้าไม่แก้ | สถานะ |
|---|---|---|---|---|---|
| 1 | `src/models/roleModel.ts` | `role_name` | `roles` | ลบ role ทิ้ง (soft) แล้วสร้าง role ชื่อเดิมใหม่ไม่ได้ตลอดกาล (เช่น พิมพ์ผิดแล้วลบ อยากสร้างชื่อเดิมใหม่) | ✅ แก้แล้ว |
| 2 | `src/models/userModel.ts` | `email` | `users` | **กระทบสูงสุดในกลุ่มนี้** — ลบ user ทิ้ง (soft, เช่น ไล่พนักงานออก/ลบบัญชีลูกค้า) แล้วอีเมลนั้นสมัครสมาชิกใหม่/สร้างใหม่ไม่ได้อีกเลย (`userService.createUser` ไม่มี pre-check เอง พึ่ง DB index ล้วน ๆ → ชน `11000` เงียบ ๆ กลายเป็น 409 "ซ้ำ" ที่ผู้ใช้งงว่าทำไมอีเมลตัวเอง "ซ้ำ" ทั้งที่ไม่เคยสมัคร) | ✅ แก้แล้ว |
| 3 | `src/models/promotionModel.ts` | `promotion_code` | `promotions` | ลบโปรโมชันทิ้งแล้วสร้างโค้ดเดิมซ้ำไม่ได้ (โค้ดโปรโมชันมักเป็นคำสั้น ๆ ที่คนอยากใช้ซ้ำ เช่น `SUMMER10` ปีถัดไป) | ✅ แก้แล้ว |
| 4 | `src/models/ingredientModel.ts` | `ingredient_name` | `ingredients` | ลบวัตถุดิบทิ้งแล้วสร้างชื่อเดิมใหม่ไม่ได้ | ✅ แก้แล้ว |
| 5 | `src/models/ingredientCategoryModel.ts` | `ingredient_category_name` | `ingredientcategories` | เหมือนข้อ 4 ระดับหมวดหมู่ | ✅ แก้แล้ว |
| 6 | `src/models/productCategoryModel.ts` | `product_category_name` | `productcategories` | เหมือนข้อ 4 ระดับหมวดหมู่สินค้า | ✅ แก้แล้ว |
| 7 | `src/models/componentsCategory.ts` | `component_category_name` | `componentcategories` | เหมือนข้อ 4 ระดับหมวดหมู่ชิ้นส่วน | ✅ แก้แล้ว |
| 8 | `src/models/preorderRoundItemModel.ts` | `{ round_id, product_id }` (compound) | `preorderrounditems` | ลบสินค้าออกจากรอบพรีออเดอร์ (soft) แล้วเพิ่มสินค้าตัวเดิมกลับเข้ารอบเดิมไม่ได้อีก — ไม่มี endpoint restore แยกด้วยซ้ำ (เช็คแล้ว) เพราะงั้นทางเดียวที่จะ "ได้กลับมา" คือเพิ่มใหม่ ซึ่งจะชน index นี้ตรง ๆ | ✅ แก้แล้ว |

**วิธีแก้ที่ใช้จริง (2026-09-13, ตรงกับที่ทำสำเร็จแล้วกับ `unitModel.ts`):** ต่อแต่ละโมเดล เอา
`unique: true` ออกจาก field definition แล้วเพิ่ม
```ts
xxxSchema.index({ <field> }, { unique: true, partialFilterExpression: { deleted_at: null } });
```
แยกต่างหาก (`preorderRoundItemModel` เป็น compound index ใช้ `{ round_id: 1, product_id: 1 }` เหมือนเดิม
แค่เพิ่ม `partialFilterExpression`) แล้วรัน `npm run sync-indexes` จริงกับ DB — **ผลลัพธ์: สำเร็จ 38/38
model ในครั้งเดียว ไม่ต้อง cleanup ข้อมูลเลยสักจุด** ตรงตามที่คาดไว้ (ยืนยัน DB ไว้ก่อนแล้วว่าไม่มีของซ้ำ)
· ยืนยันด้วย `typecheck`/`typecheck:test`/`lint`(0 error)/`test`(171)/`test:integration`(132)/`build`
ผ่านหมด

**หมายเหตุ (พบระหว่างแก้ ไม่ได้อยู่ในสโคปนี้):** `promotionModel.ts` มี
`promotionSchema.index({ promo_code: 1 })` เป็น dead index — ชื่อฟิลด์พิมพ์ผิด (ฟิลด์จริงคือ
`promotion_code`) ทำให้ index นี้จัดทำดัชนีให้ฟิลด์ที่ไม่มีอยู่จริง (ทุกเอกสารเป็น `null` เหมือนกันหมด) —
ไม่กระทบอะไร (แค่เปลืองพื้นที่ index เล็กน้อย) แต่เป็นโค้ดขยะที่ควรลบทิ้งเมื่อมีโอกาส

---

## 2. ✅ N+1 query ใน per-item loop — พบ + แก้แล้ว 2/2 (คู่ขนานกับ §3.18) (2026-09-13)

> **pattern เดิม:** [BACKLOG.md §3.18](BACKLOG.md) แก้ `orderService`/`cartService` (checkout) จาก loop
> `await` ทีละบรรทัดเป็น batch query ด้วย `$in` ครั้งเดียว — แต่ **ไม่เคยไล่เช็คว่า path อื่นที่สร้าง
> เอกสารจากหลายรายการเหมือนกันมีปัญหาเดียวกันไหม** เหมือนที่ §2b เจอว่า preorder ไม่เคยได้ fix ตาม order
> ในบั๊กชุดก่อนหน้า — รอบนี้เจอว่า preorder **พลาดอีกแล้ว** (คนละบั๊ก คนละรอบ แต่ pattern เดียวกัน:
> "แก้ order แล้วลืมเช็ค preorder")

| # | ที่ไฟล์ | รายละเอียด | สถานะ |
|---|---|---|---|
| 2.1 | `src/services/preorderService.ts` — `createPreorder()` (บรรทัด ~148-186) | เดิม `for (const raw of input.items) { ... await preorderRoundService.getOrderableRoundItem(raw.round_item_id, ...) ... }` — query แยกทีละรายการต่อ 1 request (`getOrderableRoundItem` อ่าน round item + product ต่อครั้ง) เหมือน `resolveLine()` เดิมก่อนแก้ §3.18 เป๊ะ ต่างจาก `orderService`/`cartService` ที่ถูกเปลี่ยนเป็น `resolveLines()` แบบ batch ไปแล้ว — พรีออเดอร์ 1 ใบที่มีหลายรายการ (ลูกค้าสั่งพรีออเดอร์หลายเมนูพร้อมกันในรอบเดียว) จะยิง query จำนวนเท่ากับจำนวนรายการ ไม่คงที่เหมือน `resolveLines()` | ✅ แก้แล้ว |
| 2.2 | `src/services/productionOrderService.ts` — `createProductionOrder()` (บรรทัด ~93-97) | เดิม `for (const raw of input.items) { await productionItemService.addItem(String(order._id), raw); }` — สร้างใบสั่งผลิตที่มีหลายรายการ (เช่น สั่งผลิตเค้ก 5 สูตรพร้อมกัน) ยิง `addItem` แยกทีละรายการ (แต่ละครั้งมี query ภายในของตัวเองด้วย เช่นดึงสูตร/ตรวจ recipe รวมถึง fetch order ซ้ำทุกครั้งทั้งที่เป็น order เดียวกัน) — ผลกระทบต่ำกว่าข้อ 2.1 เพราะใบสั่งผลิตมักมีรายการน้อยกว่าตะกร้า/พรีออเดอร์ลูกค้า แต่เป็น pattern เดียวกัน | ✅ แก้แล้ว |

**หมายเหตุ:** ยังมี loop รอง 1 จุดใน `createPreorder()` ที่ไม่ใช่ N+1 แบบเดียวกันโดยตรง (บรรทัด ~220-226
`for (const l of lines) await preorderRoundService.commitQty(...)` เป็นการจองโควตาแบบ atomic ต่อ
เอกสาร — จำเป็นต้องเป็น per-item เพื่อความถูกต้อง ไม่ใช่จุดที่ batch ได้ตรง ๆ เหมือนการ "อ่าน" ข้อมูล —
**ไม่ได้แก้ตรงนี้ตามที่ตั้งใจไว้แต่แรก** เพราะเป็นคนละลักษณะปัญหา)

**วิธีแก้ที่ใช้จริง (2026-09-13):**
- **2.1** — เพิ่ม `preorderRoundService.getOrderableRoundItems()` (พหูพจน์ — แทนที่
  `getOrderableRoundItem()` เอกพจน์เดิมไปเลย เพราะไม่มีที่อื่นเรียกใช้) รับ `round_item_id[]` แล้ว
  batch query ด้วย `$in` ครั้งเดียวต่อ collection (`preorderRoundItem`/`product`) จากนั้น join ใน
  memory ตามลำดับเดิม เหมือน `resolveLines()` ของ `orderService` — `createPreorder()` แก้มาเรียกตัวนี้แทน
- **2.2** — เพิ่ม `productionItemService.addItems()` (พหูพจน์ — เก็บ `addItem()` เอกพจน์เดิมไว้ เพราะยัง
  ใช้จริงที่ `POST /admin/production-orders/[id]/items` สำหรับเพิ่มทีละรายการเข้าใบสั่งผลิตที่มีอยู่
  แล้ว ไม่ใช่ N+1 เพราะเป็นคนละ request) — batch fetch order ครั้งเดียว + product/recipe ด้วย `$in`
  ต่อ collection แล้ว `insertMany` รวด — `createProductionOrder()` แก้มาเรียกตัวนี้แทน
- ทั้งคู่ validate/error message เดิมทุกจุดต่อรายการ ต่างแค่ "ลำดับ" ของ error เมื่อมีหลายรายการผิด
  พร้อมกัน (เหมือนที่ยอมรับไว้แล้วใน `orderService.resolveLines()` §3.18 — ไม่มีเทสไหนอิงลำดับ error
  ข้ามรายการ) · ยืนยันด้วย `typecheck`/`typecheck:test`/`lint`(0 error)/`test`(171)/
  `test:integration`(132, รวมเทสเดิมของ `createPreorder`/`createProductionOrder` ที่มีหลายรายการ)/
  `build` ผ่านหมด

---

## 3. สิ่งที่ตรวจแล้วไม่พบปัญหา (บันทึกไว้กันตรวจซ้ำอนาคต)

- **Ownership/IDOR ของ shop routes** — เทียบกับ §2b.1 (payment IDOR เดิม) แล้วไล่เช็ค
  `addresses`/`cart/items`/`reviews` ทุก mutation endpoint: ทุกจุด scope ด้วย `user_id` ที่ service
  layer จริง (`addressService`/`cartService` filter query ด้วย `user_id`/`cart_id` ที่ผูกกับ user,
  `reviewService` เช็ค `String(review.user_id) !== String(userId)` แล้ว throw `forbidden`) — ไม่พบช่องโหว่
- **Duplicate-key error handling ทั่วระบบ** — `src/lib/apiResponse.ts` มี `isDuplicateKeyError()` แปลง
  Mongo `11000` เป็น structured error response อยู่แล้วในทุก route ที่ผ่าน `route()` wrapper — ไม่ใช่ 500
  ดิบเหมือนที่กังวลตอนแรกว่าการแก้ §1 ด้านบนจะทำให้ error message แย่ลง
- **เศษบาทหลังย้ายเงินเป็นสตางค์ (§3.11)** — grep หา `Math.round(x*100)/100` (สูตรปัดบาทแบบเดิมที่เคยเป็น
  บั๊กในเฟส 4 ของ §3.11) ที่เหลืออยู่ใน `dashboardService.ts`/`expenseService.ts`/`reviewService.ts`/
  `discountEngine.ts` — **ตรวจแล้วถูกต้อง** ทุกจุดเป็นการปัด **บาท** (field ที่ยังเป็น float ตาม design
  เช่น `avg_rating`, ค่าที่ผ่าน `toBaht()` มาแล้วก่อนปัด) ไม่ใช่การปัดสตางค์ดิบแบบที่เคยผิดในเฟส 4
- **Path traversal / file validation ของ `src/lib/upload.ts` (2026-09-15)** — ไล่อ่านทั้งไฟล์ +
  entry point เดียวที่เรียกจริง (`POST /api/admin/products/images`) แล้วยืนยัน **ไม่พบช่องทาง path
  traversal ที่ใช้ได้จริง**:
  - `saveImages(files, dir)` — `dir` เป็น literal `"products"` ที่ hardcode ในโค้ด ไม่เคยมาจาก client
    เลยสักจุด (grep แล้วมี caller เดียว) การ sanitize `dir.replace(/[^a-z0-9_-]/gi, "")` จึงเป็น
    defense-in-depth เฉย ๆ ไม่ใช่แนวป้องกันเดียว
  - `deleteImages(urls)` — `urls` ที่ส่งเข้ามาทุกจุด (`productService.updateProduct`/
    `hardDeleteProduct`) เป็น **subset ของ `oldImages`** (ค่าที่อ่านจาก DB ก่อนอัปเดต ซึ่งมาจาก
    `saveImages()` เองเท่านั้น) — client ควบคุม url ที่จะถูก "ลบ" ไม่ได้แม้จะยัดค่าแปลกใน
    `product_img` มาตอน update ก็ตาม (ค่านั้นกลายเป็นส่วนหนึ่งของ "kept" ไม่ใช่ "removed")
  - regex ใน `localDiskDriver.delete()` (`/^\/uploads\/([a-z0-9_-]+)\/([^/\\]+)$/i`) กัน `/`,`\` ได้ครบ —
    ทดสอบเคส edge `filename = ".."` (ผ่าน regex ได้เพราะ `.` ไม่ถูกห้ามใน `[^/\\]+`) แล้วพบว่า
    resolve ได้แค่ `public/uploads/` (ไดเรกทอรีเอง ไม่ใช่ไฟล์) → `unlink()` throw `EISDIR` → ถูกกลืนใน
    `deleteImages()` (`.catch(log.error)`) อยู่แล้ว **ไม่มีผลจริง** ไม่ใช่ช่องโหว่
  - เทสเดิม (`tests/lib/upload.test.ts`) มีเคส path traversal แบบ `/uploads/../../etc/passwd` +
    `/uploads/a/b/c/d.png` อยู่แล้วและผ่าน ยืนยันตรงกับผลตรวจรอบนี้
  - การตรวจไฟล์ 3 ชั้น (size → นามสกุล client → magic bytes จริง) ใช้ **นามสกุลจาก magic bytes**
    (`realExt`) ตอนตั้งชื่อไฟล์ที่บันทึกจริงเสมอ ไม่ใช่นามสกุลจาก `file.name` — กัน mismatch ระหว่างชื่อ
    ไฟล์กับเนื้อหาได้ถูกต้อง · ไม่รับ SVG (ไม่มี signature ให้ sniff ผ่าน) จึงไม่มีช่อง stored-XSS ผ่านรูป
  - **พบ + แก้ 1 จุดที่เกี่ยวข้อง (ไม่ใช่ path traversal แต่เป็น "file validation" ตามขอบเขตที่ตรวจ):**
    `createS3Driver().save()` เช็ค `S3_BUCKET` ว่าตั้งค่าไว้ (throw ถ้าไม่ตั้ง) แต่ **ไม่เคยเช็ค
    `S3_PUBLIC_URL_BASE`** ทั้งที่ `keyFromUrl()` ตอน `delete()` ต้องพึ่งค่านี้แกะ key กลับ — ถ้าไม่ตั้ง
    จะ silent: อัปโหลดสำเร็จได้ปกติ (url เป็น raw key ไม่มีโดเมนนำหน้า) แต่ `deleteImages()` จะ no-op
    ตลอดไปทุกครั้งเงียบ ๆ (เงื่อนไข `base && url.startsWith(...)` เป็นเท็จเสมอ) — ทำให้ §3.14 (ลบรูปที่
    ไม่ใช้) ใช้งานไม่ได้เลยถ้าเลือก `UPLOAD_DRIVER=s3` แล้วลืมตั้งตัวแปรนี้ตัวเดียว แก้โดยเพิ่ม throw
    แบบเดียวกับ `S3_BUCKET` (`docs/env.md` อัปเดตคอลัมน์ "จำเป็น" ของ `S3_PUBLIC_URL_BASE` ด้วย) — ไม่มี
    unit test เพิ่มเพราะ driver instance เป็น module-level singleton ที่เลือกครั้งเดียวตอน `getDriver()`
    แรกสุด (เหมือน `S3_BUCKET` guard เดิมที่ก็ไม่เคยมี unit test เช่นกัน — s3 driver ทดสอบผ่าน
    integration/manual เท่านั้นตามที่ระบุไว้ในเทสไฟล์) · ยืนยันด้วย `typecheck`/`typecheck:test`/
    `lint`(0 error)/`test`(171)/`test:integration`(138)/`build` ผ่านหมด

---

## 4. ✅ พรีออเดอร์ไม่มีทางอัปเดตสถานะจัดส่งได้เลย — คู่ขนานกับ `orderService.updateDelivery` ที่ไม่เคย fix ตาม (พบ + แก้แล้ว 2026-09-13)

> พบจากการไล่เทียบฟังก์ชัน `orderService.ts` กับ `preorderService.ts` ทีละตัวแบบเดียวกับที่ §2b เคยทำ
> (เจอ 4 บั๊กตอนนั้น) — รอบนี้ไล่เทียบ export ทั้งหมดของทั้งสองไฟล์ พบว่า `orderService` มีฟังก์ชัน
> `updateDelivery()` ที่ `preorderService` **ไม่มีเลย**

**ยืนยันด้วยการอ่านโค้ดจริงครบทุกชั้น (ไม่ใช่แค่เดา):**
- `preorderModel.ts` มีฟิลด์ `delivery_status` (enum `pending/shipping/delivered/failed`),
  `shipped_at`, `delivered_at`, `tracking_no`, `delivered_note` — **ครบทุกฟิลด์เหมือน `orderModel.ts`
  เป๊ะ** — แปลว่า schema ถูกออกแบบมาให้รองรับการติดตามสถานะจัดส่งของพรีออเดอร์ตั้งแต่แรกจริง ๆ
- `preorderService.ts` **ไม่มีฟังก์ชัน `updateDelivery()`** เทียบเท่า `orderService.updateDelivery()`
  เลย (เช็ค export ทั้งไฟล์แล้ว) — `updatePreorderStatus()` แก้ได้แค่ `order_status` (state machine
  pending→confirmed→...) เท่านั้น ไม่แตะฟิลด์ delivery ใด ๆ ทั้งสิ้น
- `src/app/api/admin/preorders/[id]/status/route.ts` (route เดียวที่แก้พรีออเดอร์ได้นอกจาก
  create/delete) อ่านแค่ `body.order_status` + `body.cancelled_reason` เท่านั้น ไม่มี body field
  อื่นถูกใช้เลย
- **ไม่มี** `src/app/api/admin/preorders/[id]/delivery/route.ts` ทั้งที่ order มี
  `src/app/api/admin/orders/[id]/delivery/route.ts` (`PATCH`, body:
  `delivery_status?/tracking_no?/shipped_at?/delivered_at?/delivered_note?`, ผ่าน
  `updateDeliveryBody` zod schema) คู่กันอยู่

**ผลกระทบ:** พรีออเดอร์ที่ `order_type: "delivery"` — เมื่อร้านแพ็คของแล้วจะจัดส่ง **ไม่มีทางบันทึกเลขพัสดุ
(`tracking_no`) หรือเปลี่ยน `delivery_status` เป็น `"shipping"`/`"delivered"` ได้ผ่าน API เลยแม้แต่ทางเดียว**
— ฟิลด์เหล่านี้จะค้างอยู่ที่ค่า default (`delivery_status: "pending"`, ที่เหลือเป็น `null`) ตลอดไปไม่ว่า
พรีออเดอร์จะถูกจัดส่งจริงไปแล้วกี่ใบก็ตาม (ต่างจากออเดอร์ปกติที่แอดมินอัปเดตได้ผ่าน
`PATCH /api/admin/orders/[id]/delivery`)

**วิธีแก้ที่ใช้จริง (2026-09-13):** เพิ่ม `preorderService.updateDelivery()` ก็อปโครงจาก
`orderService.updateDelivery()` เป๊ะ (เช็ค `order_type === "delivery"`, auto-set `shipped_at`/
`delivered_at` เมื่อเปลี่ยนสถานะและยังไม่เคยตั้งมาก่อน) + **reuse** `updateDeliveryBody` จาก
`schemas/order.ts` ตรง ๆ (shape generic เหมือนกันเป๊ะ ไม่ต้องสร้างซ้ำ) +
`PATCH /api/admin/preorders/[id]/delivery` route คู่กับของ order (`withPermission("preorder",
"update")` + audit log) · เทสใหม่ `tests/integration/preorderDelivery.test.ts` (6 เคส: auto-set
shipped_at/delivered_at, ไม่ทับ shipped_at เดิม, reject order_type=takeaway, reject ไม่พบพรีออเดอร์,
persist ลง DB จริง) · ยืนยันด้วย `typecheck`/`typecheck:test`/`lint`(0 error)/`test`(171)/
`test:integration`(138, +6 เคสใหม่)/`build`(route `/api/admin/preorders/[id]/delivery` ขึ้นจริง)
ผ่านหมด

---

## 5. ✅ ความเสี่ยงเชิงออกแบบใน `crudService.ts` — พบ + แก้แล้ว (พบ 2026-09-13, แก้ 2026-09-15)

> พบระหว่างตรวจว่า mass-assignment ผ่าน crud-factory (`createCrudService`) ปลอดภัยดีไหม —
> **ตรวจ 14 service ที่ใช้ `createCrudService` ทุกตัวแล้ว ปลอดภัยหมด** (ทุกตัวระบุ `createFields`
> ครบ ซึ่ง `updateFields` จะ fallback ไปใช้ค่านี้อัตโนมัติถ้าไม่ได้ระบุแยก) — **แต่ตัว library เองมี
> ดีไซน์ที่เป็นกับดัก** ไว้รอ service ในอนาคตที่ลืมระบุ

`src/lib/crudService.ts` — `create()`/`update()`:
```ts
const payload = createFields ? pick(input, createFields) : input;   // create()
const payload = updateFields ? pick(input, updateFields) : input;   // update()
```
ถ้า service ไหน**ไม่ระบุ** `createFields`/`updateFields` ตอนเรียก `createCrudService(model, opts)` —
`payload` จะเป็น **request body ดิบทั้งก้อนไม่มี whitelist เลย** ไปเขียนลง DB ตรง ๆ ผ่าน `$set` (`update`)
หรือ `model.create()` (`create`) — client ส่งฟิลด์อะไรมาก็ตั้งได้หมด รวมถึงฟิลด์อ่อนไหวที่ไม่ควรแตะตรง ๆ
เช่น `deleted_at`, `used_count`, `current_stock` (ถ้า model มีฟิลด์แบบนี้)

**สถานะปัจจุบัน (ตรวจแล้ว 2026-09-13):** ทั้ง 14 service (`banner`/`componentCategory`/`component`/
`deliveryZone`/`expense`/`ingredientCategory`/`ingredient`/`notification`/`productCategory`/
`productOption`/`productVariant`/`recipe`/`role`/`sentiment (aspect+semanticTerm)`) ระบุ `createFields`
ครบทุกตัว — spot-check `ingredientService.ts` เจอว่าตั้งใจแยก `createFields`/`updateFields` สองชุดถูกต้อง
ด้วยซ้ำ (`current_stock` อยู่ใน `createFields` เท่านั้น ไม่อยู่ใน `updateFields` — มีคอมเมนต์กำกับไว้ตรงว่า
"current_stock ตั้งได้แค่ตอนสร้าง (ยอดยกมา) หลังจากนั้นต้องผ่าน transaction") **ไม่มีบั๊กที่เกิดขึ้นจริงตอนนี้**

**วิธีแก้ที่ใช้จริง (2026-09-15):** เปลี่ยน `createFields` ใน `CrudOptions` (`src/lib/crudService.ts`) จาก
optional (`?:`) เป็น **required** — `updateFields` ปล่อยเป็น optional ต่อไปได้เพราะ fallback
(`opts.updateFields ?? opts.createFields`) รับประกันว่ามีค่าเสมอเมื่อ `createFields` required แล้ว ·
`create()`/`update()` เปลี่ยนจาก `createFields ? pick(...) : input` เป็น `pick(input, createFields)` ตรง ๆ
(ไม่มีทางเป็น `undefined` อีกต่อไป ตัด dead branch ออก)

**ผลจากการเปลี่ยน type — compiler เจอจุดจริง 1 จุดทันที:** `src/services/notificationService.ts` เรียก
`createCrudService` โดยระบุแค่ `updateFields: ["is_read"]` **ไม่มี `createFields` เลย** — แปลว่าก่อนแก้
`base.create()` (ที่ถูก spread ออกมาเป็น `notificationService.create` ผ่าน `{ ...base, notify }`) จะรับ
request body ดิบทั้งก้อนไม่มี whitelist จริงตามที่ §5 กังวลไว้ทุกประการ — **ไม่ได้ถูกเรียกจริงในโค้ด
ตอนนี้** (ยืนยันแล้ว: `GET /api/admin/notifications` มีแค่ `GET` ไม่มี `POST` route — คอมเมนต์บนทั้งไฟล์
service และ route บอกตรงกันว่า "สร้างได้ทางเดียวคือ `notify()`" ซึ่งเขียนผ่าน `notificationModel.create()`
ตรง ๆ ไม่ผ่าน `base` เลย) แต่เป็น dead-but-exposed method ที่ถ้ามีใครเพิ่ม `POST` route ในอนาคตแล้วลืม
เช็คจุดนี้ก่อนจะกลายเป็นช่องโหว่ทันที — เพิ่ม `createFields: ["title", "message", "module", "type",
"link", "is_read"]` (ชุดเดียวกับฟิลด์ที่ `notify()` เขียนจริง ไม่รวม `line_sent`/`line_error`/`deleted_at`
ที่ควรถูกจัดการภายในเท่านั้น) ปิดช่องนี้แล้ว

ยืนยันด้วย `typecheck` (เจอ error ที่ `notificationService.ts` ก่อนแก้ ตรงตามคาด) / `typecheck:test` /
`lint` (0 error, 5 warning เดิมไม่เปลี่ยน) / `test` (171) / `test:integration` (138) / `build` ผ่านหมด

---

## 6. ยังไม่ได้ตรวจ (ขอบเขตที่ยังไม่ครอบในรอบนี้)

- ไล่เทียบ `productionOrderService`/`preorderRoundService` กับฟังก์ชันคู่ขนานอื่น (ไม่มี "ต้นแบบ" ที่
  ชัดเจนเท่า order/preorder จึงยังไม่ได้ทำแบบเดียวกับ §4)
- ตรวจ race condition อื่นนอกจาก quota/usage ที่มีการ์ดแล้ว (เช่น stock ระดับ variant)
- ตรวจ validation coverage ของ `/api/shop/preorders` (POST) ที่ [BACKLOG.md §3.8](BACKLOG.md) บันทึกไว้
  แล้วว่ายังไม่ zod-adopt เต็ม — เป็น gap ที่รู้ตัวอยู่แล้ว ไม่ใช่ของใหม่
- ตรวจ rate-limit coverage ของ endpoint สาธารณะอื่นนอกจาก auth (เช่น `/api/shop/promotions/validate`,
  `/api/shop/orders/delivery-quote`) — ตอนนี้ตั้งใจครอบแค่ 4 endpoint ตาม [BACKLOG.md §3.2](BACKLOG.md)
  ยังไม่ได้ประเมินว่าควรขยายไหม
