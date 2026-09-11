# Concurrency guards — โปรโมชัน usage + payment ซ้ำ

> อัปเดตล่าสุด: 2026-09-07
> ขอบเขต: กัน race ที่ทำให้ข้อมูลไม่ถูกต้อง — BACKLOG ข้อ 2.9 (usage_limit) + 2.10 (payment ซ้ำ)
> บริบท: MongoDB standalone — **ไม่มี transaction** ทั้ง codebase → ใช้ atomic single-doc update + compensation

---

## 2.9 — โปรโมชัน `usage_limit` / `max_user_per_user` ไม่ atomic

### ปัญหาเดิม

`promotionService.validateForOrder` อ่าน `promo.used_count` แล้วเทียบ `usage_limit` (read) →
`orderService.persistOrder` สร้างออเดอร์ → `promotionUsageService.recordUsage` ค่อย `$inc used_count`
ทีหลังแบบ best-effort (ไม่มี guard)

→ 2 ออเดอร์ยิงพร้อมกัน: อ่าน `used_count = 4` / `usage_limit = 5` ทั้งคู่ → ผ่าน check ทั้งคู่ →
`$inc` ทั้งคู่ → `used_count = 6` เกินลิมิต · `max_user_per_user` race แบบเดียวกัน

### วิธีแก้ — `promotionUsageService.recordUsage`

**1) จองสิทธิ์ `usage_limit` แบบ atomic** (single-doc `findOneAndUpdate` — แนวเดียวกับ preorder quota §8)

```ts
const claimed = await promotionModel.findOneAndUpdate(
  {
    _id: input.promotion_id,
    deleted_at: null,
    $or: [
      { usage_limit: null },
      { $expr: { $lt: [{ $ifNull: ["$used_count", 0] }, "$usage_limit"] } },
    ],
  },
  { $inc: { used_count: 1 } },
  { new: true }
).lean();

if (!claimed) {
  const exists = await promotionModel.exists({ _id: input.promotion_id, deleted_at: null });
  throw exists ? unprocessable("โปรโมชันนี้ถูกใช้ครบจำนวนแล้ว") : notFound("ไม่พบโปรโมชันนี้");
}
```

`$inc` จะเกิดก็ต่อเมื่อ `used_count < usage_limit` ในคำสั่งเดียว → 2 คำขอพร้อมกันมีแค่คำขอเดียวที่ claim สำเร็จ

**2) `max_user_per_user` — optimistic (สร้างแล้ว count, คนหลังแพ้)**

```ts
try {
  const doc = await promotionUsagesModel.create({ ...input });

  if (claimed.max_user_per_user != null) {
    const userCount = await promotionUsagesModel.countDocuments({
      promotion_id: input.promotion_id, user_id: input.user_id, deleted_at: null,
    });
    if (userCount > claimed.max_user_per_user) {
      await promotionUsagesModel.deleteOne({ _id: doc._id }).catch(() => undefined);
      throw unprocessable("คุณใช้สิทธิ์โปรโมชันนี้ครบจำนวนแล้ว");
    }
  }
  return doc.toObject();
} catch (err) {
  // rollback การจอง used_count ถ้าขั้นนี้ล้ม (create ล้ม / per-user เกิน)
  await promotionModel
    .updateOne({ _id: input.promotion_id, used_count: { $gt: 0 } }, { $inc: { used_count: -1 } })
    .catch(() => undefined);
  throw err;
}
```

> ⚠️ per-user **ไม่ atomic 100%** — ถ้า user เดียวยิง 2 คำขอพร้อมกันเป๊ะ อาจเกินได้ 1 ครั้ง
> (ต้องใช้ transaction หรือ counter ต่อ (promo,user) ถึงจะปิดสนิท — เกินขอบเขตตอนนี้)
> แต่กรณี `usage_limit` (global) ปิดสนิทแล้ว ซึ่งเป็นตัวที่กระทบมากกว่า

### `orderService.persistOrder` — เรียก `recordUsage` ตอนสร้างออเดอร์

ย้าย `recordUsage` เข้าไปใน try block เดียวกับที่สร้างออเดอร์:

```ts
    await orderItemModel.insertMany(...);

    if (appliedPromotion) {
      try {
        await promotionUsageService.recordUsage({ ...appliedPromotion, order_id: String(order._id) });
      } catch (e) {
        if (isHttpError(e) && e.status === 422) throw e;   // limit เต็ม = reject จริง → ล้มออเดอร์
        console.error("[order] บันทึกการใช้โปรโมชันไม่สำเร็จ:", e);  // error อื่น = best-effort
      }
    }
  } catch (err) {
    await productService.restockForOrder(stockItems).catch(() => undefined);
    if (order?._id) { /* ลบ order + items */ }
    throw err;
  }
```

- **422 (limit เต็ม)** → โยนต่อ → catch คืนสต็อก + ลบออเดอร์ → ลูกค้าได้ 422 ไม่มี side effect
  (`recordUsage` rollback `used_count` ของตัวเองแล้ว จึงไม่ต้อง revoke)
- **error อื่น (transient DB)** → log เฉย ๆ ไม่ล้มออเดอร์ที่สร้างสำเร็จแล้ว (best-effort เดิม)

`validateForOrder` ยังเก็บ read-check `used_count >= usage_limit` ไว้ — เป็น fast-fail ก่อนตัดสต็อก
และใช้กับ path พรีวิว (`previewForCart`) ที่ไม่ควร claim อะไร

---

## 2.10 — สร้าง payment ซ้ำได้หลายใบต่อ 1 ออเดอร์

### ปัญหาเดิม

`paymentService.createPayment` เช็คแค่ `order.payment_status === "paid"` → ไม่กันการสร้าง payment
ใหม่ขณะที่ยังมีใบ `pending` ค้าง

→ เรียกซ้ำ = payment หลาย doc ต่อ order เดียว · `order.payment_id` ถูกเขียนทับเป็นใบล่าสุด ·
ใบ pending เก่ากลายเป็น orphan (ยังชี้ `order_id` อยู่) → แอดมิน verify ใบเก่าได้ → สถานะเพี้ยน

### วิธีแก้

**1) service — เช็คก่อนสร้าง** (`createPayment`)

```ts
const activeFilter = { deleted_at: null, status: "pending" };
if (hasOrder) activeFilter.order_id = input.order_id;
else activeFilter.preorder_id = input.preorder_id;

const activePayment = await paymentModel.findOne(activeFilter).lean();
if (activePayment) {
  throw conflict(
    "มีรายการชำระเงินที่รอตรวจสอบอยู่แล้ว — แนบสลิปกับรายการเดิมหรือรอแอดมินตรวจ",
    { payment_id: String(activePayment._id) }
  );
}
```

ลูกค้าที่อยากแก้/ส่งสลิปใหม่ → ใช้ `submitSlip` กับใบเดิม (รับ `payment_id` จาก `details`)

**2) DB — partial unique index** (`paymentModel`, defense-in-depth กัน race)

```ts
paymentSchema.index(
  { order_id: 1 },
  { unique: true, name: "uniq_pending_payment_per_order",
    partialFilterExpression: { order_id: { $type: "objectId" }, status: "pending", deleted_at: null } }
);
// + แบบเดียวกันสำหรับ preorder_id
```

- `$type: "objectId"` เพื่อไม่ index เอกสารที่ `order_id`/`preorder_id` เป็น `null`
  (ไม่งั้น payment ของ preorder ทุกใบจะชนกันที่ `order_id: null`)
- `createPayment` แปลง error `11000` → `conflict` (เผื่อ 2 คำขอลอดข้อ 1 มาพร้อมกัน)
- **ต้องรัน `npm run sync-indexes` กับ DB จริง** — ถ้ามี pending ซ้ำอยู่ก่อน index จะสร้างไม่ผ่าน
  (`--fix` ยังไม่ครอบ payments) → ต้องลบซ้ำด้วยมือก่อน

---

## สรุปแนวทาง (ใช้ซ้ำได้ที่อื่น)

| กลไก | ใช้เมื่อ | ตัวอย่างในโค้ด |
|---|---|---|
| `findOneAndUpdate` + `$expr $lt` + `$inc` | counter เดียวมีเพดาน (global) | promo `used_count`, preorder `max_qty_total` |
| partial unique index | "มีได้แค่ 1 ที่ active" | payment pending ต่อ order, attendance/review (§2.3/2.4) |
| create → re-count → undo | เพดานต่อ sub-key (per-user) ที่ไม่มี counter | promo `max_user_per_user` (optimistic) |
| compensation (try/catch + restock/delete) | หลายขั้นที่ไม่มี transaction | `persistOrder` ตัดสต็อก/สร้างออเดอร์/claim promo |
