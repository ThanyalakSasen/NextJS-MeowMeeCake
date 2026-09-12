# Preorder payment/cancellation hardening

> อัปเดตล่าสุด: 2026-09-12
> ขอบเขต: พา `preorderService.ts` / `paymentService.ts` ให้มีการป้องกันเทียบเท่า `orderService.ts` —
> แก้ BACKLOG §2b.1–2b.4
> เกี่ยวข้อง: [`BACKLOG.md`](BACKLOG.md) §2b · [`order-cancel.md`](order-cancel.md) (§2.7/2.8 ตัวต้นแบบที่เทียบด้วย)
> branch: `fix-preorder-payment-ownership`

---

## 0. ทำไมบั๊กพวกนี้ถึงเกิด (root cause เดียวกันทั้ง 4 ข้อ)

`preorderService.ts` ถูกเขียนขึ้นทีหลัง `orderService.ts` โดยจงใจ**ก๊อปโครงสร้าง**มาเยอะมาก (state
machine เดียวกัน, field ชื่อคล้ายกัน, comment อ้างถึงกันเอง — เช่น `preorderService.ts:384` เขียนไว้ตรง ๆ
ว่า "เรียกจาก paymentService ภายหลัง") แต่ตอนที่ `orderService`/`paymentService` โดน hardening รอบ
BACKLOG §2 (2.7–2.10, 2026-09-07) — เพิ่ม ownership check, amount-tolerance, auto-refund ตอนยกเลิก,
auto-confirm ตอนจ่ายเงิน — **ไม่มีใครย้อนกลับไปทำแบบเดียวกันให้ preorder** เพราะตอนนั้น preorder ยัง
ไม่เสร็จ (เฟส 5 ทำทีหลัง) ผลคือ preorder จบลงที่สถานะ "มีโครงเหมือน order ทุกอย่าง แต่ไม่มีการ์ดที่ order มี"
— โค้ดสองฝั่งดู symmetric แต่พฤติกรรมจริงไม่ symmetric เลย

**บทเรียน:** เวลามี "เส้นทางคู่ขนาน" (order ↔ preorder, หรือ pattern อื่นในอนาคต) ที่ต้อง hardening —
ต้องเช็ค **ทั้งสองเส้นทางพร้อมกัน** ไม่ใช่ทำเสร็จฝั่งเดียวแล้วถือว่าจบ เพราะ diff ระหว่างสองฝั่งจะไม่โชว์ขึ้นมา
เองใน code review ปกติถ้าไม่มีใครตั้งใจเทียบ (บั๊กพวกนี้เจอจากการไล่เทียบไฟล์ต่อไฟล์ ไม่ใช่จาก error/report จริง)

---

## 1. `createPayment` — ผู้ใช้คนอื่นจ่ายเงินแทนพรีออเดอร์คนอื่นได้ (2b.1, security)

### ปัญหาเดิม

`paymentService.createPayment()` แยก 2 branch ตาม `order_id`/`preorder_id` — branch `order` เช็ค 3 อย่างก่อนอนุญาตสร้าง payment:

```ts
// branch order (มีอยู่แล้ว)
if (String(order.user_id) !== String(input.user_id)) throw badRequest(...);   // ownership
if (order.order_status === "cancelled") throw conflict(...);                   // cancelled
if (Math.abs(amount - order.total_amount) > AMOUNT_TOLERANCE) throw badRequest(...); // amount
```

branch `preorder` เช็คแค่ **ข้อเดียว**: `preorder.payment_status === "paid"` — ไม่มี ownership, ไม่มี
cancelled-status, ไม่มี amount check เลย

`input.user_id` มาจาก `session.user_id` เสมอทั้ง `/api/shop/payments` (`withAuth`) และ
`/api/admin/payments` (`withPermission`) — เป็นค่าที่เชื่อถือได้ (ไม่ใช่ client-controlled) แต่
`input.preorder_id` เป็นค่าที่ client ส่งมาเอง (ผ่าน `parseBody` เช็คแค่รูปแบบ ObjectId ไม่เช็คว่าเป็นของใคร)

**exploit จริง:** ลูกค้า login แล้วยิง `POST /api/shop/payments` พร้อม `preorder_id` ของคนอื่น +
`amount` เท่าไหร่ก็ได้ → สร้าง payment `pending` ผูกกับพรีออเดอร์คนอื่นสำเร็จ ถ้าแอดมิน
`verifyPayment(approved:true)` ทีหลังโดยไม่ทันสังเกต (เช่นเชื่อสลิปที่แนบมา) พรีออเดอร์คนอื่นจะถูกมาร์ค
`paid` ทั้งที่เจ้าของจริงไม่ได้จ่ายอะไรเลย

### วิธีแก้

เพิ่ม 3 เช็คให้ branch `preorder` **ทุกตัวเหมือน branch `order` เป๊ะ** (`src/services/paymentService.ts`):

```ts
if (String(preorder.user_id) !== String(input.user_id)) {
  throw badRequest("พรีออเดอร์นี้ไม่ได้เป็นของผู้ใช้ที่ระบุ");
}
if (preorder.payment_status === "paid") throw conflict("พรีออเดอร์นี้ชำระเงินแล้ว");
if (preorder.order_status === "cancelled") throw conflict("พรีออเดอร์นี้ถูกยกเลิกแล้ว");
if (Math.abs(amount - preorder.total_amount) > AMOUNT_TOLERANCE) {
  throw badRequest(`ยอดชำระต้องเท่ากับยอดพรีออเดอร์ (${preorder.total_amount} บาท)`);
}
```

### ทำไมแก้แบบนี้

- **ไม่ออกแบบใหม่ — ก๊อป pattern ที่พิสูจน์แล้วจาก branch order มาตรงตัว** ปลอดภัยกว่าคิดเงื่อนไขใหม่เอง
  เพราะ branch order ผ่านการรีวิว+ใช้งานจริงมาแล้ว (ส่วนหนึ่งของ BACKLOG §2 ที่ปิดไปตั้งแต่ 2026-09-07)
- เช็ค ownership ที่ **`input.user_id` (จาก session)** ไม่ใช่ตรวจที่ route — เก็บไว้ที่ service layer
  เพราะ `createPayment` ถูกเรียกทั้งจาก `/api/shop/payments` และ `/api/admin/payments` (แอดมินสร้างแทน
  ลูกค้าได้) ถ้าเช็คที่ route จะต้องเขียนซ้ำ 2 ที่และเสี่ยงลืมจุดใดจุดหนึ่ง
- **ผลข้างเคียงที่ยอมรับ:** ฝั่งแอดมิน ถ้ากรอก `user_id` ผิดคน (ไม่ตรงเจ้าของพรีออเดอร์จริง) จะเจอ
  `badRequest` ทันทีแทนที่จะสร้าง payment ผูกผิดคนแบบเงียบ ๆ เหมือนเดิม — ถือเป็นพฤติกรรมที่ดีขึ้น
  (data integrity) ไม่ใช่ breaking change เพราะแอดมินต้องรู้ตัวเจ้าของอยู่แล้วเวลาบันทึกแทนลูกค้า

---

## 2. `propagateStatus` — จ่ายเงินพรีออเดอร์แล้วไม่ auto-confirm สถานะ (2b.2)

### ปัญหาเดิม

`paymentService.ts` มี helper `propagateStatus(payment, status)` ผลักสถานะไปยัง order/preorder ที่ผูกไว้
หลัง verify/refund — branch `order_id` เรียก `orderService.setPaymentStatus()` จริง ซึ่งข้างในมี logic
"จ่ายเงินสำเร็จ + ยัง pending → ยืนยันออเดอร์อัตโนมัติ (`pending→confirmed`)"

branch `preorder_id` **ไม่ได้เรียก `preorderService.setPaymentStatus()` เลย** — เขียน
`preorderModel.updateOne({...}, {$set:{payment_status,payment_id}})` ตรง ๆ แทน ทั้งที่
`preorderService.setPaymentStatus()` มี logic auto-advance เดียวกันเขียนไว้ครบแล้วตั้งแต่ต้น
(comment กำกับไว้ว่า "เรียกจาก paymentService ภายหลัง") — แค่**ไม่เคยมีใครเรียกจริง** (ยืนยันด้วย
`grep -rn "setPaymentStatus" src/` ก่อนแก้ พบแค่ definition กับ export type ไม่มี call site)

**ผล:** พรีออเดอร์ที่แอดมิน verify payment แล้วค้างที่ `order_status:"pending"` ตลอดไป จนกว่าแอดมินจะไป
กดเปลี่ยนสถานะเป็น `confirmed` เองอีกที (คนละหน้า คนละขั้นตอนกับหน้าตรวจสลิป — ลืมง่ายมาก)

### วิธีแก้

```ts
async function propagateStatus(payment: any, status: PaymentStatus) {
  if (payment.order_id) {
    await orderService.setPaymentStatus(String(payment.order_id), status, String(payment._id));
  } else if (payment.preorder_id) {
    await preorderService.setPaymentStatus(String(payment.preorder_id), status, String(payment._id));
  }
}
```

### ทำไมแก้แบบนี้

- **ไม่ต้องเขียน logic ใหม่เลย** — `preorderService.setPaymentStatus()` ถูกต้องอยู่แล้ว (มี
  `if (status === "paid" && preorder.order_status === "pending") { ... order_status = "confirmed" }`
  ตรงกับ `orderService.setPaymentStatus()` ทุกตัวอักษร) ปัญหาคือ "จุดเรียก" ไม่ใช่ "ตัว logic" — เลยแก้
  แค่บรรทัดเดียวที่ `propagateStatus`
- **ทำไมเดิมไม่เรียก:** สันนิษฐานว่าเขียน `preorderModel.updateOne()` ตรง ๆ ไปก่อนตอน `setPaymentStatus()`
  ยังไม่เสร็จ (dependency order ตอนพัฒนา) แล้วลืมย้อนกลับมาสลับให้เรียกฟังก์ชันจริงตอนเขียนเสร็จทีหลัง —
  เป็นเหตุผลเดียวกับที่ dead-code แบบนี้เจอยาก (compile ผ่าน, lint ผ่าน, ไม่มี error runtime — แค่ผล
  ลัพธ์ไม่ตรงที่ตั้งใจ) ต้องไล่เทียบกับ order ถึงจะเห็น

---

## 3. ยกเลิกพรีออเดอร์ที่จ่ายเงินแล้ว (แอดมิน) — ไม่คืนเงิน ไม่ log (2b.3, เทียบ §2.8)

### ปัญหาเดิม

`preorderService.updatePreorderStatus()` branch `next === "cancelled"` คืนแค่โควตารอบ
(`preorderRoundService.releaseQty`) ผ่าน raw for-loop + `.catch(() => undefined)` (กลืน error เงียบ) —
**ไม่เช็ค `payment_status` เลย** ไม่มีการเรียก `refundPayment`, ไม่มีแม้แต่ `log.warn`

เทียบกับ `orderService.updateOrderStatus()` branch เดียวกัน ที่ (ตั้งแต่ BACKLOG §2.8, 2026-09-07):
ใช้ `Saga` แทน `.catch(() => undefined)` (log ทุก step ที่ fail แทนกลืนเงียบ) และเช็ค
`payment_status === "paid"` → หา payment ที่ `paid` แล้ว `refundPayment` แบบ best-effort

**ผล:** พรีออเดอร์ที่แอดมินยกเลิกหลังลูกค้าจ่ายเงินไปแล้ว จบที่ `order_status:"cancelled"` +
`payment_status:"paid"` ค้างถาวร — ไม่มี refund record ไม่มี trace ใน log เลยสักบรรทัด (ตรงข้ามกับ
order ที่อย่างน้อยก็ log ว่า auto-refund ถูกข้ามถ้าหา payment ไม่เจอ)

### วิธีแก้

```ts
if (next === "cancelled") {
  const cleanup = new Saga();

  const items = await preorderItemModel.find({ preorder_id: preorder._id, deleted_at: null }).lean<any[]>();
  for (const it of items) {
    cleanup.onRollback(`release-qty-${it._id}`, () =>
      preorderRoundService.releaseQty(String(it.round_item_id), it.quantity)
    );
  }

  if (preorder.payment_status === "paid") {
    const paidPayment = await paymentModel
      .findOne({ preorder_id: preorder._id, status: "paid", deleted_at: null }).lean();
    if (paidPayment && opts.cancelled_by) {
      const verifiedBy = opts.cancelled_by;
      cleanup.onRollback("auto-refund", async () => {
        const { refundPayment } = await import("./paymentService"); // เลี่ยง circular import
        await refundPayment(String(paidPayment._id), { verified_by: verifiedBy });
      });
    } else {
      log.warn("preorder.auto_refund_skipped", { preorder_id: String(preorder._id), reason: "..." });
    }
  }

  await cleanup.rollback();
  // ... set cancelled_at / cancelled_by / cancelled_reason เหมือนเดิม
}
```

### ทำไมแก้แบบนี้

- **ใช้ `Saga` (`src/lib/compensation.ts`) แทนที่จะแก้ raw for-loop เดิม** เพราะ `Saga` ถูกนำมาใช้ใน
  `orderService`/`preorderService.createPreorder` แล้ว (BACKLOG §3.3, D3.1–D3.2) — เป็น utility ที่มีอยู่
  แล้วในโปรเจกต์ ให้ผล "best-effort + log ทุก step ที่ fail" แบบเดียวกันทั้งระบบ แทนที่จะมี 2 sytle
  (`.catch(() => undefined)` ที่นี่ vs `Saga` ที่อื่น) ทำให้ debug ยากขึ้นถ้าเก็บของเดิมไว้
- **dynamic import (`await import("./paymentService")`)** — ไม่ใช่ static import เพราะจะเกิด circular
  import จริง: `paymentService.ts` ต้อง import `preorderService` แบบ static อยู่แล้ว (ข้อ 2 ด้านบน,
  เรียก `preorderService.setPaymentStatus()`) ถ้า `preorderService.ts` import `paymentService` แบบ
  static กลับไปด้วย จะวนลูปกัน — แก้ด้วยการให้ฝั่ง `preorderService` เป็นฝั่ง dynamic เพราะ
  `orderService.ts` ทำแบบนี้อยู่แล้วกับปัญหาเดียวกันเป๊ะ (`orderService`↔`paymentService`) — เลือกสม่ำเสมอ
  กับ pattern ที่มีอยู่ ไม่ต้องคิดใหม่ว่าจะแก้ circular import ยังไง
- **best-effort ไม่ throw** — ถ้า `refundPayment` fail (เช่น DB สะดุด) การยกเลิกพรีออเดอร์ยังสำเร็จอยู่
  (แอดมินไปกด refund เองทีหลังได้ผ่าน `/api/admin/payments/[id]/refund`) เหตุผลเดียวกับ order: การ
  ยกเลิกที่ค้างไม่ได้อันตรายเท่ากับเงินไม่คืน แต่การ "ยกเลิกไม่สำเร็จเพราะ refund พัง" แย่กว่า — ให้ยกเลิก
  ผ่านก่อนเสมอ แล้ว log ไว้ให้ตามงานทีหลัง

---

## 4. ลูกค้ายกเลิกพรีออเดอร์ที่จ่ายเงินแล้วเองได้ทุกสถานะ (2b.4, เทียบ §2.7)

### ปัญหาเดิม

`preorderService.cancelPreorder()` (ใช้โดย `POST /api/shop/preorders/[id]/cancel`) ส่งต่อ
`updatePreorderStatus(id, "cancelled", opts)` ตรง ๆ — ไม่มี `allowedFrom` list จำกัดสถานะ ไม่มีการเช็ค
`payment_status === "paid"` เลย

เทียบกับ `orderService.cancelOrder()` ที่มี `CUSTOMER_CANCELABLE_STATUSES = ["pending","confirmed"]`
+ block self-cancel เมื่อจ่ายเงินแล้ว (`throw conflict()` บอกให้ติดต่อร้าน) — เพิ่มเข้ามาพร้อมกันตอน
BACKLOG §2.7 (ขอบเขตการยกเลิก) และ §2.8 (ผูกกับการคืนเงิน)

**ผล:** ลูกค้าที่จ่ายเงินพรีออเดอร์ไปแล้วยกเลิกเองได้ทุกสถานะ แม้ร้านกำลังเตรียมของอยู่ (`preparing`)
โควตาถูกคืนให้คนอื่นจองได้ แต่เงินของลูกค้าคนเดิมไม่ได้คืน และไม่มีกลไกตรวจจับ (ซ้อนกับข้อ 3 ด้านบน —
เส้นทางนี้ไม่มี `cancelled_by` เป็นแอดมินด้วย เลยตกไปที่ branch `log.warn` skip เฉย ๆ ไม่ refund เลย)

### วิธีแก้

```ts
export const CUSTOMER_CANCELABLE_STATUSES: readonly PreorderStatus[] = ["pending", "confirmed"];

export async function cancelPreorder(
  id: string,
  opts: {
    cancelled_by?: string;
    cancelled_reason?: string;
    allowedFrom?: readonly PreorderStatus[];
  } = {}
) {
  const { allowedFrom, ...rest } = opts;
  if (allowedFrom) {
    const preorder = await preorderModel
      .findOne({ _id: id, deleted_at: null })
      .select("order_status payment_status")
      .lean<{ order_status: PreorderStatus; payment_status?: PaymentStatus } | null>();
    if (!preorder) throw notFound("ไม่พบพรีออเดอร์ที่ระบุ");
    if (!allowedFrom.includes(preorder.order_status)) {
      throw conflict(`ยกเลิกพรีออเดอร์เองได้เฉพาะตอนสถานะ ${allowedFrom.join(" / ")} เท่านั้น ...`);
    }
    if (preorder.payment_status === "paid") {
      throw conflict("พรีออเดอร์นี้ชำระเงินแล้ว ยกเลิกเองไม่ได้ — กรุณาติดต่อร้านเพื่อขอยกเลิกและคืนเงิน");
    }
  }
  return updatePreorderStatus(id, "cancelled", rest);
}
```

และแก้ route ลูกค้าให้ส่ง `allowedFrom` เข้าไป (เดิมไม่ส่งเลย — คือสาเหตุตรง ๆ ที่ guard ไม่เคยทำงาน):

```ts
// src/app/api/shop/preorders/[id]/cancel/route.ts
const result = await preorderService.cancelPreorder(id, {
  cancelled_by: session.user_id,
  cancelled_reason: body.reason ?? "ลูกค้ายกเลิกเอง",
  allowedFrom: preorderService.CUSTOMER_CANCELABLE_STATUSES,   // ← เพิ่มบรรทัดนี้
});
```

แอดมิน (`PATCH /api/admin/preorders/[id]/status` → `updatePreorderStatus` ตรง ๆ) **ไม่แตะ** — ยัง
ยกเลิกได้ทุกสถานะที่ยังไม่ `completed` เหมือนเดิม (ผ่าน route คนละตัวที่ไม่ได้เรียก `cancelPreorder`)

### ทำไมแก้แบบนี้

- **`allowedFrom` เป็น parameter ที่ caller เลือกส่งเอง ไม่ใช่ hardcode ใน `cancelPreorder`** — เหตุผล
  เดียวกับ `orderService.cancelOrder`: `cancelPreorder`/`updatePreorderStatus` ต้องรองรับทั้ง "ลูกค้า
  ยกเลิกเอง" (จำกัดสถานะ) และ "แอดมินยกเลิก" (ไม่จำกัด) จากจุดเรียกเดียวกัน — ถ้า hardcode ไว้ในฟังก์ชัน
  จะต้องแยกฟังก์ชันใหม่สำหรับแอดมิน ซึ่งซ้ำซ้อนกว่า route ที่ต่างกันแค่ส่ง option ต่างกัน
- **payment-guard อยู่ใน `cancelPreorder` (ชั้นที่มี `allowedFrom`) ไม่ใช่ใน `updatePreorderStatus`
  (ชั้นในสุด)** เพราะ guard นี้เป็นเรื่อง "สิทธิ์ของลูกค้า" ไม่ใช่ "state machine" — แอดมินต้องยกเลิก
  preorder ที่จ่ายแล้วได้เสมอ (แล้วให้ auto-refund ที่ข้อ 3 ทำงาน) มีแค่ลูกค้าเองที่ห้าม self-cancel
  ตอนจ่ายแล้ว ตรงกับที่ `orderService` แยกไว้แบบเดียวกันทุกประการ
- **root cause ที่แท้จริงของบั๊กนี้คือ "route ไม่ส่ง `allowedFrom`" ไม่ใช่แค่ "service ไม่มี field นี้"**
  — เห็นได้จาก `orderService.cancelOrder` มี `allowedFrom` มาก่อนแล้ว (§2.7) แต่พอเขียน preorder
  เลียนแบบ ไม่ได้เพิ่ม field เดียวกันไว้ตั้งแต่แรก แล้ว route ก็เลยไม่มีอะไรให้ส่ง — แก้ทั้ง service เพิ่ม
  option และ route ส่ง option พร้อมกันในคอมมิตเดียว กัน "แก้ service แต่ลืมแก้ route" แบบที่เกิดกับ
  2b.2 (มี `setPaymentStatus()` พร้อมใช้ แต่ไม่มีใครเรียก)

---

## 5. สรุปรวม — พฤติกรรมหลังแก้ (เทียบ order ↔ preorder)

| สถานการณ์ | Order (ปิดตั้งแต่ §2.7/2.8) | Preorder (ปิด §2b, 2026-09-12) |
|---|---|---|
| สร้าง payment ให้ของคนอื่น | ❌ 400 (มีอยู่แล้ว) | ❌ 400 **(ใหม่ — 2b.1)** |
| สร้าง payment amount ไม่ตรง | ❌ 400 (มีอยู่แล้ว) | ❌ 400 **(ใหม่ — 2b.1)** |
| จ่ายเงินสำเร็จตอน `pending` | ✅ auto-confirm → `confirmed` | ✅ auto-confirm → `confirmed` **(ใหม่ — 2b.2)** |
| แอดมินยกเลิกที่จ่ายแล้ว | ✅ auto-refund + log | ✅ auto-refund + log **(ใหม่ — 2b.3)** |
| ลูกค้ายกเลิกเองตอนจ่ายแล้ว | ❌ 409 "ติดต่อร้าน" | ❌ 409 "ติดต่อร้าน" **(ใหม่ — 2b.4)** |
| ลูกค้ายกเลิกเองตอน `preparing`+ | ❌ 409 "ติดต่อร้าน" | ❌ 409 "ติดต่อร้าน" **(ใหม่ — 2b.4)** |
| ลูกค้ายกเลิกเองตอน `pending`/`confirmed` (ยังไม่จ่าย) | ✅ ได้ | ✅ ได้ (ไม่เปลี่ยน) |

ทั้ง 4 ข้อไม่ได้เพิ่ม field/behavior ใหม่ที่ order ไม่มี — เป็นการ**ทำให้ preorder ตามทันสิ่งที่ order มีอยู่
แล้ว** ทั้งหมด จึงไม่มี design decision ใหม่ให้ตัดสินใจ (ต่างจาก [`order-cancel.md`](order-cancel.md) §5
ที่เป็นการตัดสินใจเชิงธุรกิจใหม่ตอนแก้ order ครั้งแรก) — งานนี้คือการซิงก์ให้ตรงกันเท่านั้น

## 6. ยังเปิดค้าง (สืบทอดมาจาก order path — ไม่ใช่ scope ของรอบนี้)

- ยังไม่มี audit log แยกสำหรับ auto-refund preorder (เหมือน order — ดู `order-cancel.md` §3 "ยังเปิดค้าง")
- แอดมินยังยกเลิกพรีออเดอร์ที่จ่ายแล้วแบบ "ไม่คืนเงิน" (ยึดเงิน) ไม่ได้
- §2c (BACKLOG) — บั๊กความทนทานอื่นที่เจอพร้อมกัน (clearCart ไม่กัน error, voidTransaction ไม่มี floor
  guard ฯลฯ) เป็นคนละ scope กับเอกสารนี้ ยังไม่ได้แก้

## 7. เทส

`tests/integration/createPaymentPreorder.test.ts` (4 เคส, 2b.1) ·
`tests/integration/cancelPreorder.test.ts` (5 เคส, 2b.2–2b.4) — รวม 9 เคสใหม่ ทุกเคส mock เฉพาะ
`makeUser`/`makePreorder` (สร้าง preorder ตรงผ่าน model ไม่ผ่านระบบรอบ/โควตาจริง เพราะเทสนี้โฟกัสที่
payment/cancellation ไม่ใช่การจองโควตา) — ดู `tests/integration/helpers.ts`
