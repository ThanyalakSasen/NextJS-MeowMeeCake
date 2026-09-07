# Re-price ตอน checkout

> อัปเดตล่าสุด: 2026-09-07
> ขอบเขต: การคิดราคาต่อหน่วยใหม่ตอนสร้างออเดอร์จากตะกร้า — แก้ BACKLOG ข้อ 2.5
> เกี่ยวข้อง: [`Summary.md`](Summary.md) §1 (สูตรราคาขาย) · [`BACKLOG.md`](BACKLOG.md) §2.5

---

## 1. re-price คืออะไร

**re-price = โหลดค่าราคาปัจจุบันจาก DB ใหม่ + คำนวณราคาต่อหน่วยใหม่ด้วยสูตรเดิม** (ไม่ใช่แค่ "โหลดราคาสินค้า")

ทำ 3 อย่าง:

1. **โหลดค่าราคาปัจจุบัน** (แทนที่จะใช้ `cartItem.price_snapshot` ที่เก็บไว้)
   - `product.sale_price ?? product.product_price` — ราคาฐาน
   - `variant.variant_price` — ส่วนเพิ่มของ variant (ถ้าเลือก)
   - `option.extra_price` ของทุก option ที่เลือก
2. **ประกอบใหม่ด้วยสูตรเดิม** (ดู [`Summary.md`](Summary.md) §1)
   ```
   unit_price = basePrice + variantAdd + Σ optionsAdd
   ```
3. **re-validate ว่าของยังมี/ยังขายได้** — สินค้าถูกลบ? เป็น preorder? variant/option หาย?

แล้วเอา `unit_price` ใหม่ไปคิดต่อทั้งห่วงโซ่: `total_price` → `subtotal` → ส่วนลด → ค่าส่ง → `total_amount`

---

## 2. ทำไมต้องมี (บั๊ก 2.5)

`cartService.addItem` คำนวณ `price_snapshot` **ตอนหยิบใส่ตะกร้า** แล้วเก็บลง `cartItem`
เดิม `createOrderFromCart` ส่ง `unit_price: it.price_snapshot` เข้าออเดอร์ตรง ๆ โดยไม่คิดใหม่

→ ถ้า `product_price` / `sale_price` / `variant_price` / `extra_price` เปลี่ยนหลังของอยู่ในตะกร้า **ออเดอร์คิดราคาเก่า**

| | เดิม | หลังแก้ (Approach 1) |
|---|---|---|
| ราคาต่อหน่วยตอนสร้างออเดอร์ | `price_snapshot` (อาจเก่า) | โหลด product/variant/option สด แล้วบวกใหม่ |
| `product_snapshot` (ชื่อ th/eng/variant) | จาก populate ในตะกร้า | จาก product/variant ปัจจุบันใน `resolveLine` |
| โหลดราคา DB ตอน checkout | ไม่ (populate แค่ชื่อ) | ใช่ |
| สินค้าถูกลบ / เป็น preorder | หลุดไปสร้างออเดอร์ได้ | throw (`notFound` / `badRequest`) |
| variant / option หาย | ยังใส่ราคาเดิม | throw `badRequest` |
| option text required / ยาวเกิน | ไม่เช็คซ้ำ | re-validate |

**ตัวอย่าง:** หยิบชีสเค้กใส่ตะกร้าตอน ฿220 → `price_snapshot = 220` · แอดมินขึ้นราคาเป็น ฿240
- เดิม: ออเดอร์คิด ฿220
- หลังแก้: `resolveLine` โหลด `product_price = 240` → ออเดอร์คิด ฿240

---

## 3. re-price เกิดที่จุดไหนบ้างใน flow

| # | จุดในflow | endpoint / ฟังก์ชัน | ผูกมัดไหม | หมายเหตุ |
|---|---|---|---|---|
| 1 | เปิด/รีเฟรชหน้าตะกร้า | `GET /api/shop/cart` → `getCartDetail` | ไม่ (display) | **ยังไม่ทำ** — ตะกร้ายังโชว์ `price_snapshot` |
| 2 | แก้จำนวน / เพิ่ม-ลบรายการ | `addItem` / `updateItemQuantity` | ไม่ (display) | `addItem` re-price อยู่แล้ว · `updateItemQuantity` ไม่แตะราคา |
| 3 | เข้าหน้า checkout | `getCartDetail` อีกรอบ | ไม่ (display) | **ยังไม่ทำ** |
| 4 | พรีวิวค่าส่ง | `POST /api/shop/orders/delivery-quote` | ไม่ (preview) | subtotal คิดฝั่ง server |
| 5 | ใส่/validate โปรโมโค้ด | `promotionService.validateForOrder` | ไม่ (preview) | ส่วนลดผูกกับ subtotal/line_total |
| 6 | **กด "ยืนยันสั่งซื้อ" → สร้างออเดอร์** | `POST /api/shop/orders` → `createOrderFromCart` → `persistOrder` | **ใช่ (authoritative)** | ✅ **ทำแล้ว** — ราคาแช่ลง `orderItem.unit_price` ตรงนี้ |
| 7 | หลังสร้างออเดอร์ (อัปสลิป / admin verify) | — | — | ไม่ re-price — ราคา lock ที่ `orderItem` แล้ว |

**หลักคิด:**
- จุด 6 (`persistOrder`) = *ความจริงที่ผูกมัด* → ต้อง re-price **เสมอ** แม้ `getCartDetail` เพิ่งคิดไปก่อนหน้า (ราคาอาจเปลี่ยนใน gap ระหว่างเปิดหน้ากับกดสั่ง / ห้ามเชื่อค่าจาก client)
- จุด 1,3,4,5 = *โชว์ให้ตรง* (ไม่ผูกมัด) — ทำเพื่อให้พรีวิวตรงกับตอนสั่งจริง

---

## 4. สิ่งที่ทำไปแล้ว (Approach 1)

**ไฟล์:** `src/services/orderService.ts` → `createOrderFromCart`

เลิกสร้าง `lines` ด้วยมือจาก cart item · วนแต่ละรายการ → แปลงเป็น `OrderLineInput` → เรียก `resolveLine()`
(ตัวเดียวกับ path สั่งเอง / POS ใช้ — สูตรราคาจึงรวมเป็นที่เดียว)

```ts
const notes = input.item_notes ?? {};
const lines: PricedLine[] = [];
for (const it of detail.items as any[]) {
  const product = it.product_id ?? {};
  const variant = it.variant_id ?? null;
  lines.push(
    await resolveLine({
      product_id: String(product._id ?? it.product_id),
      variant_id: variant?._id ? String(variant._id) : null,
      selected_options: (it.selected_options ?? [])
        .filter((o: any) => o?.option_id != null)
        .map((o: any) => ({
          option_id: String(o.option_id),
          text_value: o.text_value ?? null,
        })),
      special_request: notes[String(it._id)] ?? null,
      quantity: it.quantity,
    })
  );
}
```

`resolveLine` (orderService.ts) ทำให้ครบในตัว:
- โหลด `product` (`deleted_at: null`) → ไม่พบ = `notFound` · `product_type === "preorder"` = `badRequest`
- โหลด `variant` (match `product_id` + `deleted_at: null`) → ไม่พบ = `badRequest`
- โหลด options (match `product_id` + `deleted_at: null`) → ไม่พบ = `badRequest` · re-validate `is_required` / `max_text_length` ของ text input
- คิด `unit_price = (sale_price ?? product_price) + variant_price + Σ extra_price`
- คืน `product_snapshot` (ชื่อ th/eng/variant) จากข้อมูลปัจจุบัน · `cost_per_unit: null` (persistOrder เติม snapshot ต้นทุนเองทีหลัง)

**ตรวจแล้ว:** `npm run typecheck` ผ่าน

---

## 5. ยังไม่ได้ทำ / ต่อยอด

| เรื่อง | รายละเอียด |
|---|---|
| re-price แบบ *เงียบ* | ลูกค้าไม่เห็นว่าราคาเปลี่ยนระหว่างหน้าตะกร้ากับยอดจริง — ถ้าราคาขึ้นอาจรู้สึกถูกหลอก |
| `getCartDetail` ยังไม่ re-price | หน้าตะกร้า / หน้า checkout ยังโชว์ `price_snapshot` — ควรให้คำนวณสด + แนบ metadata (`unit_price`, `unit_price_at_add`, `price_changed`, `price_delta`, `availability`) เพื่อให้ frontend โชว์ badge/banner "ราคาปรับปรุง" |
| ไม่เช็ค `is_visible === false` | `resolveLine` ตรวจแค่ `deleted_at` — สินค้าที่ปิดขายชั่วคราว (ไม่ได้ลบ) ยังสั่งผ่านตะกร้าได้ |
| ยิง DB ~1 query/บรรทัด | `resolveLine` วน `await` ทีละรายการ — ทำ batch (`$in`) ได้ถ้าตะกร้าใหญ่ |
| `updateItemQuantity` ไม่ re-price | แก้จำนวนในตะกร้าไม่อัปเดต `price_snapshot` ของบรรทัดนั้น |
| flow ยืนยันราคา (two-step) | ถ้าธุรกิจต้องการ "ยืนยันราคาใหม่อย่างชัดเจน": เทียบ `unit_price` ใหม่กับ `price_snapshot` → ถ้าต่าง ตอบ 409 + รายการที่เปลี่ยน → client ส่งซ้ำพร้อม `accept_price_changes: true` |

---

## 6. หมายเหตุการตัดสินใจ

การ re-price คือการเลือก **"คิดราคาปัจจุบันตอนสั่ง"** แทน **"ถือราคาในตะกร้าเป็นคำมั่น"**
บางร้านเลือกอย่างหลัง (ราคาที่ลูกค้าเห็นตอนหยิบ = ราคาที่จ่าย) — ถ้าจะกลับไปทางนั้น ให้ `createOrderFromCart` ใช้ `it.price_snapshot` เหมือนเดิม แต่ควรจำกัดอายุ snapshot (เช่น เกิน N นาที ค่อย re-price) และเก็บ `price_snapshot_at`
