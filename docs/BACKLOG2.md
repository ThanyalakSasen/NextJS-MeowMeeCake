# MeowMeeCake Backend — BACKLOG 2: บั๊ก/ความเสี่ยงชุดใหม่

> สร้าง: 2026-09-13 · อัปเดตล่าสุด: 2026-09-22 (§12.1 แก้ครบแล้ว — รีเซ็ตทั้งรหัสผ่านบัญชี owner จริง
> (ยืนยันด้วย API จริง: login รหัสใหม่ 200 / รหัส seed เดิม 401) และรหัสผ่าน Atlas DB user (ผู้ใช้เปลี่ยน
> เองที่ Atlas console, ยืนยันด้วย GET /api/health db:connected + login จริง) · §12.2 แก้แล้ว — เพิ่ม
> sort ให้ query หาสูตรตอนสร้างใบสั่งผลิตจากรอบพรีออเดอร์ deterministic
> (created_at + _id tie-breaker) · §13 แก้ครบแล้ว — created_at/updated_at ที่เก็บเป็น BSON Timestamp
> แทน Date ใน 6 collection/27 เอกสารทั้งหมด (products 6/6 + roles/banners/ingredients/
> ingredientcategories/units 21/21) ไม่มีเอกสารไหนเหลือในระบบอีกแล้ว (ยืนยันด้วย audit สแกนครบ 47
> collection) — §1–§11 ปิดครบเหมือนเดิม · §14 ใหม่ — `product_id` ไม่อัปเดตตามเมื่อ `product_type`
> ถูกแก้ไขทีหลัง พบ 2 สินค้าที่ prefix รหัส (`pos-`) ไม่ตรงกับประเภทปัจจุบัน (preorder) — ยังไม่แก้)
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
| **§7 rate-limit coverage ของ public endpoint อื่น** | ✅ **แก้ 1/2** (2026-09-15) — เพิ่ม rate-limit ที่ `/shop/promotions/validate` (กันเดารหัสโปรโมชัน) · `delivery-quote`/`orders/by-no`/`catalog/**` ตรวจแล้วไม่ต้องแก้ |
| **§8 validation coverage ของ `POST /api/shop/preorders`** | ✅ **แก้แล้ว** (2026-09-15) — เพิ่ม `schemas/preorder.ts` (zod) + รองรับ `address_id` (ปิด gap เดิมของ [BACKLOG.md §3.8](BACKLOG.md) ไปพร้อมกัน) |
| **§9 `variant_stock` ไม่เคยถูกเช็ค/ตัดสต็อกเลย** | 🟡 **พบจริง ไม่ใช่ race condition แต่ไม่มีการเช็คเลย** (2026-09-15) — DB จริงมี 0 active variant ตอนนี้ (ผลกระทบ = 0) ผู้ใช้เลือกบันทึกเป็นความเสี่ยงไว้ก่อน ไม่แก้โค้ดตอนนี้ |
| **§10 `createProductionOrder` ไม่มี Saga — header ค้างถ้า items ผิด** | ✅ **แก้แล้ว** (2026-09-15) — เพิ่ม `Saga` rollback header เมื่อ `addItems()` throw (เทียบ `orderService`/`preorderService` ที่มี, `preorderRoundService.createRound()` validate ก่อนสร้างอยู่แล้วจึงไม่ต้องแก้) |
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

## 7. ✅ rate-limit coverage ของ endpoint สาธารณะอื่นนอกจาก auth (พบ + แก้ 1/2, 2026-09-15)

> เดิมตั้งใจครอบแค่ 4 endpoint กลุ่ม auth (`login`/`register`/`google`/`me/password` — ดู
> [`security-hardening.md`](security-hardening.md) §3.2) ยังไม่เคยประเมินว่า endpoint อื่นที่ไม่ผ่าน
> middleware แบบ public (หรือ authenticated แต่เปิดให้ทุกคนที่ล็อกอินยิงได้) ควรมี rate-limit เพิ่มไหม —
> ไล่เช็คทุก route ใน `src/app/api/shop/**` + `src/app/api/catalog/**` (33 ไฟล์) แบ่งเป็น 2 กลุ่มความเสี่ยง

| Endpoint | ความเสี่ยง | ผล |
|---|---|---|
| `POST /api/shop/promotions/validate` | **enumeration/brute-force** — รับ `code` เป็น string อิสระ ตรวจว่าโค้ดใช้ได้ไหม ไม่มี rate-limit เดิมเลย ลูกค้าที่ล็อกอินแล้ว (สมัครฟรี) เขียนสคริปต์ลองโค้ดเป็นพัน ๆ ครั้งเพื่อเดาโค้ดโปรโมชันที่ยังไม่เปิดเผย/เฉพาะกลุ่มได้ — pattern เดียวกับที่กันไว้แล้วที่ `/auth/login` (เดารหัสผ่าน) | ✅ **แก้แล้ว** — เพิ่ม `rateLimit(clientIp(req), "promotions:validate", { limit: 20, windowMs: 60_000 })` |
| `POST /api/shop/orders/delivery-quote` | คำนวณค่าส่งจาก province + cart subtotal — ไม่มี "ค่าลับ" ให้เดา (province เป็นข้อมูลสาธารณะ) และคำนวณเบา (`cartService.getCartDetail` + `calcDeliveryFee` ที่มี cache zone อยู่แล้ว) — ความเสี่ยงเท่า endpoint authenticated ทั่วไปอื่น ๆ ในระบบที่ไม่ได้ rate-limit เช่นกัน ไม่ใช่ brute-force target | ✅ ตรวจแล้ว **ไม่ต้องแก้** |
| `GET /api/shop/orders/by-no/[orderNo]` | สุ่ม order_no ได้ (`OP-YYYYMMDD-XXXXXX`, `XXXXXX` = 6 ตัวอักษร base36 = 36⁶ ≈ 2.18 พันล้านค่าต่อวัน) แต่ route เช็ค `requireOwner(session, order.user_id)` เสมอ — เดาถูกได้แค่ 403 (ไม่ใช่เจ้าของ) ไม่มีข้อมูลรั่ว ไม่ใช่ endpoint ที่ "สำเร็จ = ได้ของมีค่า" แบบโปรโมชัน + keyspace ใหญ่เกินจะ brute-force จริงด้วย rate-limit ระดับ IP | ✅ ตรวจแล้ว **ไม่ต้องแก้** |
| `src/app/api/catalog/**` (12 route) | อ่านอย่างเดียวทั้งหมด (public, ไม่ต้องล็อกอิน) ไม่มี secret ให้เดา — ความเสี่ยงเป็น scraping/DoS ทั่วไปเหมือน GET endpoint อื่นทุกตัวในระบบ ไม่ใช่ของเฉพาะกลุ่มนี้ | ✅ ตรวจแล้ว **ไม่ต้องแก้** (นอกขอบเขต — ต้องเป็นนโยบายระดับระบบ เช่น CDN/WAF ไม่ใช่แก้ทีละ route) |

ยืนยันด้วย `typecheck`/`typecheck:test`/`lint`(0 error)/`test`(171)/`test:integration`(138)/`build` ผ่านหมด
— ไม่มี unit/integration test เดิมยิงเข้า route นี้ซ้ำ ๆ จนชน limit ใหม่ (เทสที่มีเรียก
`promotionService.previewForCart` ตรง ไม่ผ่าน route)

---

## 8. ✅ validation coverage ของ `POST /api/shop/preorders` — ปิด gap ที่รู้ตัวจาก BACKLOG.md §3.8 (2026-09-15)

> [`BACKLOG.md` §3.8](BACKLOG.md) เคยบันทึกไว้แล้วว่า `/api/shop/preorders` (POST) เป็น "path คู่ขนาน"
> ของ `/api/shop/orders` ที่**ไม่ผ่าน zod เลย** และ**ไม่รองรับ `address_id`** (ต้องกรอกที่อยู่ใหม่ทั้งก้อน
> ทุกครั้ง ใช้สมุดที่อยู่ไม่ได้) — รอบนี้ไล่อ่าน route + service จริงแล้วปิดทั้งสองช่องพร้อมกัน เพราะเป็น
> การแก้จุดเดียวกัน (schema ใหม่ต้องมี `address_id` อยู่แล้วถ้าจะ mirror `createOrderBody`)

**สถานะก่อนแก้ (ยืนยันด้วยการอ่านโค้ดจริง):**
- `src/app/api/shop/preorders/route.ts` — `POST` อ่าน `body.round_id`/`order_type`/`delivery_address`/
  `items` ตรงจาก `await req.json()` ไม่ผ่าน `parseBody`/zod เลย (ตัวแปรผลลัพธ์เป็น `preorder: any` —
  ตรงกับ `no-explicit-any` warning ที่ lint เคยเก็บไว้ที่บรรทัดนี้)
- `preorderService.createPreorder()` มี manual validation ของตัวเองอยู่แล้ว (เช็ค `order_type` enum,
  `items.length>0`, `round_item_id` เป็น ObjectId, `quantity` เป็นจำนวนเต็ม ≥1, `delivery_address`
  field ครบตาม `ADDRESS_FIELDS`) — **ไม่ใช่ mass-assignment/injection ที่ใช้ประโยชน์ได้จริง** (route ดึง
  แค่ 4 field ที่รู้จักจาก body ไม่ spread ทั้งก้อน) แต่ไม่มีทาง reuse `addressService.resolveDeliverySnapshot()`
  ได้เลยเพราะไม่รับ `address_id`/`recipient_name`/`recipient_phone` — ลูกค้าพรีออเดอร์แบบ delivery ต้อง
  พิมพ์ที่อยู่ใหม่ทุกครั้ง ใช้สมุดที่อยู่ที่มีอยู่แล้วไม่ได้ ต่างจาก `/shop/orders` ที่ทำได้ตั้งแต่รอบ 4c
- `GET` ก็เช่นกัน — cast query param ด้วย `as PreorderStatus | null` ตรง ๆ ไม่ผ่าน enum validation
  (ส่ง `order_status=garbage` มาจะไม่ error แค่ได้ผลลัพธ์ว่างเงียบ ๆ แทนที่จะเป็น 400 ที่อธิบายได้)

**วิธีแก้ที่ใช้จริง (2026-09-15):** สร้าง `src/schemas/preorder.ts` ใหม่ (ไฟล์เดิมไม่มี — `preorderRound.ts`
เป็นคนละเรื่อง คือ validation ของ `/api/admin/preorder-rounds*` การจัดการรอบฝั่งแอดมิน):
- `createPreorderBody` — mirror `createOrderBody` ทุกประการสำหรับส่วนที่ preorder มีร่วมกับ order
  (เงื่อนไข `address_id`/`delivery_address` oneOf + `recipient_name`/`recipient_phone` บังคับคู่กับ
  `address_id` — **โค้ดซ้ำกับ `schemas/order.ts` ตั้งใจ** เหมือนเหตุผลที่ `order.ts` เองก็ไม่ดึง
  `.refine()` ระหว่าง `createOrderBody`/`adminCreateOrderBody` มาเป็นฟังก์ชันกลาง — zod v4 `.extend()`
  ต้องมาก่อน `.refine()` เสมอ) `items` เป็น `z.array(...).min(1)` แทนการเช็คใน service (ยังคงเช็คซ้ำใน
  service ไว้เหมือนเดิม เป็นชั้นป้องกันที่สองสำหรับ caller อื่นที่ไม่ผ่าน route)
- `listPreorderQuery` — mirror `listOrderQuery` (enum `order_status`/`payment_status`/`order_type` +
  `round_id` เป็น `objectId`)
- **ไม่ import ค่า enum จาก `preorderService.ts` มาใช้ซ้ำ** (แม้จะมี `PREORDER_STATUSES`/
  `PAYMENT_STATUSES` export อยู่แล้วก็ตาม) — hardcode ค่าเดิมแยกไว้ในสคีมาแทน ตรงกับ convention เดิมของ
  `schemas/order.ts#listOrderQuery` ที่ก็ hardcode เอง ไม่ import ข้ามชั้นจาก service (schemas ควรเป็น
  leaf-level dependency ไม่ใช่ service → schema)
- `route.ts` เปลี่ยนมาใช้ `parseBody(req, createPreorderBody)` + `parseQuery(sp, listPreorderQuery)` +
  `addressService.resolveDeliverySnapshot()` (ฟังก์ชันเดียวกับที่ `/shop/orders` ใช้ — generic พอใช้ร่วม
  ได้ทันทีไม่ต้องแก้) — ปิด `any` ที่ lint เคยเก็บไว้ไปด้วยในตัว (ไม่ต้องแก้แยก)
- เทสใหม่ `tests/lib/schemas-preorder.test.ts` (10 เคส: shape พื้นฐาน, `items` ว่าง, enum/quantity ผิด,
  ObjectId รูปแบบผิด, `address_id`/`delivery_address` oneOf ครบ 5 เคสเหมือนที่ `schemas/order.ts` มี,
  `listPreorderQuery` enum) — ไม่มี unit/integration test เดิมยิงเข้า route นี้ตรง ๆ (เทสเดิมเรียก
  `preorderService.createPreorder` ตรง ไม่ผ่าน route/schema) จึงไม่มีอะไรพังจากการเปลี่ยนนี้

ยืนยันด้วย `typecheck`/`typecheck:test`/`lint` (0 error, **4 warning** ลดจาก 5 — `no-explicit-any` ที่
`shop/preorders/route.ts` หายไปพร้อมกับการลบ `preorder: any`)/`test` (171→**181**, +10)/
`test:integration` (138, ไม่เปลี่ยน — ไม่ต้องเพิ่มเพราะ `resolveDeliverySnapshot()` มีเทส integration
อยู่แล้ว (`tests/integration/resolveDeliverySnapshot.test.ts`) และ route layer ของ endpoint อื่นทั้งระบบ
ก็ไม่มี integration test แบบยิง HTTP จริงเช่นกัน — เทียบเท่า `/shop/orders` ที่ก็ครอบแค่ระดับ schema
unit test)/`build` ผ่านหมด

---

## 9. 🟡 `variant_stock` ไม่เคยถูกเช็ค/ตัดสต็อกเลยทั้งระบบ — ความเสี่ยงเชิงออกแบบ ไม่ใช่บั๊กที่เกิดจริง (พบ 2026-09-15)

> เดิมโจทย์คือ "ตรวจ race condition อื่นนอกจาก quota/usage ที่มีการ์ดแล้ว (เช่น stock ระดับ variant)"
> — ไล่โค้ดจริงแล้วพบว่า**ไม่ใช่ race condition** (ซึ่งหมายถึงมีการเช็คแต่ atomicity รั่ว) แต่เป็นกรณีที่
> **ไม่มีการเช็ค/บังคับใช้เลยสักจุดในทุก code path** — ร้ายแรงกว่า race condition เปล่า ๆ แต่ยืนยัน DB
> จริง (read-only) แล้วพบว่า **ผลกระทบปัจจุบัน = 0** เพราะไม่มี active variant อยู่เลยสักตัวในระบบตอนนี้

**ยืนยันด้วยการอ่านโค้ดจริงครบทุกจุดที่เกี่ยวข้อง:**
- `productVariantModel.ts` มีฟิลด์ `variant_stock` (`min: 0`) — แก้ไขได้ผ่าน
  `productVariantService`/`/api/admin/product-variants` ปกติ และถูก `select()` มาแสดงใน
  `productService.resolveScan()` (คอมเมนต์ในโค้ด: "คืนสินค้า + ราคาปัจจุบัน + สต็อก + variants (ถ้ามี
  ให้ POS เลือกก่อนเพิ่มลงบิล)") — ยืนยันว่าฟิลด์นี้ตั้งใจให้พนักงาน POS ดูประกอบการตัดสินใจจริง ไม่ใช่
  ฟิลด์ขยะที่หลงเหลือ
- **แต่** `productService.StockItemInput` (type ที่ `checkStockAvailability()`/`deductStockForOrder()`/
  `restockForOrder()` ทั้ง 3 ตัวรับ) มีแค่ `{ product_id, quantity }` — **ไม่มี `variant_id` เลย**
  ตรวจทั้ง 3 ฟังก์ชันแล้วยืนยันว่าทำงานที่ระดับ `product_stock_quantity` (aggregate ต่อสินค้า) ล้วน ๆ
- `orderService.ts` — `resolveLines()` (บรรทัด ~200-219) หา `variant` มาใช้คำนวณราคา
  (`variant.variant_price`) เท่านั้น **ไม่เคยอ่านหรือเช็ค `variant.variant_stock` เลย** และตอนสร้าง
  `stockItems` ก่อนเรียก `deductStockForOrder()` (บรรทัด ~366-369) ก็ map จาก `{ product_id, quantity }`
  ทิ้ง `variant_id` ของ line ไปเฉย ๆ ทั้งที่ตัวแปรมีอยู่แล้ว
- ผลคือ: สินค้าที่มี variant (เช่น ไซส์ S/M/L แยกจำนวน) — ทุก variant ของสินค้าเดียวกัน**ใช้ pool สต็อก
  เดียวกัน**คือ `product_stock_quantity` ตอน checkout ไม่ว่าลูกค้าจะเลือก variant ไหน แปลว่าถ้าตั้งใจให้
  แต่ละ variant มีสต็อกแยกกันจริง (เช่น ไซส์ S เหลือ 0 แต่ M เหลือ 5) ระบบจะยัง**ยอมให้สั่งไซส์ S ได้ถ้า
  `product_stock_quantity` รวมยังเหลือ** — ไม่มีทาง reject รายการที่ variant เฉพาะหมดสต็อกแล้ว

**ยืนยันผลกระทบจริงด้วย DB จริง (read-only aggregate, 2026-09-15):** query หา active product variant
(`deleted_at: null`) ทั้งหมดในฐานจริง → **พบ 0 รายการ** ไม่มีสินค้าไหนใช้ระบบ variant อยู่เลยตอนนี้ —
แปลว่าช่องว่างนี้**ยังไม่เคยถูกกระตุ้นให้เกิดผลจริงกับลูกค้าเลยสักครั้ง**

**ตรวจซ้ำ (read-only, 2026-09-22) — ผลตรงกับที่บันทึกไว้ ไม่มีอะไรเปลี่ยน แถมยืนยันได้กว้างกว่าเดิม:**
- `productvariants` collection มี **0 เอกสารทั้งหมด** (ไม่ใช่แค่ 0 ที่ยัง active — ไม่เคยมีใครสร้าง variant
  เลยสักตัวตั้งแต่ระบบเริ่มใช้งานจริง)
- `orderitems.variant_id` และ `cartitems.variant_id` ที่ไม่เป็น `null` → **0 แถวทั้งคู่** — ยืนยันว่าช่อง
  ว่างนี้ไม่เคยถูก trigger จริงแม้แต่ครั้งเดียวตลอดประวัติการใช้งาน ไม่ใช่แค่ "ตอนนี้ไม่มีผลกระทบ"
- โค้ดที่ระบุไว้ด้านบนยังตรงกับปัจจุบันทุกจุด (ตรวจซ้ำ `StockItemInput`, `checkStockAvailability`/
  `deductStockForOrder`/`restockForOrder`, `orderService.resolveLines`) เพิ่มเติม: `cartService.ts`
  (`addToCart`) ก็เป็น code path เดียวกัน — อ่าน `variant_id`/`variant_price` มาคำนวณ `price_snapshot`
  เท่านั้น ไม่เคยอ่าน `variant_stock` เลยเช่นกัน และ `createOrderFromCart()` (เช็คเอาท์ฝั่งลูกค้า) ก็วิ่งผ่าน
  `resolveLines()`/`persistOrder()` ตัวเดียวกับ `createOrder()` (POS/แอดมิน) จึงยืนยันได้ว่าช่องว่างนี้ครอบ
  **ทุกเส้นทางสั่งซื้อจริง** ทั้งฝั่งลูกค้าและฝั่งแอดมิน ไม่ใช่แค่บางเส้นทาง

**การตัดสินใจ (ถามผู้ใช้ก่อนแก้ ตามธรรมเนียมของโปรเจกต์นี้เวลาเจอทางเลือกเชิงสถาปัตยกรรม — ไม่เดาเอง):**
เสนอ 3 ทาง (เก็บเป็นความเสี่ยงไว้ก่อน / แก้ให้ตัดสต็อกตาม variant จริง / ลบฟิลด์ทิ้งถ้าไม่มีแผนใช้) —
**ผู้ใช้เลือก "บันทึกเป็นความเสี่ยงเชิงออกแบบไว้ก่อน"** เหตุผล: ผลกระทบปัจจุบัน = 0 (ไม่มี variant ใช้
งานจริง) การแก้ให้ตัดสต็อกตาม variant เป็นงานใหญ่ที่แตะ `orderService`/`cartService`/POS create-order +
เทสหลายเคส ควรรอจนกว่าจะมีความต้องการใช้งาน variant จริงแล้วค่อยออกแบบให้ตรงกับ requirement ตอนนั้น
(อาจไม่ใช่แค่ "แก้ atomic guard" แต่ต้องตัดสินใจเรื่อง business logic ก่อน เช่น `product_stock_quantity`
ควรเป็นผลรวมของ `variant_stock` ทุกตัวไหม หรือเป็นคนละ pool กัน)

**สถานะ:** 🟡 ไม่แก้โค้ดรอบนี้ — บันทึกไว้เป็น known risk เดียวกับรูปแบบ §5 ก่อนแก้ (ตอนยังไม่มีจุดพังจริง)
**เงื่อนไขที่ควรกลับมาทำ:** ก่อนเปิดใช้ product variant จริงครั้งแรก (เพิ่มแถวใน `product-variants` ผ่าน
หน้าแอดมินสำหรับสินค้าที่ขายจริง) ต้องตัดสินใจ + แก้เรื่องนี้ก่อน ไม่งั้นลูกค้าจะสั่ง variant ที่หมดสต็อก
แล้วได้

---

## 10. ✅ `createProductionOrder` ไม่มี Saga rollback — เหลือ header ค้างถ้า items ผิดหลังสร้างแล้ว (พบ + แก้ 2026-09-15)

> โจทย์เดิม: "ไล่เทียบ `productionOrderService`/`preorderRoundService` กับฟังก์ชันคู่ขนานอื่น (ไม่มี
> \"ต้นแบบ\" ที่ชัดเจนเท่า order/preorder)" — เปลี่ยนวิธีตรวจ: แทนที่จะเทียบสองไฟล์นี้กันเอง (โดเมนต่างกัน
> เกินจะเทียบตรง ๆ) ไล่เทียบ**แต่ละไฟล์**กับ pattern "สร้าง header + child items" ที่ established แล้วใน
> `orderService.persistOrder()`/`preorderService.createPreorder()` (ทั้งคู่ห่อด้วย `Saga` — ดู
> `hardening-d3-plan.md` §3.3b) แทน — พบว่า `preorderRoundService.createRound()` ทำถูกอยู่แล้ว (validate
> items ทุกตัวให้ผ่าน**ก่อน**สร้าง header — ดูโค้ดจริงบรรทัด ~133-170 คอมเมนต์ในไฟล์เองก็บอกตรงว่า "ตรวจ
> items ก่อนสร้างรอบ (กันสร้างรอบค้างโดยไม่มีสินค้า)") แต่ `productionOrderService.createProductionOrder()`
> **ไม่ทำแบบนั้นและไม่มี Saga ด้วย** — เจอ gap จริง

**ยืนยันด้วยการอ่านโค้ดจริง:** `createProductionOrder()` (เดิม) สร้าง `productionOrderModel` (header,
สถานะ `"planned"`) ก่อน แล้ว**ค่อย**เรียก `productionItemService.addItems()` — ฟังก์ชันนี้ validate
`recipe_id` ↔ `product_id` ตรงกันไหม (`recipe.product_id !== input.product_id` → `badRequest`) **ข้างใน
ตัวเอง หลังจาก** header ถูกสร้างไปแล้ว ต่างจาก `preorderRoundService.createRound()` ที่ validate
`product_type === "preorder"` ของทุก item ให้ผ่าน**ก่อน**เรียก `preorderRoundModel.create()` — ผลคือถ้า
แอดมินสร้างใบสั่งผลิตหลายรายการพร้อมกันแล้วพิมพ์ `recipe_id`/`product_id` ไม่ตรงกันแม้แต่รายการเดียว (เช่น
สูตรของสินค้า A แต่ระบุ product_id เป็นสินค้า B — เกิดได้ง่ายเวลาสร้างใบสั่งผลิตหลายรายการพร้อมกันจริง
ผ่าน `POST /api/admin/production-orders`, permission `production.create`) จะเหลือใบสั่งผลิต `"planned"`
ที่**ไม่มีรายการเลยสักตัว**ค้างอยู่ใน DB ตลอดไป ไม่มีทาง rollback อัตโนมัติ (ต้องให้แอดมินมาลบเองด้วยมือ
ถ้าสังเกตเจอ)

**วิธีแก้ที่ใช้จริง (2026-09-15):** ห่อขั้น `addItems()` ด้วย `Saga` (`onRollback` ลบ header ถ้า
`addItems()` throw) — เลือกวิธีนี้แทนการ restructure `addItems()` ให้ validate-then-insert แบบ
`createRound()` เพราะ `addItems()` เป็นฟังก์ชันร่วมที่ `POST /admin/production-orders/[id]/items` ก็เรียก
ใช้ (เพิ่มรายการเข้าใบที่มีอยู่แล้ว ไม่มี header ให้ rollback) — Saga ที่จุดเรียกใน `createProductionOrder()`
เท่านั้นตรงเป้ากว่า ไม่ต้องแตะ `addItems()`/`addItem()` เลย · เทสใหม่
`tests/integration/createProductionOrderRollback.test.ts` (3 เคส: `recipe_id`/`product_id` ไม่ตรงกัน →
header ไม่เหลือค้าง, items ถูกต้องสร้างสำเร็จปกติไม่ rollback, รายการที่ 2 ผิดในชุดหลายรายการ → rollback
ทั้งชุดไม่เหลือรายการค้างแม้แต่รายการเดียว)

ยืนยันด้วย `typecheck`/`typecheck:test`/`lint`(0 error, 4 warning ไม่เปลี่ยน)/`test`(181,
ไม่เปลี่ยน — เทสใหม่เป็น integration)/`test:integration`(138→**141**, +3)/`build` ผ่านหมด

**preorderRoundService — ตรวจเพิ่มเติมแล้วไม่พบ gap อื่น:** `commitQty`/`releaseQty` ใช้ atomic `$inc` +
`$expr` guard แบบเดียวกับ `promotionUsage.recordUsage` ที่แก้ไปแล้วใน §2.9 (ของเดิมถูกอยู่แล้ว) ·
`removeRoundItem`/`updateRoundItem`(`max_qty_total`)/`deleteRound` มี guard กันแก้/ลบข้อมูลที่ถูกจองไป
แล้วครบทุกจุด — ไม่มีอะไรต้องแก้เพิ่ม

---

## 11. ยังไม่ได้ตรวจ (ขอบเขตที่ยังไม่ครอบในรอบนี้)

ไม่มีรายการเหลือจากรอบตรวจนี้ — BACKLOG2 §1–§10 ครบทุกข้อที่ตั้งไว้แล้ว (§9 บันทึกเป็นความเสี่ยงไว้ก่อน
ตามที่ผู้ใช้เลือก ไม่ใช่ปิดด้วยการแก้โค้ด) รายการที่ยังเปิดค้างจริง = สิ่งที่บันทึกไว้ใน §9 เท่านั้น

---

## 12. ✅ พบระหว่างเชื่อม frontend เข้ากับ backend จริง (2026-09-22) — §12.1/§12.2 แก้ครบแล้ว

> พบระหว่างทำงานร่วมกับ frontend agent (คนละ session/repo) ไม่ใช่รอบตรวจโค้ดแบบ §1–§10 — ยืนยันด้วยการ
> อ่านโค้ดจริง + query DB จริง (read-only) ทั้งสองข้อ ไม่ใช่รายงานดิบ

### 12.1 🔴 รหัสผ่านเจ้าของร้าน (seed default) เปิดเผยอยู่ใน repo สาธารณะ ใช้ล็อกอินจริงได้

**ยืนยันแล้ว:** `scripts/seed.ts` มี `OWNER_PASSWORD = "MeowMee@1234"` commit อยู่ใน git history จริง (ไม่ใช่
placeholder) — ทดสอบแล้วว่า login ผ่านได้จริงกับ DB จริง (2026-09-20) ทั้ง `NextJS-MeowMeeCake` และ
`NextJS-MeowMeeCake-Frontend` เป็น **GitHub repo สาธารณะ (public)** — ใครก็อ่านค่านี้ได้โดยไม่ต้องมีสิทธิ์
อะไรเลย ถ้ายังไม่เคยเปลี่ยนรหัสผ่านจริงของบัญชี owner หลัง seed ครั้งแรก บัญชีนี้ถือว่าถูกเปิดเผยต่อ
สาธารณะอยู่ตอนนี้

รหัสผ่าน MongoDB Atlas (`MONGODB_URI` ใน `.env.local`: `bakery_app:bakery_app`) ก็เดาง่ายเช่นกัน — ไม่ได้
commit ลง git (`.env.local` อยู่ใน `.gitignore`) จึงไม่เปิดเผยเท่าเคสแรก แต่ยังเป็นความเสี่ยงถ้าไฟล์รั่วออกไป

**วิธีแก้:** เปลี่ยนรหัสผ่านบัญชี owner จริงด้วย `npm run reset-owner-password -- <email> <new-password>`
(เวอร์ชันล่าสุดปลดล็อกบัญชีให้ด้วยแล้ว ดู `scripts/reset-owner-password.ts`) และเปลี่ยนรหัสผ่าน DB user
`bakery_app` ที่ตัว MongoDB Atlas เอง (นอกเหนือขอบเขตโค้ด ต้องทำที่ Atlas console) แล้วอัปเดต `MONGODB_URI`
ใน `.env.local` ที่ deploy จริงตาม

**ส่วนที่ทำแล้ว (2026-09-22):** รันสคริปต์ `reset-owner-password.ts` เปลี่ยนรหัสผ่านบัญชี owner จริง
(`thanyalak.sas@kkumail.com`) จาก seed เดิม (`MeowMee@1234`) เป็นรหัสผ่านใหม่ที่ผู้ใช้กำหนดเอง (ไม่บันทึก
ค่าจริงไว้ในเอกสารนี้) — **ยืนยันด้วย API จริง:** login ด้วยรหัสใหม่ → `200 OK` (คืน user จริง), login
ด้วยรหัส seed เดิม → `401` (ใช้ไม่ได้แล้ว) ปิดช่องโหว่ "รหัสผ่านเปิดเผยใน repo สาธารณะใช้ล็อกอินได้จริง"
เรียบร้อยสำหรับส่วนบัญชี owner

**ส่วนที่ทำแล้ว (ต่อ, 2026-09-22):** ผู้ใช้เปลี่ยนรหัสผ่าน MongoDB Atlas DB user `bakery_app` เองที่ Atlas
console (นอกเหนือขอบเขตที่ agent ทำได้จากในนี้) แล้วอัปเดต `MONGODB_URI` ใน `.env.local` ตาม — ยืนยันด้วย
`GET /api/health` (`{"ok":true,"db":"connected"}`) และ login จริงผ่าน API (`200 OK`) หลังรีสตาร์ท dev
server (ต้อง kill process เดิม + ลบ `.next` cache ก่อน — server เดิมมี cache เสียจากสลับ branch หลายรอบ
ระหว่างเซสชันนี้ ปนมากับตอนทดสอบ ไม่เกี่ยวกับรหัสผ่าน Atlas)

**สถานะ:** ✅ แก้ครบทั้งหมดแล้ว — รหัสผ่านบัญชี owner + รหัสผ่าน Atlas DB user เปลี่ยนแล้วทั้งคู่ ยืนยันผล
จริงแล้ว ปิดช่องโหว่ "รหัสผ่านเปิดเผยใน repo สาธารณะใช้ล็อกอิน/เชื่อม DB ได้จริง" สมบูรณ์

### 12.2 🟡 `createProductionFromRound` เลือกสูตรกำกวมถ้าสินค้ามีหลายสูตรที่ยังไม่ถูกลบ (ยังไม่มีผลกระทบจริง)

**บริบท:** ฟีเจอร์ใหม่ `POST /api/admin/production-orders/from-preorder-round` (PR #44,
`productionOrderService.createProductionFromRound`) ต้องหาสูตรของแต่ละสินค้าที่ถูกสั่งในรอบพรีออเดอร์ —
query ปัจจุบันคือ

```ts
const recipes = await recipeModel.find({ product_id: { $in: productIds }, deleted_at: null }).lean();
```

ไม่มี `.sort()` — ถ้าสินค้าหนึ่งมีสูตรที่ยังไม่ถูกลบมากกว่า 1 สูตร โค้ดจะใช้ "สูตรตัวแรกที่ query คืนมา" ซึ่ง
Mongo ไม่การันตีลำดับถ้าไม่ระบุ sort ชัดเจน (ต่างจาก `recipeService.getUnitCostByProduct()` ที่ sort
`created_at: -1` แล้วเลือกล่าสุดโดยตั้งใจ — จุดนี้เขียนไม่สอดคล้องกัน)

**ยืนยันด้วย DB จริง (read-only aggregate, 2026-09-22):** ตอนนี้**ไม่มีสินค้าตัวไหนมีสูตรซ้ำมากกว่า 1 สูตร
ที่ยังไม่ถูกลบเลย** (`recipes` group by `product_id` where `deleted_at:null` having count > 1 → ว่างเปล่า)
ผลกระทบปัจจุบัน = 0 เหมือนรูปแบบ §9 (`variant_stock`)

**การตัดสินใจ:** ถามผู้ใช้ว่าจะแก้แบบไหนระหว่าง 2 ทางเลือก (sort `created_at: -1` เอาสูตรล่าสุดเหมือน
`getUnitCostByProduct()`, หรือ 400 ปฏิเสธตรง ๆ ถ้าเจอสินค้าที่มีสูตรซ้ำ) — **ผู้ใช้เลือกทางแรก** (ใช้สูตร
ล่าสุด) เพราะทำงานต่อได้ปกติ ไม่บล็อกการสร้างใบสั่งผลิต

**แก้แล้ว (2026-09-22):**
- `productionOrderService.createProductionFromRound` — เพิ่ม `.sort({ created_at: -1, _id: -1 })` ที่
  query หาสูตร (`recipeModel.find(...)`) — เพิ่ม `_id: -1` เป็น tie-breaker ด้วย **ไม่ใช่แค่ `created_at`
  เฉย ๆ แบบ `getUnitCostByProduct()`** เพราะเทสที่เขียนใหม่เจอจริงว่า 2 สูตรที่สร้างในมิลลิวินาทีเดียวกัน
  (เช่นตอนรันเทสเร็ว หรือ bulk insert จริง) `created_at` เท่ากันเป๊ะ ทำให้ sort ผลลัพธ์ไม่ deterministic
  ตามที่ตั้งใจ — `_id` (ObjectId) มีตัวนับเพิ่มขึ้นเสมอต่อการสร้างในโปรเซสเดียวกัน แก้ปัญหานี้ได้ตรง ๆ
  (`getUnitCostByProduct()` เองก็มีช่องโหว่เดียวกันแฝงอยู่ แต่ไม่อยู่ในขอบเขตที่ขอให้แก้รอบนี้ — บันทึกไว้
  เผื่ออนาคต)
- `tests/integration/createProductionFromRound.test.ts` — เพิ่มเทสใหม่ 1 เคส: สร้าง 2 สูตรให้สินค้าเดียว
  (เก่า→ใหม่ตามลำดับสร้างจริง) ยืนยันว่าใบสั่งผลิตอ้างอิงสูตรใหม่ล่าสุดเสมอ ไม่ใช่ตัวไหนก็ได้

ยืนยันด้วย `typecheck`/`typecheck:test`/`lint` (0 error, warning เท่าเดิม 5 จุด ไม่เกี่ยวกับไฟล์ที่แก้)/
`test` (190)/`test:integration` (178, +1 จาก 177)/`build` ผ่านหมด

**เงื่อนไขที่เคยบันทึกไว้ (ปิดแล้ว):** ก่อนอนุญาตให้สินค้าหนึ่งมีสูตรที่ใช้งานพร้อมกันหลายสูตร (เช่น สูตร
ทางเลือกตามฤดูกาล/ต้นทุนวัตถุดิบ) ต้องตัดสินใจ + แก้เรื่องนี้ก่อน — ตอนนี้แก้แล้ว พฤติกรรมที่ได้คือใช้สูตร
ล่าสุดเสมอ (deterministic) ไม่ใช่ "ตัวแรกที่ Mongo คืนมา" แบบเดิมที่ไม่แน่นอน

**สถานะ:** ✅ แก้แล้ว (2026-09-22)

---

## 13. ✅ `created_at`/`updated_at` เก็บเป็น BSON `Timestamp` แทน `Date` — 6 collection/27 เอกสาร, แก้ครบแล้ว (2026-09-22)

> พบระหว่างทดสอบหน้าจอจริง (agent อื่นเปิดเบราว์เซอร์ทดสอบ frontend) — เจ้าของโปรเจกต์สังเกตเห็นรหัสสินค้า
> (`product_id`) มีคำว่า "NaN" ปนอยู่ (เช่น `pos-NaNNaN796`) ระหว่างดูหน้าจอจริง ไม่ใช่รอบตรวจโค้ดแบบ §1–§10
> — ยืนยันด้วยการอ่านโค้ดจริง + ตรวจ DB จริง (read-only) ก่อนแก้ทุกจุด

### สาเหตุ

`created_at`/`updated_at` ของบางเอกสารถูกเก็บเป็นชนิด BSON `Timestamp` — ชนิดภายในของ MongoDB สำหรับ
oplog/replication (ไม่ใช่ค่าที่ควรใช้เป็นข้อมูลแอป) — แทนที่จะเป็น `Date` ปกติที่ Mongoose
`timestamps: true` ตั้งให้อัตโนมัติ คาดว่าเกิดจากตอนนำเข้า/สร้างข้อมูลผ่านทางที่ข้าม Mongoose ไปเขียนตรง
กับ MongoDB driver (bulk import หรือ script migration รุ่นเก่าก่อนหน้านี้ — ไม่พบร่องรอยว่าเกิดจากสคริปต์
ใดในโค้ดปัจจุบัน)

ผลกระทบที่ยืนยันแล้ว: `scripts/backfill-product-codes.ts` (เดิม) ทำ `new Date(p.created_at)` แล้วได้
Invalid Date (`NaN`) สำหรับเอกสารที่เสีย ค่า `NaN` นั้นถูกฝังลงในรหัสสินค้า `pos-DDYYzzz`/`pre-DDYYzzz`
โดยตรง (5/6 เอกสาร) หรือได้วันที่ปลอม 1999-12-31 ที่บังเอิญผ่านรูปแบบ regex ของรหัสแต่ไม่มีความหมายจริง
(1/6 เอกสาร — `pos-0100074`) — และรันซ้ำ backfill ก็ไม่แก้ เพราะเงื่อนไข "ยังไม่มีรหัส" เช็คแค่ field ว่าง/
ไม่มี ไม่เช็ค pattern

**ผลกระทบใช้งานจริงที่ยืนยันแล้ว (ผ่าน API จริง):** `resolveScan()` (สแกนบาร์โค้ดที่ POS) เช็ค
`isProductCode()` (regex `^(pos|pre)-\d{7}$`) ก่อนเสมอ — รหัสที่มีตัวอักษร "N" ไม่ผ่าน ตกไปเช็ค `ObjectId`
ก็ไม่ผ่านอีก จบที่ 400 `"รูปแบบรหัสที่สแกนไม่ถูกต้อง"` **สินค้า 5 รายการสแกนที่ POS ไม่เจอเลยจริง ๆ**

### ขอบเขตที่เจอ (สแกนครบทุก 47 collection ในระบบ ไม่ใช่เดา)

| collection | เอกสารที่เสีย | created_at เสีย | updated_at เสีย |
|---|---|---|---|
| products | 6 | 6 | 0 |
| roles | 3 | 3 | 2 |
| banners | 2 | 2 | 0 |
| ingredients | 8 | 8 | 0 |
| ingredientcategories | 2 | 2 | 2 |
| units | 6 | 6 | 0 |
| **รวม** | **27** | | |

ยืนยันแล้วว่าไม่มี collection อื่นในระบบปนเปื้อนด้วย (scan ครบ 47/47 collection จริง)

### วิธีกู้วันที่จริง

BSON `Timestamp` เก็บเป็น (t, i) แต่ตีความ `t` เป็นวันที่จริงไม่ได้ — เอกสารที่เสียมี `t` เล็กมาก (412,
413, 414 = ไม่กี่นาทีหลัง 1970-01-01) ซึ่งไม่ใช่เวลาที่สร้างเอกสารจริงเลย จึงกู้จาก **`ObjectId` ของ
เอกสารเอง** แทน — ฝัง Unix timestamp ของตอนสร้างไว้ใน 4 byte แรกเสมอ (`objectId.getTimestamp()`) ไม่ขึ้น
กับ field `created_at` ที่เสีย เชื่อถือได้กว่ามาก · เทียบกับ `updated_at` (ถ้ายังเป็น Date ปกติ) เป็นตัวเช็ค
สมเหตุสมผล — ยืนยันว่าทุกแถวที่ `updated_at` ยังดีอยู่มีค่า **หลัง** วันที่กู้ได้เสมอ (ตรงตามตรรกะปกติ ไม่มี
ความผิดปกติเพิ่มเติม)

### สิ่งที่ทำแล้ว (เฉพาะ products, 2026-09-22)

- `scripts/audit-bson-timestamp-fields.ts` (read-only) — สแกนทุก collection จริง หา `created_at`/
  `updated_at` ที่เป็น BSON Timestamp, กู้วันที่จาก ObjectId, เฉพาะ products เสนอรหัสใหม่ที่ควรจะเป็นด้วย
- `scripts/fix-bson-timestamp-products.ts` — dry-run เป็นค่าเริ่มต้น, ตรวจกับ DB จริงก่อนเขียนทุกแถว
  (ยังเป็น BSON Timestamp จริงไหม / product_id ยังตรงกับ report ไหม), สร้างรหัสใหม่ด้วย
  `generateProductCode()` เดิม (รหัสชนกัน → สุ่มใหม่อัตโนมัติ ใช้ unique index ที่มีอยู่แล้ว), สำรองค่าเดิม
  ลง `scripts/backups/`, marker กันรันซ้ำใน `migrations`
- รัน `--apply` แล้วกับ DB จริง (2026-09-22) — **6/6 สำเร็จ ไม่มีรายการล้มเหลว** ยืนยันผลด้วย query DB จริง
  (0 รหัสมี "NaN" เหลือ, 0 `created_at` เป็น Timestamp เหลือ, ทุกรหัสผ่าน pattern 100%) และยืนยันซ้ำผ่าน
  `GET /api/admin/pos/scan` จริง — รหัสใหม่สแกนเจอสินค้าถูกต้อง, รหัสเก่ายังถูกปฏิเสธเหมือนเดิม (ตรงตาม
  design ของ `isProductCode()`)
- **⚠️ ผลข้างเคียงที่ไม่ใช่งานโค้ด:** รหัสสินค้าทั้ง 6 รายการเปลี่ยนไปจากเดิม (แม้แต่ตัวที่ "ดูปกติ" อย่าง
  `pos-0100074` เดิม ก็เปลี่ยนเป็นรหัสใหม่ด้วย เพราะวันที่ในรหัสเดิมเป็นค่าปลอม) — ถ้าเคยพิมพ์บาร์โค้ด/
  ป้ายราคาด้วยรหัสเดิมไปแล้ว ต้องพิมพ์ใหม่

### ส่วนที่ทำแล้ว (21 เอกสารที่เหลือ, 2026-09-22)

- `scripts/fix-bson-timestamp-other-collections.ts` (ใหม่) — เดียวกับ `fix-bson-timestamp-products.ts`
  ทุกจุดด้านความปลอดภัย (dry-run เป็นค่าเริ่มต้น, ปฏิเสธ report เก่ากว่า 24 ชม., ตรวจกับ DB จริงก่อนเขียน
  ทุกแถว, สำรองค่าเดิมลง `scripts/backups/`, marker กันรันซ้ำ) แต่ต่างจาก products ตรงที่ **ไม่ต้องสร้าง
  รหัสใหม่** (5 collection นี้ไม่มี field รหัสที่พึ่งพา `created_at` เหมือน `product_id`) แก้แค่
  `created_at`/`updated_at` ให้เป็น `Date` ที่กู้จาก `ObjectId.getTimestamp()`
- **`updated_at` ที่เสียด้วย (4 แถว: roles 2, ingredientcategories 2):** ไม่มีแหล่งข้อมูลอื่นที่เชื่อถือได้
  กว่าในการกู้ "เวลาแก้ไขล่าสุดจริง" (ต่างจาก `created_at` ที่กู้จาก ObjectId ได้ตรง ๆ) จึงตั้งเป็นค่า
  เดียวกับ `created_at` ที่กู้ได้ (สมมติว่ายังไม่เคยถูกแก้ไขหลังสร้าง — สมมติฐานที่ระมัดระวังที่สุดเท่าที่
  ทำได้ ไม่มีข้อมูลอื่นชี้ว่าเคยมีการแก้ไขจริงเมื่อไหร่)
- รัน `--apply` แล้วกับ DB จริง (2026-09-22) — **21/21 สำเร็จ ไม่มีรายการล้มเหลว** ยืนยันด้วยการรัน
  `audit-bson-timestamp-fields.ts` ซ้ำ: **0 เอกสารเสียเหลือในทั้ง 47 collection ของระบบ** (ปิดครบทุก
  collection แล้ว ไม่ใช่แค่ 5 ที่ตั้งใจแก้รอบนี้)

ยืนยันด้วย `typecheck`/`lint` (0 error, warning เท่าเดิม 5 จุด ไม่เกี่ยวกับไฟล์ที่แก้) ผ่านหมด — สคริปต์นี้
เป็น one-off migration เหมือน `fix-bson-timestamp-products.ts` ไม่มี vitest ประกบ (ยืนยันผลผ่าน dry-run +
DB จริงแทน ตามแพทเทิร์นเดียวกับสคริปต์แก้ข้อมูลตัวอื่นในโปรเจกต์นี้)

**สถานะ:** ✅ แก้ครบทั้งหมดแล้ว — products (6/6) + roles/banners/ingredients/ingredientcategories/units
(21/21) รวม 27/27 เอกสารที่เจอตอน audit ครั้งแรก ไม่มีเอกสารไหนเหลือ BSON Timestamp ในระบบอีกแล้ว

---

## 14. 🟡 `product_id` ไม่อัปเดตตามเมื่อ `product_type` ถูกแก้ไขทีหลัง — prefix ค้างผิดประเภท (พบ 2026-09-22)

> พบระหว่างช่วยฝั่ง frontend สร้างแผ่นบาร์โค้ดทดสอบ (agent อื่นคนละ session/repo) — เจ้าของโปรเจกต์สังเกต
> ว่าสินค้าพรีออเดอร์บางตัวมีรหัสขึ้นต้นด้วย `pos-` ทั้งที่ควรเป็น `pre-`

**สาเหตุ (ยืนยันด้วยการอ่านโค้ดจริง):** `generateProductCode(product_type)` ถูกเรียกแค่จุดเดียวคือใน
`createProduct()` (`src/services/productService.ts` บรรทัด ~236) — คำนวณ prefix (`pos-`/`pre-`) จาก
`product_type` **ณ ตอนสร้างเท่านั้น** ส่วน `updateProduct()` (บรรทัด ~393 เป็นต้นไป) รับ `product_type`
เป็นฟิลด์ที่แก้ไขได้ปกติ (ผ่าน `validateTypeConsistency()`) **แต่ไม่มีจุดไหนเรียก
`generateProductCode()` ใหม่หรือแตะ `product_id` เลย** — ถ้าใครเปลี่ยนประเภทสินค้าทีหลังผ่านหน้าแก้ไข
รหัสเดิมจะติดอยู่กับ prefix ของประเภทเก่าตลอดไป ไม่มีอะไรเตือน/ปฏิเสธด้วย

**ยืนยันผลกระทบด้วย DB จริง (read-only, 2026-09-22):** สแกนสินค้าที่มีรหัสทั้งหมด (37 ตัว) เทียบ prefix
กับ `product_type` ปัจจุบัน → พบ **2 ตัวที่ไม่ตรงกัน**:

| สินค้า | รหัส | ประเภทปัจจุบัน | created_at | updated_at |
|---|---|---|---|---|
| เค้กสตรอว์เบอร์รีครีม | `pos-1626294` | preorder | 2026-08-16 | 2026-09-06 (ห่าง 21 วัน) |
| บราวนี่มัทฉะ | `pos-1626338` | preorder | 2026-08-16 | 2026-09-06 (ห่าง 21 วัน) |

ทั้งคู่มี `created_at`/`updated_at` ห่างกันจริง 21 วันพอดี (สร้างพร้อมกันวันเดียว, แก้พร้อมกันอีกวันหนึ่ง)
ตรงกับสมมติฐานว่าเคยแก้ประเภทสินค้าเป็นกลุ่มพร้อมกันครั้งหนึ่งแล้วรหัสไม่ตามให้ — ทั้งสองตัวยัง
`is_visible: false` และ `preorder_config: null` อยู่ (ดูเหมือนเป็นข้อมูลทดสอบที่ยังไม่สมบูรณ์ ไม่ใช่
สินค้าที่ขายจริงตอนนี้ — บันทึกไว้เผื่อเป็นเบาะแสเพิ่มเติม ไม่ใช่ปัญหาที่ต้องแก้ในหัวข้อนี้)

**ผลกระทบ:** ไม่ทำให้สแกน POS พังเหมือน §13 (รหัสยัง match กับ `isProductCode()` regex ปกติ สแกนเจอ
สินค้าถูกตัวอยู่) แต่ prefix ที่ไม่ตรงกับประเภทจริงทำให้**สับสนเวลาดูรหัสตรง ๆ** (เช่น ทำแผ่นป้าย/บาร์โค้ด
แยกตามประเภทให้พนักงาน จะจัดกลุ่มผิดถ้าเชื่อ prefix อย่างเดียว) และเป็นเบาะแสว่าข้อมูลอื่นของสินค้านี้ก็
อาจไม่ sync กันหลังแก้ไขทีหลังเหมือนกัน (`preorder_config` ที่ยังเป็น `null` ทั้งที่ type เป็น preorder
แล้วก็เป็นตัวอย่างเดียวกัน)

**การตัดสินใจ:** บันทึกไว้ก่อนตามที่ผู้ใช้ขอ ยังไม่แก้โค้ด/ข้อมูลตอนนี้

**ทางเลือกที่เป็นไปได้เมื่อพร้อมแก้:**
- (ก) แก้เฉพาะ 2 แถวนี้ตรง ๆ ด้วยสคริปต์ (สร้าง `product_id` ใหม่ด้วย `generateProductCode("preorder", ...)`
  แบบเดียวกับ `fix-bson-timestamp-products.ts`) — แก้ปลายเหตุ ไม่กันไม่ให้เกิดซ้ำ
- (ข) แก้ที่ต้นเหตุใน `updateProduct()` — ถ้า `input.product_type` เปลี่ยนจริงและ prefix ของ
  `product_id` เดิมไม่ตรงกับประเภทใหม่ ให้สร้างรหัสใหม่ให้อัตโนมัติ (ต้องคิดเรื่อง retry ชนกันเหมือน
  ตอนสร้างใหม่ด้วย) — ป้องกันไม่ให้เกิดซ้ำในอนาคต แต่เป็นงานที่ใหญ่กว่าและมีผลข้างเคียง (รหัสสินค้าเปลี่ยน
  ทุกครั้งที่แก้ประเภท — ถ้าเคยพิมพ์บาร์โค้ด/ป้ายราคาไปแล้วต้องพิมพ์ใหม่ เหมือนที่เคยเตือนไว้ใน §13)

**เงื่อนไขที่ควรกลับมาทำ:** ก่อนใช้ prefix ของ `product_id` เป็นเกณฑ์แยกประเภทสินค้าในหน้าจอ/รายงานใดๆ
(เช่นแผ่นบาร์โค้ดที่แยกตาม prefix) ควรตรวจสอบ/แก้ 2 แถวนี้ก่อน ไม่งั้นจะจัดกลุ่มผิด

**สถานะ:** 🟡 ยังไม่แก้ — บันทึกไว้ก่อนตามที่ผู้ใช้ขอ
