# Robustness fixes: clearCart error handling + voidTransaction floor guard

> อัปเดตล่าสุด: 2026-09-12
> ขอบเขต: แก้ BACKLOG §2c.1–2c.2 — สองบั๊กความทนทานที่เจอพร้อมกับ §2b (code review เต็ม `src/services/`)
> เกี่ยวข้อง: [`BACKLOG.md`](BACKLOG.md) §2c
> branch: `fix-robustness-2c`

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

## 3. เทส

- `tests/integration/createOrderFromCart.test.ts` (2 เคส) — mock `cartService.clearCart` ด้วย
  `vi.spyOn(...).mockRejectedValueOnce(...)` แล้วยืนยันว่า `createOrderFromCart` ยัง resolve สำเร็จ
  (ไม่ throw ตาม) + เคสปกติยืนยันตะกร้ายังว่างหลังสร้างออเดอร์เหมือนเดิม — **เป็นเทสแรกในโปรเจกต์ที่ใช้
  `vi.spyOn` กับ service module** (ก่อนหน้านี้ทุกเทสเป็น pure integration ไม่ mock อะไร) เพราะการบังคับ
  ให้ DB operation จริงพังแบบ controllable ทำไม่ได้ด้วยวิธีอื่นที่สมเหตุสมผลเท่า
- `tests/integration/voidTransaction.test.ts` (3 เคส) — รับ 100 + ใช้ 80 แล้ว void รายการรับ → conflict
  + สต็อกไม่เปลี่ยน, void รายการ receive ที่ยังไม่ถูกใช้ → สำเร็จปกติ, void รายการ use → คืนสต็อกได้เสมอ
  (sanity ว่าไม่ได้ไปกระทบทิศทางที่ไม่ต้องกัน)
- เพิ่ม helper `makeIngredient`/`makeUnit` ใน `tests/integration/helpers.ts`

## 4. ยังเปิดค้าง (ไม่ใช่ scope ของรอบนี้)

- §2c.3 (ความเสี่ยง double-credit สต็อกจาก production — ไม่มี back-reference) และ §2c.4 (`recordUsage`
  swallow error — เป็น tradeoff ที่ตั้งใจไว้แล้ว ไม่ใช่บั๊ก) ยังไม่ได้แก้ ดู [`BACKLOG.md`](BACKLOG.md) §2c
- `voidTransaction` ยังเป็น endpoint กลางที่ void รายการจาก production ได้โดยไม่มีการกันไว้ (คือ §2c.3
  พอดี) — ยังไม่แก้ในรอบนี้เพราะต้องสืบ `productionItemService.ts` เพิ่มก่อนตัดสินใจออกแบบ
