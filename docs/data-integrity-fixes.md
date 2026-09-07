# สรุปการแก้บั๊กความถูกต้องข้อมูล 2.8–2.11

> อัปเดตล่าสุด: 2026-09-07
> ขอบเขต: BACKLOG §2 ข้อ 2.8–2.11 — บั๊กที่พบตอนรีวิวหลังปิด 2.1–2.7 (มีอยู่เดิม ไม่ได้เกิดจากงานรอบก่อน)
> เอกสารเชิงลึกแยกเรื่อง: [`order-cancel.md`](order-cancel.md) · [`promo-freeshipping.md`](promo-freeshipping.md) · [`concurrency-guards.md`](concurrency-guards.md)

ทุกข้อตรวจด้วย `npm run typecheck` + `npm run build` (โปรเจกต์ยังไม่มี test setup)

| # | เรื่อง | ไฟล์โค้ดที่แก้ | ต้อง migration? |
|---|---|---|---|
| 2.8 | ยกเลิกออเดอร์ `paid` ไม่ผูกกับการคืนเงิน | `orderService.ts`, `shop/orders/[id]/cancel/route.ts`, `admin/orders/[id]/status/route.ts` | ไม่ |
| 2.9 | โปรโมชัน `usage_limit` / `max_user_per_user` ไม่ atomic | `promotionUsageService.ts`, `orderService.ts` | ไม่ |
| 2.10 | สร้าง payment ซ้ำหลายใบต่อ 1 ออเดอร์ | `paymentService.ts`, `paymentModel.ts` | **ใช่** — `sync-indexes` + ลบ pending ซ้ำ |
| 2.11 | โปรที่คิดส่วนลดออกมา 0 ยังผูก `promotion_id` | `discountEngine.ts`, `orderService.ts` | ไม่ |

---

## 2.8 — ยกเลิกออเดอร์ที่จ่ายเงินแล้ว ไม่ผูกกับการคืนเงิน

### ปัญหา
`updateOrderStatus` สาขา cancel: คืนสต็อก + คืนสิทธิ์โปร + set cancelled — **ไม่ดู `payment_status`**
→ ยกเลิกออเดอร์ที่ `paid` ได้ โดย `payment.status` ยัง `paid`, ไม่มี refund → เงินในระบบไม่ตรง
`refundPayment` กับการ cancel เป็นคนละทางที่ไม่เชื่อมกัน

### วิธีแก้ — แยก 2 ฝั่ง

**ฝั่งลูกค้า** (`cancelOrder({ allowedFrom })` — เรียกจาก `/api/shop/orders/[id]/cancel`)
```ts
if (order.payment_status === "paid") {
  throw conflict("ออเดอร์นี้ชำระเงินแล้ว ยกเลิกเองไม่ได้ — กรุณาติดต่อร้านเพื่อขอยกเลิกและคืนเงิน");
}
```

**ฝั่งแอดมิน** (`updateOrderStatus` สาขา cancel — เรียกจาก `/api/admin/orders/[id]/status`)
```ts
if (order.payment_status === "paid") {
  const paidPayment = await paymentModel
    .findOne({ order_id: order._id, status: "paid", deleted_at: null }).lean();
  if (paidPayment && opts.cancelled_by) {
    try {
      const { refundPayment } = await import("./paymentService");   // dynamic — เลี่ยง circular import
      await refundPayment(String(paidPayment._id), { verified_by: opts.cancelled_by });
    } catch (e) { console.error("[order] คืนเงินอัตโนมัติไม่สำเร็จ:", e); }   // best-effort
  }
}
```
- `refundPayment` → `propagateStatus` → `setPaymentStatus(orderId, "refunded")` → `order.payment_status = "refunded"`
- `order.save()` ท้าย `updateOrderStatus` เขียนเฉพาะ path ที่แก้ (`order_status`/`cancelled_*`) → ไม่ทับ `refunded`
- เช็ค `=== "paid"` เท่านั้น → ยกเลิกซ้ำ / ออเดอร์ที่ refund แล้ว ไม่คืนเงินซ้ำ

### ยังเปิดค้าง
- ไม่มี audit log แยกสำหรับ auto-refund (route audit แค่ "เปลี่ยนสถานะเป็น cancelled")
- ไม่รองรับยกเลิกแบบ "ยึดเงิน" (ไม่คืน) — ถ้าต้องการต้องเพิ่ม flag ใน opts

---

## 2.9 — โปรโมชัน `usage_limit` / `max_user_per_user` ไม่ atomic

### ปัญหา
`validateForOrder` อ่าน `used_count` เทียบ `usage_limit` (read) → `recordUsage` ค่อย `$inc` ทีหลัง (ไม่มี guard)
→ 2 ออเดอร์พร้อมกันผ่าน check ทั้งคู่ → `used_count` เกินลิมิต

### วิธีแก้ — `promotionUsageService.recordUsage`
```ts
// 1) จอง usage_limit แบบ atomic (single-doc — แนวเดียวกับ preorder quota)
const claimed = await promotionModel.findOneAndUpdate(
  { _id, deleted_at: null,
    $or: [{ usage_limit: null },
          { $expr: { $lt: [{ $ifNull: ["$used_count", 0] }, "$usage_limit"] } }] },
  { $inc: { used_count: 1 } }, { new: true });
if (!claimed) throw unprocessable("โปรโมชันนี้ถูกใช้ครบจำนวนแล้ว");

// 2) max_user_per_user — optimistic: create row → count → เกิน = ลบ row + rollback used_count
```
- `orderService.persistOrder` เรียก `recordUsage` ใน try block ตอนสร้างออเดอร์:
  **422 (limit เต็ม) = โยนต่อ → catch คืนสต็อก + ลบออเดอร์** · error อื่น = best-effort เดิม (log, ไม่ล้ม)
- `validateForOrder` เก็บ read-check ไว้ fast-fail + ใช้กับพรีวิว

### ยังเปิดค้าง
`max_user_per_user` เป็น optimistic — user เดียวยิง 2 คำขอพร้อมกันเป๊ะ ยังเกินได้ 1 (ต้องมี transaction ถึงปิดสนิท)
แต่ `usage_limit` (global) ปิดสนิทแล้ว — ตัวที่กระทบมากกว่า

---

## 2.10 — สร้าง payment ซ้ำหลายใบต่อ 1 ออเดอร์

### ปัญหา
`createPayment` เช็คแค่ `payment_status === "paid"` → ไม่กันการสร้างขณะยังมีใบ `pending` ค้าง
→ payment หลาย doc ต่อ order เดียว · `order.payment_id` ถูกเขียนทับเป็นใบล่าสุด · ใบเก่า orphan → แอดมิน verify ผิดใบได้

### วิธีแก้
**1) service** (`createPayment`) — เช็คก่อนสร้าง
```ts
const activePayment = await paymentModel.findOne({ <fk>, deleted_at: null, status: "pending" }).lean();
if (activePayment) throw conflict("มีรายการชำระเงินที่รอตรวจสอบอยู่แล้ว", { payment_id: String(activePayment._id) });
```
**2) DB** — partial unique index (`paymentModel`)
```ts
paymentSchema.index({ order_id: 1 }, {
  unique: true, name: "uniq_pending_payment_per_order",
  partialFilterExpression: { order_id: { $type: "objectId" }, status: "pending", deleted_at: null },
});
// + uniq_pending_payment_per_preorder แบบเดียวกัน
```
- `$type: "objectId"` เพื่อไม่ index doc ที่ `<fk>` เป็น null (ไม่งั้น payment preorder ทุกใบชนกันที่ `order_id: null`)
- `createPayment` แปลง error `11000` → `conflict` (กัน race ระดับ DB)

### Migration (สำคัญ)
```
[ ] MongoDB: ลบ payment "pending" ซ้ำ (order_id/preorder_id เดียวกันหลายใบ) ให้เหลือใบเดียว
[ ] npm run sync-indexes
```
ถ้ามี pending ซ้ำอยู่ก่อน `syncIndexes()` จะสร้าง index **ไม่ผ่าน** (❌) — `--fix` ยังไม่ครอบ payments ต้องลบด้วยมือ

---

## 2.11 — โปรที่คิดส่วนลดออกมา 0 ยังผูก `promotion_id` (เวอร์ชันทั่วไปของ 2.6)

### ปัญหา
โปร `Amount`/`Percentage` ที่คิดออกมาได้ `discount_amount = 0` (`discount_value = 0`, `eligibleAmount` น้อยมาก, config ผิด)
→ `order.promotion_id` ถูกเซ็ต แต่ guard `discount_amount > 0` ทำให้ไม่ `recordUsage` → ผูกโปรโดยไม่มี usage record

### วิธีแก้ — `discountEngine.computeDiscount`
```ts
discount = round2(Math.max(0, discount));
if (discount <= 0) {
  throw unprocessable("โปรโมชันนี้ไม่ให้ส่วนลดกับออเดอร์นี้ (ส่วนลดเป็น 0)");
}
```
- ครอบทั้ง path สร้างออเดอร์ + พรีวิว (เหมือน 2.6) · FreeShipping ไม่โดน เพราะถูก reject ก่อนแล้วตอน `!(delivery_fee > 0)`
- `persistOrder` ตัด guard `discount_amount > 0` ที่ `recordUsage` → เหลือ `if (appliedPromotion)`
  (มี `appliedPromotion` = `discount > 0` เสมอ · `order.promotion_id` ก็เซ็ตคู่กัน → ไม่มีเคส "ผูกโปรแต่ไม่บันทึก usage")

---

## ลำดับ commit (branch `Debug-Validate-data`)

```
9ab0348  fix: atomic promo usage claim + single active payment per order (BACKLOG 2.9, 2.10)
91a5d61  fix(promo): reject promotions that compute to zero discount (BACKLOG 2.11)
f737092  fix(shop): block customer cancel of paid orders; log BACKLOG 2.8-2.11
```
(2.8 ฝั่งแอดมิน + เอกสารรวมฉบับนี้ = commit ถัดไป)
