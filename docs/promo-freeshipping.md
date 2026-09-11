# โปรโมชัน FreeShipping กับออเดอร์ที่ไม่มีค่าจัดส่ง

> อัปเดตล่าสุด: 2026-09-07
> ขอบเขต: การ reject โปรโมชันชนิด `FreeShipping` เมื่อออเดอร์ไม่มีค่าจัดส่ง — แก้ BACKLOG ข้อ 2.6
> เกี่ยวข้อง: [`Summary.md`](Summary.md) §2.3 · [`BACKLOG.md`](BACKLOG.md) §2.6

---

## 1. ปัญหาเดิม

โปรโมชันมี 3 ชนิด: `Percentage` / `Amount` / `FreeShipping`
ชนิด `FreeShipping` คิดส่วนลด = ค่าจัดส่ง:

```ts
// src/lib/discountEngine.ts — computeDiscount, สาขา FreeShipping (เดิม)
discount = ctx.delivery_fee;
```

แต่ `ctx.delivery_fee` เป็น `0` ได้ 2 กรณี:
- **ออเดอร์รับเอง (takeaway)** — `orderService.persistOrder` คิดค่าส่งเฉพาะ `order_type === "delivery"` เท่านั้น
- **ออเดอร์จัดส่งที่ได้ส่งฟรีอยู่แล้ว** — `subtotal ≥ DELIVERY_FREE_MIN` (ค่าเริ่มต้น 1500)

ทั้งสองกรณี → `discount = 0`

### ผลที่ตามมา (ข้อมูลไม่สอดคล้อง)

`persistOrder` ยังเซ็ต:
```ts
appliedPromotion = { promotion_id: result.promotion_id, discount_amount: 0 };
// ...
order.promotion_id = appliedPromotion.promotion_id;   // ← ออเดอร์บันทึกว่า "ใช้โปรนี้"
```

แต่ตอนบันทึกการใช้งานมี guard:
```ts
if (appliedPromotion && appliedPromotion.discount_amount > 0) {
  await promotionUsageService.recordUsage({ ... });   // ← ไม่ถูกเรียก เพราะ = 0
}
```

สรุป: **ออเดอร์ผูก `promotion_id` แต่ไม่มี usage record + `used_count` ไม่ขยับ**
- ลูกค้าไม่ได้ส่วนลดอะไร แต่ออเดอร์ดูเหมือนใช้โปรไปแล้ว
- ตอนยกเลิกออเดอร์ `promotionUsageService.revokeUsage({ order_id })` ไม่มีอะไรให้คืน
- รายงานการใช้โปรโมชันเพี้ยน (โปรที่ `usage_limit` จำกัด นับไม่ตรง)

---

## 2. วิธีแก้

**reject ไปเลย** เมื่อ `FreeShipping` เจอออเดอร์ที่ไม่มีค่าจัดส่ง — อย่าปล่อยให้เกิดส่วนลด 0

```ts
// src/lib/discountEngine.ts — computeDiscount, สาขา FreeShipping (ใหม่)
} else if (type === "FreeShipping") {
  if (!(ctx.delivery_fee > 0)) {
    throw unprocessable(
      "โปรโมชันส่งฟรีใช้ได้เฉพาะออเดอร์แบบจัดส่งที่มีค่าจัดส่งเท่านั้น " +
      "(ออเดอร์รับเอง หรือออเดอร์ที่ได้ส่งฟรีอยู่แล้ว ใช้ไม่ได้)"
    );
  }
  freeShipping = true;
  discount = ctx.delivery_fee;
}
```

ใช้ `!(x > 0)` แทน `x <= 0` เพื่อกัน `NaN`/`null` ด้วย

### ทำไมแก้ที่ `computeDiscount`

เป็นจุดเดียวที่ทั้ง 2 path วิ่งผ่าน:

| path | เรียกผ่าน | ผลหลังแก้ |
|---|---|---|
| สร้างออเดอร์ | `orderService.persistOrder` → `promotionService.validateForOrder` → `computeDiscount` | throw ก่อนออเดอร์ถูกสร้าง — ไม่มี `promotion_id` ค้าง |
| ลูกค้าเช็คโค้ดก่อนจ่าย | `POST /api/shop/promotions/validate` → `previewForCart` → `validateForOrder` → `computeDiscount` | ลูกค้าเห็น 422 ตั้งแต่ตอนกรอกโค้ด ไม่ต้องรอกดสั่ง |

ถ้าไปแก้ที่ `persistOrder` อย่างเดียว → พรีวิวจะบอก "ใช้ได้ ส่วนลด 0" แล้วตอนสั่งจริงถึง reject → ไม่สอดคล้อง

---

## 3. พฤติกรรมหลังแก้

| สถานการณ์ | เดิม | ใหม่ |
|---|---|---|
| FreeShipping + ออเดอร์ delivery (ค่าส่ง 40) | ลด 40 | ลด 40 (เหมือนเดิม) |
| FreeShipping + ออเดอร์ takeaway | ลด 0, ออเดอร์ผูก promo, ไม่มี usage | **422** `"โปรโมชันส่งฟรีใช้ได้เฉพาะออเดอร์แบบจัดส่ง..."` |
| FreeShipping + delivery แต่ subtotal ≥ 1500 (ส่งฟรีอยู่แล้ว) | ลด 0, ออเดอร์ผูก promo, ไม่มี usage | **422** (ข้อความเดียวกัน) |
| Percentage / Amount | ไม่กระทบ | ไม่กระทบ |

---

## 4. เคสทั่วไป: ส่วนลดออกมา 0 จากโปรชนิดอื่น (BACKLOG 2.11 — ✅ แก้แล้ว 2026-09-07)

เดิม: **โปรชนิด `Amount` หรือ `Percentage` ที่คิดออกมาได้ `discount_amount = 0`**
(เช่น `discount_value = 0`, `eligibleAmount` น้อยมาก, config ผิด) — ออเดอร์ยังผูก `promotion_id` โดยไม่บันทึก usage เหมือนกัน

แก้: `computeDiscount` เพิ่มเช็คหลัง `discount = round2(Math.max(0, discount))`:
```ts
if (discount <= 0) {
  throw unprocessable("โปรโมชันนี้ไม่ให้ส่วนลดกับออเดอร์นี้ (ส่วนลดเป็น 0)");
}
```
- ครอบทั้ง 2 path เหมือน 2.6 (สร้างออเดอร์ + พรีวิว)
- FreeShipping ไม่โดนเช็คนี้ เพราะถูก reject ก่อนแล้วตอน `!(ctx.delivery_fee > 0)` (และถ้าผ่าน = `delivery_fee > 0` แน่นอน)
- `persistOrder` ตัด guard `discount_amount > 0` ที่ `recordUsage` ทิ้ง → เหลือ `if (appliedPromotion)` เพราะตอนนี้ `discount > 0` เสมอเมื่อมี `appliedPromotion` · `order.promotion_id` ก็เซ็ตเฉพาะตอนมี `appliedPromotion` → ไม่มีเคส "ผูกโปรแต่ไม่บันทึก usage" อีก

---

## 5. หมายเหตุการตัดสินใจ

การ reject คือการเลือก **"โปรที่ไม่ให้ประโยชน์ = ใช้ไม่ได้"** แทน **"ใช้ได้แต่ลด 0"**
ถ้าธุรกิจอยากให้ลูกค้า "แปะโค้ดส่งฟรีไว้ก่อน" กับออเดอร์ takeaway ได้ (เผื่อเปลี่ยนเป็น delivery ทีหลัง) — ต้องออกแบบให้ผูกโค้ดที่ระดับตะกร้า ไม่ใช่ระดับออเดอร์ และคิดส่วนลดตอน checkout เท่านั้น
