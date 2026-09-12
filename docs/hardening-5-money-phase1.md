# รอบ 5 — เงินเป็น integer (สตางค์), เฟส 1-3: Order+Preorder+Payment, Expense, Delivery zone

> อัปเดตล่าสุด: 2026-09-12
> สถานะ: ✅ **เฟส 1-3 เสร็จสมบูรณ์** (จากทั้งหมด 5 เฟส — ดู §7 "เฟสที่เหลือ")
> ที่มา: [`BACKLOG.md`](BACKLOG.md) §3.11 — งานเดี่ยวเสี่ยงสูงที่สุดในทั้งหมด (tag **L**)
> ก่อนเริ่ม: สำรวจขอบเขตจริงก่อน (17 model + 9 schema แตะเงิน) แล้วถามผู้ใช้เรื่อง API contract

## 0. ทำไมต้องแบ่งเฟส (และทำไมเฟส 1 ใหญ่กว่าที่คิดตอนแรก)

สำรวจโค้ดจริงก่อนแตะอะไรพบว่าเงินกระจายอยู่ใน **17 models** — ถ้าทำทีเดียวทั้งหมดตามที่ BACKLOG เขียนไว้
("กระทบทุก model/service") ความเสี่ยงสูงเกินจะรีวิวได้ทันครั้งเดียว จึงแบ่งเป็นเฟสตาม **domain ที่ผูกกัน
จริงทางโค้ด** ไม่ใช่แบ่งตามความรู้สึกว่า "เรื่องเดียวกัน":

- ตอนแรกวางแผนแยก Order ออกจาก Preorder (คนละ path) แต่พบว่า **`paymentModel` เป็น collection กลาง
  ที่ทั้งสองฝั่งใช้ร่วมกัน** (`payment.order_id` หรือ `payment.preorder_id` อย่างใดอย่างหนึ่ง) — ถ้าแปลง
  แค่ order แล้วปล่อย preorder ไว้เป็นบาท `paymentModel.amount` จะกำกวมว่าหน่วยไหนกันแน่ (payment
  บาง doc เป็นสตางค์ บาง doc เป็นบาท) แย่กว่าไม่แปลงเลย จึงต้องรวม preorder เข้าเฟสเดียวกัน
- `promotionUsagesModel.discount_applied` ก็ต้องแปลงพร้อมกันด้วยเหตุผลเดียวกัน (ค่าที่คิดมาจาก
  subtotal ของทั้ง order/preorder ที่ตอนนี้เป็นสตางค์แล้ว)
- `dashboardService` อ่านรวมจากทั้ง orderModel/orderItemModel เข้าด้วยกัน ต้องแก้พร้อมกันไปในตัว

**สิ่งที่ยังไม่แตะ** (ตั้งใจ ไม่ใช่ลืม — `expenseModel.amount` แปลงในเฟส 2, `deliveryZoneModel.fee`
แปลงในเฟส 3): `productModel`/`productVariantModel`/`productOptionModel` (ราคาสินค้า/variant/option),
`promotionModel` (นิยามโปรโมชัน — `discount_value`/`min_order_amount`/`max_discount_amount`),
`recipeModel`/`componentModel`/`ingredientModel` (ต้นทุนวัตถุดิบ/สูตร),
`cartItemModel.price_snapshot`, `orderItem`/`preorderItem`.`cost_per_unit` — ยังเป็นบาททั้งหมด ดู §7

---

## 1. การตัดสินใจสถาปัตยกรรม (ถามผู้ใช้ก่อนลงมือ)

**คำถาม:** API (request/response ทุก endpoint) จะเปลี่ยนเป็นจำนวนเต็มสตางค์ด้วยหรือไม่
**คำตอบผู้ใช้:** เก็บใน DB เป็นสตางค์ แต่ API ยังรับ-ส่งเป็นทศนิยมบาทเหมือนเดิม (ไม่ breaking change)

กติกาที่ตามมา (ดู `src/lib/money.ts`):

```ts
export function toSatang(baht: number): number { return Math.round(baht * 100); }
export function toBaht(satang: number): number { return Math.round(satang) / 100; }
```

1. แปลงเป็นสตางค์ **ให้เร็วที่สุด** ตอนรับ input (ทั้งจาก client และจาก "โดเมนอื่นที่ยังเป็นบาท" เช่น
   ราคาสินค้าจาก `productModel`)
2. คำนวณทุกอย่างเป็น integer สตางค์ตลอดทาง — **ห้ามผสมหน่วยกลางทางคำนวณเด็ดขาด**
3. แปลงกลับเป็นบาทเฉพาะตอนสุดท้ายก่อนส่ง response กลับ (หรือแสดงผล/log)

### รูปแบบ "แปลงข้ามโดเมนตรงจุดที่ข้าม" (จุดสำคัญที่สุดของเฟสนี้)

เพราะ `productModel`/`promotionModel`/`deliveryZoneModel`/`recipeService` **ยังไม่ถูกแปลง** แต่
`orderService`/`preorderService` เรียกข้ามไปอ่าน/เขียนโดเมนเหล่านั้นตลอดเวลา (คิดราคาสินค้า, คิด
ส่วนลด, คิดค่าส่ง, snapshot ต้นทุน) — ทุกจุดที่ข้ามโดเมนแปลงหน่วยตรงนั้นทันที ไม่ปล่อยให้หน่วยรั่วไหลไป
ไกลกว่าจุดที่ข้าม:

```ts
// resolveLine() — คำนวณ unit_price เป็นบาทให้เสร็จก่อนทั้งหมด (จาก productModel ที่ยังเป็นบาท)
// แล้วแปลงเป็นสตางค์ครั้งเดียวตอนจบ ก่อนคืนกลับเข้าสู่โดเมนออเดอร์
const unit_price = basePrice + variantPrice + optionsTotal; // บาททั้งหมด
return { ..., unit_price: toSatang(unit_price) };

// persistOrder() — deliveryService/promotionService ยังทำงานเป็นบาท
const fee = await deliveryService.calcDeliveryFee({ subtotal: toBaht(subtotal), ... });
delivery_fee = toSatang(fee.fee);

const result = await promotionService.validateForOrder({ subtotal: toBaht(subtotal), ... });
discount_amount = toSatang(result.discount_amount);
```

วิธีนี้ทำให้ **ไม่ต้องแตะ `productModel`/`promotionModel`/`deliveryZoneModel`/`discountEngine.ts`/
`deliveryService.ts`/`recipeService.ts`/`promotionService.ts` เลยสักไฟล์** ในเฟสนี้ — ลดพื้นที่เสี่ยงลง
มหาศาลเทียบกับถ้าพยายามแปลงทุกอย่างพร้อมกัน

### `cost_per_unit` จงใจปล่อยเป็นบาท

`orderItemModel.cost_per_unit`/`preorderItemModel.cost_per_unit` มาจาก `recipeService.getUnitCostByProduct()`
(ยังไม่แปลง) และใช้แค่คำนวณ COGS ใน dashboard — **ไม่เคยถูกบวก/ลบรวมกับ subtotal/total_amount ของ
ออเดอร์ที่ไหนเลย** (ยืนยันจากโค้ดจริง) จึงปลอดภัยที่จะให้ต่างหน่วยกับฟิลด์อื่นในเอกสารเดียวกันไปก่อนจนกว่า
โดเมนสูตร/วัตถุดิบจะถูกแปลงในเฟสถัดไป — มีคอมเมนต์กำกับไว้ในทุก schema ที่เกี่ยวข้องกันสับสน

---

## 2. Field ที่แปลงแล้ว (สตางค์)

| Model | Field | เฟส |
|---|---|---|
| `orderModel` | `subtotal`, `discount_amount`, `delivery_fee`, `total_amount` | 1 |
| `orderItemModel` | `unit_price`, `total_price`, `selected_options[].extra_price` (ไม่รวม `cost_per_unit`) | 1 |
| `preorderModel` | `subtotal`, `discount_amount`, `delivery_fee`, `total_amount` | 1 |
| `preorderItemModel` | `unit_price`, `total_price` (ไม่รวม `cost_per_unit`) | 1 |
| `paymentModel` | `amount` (ใช้ร่วมทั้งฝั่ง order/preorder) | 1 |
| `promotionUsagesModel` | `discount_applied` | 1 |
| `expenseModel` | `amount` | 2 |
| `deliveryZoneModel` | `fee` | 3 |

## 3. Service ที่แก้ + ตรรกะ presenter (สตางค์ → บาท ตอนคืนค่า)

- **`orderService.ts`** — `resolveLine()` (แปลง unit_price/extra_price), `persistOrder()`
  (subtotal/delivery_fee/discount_amount/total_amount ทั้งหมดเป็น integer arithmetic ล้วน ไม่ต้อง
  `round2()` อีกต่อไป — ลบ helper นี้ทิ้งไปเลย), เพิ่ม `presentOrder()`/`presentOrderItem()` ใช้ใน
  `listOrders`/`getOrderById`/`getOrderByNo`/`updateDelivery`/`setPaymentStatus`
- **`preorderService.ts`** — โครงเดียวกับ orderService เป๊ะ (`presentPreorder()`/`presentPreorderItem()`)
- **`paymentService.ts`** — `createPayment()` แปลง `input.amount` (บาทจาก client) เป็นสตางค์ก่อนเทียบ/
  บันทึก · `AMOUNT_TOLERANCE` เปลี่ยนจาก `0.01` (บาท) เป็น `1` (สตางค์) · เพิ่ม `presentPayment()` ใช้
  ในทุกจุดที่คืน payment doc (`create`/`list`/`getById`/`submitSlip`/`verify`/`refund`)
- **`promotionUsageService.ts`** — เพิ่ม `presentUsage()` ใช้ใน `recordUsage`/`listUsages`/`getUsageById`
- **`dashboardService.ts`** — `overview()` แปลง `revenue`/`discount` (จาก orderModel aggregate) เป็นบาท
  **ก่อน** เอาไปรวมกับ `cogs`/`expenseTotal` (ยังเป็นบาท) ในสูตร `profit_estimate` — ผสมหน่วยตรงนี้คือจุด
  เสี่ยงที่สุดถ้าพลาด (กำไรจะเพี้ยนx100 เงียบ ๆ ไม่มี error ให้เห็น) · `salesByDay()`/`topProducts()`
  แปลง `revenue` เช่นกัน
- **`expenseService.ts`** (เฟส 2) — เดิม export `createCrudService(...)` ตรง ๆ ไม่มีการแปลงอะไรเลย
  เปลี่ยนเป็นห่อ `base` (แบบเดียวกับ `deliveryZoneService` ในรอบ 4d) แล้ว override
  `create`/`update`/`list`/`getById`/`remove`/`restore` ให้แปลง `amount` เข้า/ออก · `summary()`
  (aggregate ตามหมวด) และ `totalInRange()` (ใช้จาก `dashboardService`) แปลงผลรวมเป็นบาทก่อนคืน —
  **`dashboardService.ts` ไม่ต้องแก้อะไรเลยสักบรรทัดในเฟสนี้** เพราะ `totalInRange()` คืนบาทให้เหมือนเดิม
  ทุกประการ (ยืนยันด้วย `git diff` ว่าไฟล์นี้ไม่มีการเปลี่ยนแปลงในเฟส 2)
- **`deliveryZoneService.ts`** (เฟส 3) — เพิ่ม `presentZone()` ใช้ใน `list`/`getById`/`create`/
  `update`/`remove`/`restore` (ให้ `/api/admin/delivery-zones` ยังบาทเหมือนเดิม) **แต่**
  `getActiveZonesCached()` (cache ภายในที่ `deliveryService.ts` เรียกใช้เท่านั้น ไม่เคยถูก expose ตรง
  ให้ client) **ตั้งใจไม่ผ่าน presenter** — ปล่อยเป็นสตางค์ดิบไว้ ให้ `deliveryService.ts` แปลงเองตรงจุด
  ที่ใช้จริง (`calcDeliveryFee()`/`listZones()`) ตามรูปแบบ "แปลงข้ามโดเมนตรงจุดที่ข้าม" เดียวกับเฟส 1

**ไม่ต้องแก้ schema (`src/schemas/order.ts`, `payment.ts`, `expense.ts`, `delivery.ts`) หรือ route ไหน
เลยสักไฟล์** —
client ยังส่ง/รับบาททศนิยมเหมือนเดิมทุกประการ การแปลงทั้งหมดอยู่ในชั้น service ล้วน ๆ

---

## 4. Migration script

`scripts/migrate-money-to-satang.ts` (`npm run migrate:money-to-satang`) — คูณ ×100 ทุก field ข้างบน
ด้วย MongoDB `$mul` (atomic ต่อ collection ไม่ต้อง fetch+loop ใน JS) รวม nested
`selected_options[].extra_price` ด้วย positional-all operator

**กันรันซ้ำแบบต่อ collection (marker แยก ไม่ใช่ marker เดียวทั้งไฟล์)** — บันทึก marker doc แยกกันต่อ
section ไว้ใน collection `migrations` (เช่น `_id: "money_to_satang_3_11_orders"`,
`"money_to_satang_3_11_expenses"` ฯลฯ) แต่ละ section เช็ค marker ของตัวเองก่อนรันเสมอ

**ทำไมต้องเป็น marker แยก ไม่ใช้ marker เดียวทั้งไฟล์ (บั๊กที่เจอตอนเขียนเฟส 2):** ตอนแรกออกแบบเป็น
marker เดียวทั้งไฟล์ (`"money_to_satang_3_11"`) เช็คครั้งเดียวตอนต้นฟังก์ชัน — ใช้ได้ดีตอนมีแค่เฟส 1
แต่พอมาเขียนเฟส 2 (เพิ่ม `expenseModel` เข้าไปในไฟล์เดิม) พบว่า **ถ้า DB เคยรัน migrate ตอนเป็นเฟส 1
ไปแล้ว (มี marker เดียวนั้นอยู่) รันสคริปต์ใหม่ (ที่มี expenseModel เพิ่มมาแล้ว) จะเจอ marker เดิม แล้ว
ข้ามทั้งไฟล์ทันที — `expenseModel` จะไม่ถูกแตะเลยแม้แต่ครั้งเดียว** เงียบ ๆ ไม่มี error ให้เห็นด้วย —
เปลี่ยนเป็น marker แยกต่อ collection ก่อน merge เฟส 2 แก้ปัญหานี้ถาวร: DB ที่เคยรันเฟส 1 ไปแล้ว รัน
สคริปต์เวอร์ชันเฟส 2 จะข้าม section เดิมที่มี marker (orders/payments/ฯลฯ) แต่ยังรัน `expenses` จริง
เพราะไม่มี marker ของมัน — มีเทสจำลองสถานการณ์นี้ตรง ๆ ใน `migrateMoneyToSatang.test.ts`

`runMigration()` คืน `Record<string, number | null>` — ตัวเลข = จำนวนเอกสารที่แก้จริง, `null` = section
นั้นถูกข้าม (เคยรันแล้ว) แยก logic ออกมาจาก CLI runner (ที่ทำ `mongoose.disconnect()` ตอนจบ) เพื่อให้
integration test import `runMigration()` ไปเรียกตรง ๆ ได้โดยไม่ตัด connection ที่เทสอื่นในไฟล์ใช้ร่วมกัน

**ต้องรันก่อน deploy จริงครั้งแรกหลัง PR นี้ merge** (หรือรันกับ DB dev/staging ที่มีข้อมูลทดสอบอยู่แล้ว
ถ้าอยากให้ตัวเลขเดิมยังถูกต้อง — ถ้าไม่รัน ข้อมูลเก่าจะโดนตีความเป็นสตางค์ทั้งที่จริงเป็นบาท เช่น
`total_amount: 150` เดิม (150 บาท) จะกลายเป็นแค่ 1.50 บาทถ้าไม่ migrate) — **ถ้าเคยรันตอนจบเฟสก่อนหน้า
ไปแล้ว รันซ้ำอีกครั้งตอนนี้ได้เลยปลอดภัยเสมอ** (marker แยกต่อ section) จะแค่เติม section ใหม่ที่ยังไม่
เคยรันให้เท่านั้น (ตอนนี้คือ `delivery_zones`)

---

## 5. บั๊กที่เจอระหว่างเขียนเทส (ไม่เกี่ยวกับเงินโดยตรง แต่แก้ไปด้วย)

`tests/integration/setup.ts`'s `afterEach` เดิมเคลียร์ collection ด้วย
`mongoose.connection.collections` (แคชเฉพาะ collection ที่เคยผ่าน Mongoose model) — collection ที่
เขียนตรงผ่าน native driver (`db.collection("migrations")` ใน migration script) **ไม่ถูกเคลียร์ระหว่าง
เทส** ทำให้เทส "กันรันซ้ำ" ของ `migrateMoneyToSatang.test.ts` เห็น marker ตกค้างข้ามเทสในไฟล์เดียวกัน
ผิดพลาด — แก้โดยเปลี่ยนไป `db.listCollections()` แล้วเคลียร์ทุก collection จริงที่มีอยู่แทน (ครอบคลุมกว่า
เดิม ป้องกันปัญหาเดียวกันสำหรับ migration script อื่นในอนาคตด้วย)

---

## 6. เทส

- `tests/lib/money.test.ts` (8 เคส) — `toSatang`/`toBaht` กันปัญหา floating-point คลาสสิก
  (`19.99*100 !== 1999` ใน JS ดิบ, `0.1+0.2` ฯลฯ), round-trip ไม่เพี้ยน, `percentOfSatang`,
  `toSatangFields`/`toBahtFields`
- `tests/integration/persistOrder.test.ts` (+1 เคส) — `29.9*3 = 89.69999999999999` ใน JS ดิบ (ก่อนแก้
  `orderItem.total_price` แต่ละบรรทัด**ไม่เคย** `round2()` เลย มีแต่ subtotal/total_amount รวมที่โดน —
  ยืนยันว่าหลังแก้ทั้ง order และ orderItem เก็บเป็น integer สตางค์เป๊ะ ไม่มีทางเพี้ยนแบบนี้อีก)
- `tests/integration/migrateMoneyToSatang.test.ts` (4 เคส) — แปลงถูกทุก field ทุก collection รวม
  nested array + `cost_per_unit` ไม่ถูกแตะ, กันรันซ้ำต่อ collection ใช้ได้จริง, **จำลองสถานการณ์
  "เพิ่ม field ใหม่เข้าไฟล์ทีหลัง" ตรง ๆ** (ตั้ง marker หลอกของ section เก่าไว้ก่อน แล้วยืนยันว่า section
  ใหม่ที่ยังไม่มี marker ยังรันจริง — คุมบั๊กที่เจอตอนเขียนเฟส 2 ไม่ให้เกิดซ้ำ)
- `tests/integration/expenseService.test.ts` (5 เคส, เฟส 2) — create/update แปลง amount ถูกทาง,
  list/getById คืนบาท, `summary()` รวมยอดตามหมวดถูกต้อง, `totalInRange()` คืนบาทตรง ๆ
- `tests/integration/dashboardService.test.ts` (1 เคส, เฟส 2) — สร้างออเดอร์ paid (satang) +
  ค่าใช้จ่าย (satang หลังเฟส 2) พร้อมกัน ยืนยันว่า `profit_estimate` ไม่ผสมหน่วยผิด (จุดเสี่ยงสุดตาม §3)
- `tests/integration/deliveryService.test.ts` (+4 เคส, เฟส 3) — create/update แปลง fee ถูกทาง,
  list/getById (หน้าแอดมิน) คืนบาท, `calcDeliveryFee` คำนวณถูกเป๊ะแม้ fee เป็นทศนิยมที่ float มักพัง
  (29.9 บาท)
- แก้ assertion เดิมที่ query DB ตรง ๆ (bypass presenter) ใน `persistOrder.test.ts`,
  `createPaymentPreorder.test.ts`, `cancelPreorder.test.ts` ให้ตรงกับหน่วยสตางค์จริง + comment กำกับ
  ชัดว่าทำไมต่างจาก `order.*`/`preorder.*` ที่มาจาก service (บาทเหมือนเดิม)
- unit 163 → 171 (คงที่ตั้งแต่เฟส 2) · integration 79 → 82 (เฟส 1) → 89 (เฟส 2) → **93** (เฟส 3)

---

## 7. เฟสที่เหลือของ §3.11 (ยังไม่ทำ — ทำทีหลังตามความจำเป็น ไม่ต้องรีบ)

เรียงตามความเสี่ยง/ผลกระทบจากน้อยไปมาก:

1. ~~**Expense** (`expenseModel.amount`)~~ — ✅ เสร็จแล้ว (เฟส 2, 2026-09-12)
2. ~~**Delivery zone** (`deliveryZoneModel.fee`)~~ — ✅ เสร็จแล้ว (เฟส 3, 2026-09-12) — โดดเดี่ยวตามคาด
   แต่ `getActiveZonesCached()` (cache ภายในที่ `deliveryService.ts` ใช้) ต้องปล่อยเป็นสตางค์ดิบไว้
   ไม่ผ่าน presenter (presenter มีไว้เฉพาะ `/api/admin/delivery-zones` เท่านั้น) — env fallback
   (`DELIVERY_FEE_METRO`/`DELIVERY_FEE_UPCOUNTRY`) **ไม่ได้แปลง** เพราะยังเป็น "บาท" ทั้งระบบเหมือนเดิม
   (ค่านั้นไม่เคยถูกเก็บลง DB เป็นสตางค์เลย ใช้ตรงในฟังก์ชันเป็นบาทตลอด ไม่มีอะไรต้องแก้)
3. **Recipe/Component/Ingredient cost** (`estimated_cost_per_batch`, `cost_per_unit`) — ผูกกับ
   `orderItem.cost_per_unit`/`preorderItem.cost_per_unit` ที่ปล่อยไว้เป็นบาทในเฟส 1 — ทำเฟสนี้เมื่อไหร่
   ต้องกลับมาแปลง 2 field นั้นให้เป็นสตางค์ด้วยพร้อมกัน (ตอนนี้คงเป็นบาทไว้ตั้งใจ)
4. **Promotion definition** (`promotionModel.discount_value`/`min_order_amount`/`max_discount_amount`)
   — ซับซ้อนกว่าที่อื่นเพราะ `discount_value` เป็นเงิน**เฉพาะ**ตอน `discount_type === "Amount"`
   (ตอน `"Percentage"` เป็นตัวเลข % ไม่ใช่เงิน) ต้อง handle แบบ conditional ทั้งตอน migrate และตอน
   validate schema
5. **Product pricing** (`productModel.product_price`/`sale_price`/`purchase_cost`,
   `productVariantModel.variant_price`, `productOptionModel.extra_price`) — เสี่ยงสุดเพราะกระทบ
   `cartItemModel.price_snapshot` ด้วย (ต้อง migrate พร้อมกัน) และเป็นจุดเริ่มของทุกการคำนวณเงินในระบบ
   (`resolveLine()` ที่เพิ่งแปลงในเฟส 1 จะไม่ต้องมี "จุดข้ามโดเมน" อีกต่อไปถ้าทำเฟสนี้เสร็จ — โค้ดจะง่ายขึ้น)

แต่ละเฟสควรทำแยก PR — เขียน migration ส่วนเพิ่มเข้าไปใน `scripts/migrate-money-to-satang.ts` เดิม
(เพิ่ม `runSection()` ใหม่ต่อ collection — **ห้ามใช้ marker เดิมซ้ำ ต้องตั้ง sectionId ใหม่ไม่ซ้ำใคร
เสมอ** ดู §4 ว่าทำไม) ไม่ต้องสร้างไฟล์ใหม่ เว้นแต่จะซับซ้อนจนแยกอ่านง่ายกว่า (เช่น promotion ที่ต้อง
conditional)
