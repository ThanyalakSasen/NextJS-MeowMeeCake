# ระบบพรีออเดอร์ (Preorder)

สั่งสินค้าล่วงหน้าเป็น "รอบ" สำหรับสินค้าที่ `product_type = "preorder"`
แยกคอลเลกชัน + service + route ออกจากออเดอร์ปกติ (`orderModel`) โดยสิ้นเชิง

---

## 1. ภาพรวม 4 คอลเลกชัน

| Model | คืออะไร |
|---|---|
| `PreorderRounds` | **รอบ** — ช่วงเวลาเปิดรับสั่งล่วงหน้า (`open_date`..`close_date`) + วันนัดรับ (`pickup_date`) |
| `PreorderRoundItems` | **สินค้าในรอบ** — สินค้า preorder ที่เปิดขายในรอบนั้น + ราคา override + เพดานจำนวนรวม (`max_qty_total`) + ยอดจองปัจจุบัน (`current_qty`) |
| `Preorders` | **ใบสั่งพรีออเดอร์ของลูกค้า** — 1 ใบ = 1 รอบ, มี `preorder_no`, ยอดเงิน, สถานะ |
| `PreorderItems` | **รายการในใบสั่ง** — snapshot ชื่อสินค้า + ราคา + จำนวน + `pickup_date` + `cost_per_unit` |

```
PreorderRound 1 ──< PreorderRoundItem >── Product (product_type: "preorder")
      │                     │
      │                     └── current_qty / max_qty_total  (โควตา)
      │
      └──< Preorder (ของลูกค้า) 1 ──< PreorderItem >── round_item_id, product_id
```

---

## 2. สถานะรอบ (`round_status`)

```
scheduled ──> open ──> closed
    │           │
    └───────────┴──> cancelled
```

| สถานะ | ความหมาย | ลูกค้าสั่งได้? |
|---|---|---|
| `scheduled` | ตั้งเวลาไว้ `open_date` ยังไม่ถึง (ค่า default ตอนสร้างถ้า `open_date` เป็นอนาคต) | ❌ |
| `open` | เปิดรับพรีออเดอร์ | ✅ **เฉพาะเมื่อ `now` อยู่ในช่วง `open_date`..`close_date`** |
| `closed` | ปิดรับแล้ว | ❌ |
| `cancelled` | ยกเลิกรอบ | ❌ |

- **ระบบไม่เลื่อนสถานะอัตโนมัติตามเวลา** — แอดมินกด `PATCH .../status` เอง
- ตอนลูกค้าสั่ง `preorderService` เรียก `assertRoundOrderable()` เช็คซ้ำอีกชั้น (สถานะต้อง `open` + อยู่ในช่วงเวลา)
- แก้ `round_name` / วันที่ ได้เฉพาะรอบ `scheduled` / `open` (ไม่ใช่ `closed` / `cancelled`)

---

## 3. โควตา (`current_qty` / `max_qty_total`)

แต่ละ `PreorderRoundItem` มีเพดาน `max_qty_total`

| การกระทำ | ผลต่อ `current_qty` |
|---|---|
| ลูกค้าสร้างพรีออเดอร์สำเร็จ | `+quantity` ต่อรายการ (`commitQty`) |
| ยกเลิกพรีออเดอร์ (ลูกค้า/แอดมิน) | `-quantity` คืนกลับ (`releaseQty`) |

**กันจองเกิน** — `commitQty` ใช้ update filter แบบมีเงื่อนไข ทำงานเป็น atomic operation เดียว:

```js
updateOne(
  { _id, deleted_at: null, is_active: true,
    $expr: { $lte: [ { $add: ["$current_qty", qty] }, "$max_qty_total" ] } },
  { $inc: { current_qty: qty } }
)
// modifiedCount !== 1  → 409 "จำนวนที่สั่งเกินโควตาที่เหลือ"
```

> ไม่มี MongoDB transaction — ถ้าสร้างเอกสารพรีออเดอร์ล้มเหลวหลัง commit โควตาไปแล้ว
> service จะ `releaseQty` คืนให้ทุกตัว (best-effort compensation) แล้ว throw error เดิม

---

## 4. การคิดเงิน

| ส่วน | สูตร |
|---|---|
| `unit_price` (ต่อรายการ) | `round_item.price_override ?? product.sale_price ?? product.product_price` |
| `total_price` (ต่อรายการ) | `round2(unit_price × quantity)` |
| `subtotal` | `round2(Σ total_price)` |
| `delivery_fee` | `order_type = "delivery"` → `deliveryService.calcDeliveryFee({ province, subtotal }).fee` · `"takeaway"` → `0` |
| `discount_amount` | ลูกค้า = `0` เสมอ · แอดมินสร้างแทน = ค่ากรอกมือ (`allowManualDiscount`) |
| `total_amount` | `round2(subtotal − discount_amount + delivery_fee)` |
| `cost_per_unit` (ต่อรายการ) | snapshot จากสูตรล่าสุด `recipeService.getUnitCostByProduct()` → เก็บลง `PreorderItem` เพื่อคำนวณกำไรใน dashboard |

ดูสูตรกลางทั้งระบบที่ [`docs/Summary.md`](Summary.md)

---

## 5. สถานะใบสั่ง (`order_status`) — เหมือนออเดอร์ปกติ

```
pending → confirmed → preparing → ready → completed
   └──────────┴───────────┴─────────┴──> cancelled   (คืนโควตาในรอบให้อัตโนมัติ)
```

- `PATCH /api/admin/preorders/[id]/status` — แอดมินเลื่อนสถานะ
- ลูกค้ายกเลิกเองได้ทุกสถานะที่ยังไม่ `completed` ผ่าน `POST /api/shop/preorders/[id]/cancel`
- ลบใบสั่ง (soft) ได้เฉพาะ `completed` / `cancelled`

---

## 6. Endpoints

### สาธารณะ — `/api/catalog` (ไม่ต้องล็อกอิน)

| Method | Path | หมายเหตุ |
|---|---|---|
| GET | `/api/catalog/preorder-rounds` | ค่าเริ่มต้นคืนเฉพาะรอบ `scheduled`/`open` ที่ `close_date` ยังไม่ผ่าน · `?all=1` เอาหมด · `?status=` `?search=` `?page=` `?limit=` |
| GET | `/api/catalog/preorder-rounds/[id]` | รายละเอียดรอบ + รายการสินค้า **`is_active=true`** พร้อม `current_price`, `remaining_qty` |

### ลูกค้า — `/api/shop` (ต้องล็อกอิน, เห็นเฉพาะของตัวเอง)

| Method | Path | Body |
|---|---|---|
| GET | `/api/shop/preorders` | — (`?order_status=` `?payment_status=` `?order_type=` `?round_id=` `?page=` `?limit=`) |
| POST | `/api/shop/preorders` | `{ round_id, order_type: "delivery"\|"takeaway", delivery_address?, items: [{ round_item_id, quantity, special_request? }] }` |
| GET | `/api/shop/preorders/[id]` | — (เจ้าของเท่านั้น) |
| POST | `/api/shop/preorders/[id]/cancel` | `{ reason? }` |

### แอดมิน — `/api/admin` (สิทธิ์เมนู `preorder`)

| Method | Path | สิทธิ์ | หมายเหตุ |
|---|---|---|---|
| GET/POST | `/api/admin/preorder-rounds` | `view`/`create` | POST รับ `items[]` สร้างรอบ + รายการในรอบพร้อมกันได้ |
| GET/PATCH/DELETE | `/api/admin/preorder-rounds/[id]` | `view`/`update`/`delete` | DELETE บล็อกถ้ายังมีพรีออเดอร์ค้างในรอบ |
| POST | `/api/admin/preorder-rounds/[id]/restore` | `update` | |
| PATCH | `/api/admin/preorder-rounds/[id]/status` | `update` | `{ round_status }` |
| GET/POST | `/api/admin/preorder-rounds/[id]/items` | `view`/`update` | เพิ่มสินค้าเข้ารอบ (`product_id` ต้องเป็น `preorder`) |
| PATCH/DELETE | `/api/admin/preorder-round-items/[id]` | `update` | DELETE บล็อกถ้า `current_qty > 0` (ใช้ `is_active=false` แทน) |
| GET/POST | `/api/admin/preorders` | `view`/`create` | POST ต้องมี `user_id` + รองรับ `discount_amount` |
| GET/DELETE | `/api/admin/preorders/[id]` | `view`/`delete` | |
| PATCH | `/api/admin/preorders/[id]/status` | `update` | `{ order_status, cancelled_reason? }` |

> ทุก mutation เขียน audit log (`entity`: `PreorderRound` / `PreorderRoundItem` / `Preorder`) — ดู [`docs/auditLog.md`](auditLog.md)

---

## 7. สิทธิ์ (RBAC)

เพิ่ม menu key `"preorder"` ใน `permissionService.MENU_KEYS` แล้ว

- **owner** — ผ่านทุก action อยู่แล้ว (bypass)
- **staff** — ต้องสร้าง permission row `{ role_id: <staff>, menu_key: "preorder", can_view/can_create/... }`
  ผ่าน `POST /api/admin/permissions` (ยังไม่มีใน seed)

---

## 8. ข้อมูลทดสอบ — `npm run seed:preorder-rounds`

สร้างสินค้าซาวโดว์ 5 รายการ (`product_type: "preorder"`) + 4 รอบ:

| รอบ | ช่วงเวลา | `round_status` | ใช้เทส |
|---|---|---|---|
| 21-27 ส.ค. 2569 | ผ่านมาแล้ว | `closed` | ดูรอบที่ปิดแล้ว (มี `current_qty` จำลอง) |
| 1-7 ก.ย. 2569 | ปัจจุบัน | `open` | **สั่งพรีออเดอร์ได้จริง** |
| 14-21 ก.ย. 2569 | อนาคต | `scheduled` | รอบที่ยังไม่เปิด |
| 1-7 ต.ค. 2569 | อนาคต | `scheduled` | รอบที่ยังไม่เปิด |

ต้องรัน `npm run seed` ก่อน (ต้องมี owner user + หมวด "ซาวโดว์" + หน่วย "ชิ้น") · สคริปต์ idempotent รันซ้ำได้

---

## 9. ยังไม่ทำ (ต่อยอด)

| งาน | สถานะ |
|---|---|
| ผูกโปรโมชัน/`discountEngine` กับพรีออเดอร์ | ยังไม่ทำ — รองรับแค่ `discount_amount` กรอกมือของแอดมิน |
| `paymentService` เรียก `preorderService.setPaymentStatus()` | มี hook `setPaymentStatus` รออยู่ — ยังไม่ต่อสาย (payment model รับ `preorder_id` ได้แล้ว) |
| `productionOrderService` สร้างใบสั่งผลิตจาก `round_id` | ยัง reject `source_type: "preorder"` |
| เลื่อน `round_status` อัตโนมัติตามเวลา (cron) | ยังไม่ทำ — แอดมินกดเอง |
| seed permission เมนู `preorder` ให้ role `staff` | ยังไม่มีใน `scripts/seed.ts` |
