# รอบ 5 — เงินเป็น integer (สตางค์), เฟส 1-4: Order+Preorder+Payment, Expense, Delivery zone, Recipe/Component/Ingredient

> อัปเดตล่าสุด: 2026-09-12
> สถานะ: ✅ **เฟส 1-4 เสร็จสมบูรณ์** (จากทั้งหมด 5 เฟส — ดู §7 "เฟสที่เหลือ")
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
แปลงในเฟส 3, `recipeModel`/`componentModel`/`ingredientModel` + `cost_per_unit`/`purchase_cost`
แปลงในเฟส 4): `productModel.product_price`/`sale_price`/`productVariantModel`/`productOptionModel`
(ราคาขาย/variant/option), `promotionModel` (นิยามโปรโมชัน — `discount_value`/`min_order_amount`/
`max_discount_amount`), `cartItemModel.price_snapshot` — ยังเป็นบาททั้งหมด ดู §7

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

เพราะ `productModel`/`promotionModel` (นิยามส่วนลด) **ยังไม่ถูกแปลง** แต่ `orderService`/
`preorderService` เรียกข้ามไปอ่าน/เขียนโดเมนเหล่านั้นตลอดเวลา (คิดราคาสินค้า, คิดส่วนลด) — ทุกจุดที่
ข้ามโดเมนแปลงหน่วยตรงนั้นทันที ไม่ปล่อยให้หน่วยรั่วไหลไปไกลกว่าจุดที่ข้าม (ตัวอย่างเดียวกันนี้ยังใช้กับ
`deliveryService.ts` แม้ `deliveryZoneModel.fee` จะถูกแปลงเป็นสตางค์แล้วตั้งแต่เฟส 3 ก็ตาม — เพราะ
"สัญญา" ของฟังก์ชัน `calcDeliveryFee()` เองยังพูดเป็นบาทอยู่ ส่วนที่เป็นสตางค์คือแค่ข้อมูลภายในที่มัน
query มาใช้เท่านั้น ดู §3 เฟส 3 กับ §3 เฟส 4 ว่า `recipeService.getUnitCostByProduct()` ก็ทำนองเดียวกัน
แต่กลับด้าน — คืนสตางค์ตรง ๆ เพราะผู้เรียกใช้ (orderService) เป็นโดเมนสตางค์อยู่แล้ว):

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

วิธีนี้ทำให้ **ไม่ต้องแตะ `productModel`/`promotionModel`/`discountEngine.ts`/`deliveryService.ts`/
`promotionService.ts` เลยสักไฟล์** ในเฟส 1 — ลดพื้นที่เสี่ยงลงมหาศาลเทียบกับถ้าพยายามแปลงทุกอย่างพร้อมกัน
(`recipeService.ts` เคยอยู่ในกลุ่มนี้ด้วยตอนเฟส 1 แต่ถูกแปลงจริงในเฟส 4 — ดู §3 เฟส 4)

### `cost_per_unit` จงใจปล่อยเป็นบาท (เฟส 1) → แปลงจริงในเฟส 4

`orderItemModel.cost_per_unit`/`preorderItemModel.cost_per_unit` มาจาก `recipeService.getUnitCostByProduct()`
และใช้แค่คำนวณ COGS ใน dashboard — **ไม่เคยถูกบวก/ลบรวมกับ subtotal/total_amount ของออเดอร์ที่ไหนเลย**
(ยืนยันจากโค้ดจริง) ตอนเฟส 1 จึงปลอดภัยที่จะให้ต่างหน่วยกับฟิลด์อื่นในเอกสารเดียวกันไปก่อน จนกว่าโดเมน
สูตร/วัตถุดิบ (ที่มาของค่านี้) จะถูกแปลงในเฟสถัดไป — **แปลงจริงแล้วในเฟส 4 พร้อมกับ
`recipeModel`/`componentModel`/`ingredientModel`** (ดู §3/§7)

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
| `ingredientModel` | `cost_per_unit` | 4 |
| `componentModel` | `estimated_cost_per_batch` | 4 |
| `recipeModel` | `estimated_cost_per_batch` | 4 |
| `productModel` | `purchase_cost` (**ไม่รวม** `product_price`/`sale_price` — รอเฟส 5) | 4 |
| `orderItemModel` | `cost_per_unit` (ค้างจากเฟส 1 — ต้องรอเฟสนี้ก่อน) | 4 |
| `preorderItemModel` | `cost_per_unit` (ค้างจากเฟส 1 — ต้องรอเฟสนี้ก่อน) | 4 |

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
- **`ingredientService.ts`** (เฟส 4) — เพิ่ม `presentIngredient()` ใช้ใน `list`/`getById`/`create`/
  `update`/`remove`/`restore`/`getLowStock()` (populate ตรงในนี้ก็ต้องแปลงด้วย ไม่ใช่แค่ CRUD ปกติ)
  `create`/`update` แปลง `cost_per_unit` เข้าเป็นสตางค์ก่อนเขียน
- **`componentService.ts`** (เฟส 4) — เพิ่ม `presentComponent()` ใช้ใน `list`/`getById`/`create`/
  `update`/`remove`/`restore`/`listByCategory()` · `prepare()` (คิด `estimated_cost_per_batch` อัตโนมัติ
  จากต้นทุนวัตถุดิบ) ต้องแก้สูตรปัดเศษด้วย — ดูรายละเอียดหัวข้อ "บั๊กปัดเศษ" ด้านล่าง · `getExpanded()`
  populate `ingredients.ingredient_id` มา (ติด `cost_per_unit` ของวัตถุดิบนั้นมาด้วย) ต้องแปลง**ซ้อน**
  เองอีกชั้น เพราะ populate ไม่เรียกผ่าน `ingredientService.presentIngredient()` เลย — เพิ่ม
  `presentExpandedComponent()` แยกจาก `presentComponent()` ปกติ
- **`recipeService.ts`** (เฟส 4) — โครงเดียวกับ `componentService.ts` เป๊ะ (`presentRecipe()`/
  `presentExpandedRecipe()` ที่ต้องแปลงซ้อนทั้ง `ingredients.ingredient_id.cost_per_unit` **และ**
  `components.component_id.estimated_cost_per_batch` เพราะ `getExpanded()` populate ทั้งคู่พร้อมกัน) ·
  **`getUnitCostByProduct()` เปลี่ยนความหมาย** — จากเดิมคืนบาท (เพราะ `estimated_cost_per_batch`/
  `purchase_cost` ที่มันอ่านยังเป็นบาททั้งคู่) ตอนนี้คืน**สตางค์**ตรง ๆ โดยไม่ต้องแก้โค้ดคำนวณเลยสักบรรทัด
  (แค่ query ข้อมูลที่เป็นสตางค์อยู่แล้วมาหาร/เทียบ) เพราะฟังก์ชันนี้ไม่เคย expose ผ่าน API ตรง ๆ (ใช้แค่
  ภายใน orderService/preorderService) — เปลี่ยนแค่ comment ให้ชัดว่าหน่วยเปลี่ยนไปแล้ว ผู้เรียก
  (orderService/preorderService) ก็ไม่ต้องแก้อะไรเพิ่มเพราะรับค่ามาใส่ `orderItem.cost_per_unit` ตรง ๆ
  อยู่แล้ว (ซึ่งตอนนี้เป็นสตางค์เหมือนกัน)
- **`productService.ts`** (เฟส 4) — เพิ่ม `presentProduct()` ที่แปลง**เฉพาะ** `purchase_cost` (ไม่แตะ
  `product_price`/`sale_price` — รอเฟส 5) ใช้ในทุก read/write path ที่คืน product doc
  (`createProduct`/`getProductByCode`/`getProductById`/`getProducts`/`updateProduct`/`deleteProduct`/
  `restoreProduct`/`hardDeleteProduct`) — เยอะกว่า service อื่นเพราะ `productService.ts` ไม่เคยมี
  presenter มาก่อนเลย (product pricing ทั้งหมดยังเป็นบาทมาตลอด) ต้องไล่ทุกจุด return แยกกัน ไม่ใช่แค่
  override `list`/`getById` เหมือน CRUD service อื่น ๆ
- **`orderService.ts`/`preorderService.ts`** (เฟส 4) — เพิ่ม `cost_per_unit` เข้า
  `ORDER_ITEM_MONEY_FIELDS`/`PREORDER_ITEM_MONEY_FIELDS` (`toBahtFields` ข้าม key ที่เป็น `null` อยู่
  แล้วโดยไม่ error จึงปลอดภัยที่จะรวมเข้าไปตรง ๆ) — จุดที่ assign ค่าใน `persistOrder()` เอง**ไม่ต้องแก้
  เลยสักบรรทัด** เพราะ `costByProduct.get(...)` ที่ได้จาก `getUnitCostByProduct()` เป็นสตางค์แล้วพอดี
  ตรงกับที่ `orderItemModel.cost_per_unit` ต้องการ
- **`dashboardService.ts`** (เฟส 4) — `overview()`'s `cogsRows` aggregate (`$sum` ของ
  `orderItem.cost_per_unit * quantity`) ตอนนี้ได้ผลรวมเป็นสตางค์แล้ว (เดิมเป็นบาท) ต้องเพิ่ม `toBaht()`
  ครอบ `cogs` ก่อนเอาไปรวมในสูตร `profit_estimate` — เป็นจุดเสี่ยงเดิมที่เคยเตือนไว้ตั้งแต่เฟส 1 ว่า "รอ
  เฟส 4 มาแก้" (ดู comment เดิมในโค้ด) ตอนนี้แก้ครบแล้วทุกองค์ประกอบของสูตร

### บั๊กปัดเศษที่เจอในเฟส 4: `Math.round(x*100)/100` ใช้ไม่ได้กับสตางค์อีกต่อไป

`componentService.prepare()`/`recipeService.prepare()` (คิด `estimated_cost_per_batch` อัตโนมัติจาก
ต้นทุนวัตถุดิบ) และ `recipeService.getUnitCostByProduct()` (หาร `estimated_cost_per_batch / yield_qty`)
เดิมทั้งสามจุดปัดเศษด้วย `Math.round(x * 100) / 100` — สูตรนี้ถูกต้องตอนที่ `x` เป็น **บาท** (ปัดให้เหลือ
ทศนิยม 2 ตำแหน่งพอดี คือหน่วยสตางค์) แต่พอ `ingredientModel.cost_per_unit`/`componentModel.
estimated_cost_per_batch` เปลี่ยนเป็นสตางค์แล้ว ตัวเลขที่ query มาคำนวณ (`x`) ก็เป็นสตางค์อยู่แล้ว — ถ้า
ยังใช้สูตรเดิมจะกลายเป็น "ปัดสตางค์ให้เหลือละเอียดถึง 1/100 สตางค์" ซึ่งไม่มีความหมายเลย (สตางค์เป็นหน่วย
เล็กที่สุดของระบบ ไม่มี "เศษสตางค์" ให้ปัดอีกที) ต้องเปลี่ยนเป็น `Math.round(x)` ตรง ๆ ทั้ง 3 จุด — เจอจาก
การอ่านโค้ดเก่าอย่างละเอียดก่อนแก้ ไม่ใช่จากเทสพังก่อน (เทสที่เขียนใหม่ในเฟสนี้ตั้งใจใช้ตัวเลขที่ปัดไม่ลง
ตัวพอดี เช่น ต้นทุน 9.99 บาท × 1.5 = 1498.5 สตางค์ เพื่อยืนยันว่า `Math.round()` ทำงานถูกทาง)

### บั๊กที่เจอในเฟส 4: MongoDB `$mul` พังทันทีถ้าเจอ field ที่เป็น `null`

`orderItemModel`/`preorderItemModel.cost_per_unit` และ `productModel.purchase_cost` เป็น **nullable**
(`default: null`) ต่างจาก field เงินอื่นทุกตัวที่เคยแปลงมาก่อนหน้านี้ (ล้วน `required: true` ไม่มีทาง
เป็น `null`) — ทดสอบจริงกับ `mongodb-memory-server` พบว่า MongoDB **error ทันที** ถ้า `$mul` เจอเอกสาร
ที่ field เป้าหมายเป็น `null` ตรง ๆ (ไม่ใช่แค่ข้ามเงียบ ๆ แบบที่อาจคาดไว้):

```
Plan executor error during update :: caused by :: Cannot apply $mul to a value of non-numeric type.
{_id: 1} has the field 'v' of non-numeric type null
```

ถ้า `updateMany({}, { $mul: { cost_per_unit: 100 } })` ตรง ๆ แบบ field required ทั่วไป จะทำให้
migration **พังกลางทางทั้ง collection** ทันทีที่เจอเอกสารแรกที่มีค่า `null` (ซึ่งเป็นกรณีปกติมาก — สินค้า/
รายการส่วนใหญ่ที่ไม่มีสูตร/ไม่ใช่ "ซื้อมาขายต่อ" ก็ปล่อย field นี้เป็น `null`) แก้ด้วยการกรอง query ก่อน
เสมอสำหรับ field เงินที่ nullable: `updateMany({ cost_per_unit: { $type: "number" } }, { $mul: {...} })`
— field ที่เป็น `null` จะไม่ถูกแตะเลย (ยังคง `null` เหมือนเดิม ไม่ถูกแปลงเป็น `0` หรือค่าอื่น) มีเทสยืนยัน
ทั้งสองด้าน (ทั้งกรณี field เป็นตัวเลขจริง และกรณีเป็น `null`) ใน `migrateMoneyToSatang.test.ts`

### บั๊กมาร์กเกอร์ซ้ำ (แบบเดียวกับเฟส 2) เจออีกครั้งในเฟส 4

`orderItemModel`/`preorderItemModel.cost_per_unit` เป็น field ที่**มีอยู่แล้ว**ตั้งแต่เฟส 1 (แค่ตั้งใจ
ไม่รวมใน `$mul` ตอนนั้น) — ถ้าเพิ่ม `cost_per_unit` เข้าไปใน `$mul` ของ section `"order_items"`/
`"preorder_items"` **เดิม**ตรง ๆ (ตาม logic เดิมที่คิดว่า "field ใหม่ก็แค่เพิ่มเข้า object เดียวกัน") จะ
เจอบั๊กเดียวกับที่พบตอนเฟส 2 เป๊ะ: DB ที่เคยรัน migrate ตอนเฟส 1 ไปแล้ว (marker `"order_items"`/
`"preorder_items"` มีอยู่แล้ว) จะข้าม section นั้นทั้งหมดทันทีเมื่อรันสคริปต์เวอร์ชันเฟส 4 — `cost_per_unit`
จะไม่ถูกแตะเลยแม้แต่ครั้งเดียว เงียบ ๆ ไม่มี error — แก้โดยตั้ง section id ใหม่แยกต่างหาก
(`"order_items_cost_per_unit"`/`"preorder_items_cost_per_unit"`) เสมอเมื่อเพิ่ม field เงินเข้า
collection ที่เคยมี section ของตัวเองอยู่ก่อนแล้ว — มีเทสจำลองสถานการณ์นี้ตรง ๆ เหมือนกับที่ทำไว้ตอนเฟส 2

**บทเรียนที่ยืนยันซ้ำจากทั้งสองเฟส:** ทุกครั้งที่เพิ่ม field เงินใหม่เข้าไฟล์ migration นี้ ไม่ว่าจะเป็น
collection ใหม่ทั้งหมด (เฟส 2) หรือ field ใหม่ใน collection ที่เคยมี section อยู่แล้ว (เฟส 4) —
**ต้องเป็น section id ใหม่เสมอ ห้ามผสมกับ section เดิมเด็ดขาด**

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

**เฟส 4 เจอบั๊กเดิมซ้ำ + บั๊กใหม่อีกจุด** — ดูรายละเอียดเต็มที่ §3 หัวข้อ "บั๊กที่เจอในเฟส 4" (2 หัวข้อ
ย่อย): (1) เพิ่ม `cost_per_unit` เข้า section `order_items`/`preorder_items` เดิมตรง ๆ จะโดนบั๊ก
มาร์กเกอร์ซ้ำแบบเดียวกับเฟส 2 — ต้องแยก section id ใหม่ (`order_items_cost_per_unit`/
`preorder_items_cost_per_unit`) (2) `cost_per_unit`/`purchase_cost` เป็น nullable field เงินตัวแรกที่
เจอในไฟล์นี้ — MongoDB `$mul` error ทันทีถ้าเจอ `null` ตรง ๆ ต้อง filter `{ field: { $type: "number" } }`
ก่อนเสมอ (field required ทั่วไปไม่ต้องกังวลเรื่องนี้เพราะไม่มีทางเป็น `null`)

**ต้องรันก่อน deploy จริงครั้งแรกหลัง PR นี้ merge** (หรือรันกับ DB dev/staging ที่มีข้อมูลทดสอบอยู่แล้ว
ถ้าอยากให้ตัวเลขเดิมยังถูกต้อง — ถ้าไม่รัน ข้อมูลเก่าจะโดนตีความเป็นสตางค์ทั้งที่จริงเป็นบาท เช่น
`total_amount: 150` เดิม (150 บาท) จะกลายเป็นแค่ 1.50 บาทถ้าไม่ migrate) — **ถ้าเคยรันตอนจบเฟสก่อนหน้า
ไปแล้ว รันซ้ำอีกครั้งตอนนี้ได้เลยปลอดภัยเสมอ** (marker แยกต่อ section) จะแค่เติม section ใหม่ที่ยังไม่
เคยรันให้เท่านั้น (ตอนนี้คือ `ingredients`/`components`/`recipes`/`products_purchase_cost`/
`order_items_cost_per_unit`/`preorder_items_cost_per_unit`)

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
- `tests/integration/migrateMoneyToSatang.test.ts` (5 เคส) — แปลงถูกทุก field ทุก collection รวม
  nested array (เฟส 1) + ingredient/component/recipe/`purchase_cost`/`cost_per_unit` ของ order/
  preorder item (เฟส 4), กันรันซ้ำต่อ collection ใช้ได้จริง, **จำลองสถานการณ์ "เพิ่ม field ใหม่เข้า
  ไฟล์ทีหลัง" ตรง ๆ ทั้งสองแบบ** — แบบ collection ใหม่ทั้งหมด (เฟส 2) และแบบ field ใหม่เข้า
  collection ที่มี section เดิมอยู่แล้ว (เฟส 4, `cost_per_unit` เข้า `order_items`) — ทั้งสองแบบยืนยันว่า
  section เก่าที่มี marker แล้วไม่โดนคูณซ้ำ แต่ section ใหม่ (ไม่ว่าจะเป็น collection ใหม่หรือ field ใหม่
  ใน collection เดิม) ยังรันจริงเสมอ, มีเคสเฉพาะยืนยันว่า field ที่เป็น `null` (`cost_per_unit`/
  `purchase_cost`) ไม่ทำให้ `$mul` พังและไม่ถูกแปลงเป็น `0`
- `tests/integration/expenseService.test.ts` (5 เคส, เฟส 2) — create/update แปลง amount ถูกทาง,
  list/getById คืนบาท, `summary()` รวมยอดตามหมวดถูกต้อง, `totalInRange()` คืนบาทตรง ๆ
- `tests/integration/dashboardService.test.ts` (1 เคส, เฟส 2) — สร้างออเดอร์ paid (satang) +
  ค่าใช้จ่าย (satang หลังเฟส 2) พร้อมกัน ยืนยันว่า `profit_estimate` ไม่ผสมหน่วยผิด (จุดเสี่ยงสุดตาม §3)
- `tests/integration/deliveryService.test.ts` (+4 เคส, เฟส 3) — create/update แปลง fee ถูกทาง,
  list/getById (หน้าแอดมิน) คืนบาท, `calcDeliveryFee` คำนวณถูกเป๊ะแม้ fee เป็นทศนิยมที่ float มักพัง
  (29.9 บาท)
- `tests/integration/recipeCostMoney.test.ts` (10 เคส, เฟส 4, ไฟล์ใหม่) — ครอบทั้ง 4 service ที่แก้:
  `ingredientService` create/update/list/getById แปลง `cost_per_unit` ถูกทาง · `componentService`
  ทั้งกรอกต้นทุนมือและคิดอัตโนมัติจาก ingredients (ใช้ 9.99 บาท × 1.5 = 1498.5 → ต้องปัดเป็น 1499
  ยืนยันสูตรปัดเศษใหม่ถูกต้อง) รวม `getExpanded()` presenting ซ้อน · `recipeService` คิดต้นทุนรวม
  ingredients+components + `getExpanded()` presenting ซ้อนทั้งสองฝั่ง · `productService.purchase_cost`
  create/update/list/getById รวมกรณี `null` · **end-to-end เต็มเส้นทาง**: สร้างออเดอร์จริงจากสินค้าที่มี
  สูตร ยืนยันว่า `orderItem.cost_per_unit` ใน DB เป็นสตางค์ตรง แต่ `getOrderById()` คืน API เป็นบาทถูกต้อง
- `tests/integration/getUnitCostByProduct.test.ts` (4 เคส เดิม, ปรับ comment) — ยืนยันว่าตัวเลขทดสอบเดิม
  (สร้างข้อมูลตรงผ่าน model) ยังใช้ได้เหมือนเดิมทุกค่า เพราะฟังก์ชันนี้ไม่เคยแปลงหน่วยเอง — สิ่งที่เปลี่ยน
  หลังเฟส 4 มีแค่ "ความหมาย" ของหน่วย (บาท → สตางค์) ไม่ใช่ค่าตัวเลข
- `tests/integration/dashboardService.test.ts` (1 เคส เดิม, ปรับให้ `cost_per_unit` เป็นสตางค์) —
  ยืนยัน `cogs`/`profit_estimate` ยังถูกต้องหลังเพิ่ม `toBaht()` ครอบ `cogsRows` (เฟส 4)
- แก้ assertion เดิมที่ query DB ตรง ๆ (bypass presenter) ใน `persistOrder.test.ts`,
  `createPaymentPreorder.test.ts`, `cancelPreorder.test.ts` ให้ตรงกับหน่วยสตางค์จริง + comment กำกับ
  ชัดว่าทำไมต่างจาก `order.*`/`preorder.*` ที่มาจาก service (บาทเหมือนเดิม)
- unit 163 → 171 (คงที่ตั้งแต่เฟส 2) · integration 79 → 82 (เฟส 1) → 89 (เฟส 2) → 93 (เฟส 3) →
  **104** (เฟส 4)

---

## 7. เฟสที่เหลือของ §3.11 (ยังไม่ทำ — ทำทีหลังตามความจำเป็น ไม่ต้องรีบ)

เรียงตามความเสี่ยง/ผลกระทบจากน้อยไปมาก:

1. ~~**Expense** (`expenseModel.amount`)~~ — ✅ เสร็จแล้ว (เฟส 2, 2026-09-12)
2. ~~**Delivery zone** (`deliveryZoneModel.fee`)~~ — ✅ เสร็จแล้ว (เฟส 3, 2026-09-12) — โดดเดี่ยวตามคาด
   แต่ `getActiveZonesCached()` (cache ภายในที่ `deliveryService.ts` ใช้) ต้องปล่อยเป็นสตางค์ดิบไว้
   ไม่ผ่าน presenter (presenter มีไว้เฉพาะ `/api/admin/delivery-zones` เท่านั้น) — env fallback
   (`DELIVERY_FEE_METRO`/`DELIVERY_FEE_UPCOUNTRY`) **ไม่ได้แปลง** เพราะยังเป็น "บาท" ทั้งระบบเหมือนเดิม
   (ค่านั้นไม่เคยถูกเก็บลง DB เป็นสตางค์เลย ใช้ตรงในฟังก์ชันเป็นบาทตลอด ไม่มีอะไรต้องแก้)
3. ~~**Recipe/Component/Ingredient cost** (`estimated_cost_per_batch`, `cost_per_unit`)~~ — ✅ เสร็จแล้ว
   (เฟส 4, 2026-09-12) — แปลง `ingredientModel.cost_per_unit`/`componentModel`+`recipeModel.
   estimated_cost_per_batch` พร้อม `orderItem`/`preorderItem.cost_per_unit` ที่ค้างจากเฟส 1 ครบทุกตัว
   ตามแผน · **ดึง `productModel.purchase_cost` เข้ามาแปลงพร้อมกันด้วย** ทั้งที่อยู่ในกลุ่ม "Product
   pricing" ของแผนเดิม (ข้อ 5 ด้านล่าง) เพราะสำรวจโค้ดจริงก่อนลงมือพบว่า `recipeService.
   getUnitCostByProduct()` ผสมค่าจากทั้งสูตรกับ `purchase_cost` fallback เข้าด้วยกันเป็น Map เดียว —
   ถ้าปล่อย `purchase_cost` ไว้ก่อนตามแผนเดิมจะได้ Map ที่หน่วยปนกัน (บาง productId มาจากสูตรเป็น
   สตางค์ บาง productId มาจาก fallback เป็นบาท) โดยไม่มีทางรู้จากภายนอกว่าค่าไหนมาจากไหน — บทเรียนนี้คือ
   เหตุผลที่แผนเฟสต้องยึด "domain ที่ผูกกันจริงทางโค้ด" ไม่ใช่ตามหมวดหมู่ที่ดูเป็นเรื่องเดียวกัน (เหมือนที่
   เจอกับ order/preorder ตอนเฟส 1) เจอบั๊กใหม่ 2 จุดระหว่างทำ (ปัดเศษ + `$mul` กับ `null`) และบั๊ก
   มาร์กเกอร์ซ้ำแบบเดียวกับเฟส 2 อีกครั้ง — รายละเอียดเต็ม → §3/§4
4. **Promotion definition** (`promotionModel.discount_value`/`min_order_amount`/`max_discount_amount`)
   — ซับซ้อนกว่าที่อื่นเพราะ `discount_value` เป็นเงิน**เฉพาะ**ตอน `discount_type === "Amount"`
   (ตอน `"Percentage"` เป็นตัวเลข % ไม่ใช่เงิน) ต้อง handle แบบ conditional ทั้งตอน migrate และตอน
   validate schema
5. **Product pricing ที่เหลือ** (`productModel.product_price`/`sale_price` — `purchase_cost` แปลงไป
   แล้วในเฟส 4, `productVariantModel.variant_price`, `productOptionModel.extra_price`) — เสี่ยงสุดเพราะ
   กระทบ `cartItemModel.price_snapshot` ด้วย (ต้อง migrate พร้อมกัน) และเป็นจุดเริ่มของทุกการคำนวณเงิน
   ในระบบ (`resolveLine()` ที่เพิ่งแปลงในเฟส 1 จะไม่ต้องมี "จุดข้ามโดเมน" ไปหา productModel อีกต่อไปถ้า
   ทำเฟสนี้เสร็จ — โค้ดจะง่ายขึ้น)

แต่ละเฟสควรทำแยก PR — เขียน migration ส่วนเพิ่มเข้าไปใน `scripts/migrate-money-to-satang.ts` เดิม
(เพิ่ม `runSection()` ใหม่ต่อ collection — **ห้ามใช้ marker เดิมซ้ำ ต้องตั้ง sectionId ใหม่ไม่ซ้ำใคร
เสมอ** ดู §4 ว่าทำไม) ไม่ต้องสร้างไฟล์ใหม่ เว้นแต่จะซับซ้อนจนแยกอ่านง่ายกว่า (เช่น promotion ที่ต้อง
conditional)
