# MeowMeeCake Backend — BACKLOG 2: บั๊ก/ความเสี่ยงชุดใหม่

> สร้าง: 2026-09-13
> ขอบเขต: ฝั่ง Backend (`src/**`, `scripts/**`) — ยังไม่รวม frontend เหมือน [`BACKLOG.md`](BACKLOG.md)
> วิธีตรวจ: อ่านโค้ดจริง + grep หา pattern ที่เคยเป็นบั๊กมาก่อนซ้ำที่อื่น + ตรวจ DB จริง (read-only) เพื่อ
> ยืนยันผลกระทบ — **ไม่ใช่รายงานดิบจาก agent** (ตามธรรมเนียมเดิมของ [`BACKLOG.md`](BACKLOG.md) §2b/§2c/§2d)
> **สถานะ: พบแล้ว ยังไม่แก้สักข้อ** (เอกสารนี้คือขั้นตอน "หา" — รอผู้ใช้ตัดสินใจว่าจะแก้ข้อไหนก่อน
> เหมือนที่ [`BACKLOG.md`](BACKLOG.md) §2d ผ่านมา)

## สถานะโดยรวม

| ชั้น | สถานะ |
|---|---|
| **§1 unique index ไม่ partial ซ้ำกับ soft-delete (pattern เดิมจาก §2.3/§2.4/[BACKLOG.md §2d.2])** | 🔴 พบซ้ำอีก **8 จุด** — ยืนยันด้วย DB จริงแล้วว่า **ไม่มีข้อมูลซ้ำอยู่เลยสักคู่** (all-state และ active-only เท่ากับ 0 ทุกจุด) → แก้ได้ทันทีแบบเดียวกับ `unitModel` โดยไม่ต้อง cleanup ข้อมูลก่อน |
| **§2 N+1 query ซ้ำ pattern เดิมจาก §3.18 (checkout)** | 🔴 พบซ้ำอีก **2 จุด** — `preorderService.createPreorder` และ `productionOrderService.createProductionOrder` ไม่เคยได้ fix ตามที่ `orderService`/`cartService` ได้ไปแล้ว (คู่ขนานแบบเดียวกับที่ §2b เจอว่า preorder ไม่เคยได้ fix ตาม order) |
| ownership/IDOR ของ shop routes (`addresses`, `cart/items`, `reviews`) | ✅ ตรวจแล้ว **ไม่พบปัญหา** — ทุกจุด scope ด้วย `user_id` ที่ service layer ถูกต้อง (เทียบกับ `2b.1` ที่เคยพลาด) |
| duplicate-key error handling ทั่วไป (`crudService`/`apiResponse`) | ✅ ตรวจแล้ว **ไม่พบปัญหา** — `toErrorResponse()` แปลง Mongo `11000` เป็น response ที่มีโครงสร้างอยู่แล้ว ไม่ใช่ 500 ดิบ |

---

## 1. 🔴 Unique index ไม่ partial ซ้ำกับ soft-delete — พบอีก 8 จุด

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

| # | Model | Field(s) ที่ unique เฉย ๆ | Collection จริง | ผลกระทบถ้าไม่แก้ |
|---|---|---|---|---|
| 1 | `src/models/roleModel.ts` | `role_name` | `roles` | ลบ role ทิ้ง (soft) แล้วสร้าง role ชื่อเดิมใหม่ไม่ได้ตลอดกาล (เช่น พิมพ์ผิดแล้วลบ อยากสร้างชื่อเดิมใหม่) |
| 2 | `src/models/userModel.ts` | `email` | `users` | **กระทบสูงสุดในกลุ่มนี้** — ลบ user ทิ้ง (soft, เช่น ไล่พนักงานออก/ลบบัญชีลูกค้า) แล้วอีเมลนั้นสมัครสมาชิกใหม่/สร้างใหม่ไม่ได้อีกเลย (`userService.createUser` ไม่มี pre-check เอง พึ่ง DB index ล้วน ๆ → ชน `11000` เงียบ ๆ กลายเป็น 409 "ซ้ำ" ที่ผู้ใช้งงว่าทำไมอีเมลตัวเอง "ซ้ำ" ทั้งที่ไม่เคยสมัคร) |
| 3 | `src/models/promotionModel.ts` | `promotion_code` | `promotions` | ลบโปรโมชันทิ้งแล้วสร้างโค้ดเดิมซ้ำไม่ได้ (โค้ดโปรโมชันมักเป็นคำสั้น ๆ ที่คนอยากใช้ซ้ำ เช่น `SUMMER10` ปีถัดไป) |
| 4 | `src/models/ingredientModel.ts` | `ingredient_name` | `ingredients` | ลบวัตถุดิบทิ้งแล้วสร้างชื่อเดิมใหม่ไม่ได้ |
| 5 | `src/models/ingredientCategoryModel.ts` | `ingredient_category_name` | `ingredientcategories` | เหมือนข้อ 4 ระดับหมวดหมู่ |
| 6 | `src/models/productCategoryModel.ts` | `product_category_name` | `productcategories` | เหมือนข้อ 4 ระดับหมวดหมู่สินค้า |
| 7 | `src/models/componentsCategory.ts` | `component_category_name` | `componentcategories` | เหมือนข้อ 4 ระดับหมวดหมู่ชิ้นส่วน |
| 8 | `src/models/preorderRoundItemModel.ts` | `{ round_id, product_id }` (compound) | `preorderrounditems` | ลบสินค้าออกจากรอบพรีออเดอร์ (soft) แล้วเพิ่มสินค้าตัวเดิมกลับเข้ารอบเดิมไม่ได้อีก — ไม่มี endpoint restore แยกด้วยซ้ำ (เช็คแล้ว) เพราะงั้นทางเดียวที่จะ "ได้กลับมา" คือเพิ่มใหม่ ซึ่งจะชน index นี้ตรง ๆ |

**วิธีแก้ที่แนะนำ (ตรงกับที่ทำสำเร็จแล้วกับ `unitModel.ts`):** ต่อแต่ละโมเดล เอา `unique: true` ออกจาก
field definition แล้วเพิ่ม
```ts
xxxSchema.index({ <field> }, { unique: true, partialFilterExpression: { deleted_at: null } });
```
แยกต่างหาก จากนั้นรัน `npm run sync-indexes` ให้ DB จริง sync ตาม — เหมือนขั้นตอนที่ทำกับ `unitModel` เป๊ะ
(ไม่ต้อง cleanup ข้อมูลเพราะยืนยันแล้วว่าไม่มีของซ้ำ) `preorderRoundItemModel` เป็น compound index จึงใช้
`{ round_id: 1, product_id: 1 }` เหมือนเดิมแค่เพิ่ม `partialFilterExpression`

---

## 2. 🔴 N+1 query ใน per-item loop — พบอีก 2 จุด (คู่ขนานกับ §3.18 ที่ยังไม่ได้ fix ตาม)

> **pattern เดิม:** [BACKLOG.md §3.18](BACKLOG.md) แก้ `orderService`/`cartService` (checkout) จาก loop
> `await` ทีละบรรทัดเป็น batch query ด้วย `$in` ครั้งเดียว — แต่ **ไม่เคยไล่เช็คว่า path อื่นที่สร้าง
> เอกสารจากหลายรายการเหมือนกันมีปัญหาเดียวกันไหม** เหมือนที่ §2b เจอว่า preorder ไม่เคยได้ fix ตาม order
> ในบั๊กชุดก่อนหน้า — รอบนี้เจอว่า preorder **พลาดอีกแล้ว** (คนละบั๊ก คนละรอบ แต่ pattern เดียวกัน:
> "แก้ order แล้วลืมเช็ค preorder")

| # | ที่ไฟล์ | รายละเอียด |
|---|---|---|
| 2.1 | `src/services/preorderService.ts` — `createPreorder()` (บรรทัด ~148-186) | `for (const raw of input.items) { ... await preorderRoundService.getOrderableRoundItem(raw.round_item_id, ...) ... }` — query แยกทีละรายการต่อ 1 request (`getOrderableRoundItem` อ่าน round item + product ต่อครั้ง) เหมือน `resolveLine()` เดิมก่อนแก้ §3.18 เป๊ะ ต่างจาก `orderService`/`cartService` ที่ถูกเปลี่ยนเป็น `resolveLines()` แบบ batch ไปแล้ว — พรีออเดอร์ 1 ใบที่มีหลายรายการ (ลูกค้าสั่งพรีออเดอร์หลายเมนูพร้อมกันในรอบเดียว) จะยิง query จำนวนเท่ากับจำนวนรายการ ไม่คงที่เหมือน `resolveLines()` |
| 2.2 | `src/services/productionOrderService.ts` — `createProductionOrder()` (บรรทัด ~93-97) | `for (const raw of input.items) { await productionItemService.addItem(String(order._id), raw); }` — สร้างใบสั่งผลิตที่มีหลายรายการ (เช่น สั่งผลิตเค้ก 5 สูตรพร้อมกัน) ยิง `addItem` แยกทีละรายการ (แต่ละครั้งมี query ภายในของตัวเองด้วย เช่นดึงสูตร/ตรวจ recipe) — ผลกระทบต่ำกว่าข้อ 2.1 เพราะใบสั่งผลิตมักมีรายการน้อยกว่าตะกร้า/พรีออเดอร์ลูกค้า แต่เป็น pattern เดียวกัน |

**หมายเหตุ:** ยังมี loop รอง 2 จุดใน `createPreorder()` ที่ไม่ใช่ N+1 แบบเดียวกันโดยตรง (บรรทัด ~220-226
`for (const l of lines) await preorderRoundService.commitQty(...)` เป็นการจองโควตาแบบ atomic ต่อ
เอกสาร — จำเป็นต้องเป็น per-item เพื่อความถูกต้อง ไม่ใช่จุดที่ batch ได้ตรง ๆ เหมือนการ "อ่าน" ข้อมูล —
ถ้าจะแก้ควรแยกพิจารณาต่างหาก ไม่รวมในสโคปข้อ 2.1)

**วิธีแก้ที่แนะนำ:** ทำแบบเดียวกับ §3.18 — เขียน `getOrderableRoundItems()` (พหูพจน์) ที่รับ
`round_item_id[]` แล้ว batch query ด้วย `$in` ครั้งเดียว จากนั้น join ใน memory เหมือน `resolveLines()`
ของ `orderService` · ข้อ 2.2 ผลกระทบต่ำกว่า พิจารณาความคุ้มค่าก่อนแก้ (จำนวนรายการต่อใบสั่งผลิตปกติน้อย)

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

---

## 4. ยังไม่ได้ตรวจ (ขอบเขตที่ยังไม่ครอบในรอบนี้)

รอบนี้เน้น 2 pattern ที่มีประวัติเป็นบั๊กมาก่อนแล้วไล่หาที่ซ้ำ (§1/§2) เป็นหลัก ยังไม่ได้ทำ:
- ไล่เทียบ `preorderService`/`productionOrderService`/`preorderRoundService` กับ `orderService` ทีละ
  ฟังก์ชันแบบเดียวกับที่ §2b เคยทำ (เจอ 4 บั๊ก) — อาจมี divergence อื่นที่ยังไม่เจอ
- ตรวจ race condition อื่นนอกจาก quota/usage ที่มีการ์ดแล้ว (เช่น stock ระดับ variant)
- ตรวจ validation coverage ของ `/api/shop/preorders` (POST) ที่ [BACKLOG.md §3.8](BACKLOG.md) บันทึกไว้
  แล้วว่ายังไม่ zod-adopt เต็ม — เป็น gap ที่รู้ตัวอยู่แล้ว ไม่ใช่ของใหม่
