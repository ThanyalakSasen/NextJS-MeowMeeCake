# ขอบเขตการยกเลิกออเดอร์ของลูกค้า

> อัปเดตล่าสุด: 2026-09-07
> ขอบเขต: จำกัดสถานะที่ลูกค้ายกเลิกออเดอร์เองได้ — แก้ BACKLOG ข้อ 2.7
> เกี่ยวข้อง: [`BACKLOG.md`](BACKLOG.md) §2.7

---

## 1. ปัญหาเดิม

state machine ของ `order_status` (`src/services/orderService.ts` → `NEXT_STATUS`):

```
pending   → confirmed | cancelled
confirmed → preparing | cancelled
preparing → ready     | cancelled
ready     → completed | cancelled
completed → (จบ)
cancelled → (จบ)
```

`cancelled` เป็นปลายทางที่อนุญาตจาก **ทุกสถานะที่ยังไม่ completed** — รวมถึง `preparing` (ร้านเริ่มทำแล้ว) และ `ready` (ทำเสร็จรอส่ง/รอรับ)

route `POST /api/shop/orders/[id]/cancel` (ลูกค้ายกเลิกเอง) เรียก `orderService.cancelOrder()` ตรง ๆ โดยไม่จำกัดสถานะ → **ลูกค้ายกเลิกออเดอร์ที่ร้านลงมือทำไปแล้วได้** ร้านเสียของ/เสียต้นทุนฟรี

route `PATCH /api/admin/orders/[id]/status` (แอดมิน) ก็เรียก `updateOrderStatus()` — อันนี้ต้องการให้ยกเลิกได้กว้างเหมือนเดิม (แอดมินตัดสินใจเอง)

---

## 2. วิธีแก้

แยกสิทธิ์ 2 ระดับ โดยเพิ่ม option `allowedFrom` ให้ `cancelOrder()` — **ฝั่งลูกค้าเท่านั้นที่ส่งเข้ามา**

### `src/services/orderService.ts`

```ts
/** สถานะที่ "ลูกค้า" ยกเลิกออเดอร์เองได้ — พอร้านเริ่มเตรียม (preparing ขึ้นไป) ต้องติดต่อร้าน */
export const CUSTOMER_CANCELABLE_STATUSES: readonly OrderStatus[] = ["pending", "confirmed"];

export async function cancelOrder(
  id: string,
  opts: {
    cancelled_by?: string;
    cancelled_reason?: string;
    allowedFrom?: readonly OrderStatus[];   // ระบุ = ยกเลิกได้เฉพาะสถานะในลิสต์นี้
  } = {}
) {
  const { allowedFrom, ...rest } = opts;
  if (allowedFrom) {
    await dbConnect();
    assertObjectId(id);
    const order = await orderModel
      .findOne({ _id: id, deleted_at: null })
      .select("order_status")
      .lean<{ order_status: OrderStatus } | null>();
    if (!order) throw notFound("ไม่พบออเดอร์ที่ระบุ");
    if (!allowedFrom.includes(order.order_status)) {
      throw conflict(
        `ยกเลิกออเดอร์เองได้เฉพาะตอนสถานะ ${allowedFrom.join(" / ")} เท่านั้น ` +
        `(สถานะปัจจุบัน: "${order.order_status}") — หากต้องการยกเลิกกรุณาติดต่อร้าน`
      );
    }
  }
  return updateOrderStatus(id, "cancelled", rest);
}
```

### `src/app/api/shop/orders/[id]/cancel/route.ts`

```ts
const result = await orderService.cancelOrder(id, {
  cancelled_by: session.user_id,
  cancelled_reason: body.reason ?? "ลูกค้ายกเลิกเอง",
  allowedFrom: orderService.CUSTOMER_CANCELABLE_STATUSES,   // ← เพิ่มบรรทัดนี้
});
```

แอดมิน (`updateOrderStatus` โดยตรง) **ไม่แตะ** — ยังยกเลิกได้จาก pending/confirmed/preparing/ready เหมือนเดิม

---

## 3. พฤติกรรมหลังแก้

| สถานะออเดอร์ | ลูกค้ายกเลิกเอง (`/api/shop/.../cancel`) | แอดมิน (`/api/admin/.../status`) |
|---|---|---|
| `pending` | ✅ ได้ | ✅ ได้ |
| `confirmed` | ✅ ได้ | ✅ ได้ |
| `preparing` | ❌ **409** — "ติดต่อร้าน" | ✅ ได้ |
| `ready` | ❌ **409** | ✅ ได้ |
| `completed` | ❌ 409 (state machine) | ❌ 409 (state machine) |
| `cancelled` | ❌ 409 (เดิมเป็น no-op สำเร็จ — ดูหมายเหตุ) | ผ่าน (no-op) |

การยกเลิกที่ผ่าน ยังทำงานเหมือนเดิม: คืนสต็อก (`restockForOrder`) + คืนสิทธิ์โปรโมชัน (`revokeUsage`) + set `cancelled_at` / `cancelled_by` / `cancelled_reason` (ทั้งหมดอยู่ใน `updateOrderStatus`)

---

## 4. หมายเหตุ / จุดที่เปลี่ยนพฤติกรรมย่อย

- **ยกเลิกซ้ำ:** เดิมถ้าออเดอร์ `cancelled` อยู่แล้ว ลูกค้ากดยกเลิกอีกครั้งจะได้ผลลัพธ์สำเร็จแบบ no-op (`updateOrderStatus` มี `if (current === next) return`) — ตอนนี้ guard `allowedFrom` จะ throw 409 ก่อน (`cancelled` ไม่อยู่ใน `[pending, confirmed]`) · ยอมรับได้ ถือว่าชัดกว่าเดิม
- **DB query เพิ่ม 1 ครั้ง** ใน `cancelOrder` เมื่อมี `allowedFrom` (อ่าน `order_status` มาเช็คก่อน) — route ฝั่งลูกค้าอ่าน order ไปแล้วรอบหนึ่งเพื่อ `requireOwner` แต่ไม่ได้ส่งต่อ · การยกเลิกเกิดไม่บ่อย รับได้
- **ปรับ policy ได้ที่เดียว:** แก้ `CUSTOMER_CANCELABLE_STATUSES` เช่นถ้าภายหลังอยากให้ลูกค้ายกเลิกช่วง `preparing` ได้ (แต่มีค่าปรับ) ก็เติม `"preparing"` แล้วไปคิด logic ค่าปรับต่อ

---

## 5. หมายเหตุการตัดสินใจ

นี่เป็น **การตัดสินใจเชิงธุรกิจ** ที่ BACKLOG เปิดค้างไว้ — เลือกแนว "ลูกค้ายกเลิกเองได้ก่อนร้านลงมือทำ (`pending`/`confirmed`) เท่านั้น" เพราะ `preparing` = ตัดวัตถุดิบ/ลงแรงไปแล้ว การให้ลูกค้ายกเลิกฟรีถึงจุดนั้นทำให้ร้านแบกต้นทุน · ถ้าจำเป็นต้องยกเลิกหลังจากนั้นให้ผ่านแอดมิน (มีคนตัดสินใจ + คุยเรื่องเงินคืน)
