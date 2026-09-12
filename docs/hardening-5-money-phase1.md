# รอบ 5 — เงินเป็น integer (สตางค์), เฟส 1: Order + Preorder + Payment

> อัปเดตล่าสุด: 2026-09-12
> สถานะ: ✅ **เฟส 1 เสร็จสมบูรณ์** (จากทั้งหมดที่ต้องทำ — ดู §5 "เฟสที่เหลือ")
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

**สิ่งที่ยังไม่แตะในเฟสนี้** (ตั้งใจ ไม่ใช่ลืม): `productModel`/`productVariantModel`/
`productOptionModel` (ราคาสินค้า/variant/option), `promotionModel` (นิยามโปรโมชัน —
`discount_value`/`min_order_amount`/`max_discount_amount`), `deliveryZoneModel.fee`,
`recipeModel`/`componentModel`/`ingredientModel` (ต้นทุนวัตถุดิบ/สูตร), `expenseModel.amount`,
`cartItemModel.price_snapshot`, `orderItem`/`preorderItem`.`cost_per_unit` — ยังเป็นบาททั้งหมด ดู §5

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

## 2. Field ที่แปลงแล้ว (สตางค์) ในเฟสนี้

| Model | Field |
|---|---|
| `orderModel` | `subtotal`, `discount_amount`, `delivery_fee`, `total_amount` |
| `orderItemModel` | `unit_price`, `total_price`, `selected_options[].extra_price` (ไม่รวม `cost_per_unit`) |
| `preorderModel` | `subtotal`, `discount_amount`, `delivery_fee`, `total_amount` |
| `preorderItemModel` | `unit_price`, `total_price` (ไม่รวม `cost_per_unit`) |
| `paymentModel` | `amount` (ใช้ร่วมทั้งฝั่ง order/preorder) |
| `promotionUsagesModel` | `discount_applied` |

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

**ไม่ต้องแก้ schema (`src/schemas/order.ts`, `payment.ts`) หรือ route ไหนเลยสักไฟล์** — client ยังส่ง/
รับบาททศนิยมเหมือนเดิมทุกประการ การแปลงทั้งหมดอยู่ในชั้น service ล้วน ๆ

---

## 4. Migration script

`scripts/migrate-money-to-satang.ts` (`npm run migrate:money-to-satang`) — คูณ ×100 ทุก field ข้างบน
ด้วย MongoDB `$mul` (atomic ต่อ collection ไม่ต้อง fetch+loop ใน JS) รวม nested
`selected_options[].extra_price` ด้วย positional-all operator

**กันรันซ้ำ**: บันทึก marker doc ไว้ใน collection `migrations` (`_id: "money_to_satang_3_11"`) หลังรัน
สำเร็จ — รันซ้ำจะเช็คแล้วข้ามให้อัตโนมัติ (สำคัญมาก: รันซ้ำโดยไม่มี guard นี้จะคูณ ×100 ซ้ำสองรอบ ทำให้
ยอดเงินทั้งระบบพังหมด) โค้ด logic แยกเป็น `runMigration()` ที่ export ออกมาต่างหากจาก CLI runner
เพื่อให้ integration test เรียกตรง ๆ ได้โดยไม่โดน `mongoose.disconnect()` ที่ CLI runner ทำตอนจบ

**ต้องรันก่อน deploy จริงครั้งแรกหลัง PR นี้ merge** (หรือรันกับ DB dev/staging ที่มีข้อมูลทดสอบอยู่แล้ว
ถ้าอยากให้ตัวเลขเดิมยังถูกต้อง — ถ้าไม่รัน ข้อมูลเก่าจะโดนตีความเป็นสตางค์ทั้งที่จริงเป็นบาท เช่น
`total_amount: 150` เดิม (150 บาท) จะกลายเป็นแค่ 1.50 บาทถ้าไม่ migrate)

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
- `tests/integration/migrateMoneyToSatang.test.ts` (2 เคส) — แปลงถูกทุก field ทุก collection รวม
  nested array + `cost_per_unit` ไม่ถูกแตะ, กันรันซ้ำใช้ได้จริง
- แก้ assertion เดิมที่ query DB ตรง ๆ (bypass presenter) ใน `persistOrder.test.ts`,
  `createPaymentPreorder.test.ts`, `cancelPreorder.test.ts` ให้ตรงกับหน่วยสตางค์จริง + comment กำกับ
  ชัดว่าทำไมต่างจาก `order.*`/`preorder.*` ที่มาจาก service (บาทเหมือนเดิม)
- unit 163 → **171** · integration 79 → **82**

---

## 7. เฟสที่เหลือของ §3.11 (ยังไม่ทำ — ทำทีหลังตามความจำเป็น ไม่ต้องรีบ)

เรียงตามความเสี่ยง/ผลกระทบจากน้อยไปมาก:

1. **Expense** (`expenseModel.amount`) — โดดเดี่ยว ไม่ผูกกับอะไร ทำได้เร็วที่สุด
2. **Delivery zone** (`deliveryZoneModel.fee`) — โดดเดี่ยวเช่นกัน (env fallback ก็ต้องแปลงด้วยถ้าจะทำ)
3. **Recipe/Component/Ingredient cost** (`estimated_cost_per_batch`, `cost_per_unit`) — ผูกกับ
   `orderItem.cost_per_unit`/`preorderItem.cost_per_unit` ที่ปล่อยไว้เป็นบาทในเฟสนี้ — ทำเฟสนี้เมื่อไหร่
   ต้องกลับมาแปลง 2 field นั้นให้เป็นสตางค์ด้วยพร้อมกัน (ตอนนี้คงเป็นบาทไว้ตั้งใจ)
4. **Promotion definition** (`promotionModel.discount_value`/`min_order_amount`/`max_discount_amount`)
   — ซับซ้อนกว่าที่อื่นเพราะ `discount_value` เป็นเงิน**เฉพาะ**ตอน `discount_type === "Amount"`
   (ตอน `"Percentage"` เป็นตัวเลข % ไม่ใช่เงิน) ต้อง handle แบบ conditional ทั้งตอน migrate และตอน
   validate schema
5. **Product pricing** (`productModel.product_price`/`sale_price`/`purchase_cost`,
   `productVariantModel.variant_price`, `productOptionModel.extra_price`) — เสี่ยงสุดเพราะกระทบ
   `cartItemModel.price_snapshot` ด้วย (ต้อง migrate พร้อมกัน) และเป็นจุดเริ่มของทุกการคำนวณเงินในระบบ
   (`resolveLine()` ที่เพิ่งแปลงในเฟสนี้จะไม่ต้องมี "จุดข้ามโดเมน" อีกต่อไปถ้าทำเฟสนี้เสร็จ — โค้ดจะง่ายขึ้น)

แต่ละเฟสควรทำแยก PR เหมือนเฟส 1 — เขียน migration ส่วนเพิ่มเข้าไปใน
`scripts/migrate-money-to-satang.ts` เดิม (เพิ่ม field ใหม่ในแต่ละ `updateMany`) ไม่ต้องสร้างไฟล์ใหม่
เว้นแต่จะซับซ้อนจนแยกอ่านง่ายกว่า (เช่น promotion ที่ต้อง conditional)
