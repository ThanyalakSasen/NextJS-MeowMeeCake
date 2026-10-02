# หน่วยเงิน: กลับมาเก็บเป็น "บาท" ทั้งระบบ (2026-10-01)

> ตัดสินใจ: 2026-10-01 · เหตุผล: แอป **FrontOffice ต่อ MongoDB ตัวเดียวกันโดยตรง** (ไม่ผ่าน API ของ backend นี้) และเขียนเงินเป็นบาท
> ยกเลิกการเก็บ "สตางค์" ของ [BACKLOG §3.11](BACKLOG.md) (2026-09-12) · PR: `fix/backlog4-y7-y11` (#57)

## 1. ปัญหา

| | backend (หลัง §3.11) | FrontOffice |
|---|---|---|
| เขียน `product_price` 35 บาทลง DB | `3500` (สตางค์) | `35` (บาท) |
| อ่าน `3500` | 35 บาท ✅ | 3,500 บาท ❌ |
| อ่าน `35` | 0.35 บาท ❌ | 35 บาท ✅ |

→ DB มีสองหน่วยปนกัน ราคาเพี้ยน ×100/÷100 ทุกครั้งที่อีกฝั่งแก้ข้อมูล: BACKLOG2 §16 (2026-09-24) · BACKLOG4 R7 (2026-09-30 —
สินค้า 42 ตัว + ออเดอร์ `ORD-1790786142302-M2PY` ยอด "55" ที่ backend อ่านเป็น 0.55 บาท)

## 2. ก่อน / หลัง

| | ก่อน (§3.11 สตางค์) | หลัง (บาท) |
|---|---|---|
| หน่วยใน DB | สตางค์ integer (`3500`) | **บาท** ทศนิยมไม่เกิน 2 ตำแหน่ง (`35`, `35.5`) |
| หน่วยที่ API รับ-ส่ง | บาท | บาท (**ไม่เปลี่ยน** — frontend/FrontOffice ไม่ต้องแก้) |
| `toSatang(x)` (src/lib/money.ts) | `Math.round(x × 100)` | `round2(x)` — ปัด 2 ตำแหน่ง (ชื่อเดิมคงไว้ ~130 จุด) |
| `toBaht(x)` / `toBahtFields` | `x ÷ 100` | `round2(x)` |
| `round2(x)` | `Math.round(x × 100) / 100` | เพิ่ม `Number.EPSILON` (1.005 → 1.01) |
| ราคารวมบรรทัด / subtotal / total (order, preorder, cart snapshot) | บวก/คูณ integer ไม่ต้องปัด | ปัดด้วย `toSatang()` ทุกจุดที่คูณ/รวม (`orderService`, `preorderService`, `cartService`) |
| ต้นทุนสูตร/ส่วนประกอบ (`recipeService`, `componentService`) | `Math.round()` เป็นสตางค์เต็ม | ปัด 2 ตำแหน่ง |
| ตรวจข้อมูลรายวัน (Y11) | `price_not_integer` (มีทศนิยม = บาท) · `price_too_low` < 1,000 สตางค์ | `price_bad_precision` (ทศนิยม > 2) · `price_too_low` < 1 บาท · `price_too_high` > 10,000 บาท (น่าจะเป็นสตางค์) |
| สคริปต์ยุคสตางค์ (`migrate-money-to-satang`, `fix-money-units`, `fix-orders-money`, `audit-money-units`, `audit-orders-money`, `recompute-order-costs`) | รันได้ | **ถูกบล็อก** ตอนรันจาก CLI (`scripts/_legacyMoney.ts`) — รันแล้ว = ×100 ผิด · ลบ `npm run migrate:money-to-satang` |
| `fix:baht-prices` (R7 ×100) | อยู่ใน PR #57 | **ลบ** — ราคา `35` ถูกต้องแล้วตามหน่วยใหม่ |

discount engine / ค่าส่ง / LINE / dashboard ไม่ต้องแก้ — ทำงานเป็นบาทอยู่แล้ว (เดิมแปลงที่ขอบ) · เทสทั้งหมดปรับให้ DB เป็นบาท (ทั้ง PR #57: 506 ผ่าน)

## 3. ย้ายข้อมูลใน DB จริง — `scripts/migrate-money-to-baht.ts`

ข้อมูลจริง (ตรวจอ่านอย่างเดียว 2026-10-01) มีสองหน่วยปน → แบ่งฟิลด์ 2 แบบ:

| แบบ | ฟิลด์ | ทำ |
|---|---|---|
| **big-only** (FrontOffice เขียนได้) | `products.product_price` · `orders.subtotal/delivery_fee/total_amount` · `orderitems.unit_price/total_price` · `payments.amount` · `cartitems.price_snapshot` · `preorderrounditems.price_override` | ÷100 เฉพาะค่า ≥ 1,000 · ค่า < 1,000 = บาทอยู่แล้ว ไม่แตะ (สินค้าร้านนี้ไม่มีชิ้นไหนต่ำกว่า 10 บาท) |
| **all** (backend เขียนอย่างเดียว — สตางค์ทั้งหมด) | `products.sale_price/purchase_cost` · `orders.discount_amount` · `orderitems.cost_per_unit/selected_options[].extra_price` · `cartitems.selected_options[].extra_price` · พรีออเดอร์ + รายการ · โปรโมชัน (`discount_value` เฉพาะ Amount, `min_order_amount`, `max_discount_amount`) · `promotionusages` · ค่าใช้จ่าย · โซนค่าส่ง · วัตถุดิบ · ส่วนประกอบ · สูตร · variant/option | ÷100 ทุกค่า |

dry-run บน DB จริง (2026-10-01): **÷100 347 ค่า** (orders 70 · orderitems 109 · payments 27 · cartitems 42 · products 7 (sale_price) ·
promotions 11 · ingredients 30 · recipes 24 · …) · **ไม่แตะ 75 ค่า** (product_price 42 · ออเดอร์/รายการ/ชำระเงินยุคราคาเพี้ยน · ตะกร้า ·
price_override 366/650/400) · **ต้องดูเอง 1:** `WEB-1790317257577` (ยกเลิกแล้ว — subtotal สตางค์แต่ค่าส่งเป็นบาท ยอดไม่ลงตัว)

ความปลอดภัย: dry-run ค่าเริ่มต้น · `--apply` backup ทุกค่าลง `scripts/backups/money-to-baht-*.json` ก่อน · เขียนแบบมีเงื่อนไข
`{ _id, field: ค่าเดิม }` · ไม่แตะ `updated_at` · ลง marker `money_to_baht_applied` → รันซ้ำไม่ได้ · เทส `migrateMoneyToBaht.test.ts` 2 เคส

## 4. ขั้นตอนตอน deploy (ต้องทำพร้อมกัน — โค้ดใหม่อ่านข้อมูลเป็นบาท)

1. **หยุด backend + FrontOffice** (กันเขียนระหว่างย้าย)
2. `npm run migrate:money-to-baht` → ตรวจแผน → `npm run migrate:money-to-baht -- --apply`
3. deploy backend โค้ดใหม่ (PR #57) แล้วเปิด backend + FrontOffice
4. `npm run check:data-integrity -- --no-notify` → ต้องเหลือแค่รหัส `pos-`/`pre-` 2 ตัว (DEPLOY §⑦ ข้อ 3)
5. แก้มือ: `WEB-1790317257577` (ยกเลิกแล้ว — จะปล่อยไว้ก็ได้) · ออเดอร์ `ORD-1790786142302-M2PY` ยอด 55 บาทถูกต้องแล้วตามหน่วยใหม่

⚠️ ห้าม deploy โค้ดใหม่โดยไม่ย้ายข้อมูล (ยอดเดิมจะแสดง ×100) และห้ามย้ายข้อมูลแล้วรันโค้ดเก่า (ยอดจะแสดง ÷100)

## 5. สิ่งที่ยังต้องระวัง

- FrontOffice ต้องเขียนเงินเป็น **บาท** ทุกฟิลด์ (ราคา, ยอดออเดอร์, ค่าส่ง, การชำระเงิน) และทศนิยมไม่เกิน 2 ตำแหน่ง
- FrontOffice เขียน DB ตรง → ไม่มี userlog / ไม่ตัดสต็อกผ่าน `productService` / ไม่ผ่าน validation ของ backend — ระยะยาวควรเรียก API
- `check:data-integrity` รายวันจะแจ้งถ้ามีค่าเข้าข่ายสตางค์ (`price_too_high`) หรือถูกหาร 100 (`price_too_low`)
