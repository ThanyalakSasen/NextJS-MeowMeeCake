# สรุปสูตรคำนวณ — ราคา / ต้นทุน / กำไร-ขาดทุน

> อัปเดตล่าสุด: 2026-09-02
> รวมทุกสูตรที่ระบบใช้คำนวณเรื่องเงิน พร้อมไฟล์ที่เขียนอยู่ และตัวอย่างตัวเลข

**สารบัญ**
1. [ราคาขาย (customer-facing)](#1-ราคาขาย-customer-facing)
2. [ยอดออเดอร์: subtotal / ค่าส่ง / ส่วนลด / ยอดชำระ](#2-ยอดออเดอร์)
3. [ต้นทุนสูตรและส่วนประกอบ (BOM)](#3-ต้นทุนสูตรและส่วนประกอบ-bom)
4. [ต้นทุนต่อหน่วยสินค้า + snapshot ลงออเดอร์](#4-ต้นทุนต่อหน่วยสินค้า--snapshot)
5. [Dashboard: รายได้ / COGS / ค่าใช้จ่าย / กำไรโดยประมาณ](#5-dashboard)
6. [การหักสต็อกวัตถุดิบตอนผลิต](#6-การหักสต็อกวัตถุดิบตอนผลิต)
7. [เบ็ดเตล็ด: คะแนนรีวิว / สรุปค่าใช้จ่าย](#7-เบ็ดเตล็ด)
8. [สมมติฐานและข้อจำกัดที่ต้องรู้](#8-สมมติฐานและข้อจำกัด)
9. [ตัวแปร env ที่เกี่ยวกับเงิน](#9-ตัวแปร-env-ที่เกี่ยวกับเงิน)

หมายเหตุ: `round2(x)` = `Math.round(x * 100) / 100` (ปัดทศนิยม 2 ตำแหน่ง) ใช้แทบทุกที่ที่คิดเงิน

---

## 1. ราคาขาย (customer-facing)

**ไฟล์:** `src/services/cartService.ts` (`addItem`), `src/services/orderService.ts` (`resolveLine`)

```
basePrice   = product.sale_price ?? product.product_price        // ถ้ามี sale_price ใช้ราคานั้น
variantAdd  = variant.variant_price (ถ้าเลือก variant) ; ไม่เลือก = 0
optionsAdd  = Σ option.extra_price  (ของ options ที่เลือกทั้งหมด)

unit_price  = basePrice + variantAdd + optionsAdd
```

- `unit_price` ถูกเก็บเป็น **`price_snapshot`** ใน `cartItem` ตอนหยิบใส่ตะกร้า (ล็อกราคา ณ ตอนนั้น)
- ตอนสั่งซื้อผ่านตะกร้า ใช้ `price_snapshot` เดิม — **ไม่ re-price** แม้ราคาสินค้าจะเปลี่ยนภายหลัง (ดู §8)
- ตอนสั่งแบบระบุ items เอง (`source: "items"` / POS) → `resolveLine` คิด `unit_price` ใหม่จากราคาปัจจุบัน

**ตัวอย่าง:** เค้กช็อกโกแลต `product_price = 350`, `sale_price = 320`, เลือกขนาด 1 ปอนด์ (`variant_price = 150`), เพิ่มเขียนข้อความ (`extra_price = 30`)
→ `unit_price = 320 + 150 + 30 = 500`

---

## 2. ยอดออเดอร์

**ไฟล์:** `src/services/orderService.ts` (`persistOrder`)

### 2.1 subtotal

```
line.total_price = unit_price × quantity
subtotal         = round2( Σ line.total_price )
```

### 2.2 ค่าจัดส่ง (delivery_fee)

**ไฟล์:** `src/services/deliveryService.ts` (`calcDeliveryFee`)

```
ถ้า order_type = "takeaway"                → delivery_fee = 0

ถ้า order_type = "delivery":
    หาโซนจาก "จังหวัด" ปลายทาง:
        กรุงเทพฯ + ปริมณฑล (กทม., นนทบุรี, ปทุมธานี, สมุทรปราการ, สมุทรสาคร, นครปฐม)
                                          → zoneFee = DELIVERY_FEE_METRO      (ค่าเริ่มต้น 40)
        จังหวัดอื่นทั้งหมด (catch-all)      → zoneFee = DELIVERY_FEE_UPCOUNTRY  (ค่าเริ่มต้น 80)

    ถ้า subtotal ≥ DELIVERY_FREE_MIN (ค่าเริ่มต้น 1500)  → delivery_fee = 0   (ส่งฟรี)
    ไม่ถึง                                              → delivery_fee = zoneFee
```

- ระบบ **คิดเองเสมอ** ฝั่ง server — ลูกค้ากรอก `delivery_fee` เองไม่ได้
- แอดมิน override ได้ (`/api/admin/orders` ส่ง `delivery_fee` มา → `delivery_fee_override = true`)
- พรีวิวก่อนสั่ง: `POST /api/shop/orders/delivery-quote`

### 2.3 ส่วนลด (discount_amount)

**ไฟล์:** `src/lib/discountEngine.ts` (`computeDiscount`)

ก่อนคิด ต้องหา "ยอดที่ร่วมรายการ" (eligible):

```
ถ้าโปรโมชันจำกัดสินค้า/หมวด (applicable_products หรือ applicable_categories ไม่ว่าง):
    eligibleLines  = lines ที่ product_id อยู่ใน applicable_products
                     หรือ category_id อยู่ใน applicable_categories
มิฉะนั้น:
    eligibleLines  = ทุก line

eligibleAmount = round2( Σ eligibleLine.line_total )
eligibleQty    = Σ eligibleLine.quantity
```

ตรวจเงื่อนไข (ไม่ผ่าน → 422 ไม่ให้ใช้โปรโมชัน):
- `channel` ต้องอยู่ใน `applicable_channels` (`online` / `instore`)
- `eligibleAmount ≥ min_order_amount` (ถ้ากำหนด)
- `eligibleQty ≥ min_quantity` (ถ้ากำหนด)

คิดส่วนลดตาม `discount_type`:

| discount_type | สูตร |
|---|---|
| **Percentage** | `discount = eligibleAmount × (discount_value / 100)` แล้ว `discount = min(discount, max_discount_amount)` ถ้ากำหนด `max_discount_amount` |
| **Amount** | `discount = min(discount_value, eligibleAmount)` |
| **FreeShipping** | `discount = delivery_fee` , ตั้ง `free_shipping = true` · ถ้า `delivery_fee ≤ 0` (ออเดอร์รับเอง / ได้ส่งฟรีอยู่แล้ว) → **reject 422** ไม่คิดส่วนลด 0 |

```
discount_amount = round2( max(0, discount) )
```

ถ้า **ไม่ได้ใช้โปรโมชัน**: `discount_amount = max(0, discount_amount ที่แอดมินกรอก)` (ลูกค้ากรอกเองไม่ได้)

**ตัวอย่าง Percentage + cap:** โปรโมชันลด 20% สูงสุด 100 บาท, ตะกร้า `subtotal = 800` (ไม่จำกัดสินค้า)
→ `discount = 800 × 0.20 = 160` → `min(160, 100) = 100` → `discount_amount = 100`

### 2.4 ยอดชำระ (total_amount)

```
guard:  discount_amount ต้อง ≤ subtotal + delivery_fee   (ไม่งั้น 400)

total_amount = round2( subtotal − discount_amount + delivery_fee )
```

**ตัวอย่างเต็ม (delivery + Percentage):**
```
subtotal      = 800
delivery_fee  = 40        (กทม., subtotal ยังไม่ถึง 1500)
discount_amount = 100     (จาก §2.3)
total_amount  = 800 − 100 + 40 = 740
```

**ตัวอย่าง FreeShipping:**
```
subtotal      = 600
delivery_fee  = 80        (ต่างจังหวัด)
discount_amount = 80      (= delivery_fee)
total_amount  = 600 − 80 + 80 = 600      // เท่ากับ subtotal พอดี (ค่าส่งเป็นศูนย์สุทธิ)
```

---

## 3. ต้นทุนสูตรและส่วนประกอบ (BOM)

**ไฟล์:** `src/lib/bom.ts`

> ⚠️ **ไม่มีการแปลงหน่วย** — สมมติว่า `quantity` ในสูตรอยู่หน่วยเดียวกับ `cost_per_unit` ของวัตถุดิบ

### 3.1 ต้นทุนจากวัตถุดิบ

```
ingredientItemsCost = Σ ( item.quantity × ingredient.cost_per_unit )
```

### 3.2 ต้นทุนจากส่วนประกอบ (component)

```
componentUnitCost   = component.estimated_cost_per_batch / component.yield_qty   // ต้นทุนต่อ 1 หน่วยผลผลิตของ component
componentItemsCost  = Σ ( item.quantity × componentUnitCost )
```

### 3.3 estimated_cost_per_batch

คิดให้อัตโนมัติเมื่อไม่ได้ส่งค่ามา:

```
Recipe    : estimated_cost_per_batch = round2( ingredientItemsCost + componentItemsCost )
Component  : estimated_cost_per_batch = round2( ingredientItemsCost )              // component ไม่มี component ซ้อน
```

**ตัวอย่าง (Recipe):** เค้ก 1 แบทช์ (`yield_qty = 8` ชิ้น)
- แป้ง 500 (หน่วยตามสูตร) × cost_per_unit 0.05 = 25
- น้ำตาล 300 × 0.04 = 12
- ครีม (component) 2 หน่วย × (ครีม `estimated_cost_per_batch = 120` / `yield_qty = 10`) = 2 × 12 = 24
→ `estimated_cost_per_batch = round2(25 + 12 + 24) = 61`

---

## 4. ต้นทุนต่อหน่วยสินค้า + snapshot

**ไฟล์:** `src/services/recipeService.ts` (`getUnitCostByProduct`), `src/services/orderService.ts` (`persistOrder`)

```
สูตรที่ใช้ = สูตรของสินค้านั้นที่ deleted_at: null และ created_at ใหม่สุด (1 สูตร)

unit_cost  = round2( recipe.estimated_cost_per_batch / recipe.yield_qty )

ถ้าสินค้าไม่มีสูตร หรือ yield_qty = 0   → unit_cost = null
```

ตอน **สร้างออเดอร์** ระบบ batch lookup ต้นทุนของสินค้าทุกตัวในบิล แล้ว snapshot ลง:

```
orderItem.cost_per_unit = unit_cost ของสินค้านั้น  (ณ เวลาที่สั่ง)
```

**ตัวอย่าง:** จาก §3.3 เค้ก `estimated_cost_per_batch = 61`, `yield_qty = 8`
→ `unit_cost = round2(61 / 8) = 7.63` บาท/ชิ้น
→ สั่ง 3 ชิ้น: `orderItem.cost_per_unit = 7.63`, `quantity = 3`

> ข้อจำกัด: ต้นทุนเป็นระดับ **สินค้า** ไม่แยก variant · ตัวเลือกเสริม (options) ไม่คิดเป็นต้นทุน (คิดเป็นแค่ราคาขายเพิ่ม)

---

## 5. Dashboard

**ไฟล์:** `src/services/dashboardService.ts`
**Endpoint:** `GET /api/admin/dashboard/overview?date_from=&date_to=`

ตัวกรองพื้นฐานทุกตัวเลข: `order.deleted_at = null` และ (ถ้าระบุช่วง) `order.created_at` อยู่ในช่วง

### 5.1 รายได้ (revenue)

```
revenue = Σ order.total_amount   ของออเดอร์ที่ payment_status = "paid"
```

> `total_amount` รวมค่าส่งที่เก็บจากลูกค้าไว้แล้ว และหักส่วนลดไว้แล้ว (จาก §2.4)

### 5.2 ตัวเลขประกอบ

```
paidOrders       = จำนวนออเดอร์ที่ payment_status = "paid"
discount_given   = Σ order.discount_amount   (ออเดอร์ paid)
avg_order_value  = paidOrders > 0 ? round2(revenue / paidOrders) : 0
```

### 5.3 ต้นทุนสินค้าขาย (COGS)

```
COGS = Σ ( (orderItem.cost_per_unit ?? 0) × orderItem.quantity )
       เฉพาะ orderItem ของออเดอร์ที่ payment_status = "paid" และอยู่ในช่วงวันที่
```

> `orderItem.cost_per_unit` มาจาก §4 · ถ้าเป็น `null` (สินค้าไม่มีสูตร) จะถูกนับเป็น **0** → COGS จะต่ำกว่าจริง

### 5.4 ค่าใช้จ่าย (expenses)

**ไฟล์:** `src/services/expenseService.ts` (`totalInRange`)

```
expenses = Σ expense.amount   ของ expense ที่ deleted_at: null และ date อยู่ในช่วง
```

### 5.5 กำไรโดยประมาณ (profit_estimate)

```
profit_estimate = round2( revenue − expenses − COGS )
```

**ตัวอย่าง (ช่วง 1 เดือน):**
```
revenue   = 120,000     (ออเดอร์ paid รวมค่าส่ง หักส่วนลดแล้ว)
COGS      =  38,000      (Σ cost_per_unit × quantity ของทุก orderItem ที่ paid)
expenses  =  55,000      (ค่าเช่า + ค่าแรง + ค่าไฟ + วัตถุดิบซื้อเข้า ฯลฯ)

profit_estimate = 120,000 − 55,000 − 38,000 = 27,000
```

> เรียก "โดยประมาณ" เพราะ: COGS ขาดสินค้าที่ไม่มีสูตร · ค่าส่งที่จ่ายจริงให้ขนส่งนับรวมใน `expenses` (ไม่ได้แยก) · ไม่มีการแปลงหน่วยในต้นทุนวัตถุดิบ · เงินเก็บเป็น float

### 5.6 ยอดขายรายวัน / สินค้าขายดี

```
salesByDay   : group ออเดอร์ paid ตามวัน (เวลาไทย) → { date, revenue = Σ total_amount, orders = count }
topProducts  : group orderItem (ของออเดอร์ paid) ตาม product_id
               → { quantity_sold = Σ quantity , revenue = Σ total_price }  เรียงตาม quantity_sold
```

---

## 6. การหักสต็อกวัตถุดิบตอนผลิต

**ไฟล์:** `src/services/productionItemService.ts` (`consumeStock`)

ไม่ใช่การคิดเงินโดยตรง แต่เป็นสูตรที่กระทบต้นทุน (ปริมาณวัตถุดิบที่ใช้จริง):

```
qty     = use_actual ? item.actual_qty : item.planned_qty      // จำนวนที่จะผลิต
scale   = qty / recipe.yield_qty                               // กี่ "เท่าของ 1 แบทช์"

ความต้องการวัตถุดิบต่อ 1 แบทช์ (กาง component 1 ชั้น):
    จาก recipe.ingredients โดยตรง          : demand[ing] += it.quantity
    จาก recipe.components                  : factor = compItem.quantity / component.yield_qty
                                             demand[ing] += componentIngredient.quantity × factor

qty_consumed (ต่อวัตถุดิบ) = round( demand[ing] × scale , ทศนิยม 3 ตำแหน่ง )
```

จากนั้นหัก `ingredient.current_stock -= qty_consumed` (atomic) และบันทึกเป็น `IngredientTransaction` type `"use"`

> มูลค่าสต็อกวัตถุดิบ (`Σ current_stock × cost_per_unit`) — **ยังไม่มีการคำนวณในระบบ**

---

## 7. เบ็ดเตล็ด

### 7.1 คะแนนรีวิวสินค้า

**ไฟล์:** `src/services/reviewService.ts` (`recomputeProductRating`)

```
product.avg_rating   = round2( avg(review.rating) )   ของรีวิวที่ is_visible = true และ deleted_at: null
product.review_count = count(รีวิวเดียวกัน)
ถ้าไม่มีรีวิวเลย → avg_rating = null , review_count = 0
```

### 7.2 สรุปค่าใช้จ่ายตามหมวด

**ไฟล์:** `src/services/expenseService.ts` (`summary`)
**Endpoint:** `GET /api/admin/expenses/summary?date_from=&date_to=`

```
group expense ตาม category  →  { category, total = Σ amount, count }
total รวม = Σ ทุกหมวด
```

### 7.3 การบันทึกการใช้โปรโมชัน

**ไฟล์:** `src/services/promotionUsageService.ts`

```
promotionUsage.discount_applied = discount_amount ที่คิดได้จริง (§2.3)
promotion.used_count += 1        เมื่อสร้างออเดอร์สำเร็จ
promotion.used_count -= 1        เมื่อออเดอร์ถูกยกเลิก (revokeUsage)
```

---

## 8. สมมติฐานและข้อจำกัด

| # | เรื่อง | ผลกระทบ |
|---|---|---|
| 8.1 | **ไม่แปลงหน่วย** ในการคิดต้นทุน BOM (`bom.ts`) | ถ้าสูตรใส่ "กิโลกรัม" แต่ `cost_per_unit` เป็นบาท/กรัม → ต้นทุนผิด 1000 เท่า ต้องใส่หน่วยให้ตรงกันเอง |
| 8.2 | ต้นทุนต่อหน่วยเป็นระดับ **สินค้า** ไม่แยก variant | เค้ก 1 ปอนด์ กับ 2 ปอนด์ มี `cost_per_unit` เท่ากัน (จากสูตรเดียว) |
| 8.3 | สินค้า **ไม่มีสูตร** → `cost_per_unit = null` → COGS นับเป็น 0 | กำไรใน dashboard สูงกว่าจริงสำหรับสินค้าซื้อมาขายต่อ (น้ำดื่ม ฯลฯ) — ดู BACKLOG §3.16 |
| 8.4 | ตัวเลือกเสริม (options) ไม่มีต้นทุน | ท็อปปิ้งที่คิดเงินเพิ่มลูกค้า ไม่ถูกนับเป็นต้นทุน |
| 8.5 | ตะกร้า **ไม่ re-price** ตอน checkout | ถ้าขึ้นราคาสินค้าหลังลูกค้าหยิบใส่ตะกร้า จะคิดราคาเดิม (`price_snapshot`) |
| 8.6 | ค่าส่งที่จ่ายจริงให้ขนส่ง อยู่ใน `expenses` รวม | ไม่ได้ผูกค่าส่งจ่ายออกกับค่าส่งที่เก็บลูกค้าเป็นรายออเดอร์ |
| 8.7 | เงินเก็บเป็น **float** (JS number) + `round2` | สะสม error ปัดเศษได้เมื่อข้อมูลเยอะมาก — ดู BACKLOG §3.11 |
| 8.8 | ต้นทุนสูตรใช้ **สูตรล่าสุด** เท่านั้น | ถ้ามีหลายสูตรต่อสินค้า สูตรเก่าถูกละเลยในการคิดต้นทุน |
| 8.9 | "รายได้" = `total_amount` ของออเดอร์ `paid` | ออเดอร์ที่ completed แต่ยังไม่ paid ไม่ถูกนับเป็นรายได้ |

---

## 9. ตัวแปร env ที่เกี่ยวกับเงิน

| ตัวแปร | ค่าเริ่มต้น | ใช้ที่ |
|---|---|---|
| `DELIVERY_FREE_MIN` | `1500` | ยอด subtotal ที่ถึงแล้วส่งฟรี |
| `DELIVERY_FEE_METRO` | `40` | ค่าส่ง กทม. + ปริมณฑล |
| `DELIVERY_FEE_UPCOUNTRY` | `80` | ค่าส่งต่างจังหวัด |

ดูรายละเอียด env ทั้งหมดที่ [`docs/env.md`](env.md)

---

## แผนผังลำดับการคิดเงินของ 1 ออเดอร์

```
สินค้าแต่ละรายการ
  unit_price = (sale_price ?? price) + variant_price + Σ option.extra_price      [§1]
  line_total = unit_price × quantity                                            [§2.1]
        │
        ▼
subtotal = round2(Σ line_total)                                                 [§2.1]
        │
        ├──► delivery_fee  (จากจังหวัด + subtotal ≥ free_min ? 0)               [§2.2]
        │
        ├──► discount_amount  (โปรโมชัน: Percentage/Amount/FreeShipping)         [§2.3]
        │
        ▼
total_amount = round2(subtotal − discount_amount + delivery_fee)                [§2.4]
        │
        ▼
บันทึกออเดอร์ + orderItem.cost_per_unit = สูตรล่าสุด.cost_per_batch / yield_qty  [§4]
        │
        ▼  (เมื่อ payment_status = "paid" แล้ว dashboard จึงนับ)
revenue  += total_amount
COGS     += Σ (cost_per_unit × quantity)
profit_estimate = revenue − expenses − COGS                                     [§5.5]
```
