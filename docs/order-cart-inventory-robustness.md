# Robustness fixes: §2c.1–2c.4 (clearCart, voidTransaction, production double-credit, recordUsage)

> อัปเดตล่าสุด: 2026-09-12
> ขอบเขต: แก้ BACKLOG §2c.1–2c.2 (branch `fix-robustness-2c`, PR #22) + §2c.3 (branch
> `fix-production-double-credit-2c3`) — บั๊กความทนทานที่เจอพร้อมกับ §2b (code review เต็ม
> `src/services/`) · §2c.4 ตรวจสอบซ้ำแล้วยืนยันว่าเป็น tradeoff ที่ตั้งใจไว้แล้วจริง ไม่ใช่บั๊ก (§4)
> เกี่ยวข้อง: [`BACKLOG.md`](BACKLOG.md) §2c

---

## 1. `createOrderFromCart` — `clearCart()` ไม่กัน error หลัง order commit แล้ว (2c.1)

### ปัญหาเดิม

`orderService.createOrderFromCart()` ท้ายฟังก์ชัน:

```ts
const order = await persistOrder(userId, lines, input);
await cartService.clearCart(userId);   // ← ไม่มี .catch()
return order;
```

ตอนที่ `clearCart(userId)` ถูกเรียก **ออเดอร์ถูกสร้างและ commit ไปแล้วจริง** (`persistOrder` เรียก
`saga.commit()` ก่อนหน้านี้แล้ว — ดูสูตรเดียวกันใน [`order-cancel.md`](order-cancel.md)) แต่โค้ดไม่มี
`.catch()` ห่อไว้ ทั้งที่จุดอื่นในไฟล์เดียวกันที่รันหลัง commit แล้ว (เช่น
`notificationService.notify(...)`) ห่อด้วย `.catch(err => log.error(...))` ทุกจุด — มีแค่บรรทัดนี้
บรรทัดเดียวที่ไม่มี

**ผล:** ถ้า `clearCart` throw (เช่น DB สะดุดชั่วคราว, connection timeout ชั่วครู่) ทั้งที่ออเดอร์สร้าง
สำเร็จสมบูรณ์แล้ว `createOrderFromCart` จะ throw ตาม → route handler ส่ง **500** กลับไปที่ client
ลูกค้าเห็น "สร้างออเดอร์ไม่สำเร็จ" ทั้งที่จริงสำเร็จแล้ว แถมตะกร้ายังเต็มอยู่ (ไม่ได้เคลียร์) — กด "ลองใหม่"
ซ้ำมีความเสี่ยงสร้างออเดอร์ซ้ำสอง (ไม่มี idempotency key กันการยิงซ้ำ)

### วิธีแก้

```ts
const order = await persistOrder(userId, lines, input);
await cartService
  .clearCart(userId)
  .catch((err) => log.error("order.clear_cart_failed", { user_id: userId, order_id: String(order._id), err }));
return order;
```

### ทำไมแก้แบบนี้

- **`.catch()` ตรงจุด ไม่ใช่ try/catch ครอบทั้งฟังก์ชัน** — เพราะ error ที่เกิดก่อน `persistOrder` (เช่น
  ตะกร้าว่าง, สินค้าไม่มีสต็อก) **ต้อง** throw จริง ให้ client รู้ว่าสั่งไม่สำเร็จ มีแค่ error ที่เกิด
  **หลัง** order commit แล้วเท่านั้นที่ควรเป็น best-effort — ตรงกับ pattern ที่มีอยู่แล้วในไฟล์เดียวกัน
  (`notify().catch(...)`) ไม่ใช่การคิด pattern ใหม่
- **log พร้อม `order_id`** — ต่างจาก `notify().catch()` ที่ log แค่ `order_id`/`err`, ที่นี่ log ทั้ง
  `user_id` และ `order_id` เพราะถ้า `clearCart` fail จริง จะต้องมีคนไปเคลียร์ตะกร้าให้ลูกค้าด้วยมือ
  (หรืออย่างน้อยรู้ว่าตะกร้าลูกค้าคนไหนค้างของเก่าอยู่) — `order_id` ช่วยให้เชื่อมกลับไปดูออเดอร์ที่เกิด
  ปัญหานี้ได้จาก log โดยตรง
- **ไม่ทำ retry อัตโนมัติ** — พิจารณาแล้วว่าไม่คุ้ม: `clearCart` เป็น operation ที่ทำเองซ้ำได้ปลอดภัย
  (idempotent — เคลียร์ตะกร้าที่ว่างอยู่แล้วไม่มีผลเสีย) ถ้าลูกค้าเปิดแอปใหม่/รีเฟรชหน้าตะกร้า ระบบจะ
  แสดงตะกร้าเดิมที่ค้างอยู่ให้เห็นเอง ไม่ใช่ silent data loss — ผลกระทบจริงคือ "ตะกร้าเก่าโผล่มาอีกที"
  ไม่ใช่เรื่องคอขาดบาดตาย ไม่จำเป็นต้องเพิ่มความซับซ้อนของ retry logic

---

## 2. `voidTransaction` — ย้อนรายการ `receive` ไม่มี floor guard (2c.2)

### ปัญหาเดิม

`ingredientTransactionService.ts` มี 2 ฟังก์ชันที่แก้ไข `current_stock`:

- `createTransaction()` ฝั่ง `"use"` (ลดสต็อก) **มี** guard:
  ```ts
  const filter: Record<string, any> = { _id: ingredient._id, deleted_at: null };
  if (!input.allowNegative) filter.current_stock = { $gte: qty };
  const res = await ingredientModel.updateOne(filter, { $inc: { current_stock: -qty } });
  if (res.modifiedCount === 0) throw conflict(`สต็อกวัตถุดิบไม่พอ ...`);
  ```
- `voidTransaction()` ตอนย้อนรายการ `"receive"` (ก็คือ**ลดสต็อก**เหมือนกัน — ของที่เคย "รับเข้า" ถูก
  เอาออกไปตอนย้อน) **ไม่มี guard เดียวกันเลย**:
  ```ts
  const inc = txn.type === "receive" ? -txn.qty : txn.qty;
  await ingredientModel.updateOne({ _id: txn.ingredient_id }, { $inc: { current_stock: inc } });
  ```

**ผล:** รับของเข้า 100 → เบิกใช้ไปแล้ว 80 (`current_stock` เหลือ 20) → มา void รายการ "รับ 100" นั้น
ทีหลัง (เช่นกดผิด, หรือใบส่งของจริงยกเลิก) → `$inc: -100` ทำให้ `current_stock` เป็น **-80** โดยไม่มี
error ใด ๆ เลย — ตัวเลขติดลบนี้ไหลต่อไปกระทบ reorder-point alert (คำนวณผิด) และต้นทุนสูตร (ถ้าอิง
`current_stock` ที่ไหน) แบบเงียบ ๆ

### วิธีแก้

```ts
const inc = txn.type === "receive" ? -txn.qty : txn.qty; // receive→ลบออก, use→คืนกลับ

const filter: Record<string, any> = { _id: txn.ingredient_id, deleted_at: null };
if (inc < 0) filter.current_stock = { $gte: -inc };
const res = await ingredientModel.updateOne(filter, { $inc: { current_stock: inc } });
if (res.modifiedCount === 0) {
  const current = await ingredientModel.findById(txn.ingredient_id).lean();
  throw conflict(
    `สต็อกไม่พอให้ย้อนรายการนี้ (คงเหลือ ${current?.current_stock ?? 0}, ต้องย้อนออก ${-inc}) — ` +
      `อาจมีการเบิกใช้ไปแล้วหลังรายการนี้ ให้ทำ adjust ปรับยอดแทน`
  );
}
```

### ทำไมแก้แบบนี้

- **เช็คเฉพาะทิศทาง `inc < 0` (ย้อนรายการ `receive`)** — ย้อนรายการ `"use"` (`inc > 0`, คืนสต็อกกลับ
  เข้าไป) ไม่มีทางทำให้ติดลบได้เลยไม่ว่ากรณีไหน (บวกเข้าไปมีแต่จะเพิ่ม) เลย**ไม่ใส่ guard ฝั่งนั้น** —
  ใส่ guard ที่ไม่จำเป็นจะทำให้โค้ดอ่านสับสนว่าเช็คทำไม (เทสข้อ 3 ในไฟล์เทสยืนยันพฤติกรรมนี้ไว้ด้วย)
- **`updateOne` + เช็ค `modifiedCount === 0` แบบเดียวกับ `createTransaction`** — ไม่ใช้ `findOne` แล้ว
  เช็คเลข... แล้วค่อย `updateOne` แยก 2 ขั้น เพราะแบบนั้นมี race condition (อ่านค่า A แล้วมีคนอื่นแก้ก่อน
  เราจะ update ตาม A ที่ไม่ทันสมัยแล้ว) — `updateOne` พร้อม filter `$gte` เป็น**atomic operation เดียว**
  เหมือนที่ `createTransaction` ทำอยู่แล้ว รักษาความถูกต้องได้แม้มีคำขอพร้อมกัน 2 คำขอ
- **เลือก throw ไม่ใช่ clamp เป็น 0 เงียบ ๆ** — ตัดสินใจเชิง policy: การ throw ทำให้แอดมินรู้ทันทีว่า
  "ย้อนไม่ได้เพราะของถูกใช้ไปแล้วบางส่วน" ต้องไปคิดว่าจะแก้ยังไง (เช่นทำ `adjust` ปรับยอดเอง) —
  ถ้า clamp เป็น 0 แบบเงียบ ๆ แอดมินจะไม่รู้เลยว่าตัวเลขที่เห็นไม่ตรงกับที่ตั้งใจย้อน (ยอดหายไปเงียบ ๆ
  อีกแบบ เปลี่ยนจาก "ติดลบเงียบ ๆ" เป็น "ปัดเป็น 0 เงียบ ๆ" ไม่ได้ดีขึ้นจริง) — ข้อความ error ก็แนะนำ
  ทางออก (`ให้ทำ adjust ปรับยอดแทน`) ไปในตัว ไม่ใช่แค่บอกว่าทำไม่ได้เฉย ๆ
- **ไม่แตะ policy ของ `allowNegative`** — `createTransaction` มี option `allowNegative` ให้ข้าม guard
  ได้ (เผื่อกรณีพิเศษที่แอดมินตั้งใจให้สต็อกติดลบชั่วคราว) แต่ `voidTransaction` ไม่มี option นี้ให้เรียก
  เพราะ "ย้อนรายการ" ควรเป็น operation ที่ตรงไปตรงมา ไม่ควรมีทางเลี่ยงเงื่อนไข — ถ้าจำเป็นต้องบังคับย้อน
  จริง ๆ ให้ไปทำผ่าน `adjust` (ตั้งยอดนับจริงตรง ๆ) แทน ซึ่งมีอยู่แล้วและไม่ผ่าน guard ใด ๆ

---

## 3. `voidTransaction` void รายการที่มาจากการผลิตได้ตรง ๆ — เสี่ยงเครดิตสต็อกซ้ำ (2c.3)

### ปัญหาเดิม (ยืนยันแล้วว่า exploit จริง ไม่ใช่แค่ความเสี่ยงเชิงทฤษฎี)

`productionItemService.ts` มี 2 ฟังก์ชันที่แก้ `current_stock` ผ่าน `ingredientTransactionService.createTransaction()`:

- **`consumeStock(id)`** — หักสต็อกตามสูตร (type `"use"`) แล้วบันทึก `item.stock_impact` + `item.stock_updated_at` ไว้ที่ตัวรายการผลิต (`productionItemModel`) เพื่อให้ **`reverseStock` ย้อนกลับได้ทีหลัง**
- **`reverseStock(id)`** — เช็คว่า `item.stock_updated_at` ยังตั้งอยู่ → สร้างรายการ `"receive"` คืนสต็อกตาม `item.stock_impact` ที่บันทึกไว้ → เคลียร์ `stock_impact`/`stock_updated_at`

ธุรกรรม `ingredientTransaction` (type `"use"`) ที่ `consumeStock` สร้างไว้ **ไม่มีอะไรผูกกลับไปที่
`productionItem` เลย** — เป็นแค่รายการทั่วไปในตาราง `ingredientTransactions` เหมือนรายการที่บันทึกมือ
ทุกประการ ขณะที่ `DELETE /api/admin/ingredient-transactions/[id]` (`voidTransaction`) เป็น endpoint
**กลาง** ที่ void รายการไหนก็ได้ (permission `ingredients.delete`) — ไม่รู้จัก/ไม่เช็คว่ารายการนั้นมาจาก
การผลิตหรือเปล่า

**ลำดับ exploit จริงที่ตามรอยเจอ** (ใช้ endpoint ที่มีอยู่จริง 2 ตัว, permission คนละชุดกัน แต่ role
`owner` ผ่านทั้งคู่):

1. แอดมินกด **"หักสต็อกวัตถุดิบ"** ที่หน้ารายการผลิต (`POST /admin/production-items/[id]/consume-stock`)
   → หักสต็อก 5 หน่วย + สร้างธุรกรรม `"use"` qty 5 + `productionItem.stock_updated_at` ถูกตั้ง
2. แอดมิน (คนละคน หรือคนเดิมที่ลืม) ไปแก้ที่หน้า **"รายการเคลื่อนไหวสต็อกวัตถุดิบ"** (หน้าทั่วไป ไม่ใช่หน้า
   การผลิต) เห็นธุรกรรม `"use"` นั้นแล้วกด **ยกเลิก** (`DELETE /admin/ingredient-transactions/[id]`) —
   ทำได้ปกติเพราะ `voidTransaction` ไม่รู้ว่ารายการนี้มาจากการผลิต → สต็อกถูกเครดิตกลับ **+5** ทันที (ครั้งที่ 1)
   แต่ `productionItem.stock_updated_at` **ยังไม่ถูกเคลียร์** เพราะ `voidTransaction` ไม่รู้จัก `productionItemModel` เลย
3. ภายหลัง แอดมินไปที่หน้ารายการผลิตเดิม กด **"คืนสต็อกวัตถุดิบ"** (`POST /admin/production-items/[id]/reverse-stock`)
   — `reverseStock` เช็คแค่ `item.stock_updated_at` (ยังตั้งอยู่จากข้อ 1) ก็ทึกทักว่า "ยังไม่เคยถูกย้อน"
   แล้วสร้างธุรกรรม `"receive"` คืนสต็อกตาม `stock_impact` เดิม **ซ้ำอีกรอบ** → เครดิตกลับ **+5** อีกครั้ง
   (ครั้งที่ 2)

**ผล:** เบิกสต็อกจริงแค่ 5 หน่วยครั้งเดียว แต่ระบบเครดิตคืนให้ **2 ครั้ง** (+10 รวม) จากการกดปุ่มที่ถูกต้อง
2 ปุ่มบนหน้าจอคนละหน้ากัน — ไม่ต้องอาศัยบั๊กหรือช่องโหว่พิเศษใด ๆ แค่ทำตามลำดับที่สมเหตุสมผลในหน้าที่มีอยู่จริง

### วิธีแก้

เพิ่ม back-reference ตามที่ BACKLOG แนะนำไว้แต่แรก:

```ts
// src/models/ingredientTransactionModel.ts
production_item_id: {
  type: mongoose.Schema.Types.ObjectId,
  ref: "ProductionItems",
  default: null,   // null = ธุรกรรมบันทึกมือปกติ ไม่เกี่ยวกับการผลิต
},
```

`ingredientTransactionService.createTransaction()` รับ `production_item_id` เป็น input เสริม (validate
ด้วย `assertRefExists` แบบเดียวกับ ref อื่นในฟังก์ชันนี้ — กันกรอกมั่ว/ค่าไม่มีอยู่จริง) แล้วบันทึกลงเอกสาร

`productionItemService.ts` ส่ง `production_item_id: String(item._id)` แนบไปกับ**ทุกครั้ง**ที่เรียก
`createTransaction()` (ทั้ง `consumeStock` ตอนหักจริง, `consumeStock` ตอน rollback ถ้าหักบางส่วนแล้วพัง,
และ `reverseStock` ตอนคืน) — ทุกธุรกรรมที่มาจาก production มี back-ref ครบ ไม่มีจุดไหนหลุด

`voidTransaction()` เพิ่มเช็คก่อนย้อนสต็อก:

```ts
if (txn.production_item_id) {
  throw conflict(
    "รายการนี้เกิดจากการผลิต — ยกเลิกผ่านทางนี้ไม่ได้ ... ให้ไปที่รายการผลิตนี้แล้วกด " +
    "\"คืนสต็อกวัตถุดิบ\" (reverse-stock) แทน"
  );
}
```

### ทำไมแก้แบบนี้

- **แก้ที่ root cause (ไม่มีทางเชื่อมกลับ) ไม่ใช่แก้ปลายเหตุ** — ทางเลือกอื่นที่คิดไว้ เช่น ทำให้
  `reverseStock` เช็คว่าธุรกรรมเดิมยัง "active" อยู่จริงก่อนเชื่อ `stock_impact` (query
  `ingredientTransactionModel` หาธุรกรรมที่ตรงกับ note+qty+ingredient ของแต่ละ line) — เปราะกว่ามาก
  (match ด้วย note เป็น string ไม่ reliable) และไม่แก้ปัญหาฝั่ง `voidTransaction` ที่ควร "รู้ตัว" ว่า
  กำลังจะ void อะไรอยู่ตั้งแต่แรกอยู่ดี
- **บล็อกที่ `voidTransaction` ไม่ใช่บล็อกที่ `reverseStock`** — เพราะ `voidTransaction` เป็น endpoint
  ทั่วไปที่ไม่รู้บริบทการผลิตเลย ในขณะที่ `reverseStock` **คือ** ทางที่ถูกต้องสำหรับย้อนธุรกรรมกลุ่มนี้
  อยู่แล้ว (มันอ่าน `stock_impact` ที่บันทึกไว้ตรง ๆ ไม่ต้องเดา) — ปิดทางที่ผิดแทนที่จะเปิดทางที่ถูกเพิ่ม
- **validate `production_item_id` ด้วย `assertRefExists`** — แม้ route `POST /admin/ingredient-transactions`
  จะ spread `...body` เข้า `createTransaction()` ตรง ๆ โดยไม่มี zod (ช่องโหว่ mass-assignment เดิมที่มีอยู่
  ก่อนแล้ว ไม่ใช่ scope ของ fix นี้) การบังคับให้ `production_item_id` ต้องอ้างถึงรายการผลิตที่มีอยู่จริง
  ทำให้ต่อให้ client ส่งค่านี้มาเอง อย่างมากก็แค่ทำให้ธุรกรรมของตัวเอง void ไม่ได้ (ต้องรู้ id รายการผลิตจริง
  ที่มีอยู่ด้วย) ไม่ใช่ช่องโหว่ด้านความปลอดภัยใหม่
- **แท็กทุกธุรกรรมที่มาจาก production รวมถึงตอน rollback ระหว่าง `consumeStock`** — แม้ตอนนั้น
  `item.stock_updated_at` ยังไม่เคยถูกตั้ง (ไม่มีความเสี่ยง double-credit จากจุดนี้โดยตรง) แต่แท็กไว้เพื่อ
  ความสม่ำเสมอของ ledger (ตามรอยได้ว่าธุรกรรมไหนเกี่ยวกับการผลิตชิ้นไหนบ้างจากหน้ารายการเคลื่อนไหวได้เลย)

---

## 4. `recordUsage` swallow error ที่ไม่ใช่ 422 — ตรวจสอบซ้ำแล้ว: เป็น tradeoff ตั้งใจจริง ไม่ใช่บั๊ก (2c.4)

`orderService.ts` (บรรทัดที่เรียก `promotionUsageService.recordUsage`):

```ts
try {
  await promotionUsageService.recordUsage({ ... });
} catch (e) {
  if (isHttpError(e) && e.status === 422) throw e; // เต็มโควตาจริง → reject ทั้งออเดอร์
  log.error("order.record_usage_failed", { order_id: String(order._id), err: e }); // อื่น = best-effort
}
```

**ตรวจสอบซ้ำ (2026-09-12):** อ่านโค้ด + คอมเมนต์ในไฟล์จริงอีกครั้งโดยตรง — คอมเมนต์ในไฟล์ระบุเหตุผลไว้ตรง ๆ
ตั้งแต่แรกว่า `"error อื่น (transient) = best-effort ไม่ล้มออเดอร์ที่สร้างสำเร็จแล้ว"` และ error ที่เป็น
reject จริง (422 = โควตาเต็ม) ก็ยัง throw ต่อให้ saga rollback ล้มทั้งออเดอร์ตามปกติ — พฤติกรรมตรงกับที่
ตั้งใจเขียนไว้ทุกจุด ไม่ใช่บั๊กที่หลุดไปโดยไม่รู้ตัวแบบ 2c.1–2c.3

**ผลข้างเคียงที่ยอมรับไว้แล้ว (ยังอยู่ ไม่ได้แก้ในเซสชันนี้):** ถ้า `recordUsage` fail แบบ transient
(ไม่ใช่ 422) ออเดอร์จะมี `discount_amount`/`promotion_id` ติดอยู่ แต่ไม่มี `PromotionUsages` row / ไม่นับ
`used_count` — usage reporting เพี้ยนจากส่วนลดที่ให้จริง และ `revokeUsage` ตอนยกเลิกออเดอร์จะหาไม่เจอ
(ไม่มีอะไรให้ revoke) — ผลกระทบเป็นแค่ "รายงานยอดใช้โปรโมชันคลาดเคลื่อน" ไม่ใช่เงินหายหรือสต็อกผิด **ตัดสินใจ
ไม่แก้เพิ่มในรอบนี้** เพราะ effort/ผลกระทบไม่คุ้ม (transient error หายาก + ผลกระทบแค่ reporting) — ถ้าจะแก้
ต่อในอนาคต แนวทางที่แนะนำไว้คือเพิ่ม retry สั้น ๆ ก่อน swallow แทนการ log แล้วปล่อยผ่านทันที

---

## 5. เทส

- `tests/integration/createOrderFromCart.test.ts` (2 เคส) — mock `cartService.clearCart` ด้วย
  `vi.spyOn(...).mockRejectedValueOnce(...)` แล้วยืนยันว่า `createOrderFromCart` ยัง resolve สำเร็จ
  (ไม่ throw ตาม) + เคสปกติยืนยันตะกร้ายังว่างหลังสร้างออเดอร์เหมือนเดิม — **เป็นเทสแรกในโปรเจกต์ที่ใช้
  `vi.spyOn` กับ service module** (ก่อนหน้านี้ทุกเทสเป็น pure integration ไม่ mock อะไร) เพราะการบังคับ
  ให้ DB operation จริงพังแบบ controllable ทำไม่ได้ด้วยวิธีอื่นที่สมเหตุสมผลเท่า
- `tests/integration/voidTransaction.test.ts` (3 เคส) — รับ 100 + ใช้ 80 แล้ว void รายการรับ → conflict
  + สต็อกไม่เปลี่ยน, void รายการ receive ที่ยังไม่ถูกใช้ → สำเร็จปกติ, void รายการ use → คืนสต็อกได้เสมอ
  (sanity ว่าไม่ได้ไปกระทบทิศทางที่ไม่ต้องกัน)
- `tests/integration/productionStockDoubleCredit.test.ts` (5 เคส, 2c.3) — `consumeStock` แท็ก
  `production_item_id` ให้ธุรกรรมที่สร้างจริง, void ธุรกรรมที่มี back-ref → conflict (สต็อกไม่เปลี่ยน),
  `reverseStock` ทางที่ถูกยังทำงานปกติ (เครดิตกลับครั้งเดียว) + ธุรกรรม `"receive"` ที่มันสร้างก็ถูกแท็กด้วย,
  `production_item_id` ที่ไม่มีอยู่จริง → `notFound`, ธุรกรรมมือปกติ (ไม่มี back-ref) ยัง void ได้ตามเดิม
- เพิ่ม helper `makeIngredient`/`makeUnit`/`makeRecipe` ใน `tests/integration/helpers.ts`
