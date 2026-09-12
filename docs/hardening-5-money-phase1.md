# รอบ 5 — เงินเป็น integer (สตางค์): Order+Preorder+Payment, Expense, Delivery zone, Recipe/Component/Ingredient, Promotion, Product pricing

> อัปเดตล่าสุด: 2026-09-12
> สถานะ: ✅ **เสร็จสมบูรณ์ทั้งหมด** — ครบทุกเฟส (1, 2, 3, 4, 5a, 5b) จาก 18 model ที่แตะเงิน (แผนเดิม
> วางไว้ 5 เฟส/17 model — เฟส 5 แตกเป็น **5a (Promotion)** กับ **5b (Product pricing + Cart +
> preorderRoundItemModel.price_override)** ระหว่างสำรวจขอบเขตจริงก่อนลงมือ เพราะเป็นคนละ domain ที่ไม่
> ผูกกันทางโค้ดเลย — เหตุผลเดียวกับที่แบ่งเฟส 1-4 มาตั้งแต่แรก ดู §0 — และเจอ `preorderRoundItemModel.
> price_override` เพิ่มระหว่างทางที่พลาดจากการสำรวจรอบแรก รวมเป็น 18 model) — ดู §8 "สรุปทั้งโปรเจกต์"
> ที่มา: [`BACKLOG.md`](BACKLOG.md) §3.11 — งานเดี่ยวเสี่ยงสูงที่สุดในทั้งหมด (tag **L**)
> ก่อนเริ่ม: สำรวจขอบเขตจริงก่อน (17 model + 9 schema แตะเงิน — ตัวเลขนี้พลาดไป 1 model จริง ๆ ดู §0)
> แล้วถามผู้ใช้เรื่อง API contract

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

**ครบทุก field เงินที่เคยสำรวจไว้แล้ว ณ จุดนี้** — `expenseModel.amount` (เฟส 2), `deliveryZoneModel.
fee` (เฟส 3), `recipeModel`/`componentModel`/`ingredientModel` + `cost_per_unit`/`purchase_cost`
(เฟส 4), `promotionModel` (เฟส 5a), `productModel.product_price`/`sale_price`/`productVariantModel.
variant_price`/`productOptionModel.extra_price`/`cartItemModel.price_snapshot`/
`preorderRoundItemModel.price_override` (เฟส 5b) — ดู §8 สำหรับสรุปทั้งโปรเจกต์

**ตัวเลข "17 models" ด้านบนพลาดไป 1 ตัวจริง ๆ** — ตอนสำรวจตอนเริ่มรอบ 5 ไม่เจอ
`preorderRoundItemModel.price_override` (ราคาตั้งขายเฉพาะรอบ override ราคาสินค้าปกติ) เพราะมันไม่ได้
"ดูเหมือน" money field ชัดเจนแบบฟิลด์อื่น (ชื่อไม่มีคำว่า price/amount/cost ตรง ๆ กว่าจะรู้ว่าเป็นเงินต้อง
ตามอ่าน `preorderRoundService.getOrderableRoundItem()`) เจอตอนสำรวจขอบเขตเฟส 5 (ก่อนตัดสินใจแยก 5a/
5b) — field นี้ผูก `??` fallback chain เดียวกับ `product.sale_price`/`product_price` โดยตรง
(`item.price_override ?? product.sale_price ?? product.product_price`) เหมือนกับที่ `productModel.
purchase_cost` ผูกกับสูตรผ่าน `getUnitCostByProduct()` ในเฟส 4 — ต้องแปลงพร้อมกับ Product pricing ใน
เฟส 5b เสมอ ไม่งั้นได้ปัญหาหน่วยปนกันแบบเดียวกันอีก — แปลงจริงแล้วในเฟส 5b (ดู §7)

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
`recipeModel`/`componentModel`/`ingredientModel`** (ดู §3)

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
| `productModel` | `purchase_cost` (**ไม่รวม** `product_price`/`sale_price` — รอเฟส 5b) | 4 |
| `orderItemModel` | `cost_per_unit` (ค้างจากเฟส 1 — ต้องรอเฟสนี้ก่อน) | 4 |
| `preorderItemModel` | `cost_per_unit` (ค้างจากเฟส 1 — ต้องรอเฟสนี้ก่อน) | 4 |
| `promotionModel` | `min_order_amount`, `max_discount_amount` (เสมอ) + `discount_value` (**เฉพาะ** `discount_type === "Amount"`) | 5a |
| `productModel` | `product_price`, `sale_price` (section แยกจาก `purchase_cost` เดิม) | 5b |
| `productVariantModel` | `variant_price` | 5b |
| `productOptionModel` | `extra_price` | 5b |
| `cartItemModel` | `price_snapshot`, `selected_options[].extra_price` | 5b |
| `preorderRoundItemModel` | `price_override` (model ที่ 18 — พลาดจากการสำรวจ 17 model รอบแรก) | 5b |

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
- **`promotionService.ts`** (เฟส 5a) — เพิ่ม `presentPromotion()` ที่แปลง `min_order_amount`/
  `max_discount_amount` เสมอ + แปลง `discount_value` **เฉพาะ**เมื่อ `discount_type === "Amount"` ใช้ใน
  `createPromotion`/`listPromotions`/`getPromotionById`/`updatePromotion`/`deletePromotion`/
  `restorePromotion` ทุกจุดที่คืน promotion doc · `createPromotion`/`updatePromotion` แปลง input บาท
  เป็นสตางค์ก่อนเขียนด้วย logic เดียวกัน (`updatePromotion` ต้องอ่าน `discount_type` ปัจจุบันจาก DB มา
  ดูก่อนถ้า payload ไม่ได้ส่ง `discount_type` มาด้วย — ดูตัวอย่างโค้ดด้านล่าง) · **`validateForOrder()`
  นำ `presentPromotion()` มาใช้ซ้ำเป็นตัวแปลงข้ามโดเมนก่อนส่งเข้า `discountEngine.computeDiscount()`**
  (ฟังก์ชันเดียวกันที่ทำหน้าที่เป็น API presenter ก็ทำหน้าที่แปลงข้ามโดเมนได้พอดี เพราะทั้งคู่ต้องการผลลัพธ์
  แบบเดียวกันคือ "field เงินเป็นบาท") — `orderService.ts` **ไม่ต้องแก้อะไรเลยสักบรรทัด** เพราะ
  `validateForOrder()` ยังรับ-คืนเป็นบาทเหมือนเดิมทุกประการ (คอมเมนต์อธิบายเพิ่มไว้ที่จุดเรียกเท่านั้น)
- **`productService.ts`** (เฟส 5b) — ขยาย `presentProduct()` (เดิมมีแค่ `purchase_cost` จากเฟส 4) ให้
  รวม `product_price`/`sale_price` ด้วย · `createProduct`/`updateProduct` แปลงทั้งสองฟิลด์เข้าเป็น
  สตางค์ (เหมือน `purchase_cost` เป๊ะ) · `resolveScan()` **ไม่ต้องแก้เลย** เพราะอ่านจาก
  `getProductByCode()`/`getProductById()` ที่ผ่าน presenter แล้ว
- **`productVariantService.ts`/`productOptionService.ts`** (เฟส 5b) — เดิม `...base` เฉย ๆ ไม่มี
  override เลยสักฟังก์ชัน (คล้าย `expenseService.ts` ก่อนเฟส 2) เพิ่ม `presentVariant()`/
  `presentOption()` + override ครบ `list`/`getById`/`create`/`update`/`remove`/`restore`
- **`cartService.ts`** (เฟส 5b) — เพิ่ม `presentCartItem()` ใช้ใน `getCartDetail()`/`addItem()`/
  `updateItemQuantity()` · **`addItem()` ไม่ต้องแก้ตรรกะคำนวณ `price_snapshot` เลยสักบรรทัด** เพราะ
  query ตรงจาก `productModel`/`productVariantModel`/`productOptionModel` (ข้าม service ที่มี
  presenter) ซึ่งเป็นสตางค์ทั้งหมดแล้ว ผลลัพธ์จึงเป็นสตางค์เองโดยอัตโนมัติ (เหมือน `bom.ts` ในเฟส 4) ·
  `getCartDetail()` ต้องคำนวณ `line_total`/`subtotal` เป็นสตางค์ก่อนเสมอแล้วค่อยแปลงเป็นบาทตอนจบ (กัน
  ปัดเศษสะสม) และแปลง**ซ้อน**เข้าไปใน `.populate("variant_id", "... variant_price")` ด้วย (เหมือน
  `componentService.getExpanded()` ในเฟส 4)
- **`orderService.ts`'s `resolveLine()`** (เฟส 5b) — **จุดที่น่าพอใจที่สุดของทั้งโปรเจกต์**: เอา
  `toSatang()` ที่ห่อ `unit_price`/`selected_options[].extra_price` ตอนจบออกได้เลย เพราะ
  `productModel`/`productVariantModel`/`productOptionModel` เป็นสตางค์แล้วทั้งหมด "จุดข้ามโดเมน" ที่
  เคยต้องมีตั้งแต่เฟส 1 (ดู §1) **ไม่มีอยู่แล้ว** — โค้ดง่ายขึ้นจริงตามที่เคยคาดการณ์ไว้ตอนวางแผนเฟสนี้
- **`preorderRoundService.ts`** (เฟส 5b) — เพิ่ม `presentRoundItem()` แปลง `price_override`/
  `current_price` เสมอ + แปลง**ซ้อน**เข้าไปใน `.populate("product_id", PRODUCT_SELECT)` (มี
  `product_price`/`sale_price` ติดมาด้วย) ใช้ใน `addRoundItem`/`updateRoundItem`/`getRoundDetail`/
  `listRoundItems` · **`getOrderableRoundItem()` ไม่ผ่าน presenter โดยตั้งใจ** — internal only (ใช้
  แค่ใน `preorderService.createPreorder()`) คืนสตางค์ตรง ๆ เหมือน `getUnitCostByProduct()` ในเฟส 4
- **`preorderService.ts`** (เฟส 5b) — ลบ `toSatang(unit_price)` ที่เคยห่อผลลัพธ์จาก
  `getOrderableRoundItem()` ออก (เหตุผลเดียวกับ `resolveLine()` ด้านบน — ไม่มีจุดข้ามโดเมนให้ต้องแปลง
  อีกแล้ว)

### ตัวอย่างโค้ดจริงที่แก้ในเฟส 4 (ก่อน/หลัง)

**1) `componentService.prepare()`/`recipeService.prepare()` — ต้อง handle 2 เส้นทางแยกกัน ไม่ใช่แค่
เปลี่ยนสูตรปัดเศษ:**

```ts
// ก่อนแก้ (เฟส 1-3): แปลงแค่เส้นทาง auto-calc เท่านั้น เพราะตอนนั้น input.estimated_cost_per_batch
// ที่ "ส่งมาเอง" ยังเป็นบาทและ DB ก็ยังเก็บเป็นบาท จึงไม่ต้องแปลงอะไรเลยถ้าผู้ใช้กรอกมือมา
if ((isCreate || input.ingredients !== undefined) && input.estimated_cost_per_batch == null) {
  const cost = await ingredientItemsCost(input.ingredients ?? [], ingredientModel);
  input.estimated_cost_per_batch = Math.round(cost * 100) / 100; // ปัดทศนิยมบาท 2 ตำแหน่ง
}
// (ไม่มี else — ค่าที่ส่งมาเองผ่านตรงไปเก็บ DB โดยไม่ถูกแตะ)

// หลังแก้ (เฟส 4): DB เป็นสตางค์แล้ว ต้อง handle ทั้ง 2 เส้นทาง
if ((isCreate || input.ingredients !== undefined) && input.estimated_cost_per_batch == null) {
  const cost = await ingredientItemsCost(input.ingredients ?? [], ingredientModel);
  input.estimated_cost_per_batch = Math.round(cost); // cost มาจาก DB เป็นสตางค์แล้ว ปัด integer ตรง ๆ
} else if (input.estimated_cost_per_batch != null) {
  // เพิ่มเส้นทางนี้ใหม่ทั้งหมด — ค่าที่แอดมินกรอกมือเป็นบาทตาม API contract ต้องแปลงเป็นสตางค์เอง
  // (เดิมไม่มี branch นี้เลยเพราะไม่จำเป็น — เป็นจุดที่พลาดง่ายถ้าดูแค่ diff ของสูตรปัดเศษอย่างเดียว)
  input.estimated_cost_per_batch = toSatang(Number(input.estimated_cost_per_batch));
}
```

**2) `recipeService.getUnitCostByProduct()` — จุดหารที่ยังเป็นบาทแบบเก่า:**

```ts
// ก่อนแก้: r.estimated_cost_per_batch เป็นบาท (float) → หารแล้วปัดทศนิยม 2 ตำแหน่งให้เหมือนราคาบาทจริง
const unit = r.yield_qty > 0
  ? Math.round((r.estimated_cost_per_batch / r.yield_qty) * 100) / 100
  : null;

// หลังแก้: r.estimated_cost_per_batch เป็นสตางค์ (integer) อยู่แล้ว → ปัด integer ตรง ๆ พอ
const unit = r.yield_qty > 0
  ? Math.round(r.estimated_cost_per_batch / r.yield_qty)
  : null;
```

**3) migration script — filter กัน `$mul` พังกับ `null` (field required เดิมไม่เคยต้องมี filter นี้):**

```ts
// field required ทั่วไป (เฟส 1-3) — ไม่มีทางเป็น null จึง $mul ทั้ง collection ได้เลย
await orderModel.updateMany({}, { $mul: { subtotal: 100, total_amount: 100 } });

// field nullable (เฟส 4) — ต้องกรองก่อนเสมอ ไม่งั้น updateMany ทั้งคำสั่ง throw ทันทีที่เจอเอกสาร
// แรกที่ field เป็น null (ดูหัวข้อถัดไปสำหรับ error message จริงที่ยืนยันจากการทดสอบ)
await orderItemModel.updateMany(
  { cost_per_unit: { $type: "number" } },
  { $mul: { cost_per_unit: 100 } }
);
```

**4) `componentService.getExpanded()`/`recipeService.getExpanded()` — presenter ต้องแปลง "ซ้อน" เข้าไปใน
ผลลัพธ์ populate ด้วย เพราะ populate ไม่เรียกผ่าน presenter ของเจ้าของ field เอง:**

```ts
function presentExpandedComponent(doc: Record<string, any>) {
  const presented = presentComponent(doc); // แปลง estimated_cost_per_batch ของตัว component เอง
  return {
    ...presented,
    // ingredients[].ingredient_id ถูก .populate() เป็น object เต็ม (มี cost_per_unit ติดมาด้วย)
    // — ต้องแปลงตรงนี้เองอีกชั้น ไม่งั้นฟิลด์นี้จะหลุดเป็นสตางค์ดิบปนอยู่กับฟิลด์อื่นที่เป็นบาทแล้ว
    ingredients: (presented.ingredients ?? []).map((it: any) => ({
      ...it,
      ingredient_id:
        it.ingredient_id && typeof it.ingredient_id === "object"
          ? toBahtFields(it.ingredient_id, ["cost_per_unit"] as const)
          : it.ingredient_id,
    })),
  };
}
```

**5) `ORDER_ITEM_MONEY_FIELDS`/`PREORDER_ITEM_MONEY_FIELDS` — เพิ่ม field เดียว ไม่ต้องแตะ logic assign:**

```ts
// เฟส 1: cost_per_unit ยังเป็นบาท จงใจไม่รวมในลิสต์นี้
const ORDER_ITEM_MONEY_FIELDS = ["unit_price", "total_price"] as const;

// เฟส 4: cost_per_unit เป็นสตางค์แล้ว เพิ่มเข้าไปตรง ๆ — toBahtFields() ข้าม key ที่เป็น null อยู่แล้ว
// (ดู src/lib/money.ts) จึงไม่ error แม้บาง orderItem จะไม่มี cost_per_unit เลยก็ตาม
const ORDER_ITEM_MONEY_FIELDS = ["unit_price", "total_price", "cost_per_unit"] as const;
```

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

### ตัวอย่างโค้ดจริงที่แก้ในเฟส 5a

**1) `promotionService.updatePromotion()` — ต้องรู้ discount_type "ที่จะเป็นหลังอัปเดต" ก่อนตัดสินใจแปลง:**

```ts
// discount_value เป็นเงินเฉพาะตอน discount_type === "Amount" — ถ้า payload ไม่ได้ส่ง discount_type
// มาด้วย ต้องอ่านค่าปัจจุบันจาก DB มาดูก่อนว่าประเภทที่ "จะเป็นหลังอัปเดต" คืออะไร (ไม่ใช่เดาจาก payload
// อย่างเดียว หรือแย่กว่านั้นคือไม่ตรวจเลยแล้วปล่อยผ่าน)
if (payload.discount_value !== undefined) {
  let effectiveType = payload.discount_type;
  if (effectiveType === undefined) {
    const existing = await promotionModel.findOne({ _id: id, deleted_at: null })
      .select("discount_type").lean();
    effectiveType = existing.discount_type;
  }
  if (effectiveType === "Amount") {
    payload.discount_value = toSatang(Number(payload.discount_value));
  }
}
// ตั้งใจ "ไม่" แตะ discount_value เลยถ้า payload ไม่ได้ส่งมาด้วย แม้จะเปลี่ยน discount_type ในคำขอ
// เดียวกัน — ค่าเก่าที่ยังไม่เคยถูกแปลงหน่วย (นัยเป็น % หรือบาทดิบตามที่กรอกไว้ตอนสร้าง) จะยังคงเดิม
// จนกว่าแอดมินจะกรอก discount_value ใหม่มาเองจริง ๆ — พฤติกรรมนี้เหมือนกับก่อนแก้ทุกประการ (ระบบ
// ไม่เคยพยายาม "ตีความ" ค่าเก่าใหม่ตามชนิดที่เปลี่ยนไป เพราะทำแบบนั้นเสี่ยงเดาผิดยิ่งกว่า)
```

**2) `presentPromotion()` ใช้ซ้ำได้ทั้งเป็น API presenter และตัวแปลงข้ามโดเมนให้ `discountEngine.ts`:**

```ts
function presentPromotion<T extends Record<string, unknown>>(promo: T): T {
  const out = toBahtFields(promo, ["min_order_amount", "max_discount_amount"] as const);
  if (out.discount_type === "Amount" && typeof out.discount_value === "number") {
    out.discount_value = toBaht(out.discount_value);
  }
  return out;
}

// validateForOrder() — เรียกฟังก์ชันเดียวกันนี้ก่อนส่งเข้า discountEngine.computeDiscount() ที่ยัง
// ทำงานเป็นบาทล้วน (ไม่เคยถูกแก้เลยในเฟสนี้) — ไม่ต้องเขียนตัวแปลงแยกอีกชุดสำหรับ "ใช้ภายใน" เพราะ
// รูปร่างผลลัพธ์ที่ต้องการ (field เงินเป็นบาท) เหมือนกับที่ API ต้องการเป๊ะ
return computeDiscount(presentPromotion(promo), { lines, subtotal, delivery_fee, channel });
```

### บั๊ก/ข้อค้นพบที่เจอในเฟส 5a

**MongoDB `$mul` ธรรมดาทำ conditional ไม่ได้ — ต้องใช้ pipeline-style update แทน:** `discount_value`
ต้องคูณ ×100 เฉพาะเอกสารที่ `discount_type === "Amount"` เท่านั้น ซึ่ง `$mul` (object update ธรรมดาแบบ
เฟส 1-4) ไม่รองรับเงื่อนไขแบบนี้เลย ต้องเปลี่ยนไปใช้ **pipeline-style update** (`updateMany(filter,
[stage, ...])` — array แทน object เป็น argument ที่ 2) ที่รองรับ `$cond`/`$multiply` แบบ aggregation:

```ts
await promotionModel.updateMany({}, [
  { $set: {
      discount_value: { $cond: [
        { $eq: ["$discount_type", "Amount"] },
        { $multiply: ["$discount_value", 100] },
        "$discount_value",
      ]},
      min_order_amount: { $multiply: ["$min_order_amount", 100] },
      max_discount_amount: { $multiply: ["$max_discount_amount", 100] },
  }},
], { updatePipeline: true }); // mongoose ต้องมี option นี้ชัดเจน ไม่งั้น throw "Cannot pass an
                               // array to query updates unless the `updatePipeline` option is set"
                               // (native MongoDB driver รับ array ตรง ๆ ได้เลยไม่ต้องมี option แบบนี้
                               // — เจอตอนพอร์ต syntax ที่ทดสอบผ่าน native driver มาใช้ผ่าน mongoose)
```

**bonus ที่ไม่ได้ตั้งใจตอนแรก:** ทดสอบจริงพบว่า aggregation `$multiply` คืน `null` เฉย ๆ เมื่อเจอ
operand เป็น `null` (ต่างจาก `$mul` update operator ธรรมดาในเฟส 4 ที่ throw ทันที) จึงไม่ต้อง filter
`{ field: { $type: "number" } }` ก่อนเหมือนเฟส 4 เลยสำหรับ `min_order_amount`/`max_discount_amount`
ที่เป็น nullable เช่นกัน — pipeline update ปลอดภัยกว่าและโค้ดสั้นกว่า `$mul` ธรรมดาในทุกกรณีที่มี field
เงิน nullable ปนอยู่ (ควรพิจารณาใช้ pipeline-style เป็นค่าเริ่มต้นสำหรับ migration ในอนาคต แทนที่จะ
เลือก `$mul` + filter เป็นค่าเริ่มต้นแบบเฟส 4)

**ไม่ต้องแก้ schema (`src/schemas/order.ts`, `payment.ts`, `expense.ts`, `delivery.ts`) หรือ route ไหน
เลยสักไฟล์** —
client ยังส่ง/รับบาททศนิยมเหมือนเดิมทุกประการ การแปลงทั้งหมดอยู่ในชั้น service ล้วน ๆ

### ตัวอย่างโค้ดจริงที่แก้ในเฟส 5b

**1) `orderService.resolveLine()` — "จุดข้ามโดเมน" ที่มีมาตั้งแต่เฟส 1 หายไปเลย:**

```ts
// เฟส 1-5a: productModel/productVariantModel/productOptionModel ยังเป็นบาท ต้องคำนวณเป็นบาทให้
// เสร็จก่อน แล้วแปลงเป็นสตางค์ครั้งเดียวตอนจบ
const basePrice = product.sale_price ?? product.product_price;
const unit_price = basePrice + (variant?.variant_price ?? 0) + options.reduce((s, o) => s + o.extra_price, 0);
return {
  ...,
  selected_options: options.map((o) => ({ ...o, extra_price: toSatang(o.extra_price) })),
  unit_price: toSatang(unit_price),
};

// เฟส 5b: ทั้ง 3 แหล่งเป็นสตางค์แล้ว — unit_price ที่คำนวณตรงนี้เป็นสตางค์อยู่แล้วโดยอัตโนมัติ
const basePrice = product.sale_price ?? product.product_price;
const unit_price = basePrice + (variant?.variant_price ?? 0) + options.reduce((s, o) => s + o.extra_price, 0);
return {
  ...,
  selected_options: options.map((o) => ({ ...o })), // extra_price เป็นสตางค์อยู่แล้ว ไม่ต้องแปลง
  unit_price, // ไม่ต้อง toSatang() อีกแล้ว
};
```

**2) `cartService.getCartDetail()` — คำนวณเป็นสตางค์ก่อนเสมอ แล้วแปลง populate ซ้อนด้วย:**

```ts
const line = items.map((it) => {
  const lineTotalSatang = (it.price_snapshot ?? 0) * (it.quantity ?? 0); // สตางค์ดิบจาก DB
  const presented = presentCartItem(it); // แปลง price_snapshot/selected_options[].extra_price
  return {
    ...presented,
    // .populate("variant_id", "... variant_price") ติดสตางค์ดิบมาด้วย ต้องแปลงซ้อนเองอีกชั้น
    variant_id: presented.variant_id && typeof presented.variant_id === "object"
      ? toBahtFields(presented.variant_id, ["variant_price"])
      : presented.variant_id,
    line_total: toBaht(lineTotalSatang), // แปลงเป็นบาทตอนจบทีเดียว กันปัดเศษสะสม
  };
});
```

### ข้อค้นพบสำคัญที่เจอตอนสำรวจก่อนเริ่มเฟส 5b: `preorderRoundItemModel.price_override`

สำรวจโค้ดก่อนลงมือ (ตามธรรมเนียมทุกเฟสของรอบนี้) พบว่า `preorderRoundItemModel.price_override` เป็น
money field ที่**พลาดจากการสำรวจ 17 model ตอนเริ่มรอบ 5** เพราะชื่อ field ไม่มีคำว่า price/amount/cost
ที่ชัดเจนพอจะเจอด้วยการ grep ผิวเผิน (`price_override` มีคำว่า price จริง แต่ต้องตามอ่าน
`preorderRoundService.getOrderableRoundItem()`/`getRoundDetail()` ถึงจะเห็นว่ามันผูก `??` fallback
chain เดียวกับ `product.sale_price`/`product.product_price` โดยตรง — เหมือนกับที่ `productModel.
purchase_cost` ผูกกับสูตรผ่าน `getUnitCostByProduct()` ในเฟส 4 เป๊ะ) ถ้าปล่อย `price_override` ไว้ไม่
แปลงพร้อมกับ product pricing จะได้ `unit_price` ที่หน่วยปนกันขึ้นอยู่กับว่า round item นั้นมี override
หรือไม่ (มี override → บาทดิบ, ไม่มี → fallback ไปอ่านสตางค์จาก product) — จับได้ก่อนเขียนโค้ดจริง ไม่ใช่
จากเทสพัง เพราะทำตามขั้นตอน "สำรวจก่อนแตะ" ที่ตั้งเป็นธรรมเนียมมาตั้งแต่เฟส 1

### บั๊กที่ไม่ได้เจอ (แต่เกือบเจอ) ในเฟส 5b: `makeProduct()`/`makeVariant()`/`makeOption()` ในเทส

`tests/integration/helpers.ts`'s `makeProduct()` สร้าง productModel doc ตรง ๆ (ข้าม productService)
มีจุดเรียกใช้กระจายอยู่ **51 จุดใน 12 ไฟล์เทส** ทั่วทั้ง test suite (เขียนไว้ตั้งแต่ก่อนรอบ 5 เริ่มด้วยซ้ำ)
หลายจุดส่ง `product_price`/`sale_price` เป็นตัวเลขที่ตั้งใจหมายถึง "บาท" (เช่น `makeProduct({
product_price: 120 })`) — ถ้าทำตามแนวทางเฟส 4 (ปรับแค่ค่า default ของ helper ตรง ๆ อย่างที่ทำกับ
`makeIngredient`/`makeRecipe`) จะต้องไล่แก้ทุก 1 ใน 51 จุดเรียกให้กลายเป็นค่าสตางค์ ×100 เอง — เสี่ยงพลาด
สูงและงานหนักเกินจำเป็น แก้โดยให้ **helper เองเป็นคนแปลงบาท→สตางค์ก่อนเขียนจริง** (`merged.product_price
= toSatang(Number(merged.product_price))`) ทำให้ทุกจุดเรียกที่มีอยู่แล้วยังคงความหมาย "บาท" เหมือนเดิม
ทุกประการโดยไม่ต้องแก้อะไรเลยสักจุด (ยกเว้น 1 จุดที่อัปเดตราคาตรงผ่าน model โดยไม่ผ่าน helper ใน
`persistOrder.test.ts` ซึ่งต้องแก้ให้เป็นค่าสตางค์ตรง ๆ เหมือนเดิม) — **purchase_cost ไม่ได้แปลงด้วย
วิธีนี้** เพราะเทสที่มีอยู่ก่อนแล้วจากเฟส 4 (`getUnitCostByProduct.test.ts`) ส่งค่าดิบเป็นสตางค์ตรง ๆ
อยู่แล้ว ถ้าแปลงซ้อนจะพังเทสเก่าทันที — บทเรียน: **จำนวนจุดเรียกใช้ของ test helper ที่มีอยู่ก่อนควรเป็น
ตัวตัดสินว่าจะแก้ที่ default ตรง ๆ หรือแก้ที่ตัว helper ให้แปลงหน่วยให้เอง**

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

**เฟส 5a เพิ่ม section `promotions` เข้ามา** — ต่างจากทุก section ก่อนหน้าตรงที่เป็น **pipeline-style
update** (ดู §3 "บั๊ก/ข้อค้นพบที่เจอในเฟส 5a") ไม่ใช่ `$mul` object ธรรมดา แต่ยังใช้ `runSection()`
เดิมได้เหมือนกันทุกประการ (`runSection()` รับแค่ callback ที่คืน `modifiedCount` ไม่สนว่าข้างในเรียก
`updateMany` แบบไหน) — marker เป็น section ของตัวเอง (`money_to_satang_3_11_promotions`) ตามกฎเดิม

**เฟส 5b เพิ่ม 5 section ใหม่**: `products_pricing` (`product_price`/`sale_price` — section แยกจาก
`products_purchase_cost` เดิมของเฟส 4 ตามกฎ "field ใหม่เข้า collection ที่มี section อยู่แล้วต้องแยก
id เสมอ" ใช้ pipeline-style เพราะ `sale_price` เป็น nullable), `product_variants`/`product_options`
(`$mul` ธรรมดา — field required ทั้งคู่), `cart_items` (`$mul` + positional-all เหมือน
`orderItemModel.selected_options` ในเฟส 1), `preorder_round_items` (`price_override` — pipeline-style
เพราะเป็น nullable เหมือน `sale_price`)

**ต้องรันก่อน deploy จริงครั้งแรกหลัง PR นี้ merge** (หรือรันกับ DB dev/staging ที่มีข้อมูลทดสอบอยู่แล้ว
ถ้าอยากให้ตัวเลขเดิมยังถูกต้อง — ถ้าไม่รัน ข้อมูลเก่าจะโดนตีความเป็นสตางค์ทั้งที่จริงเป็นบาท เช่น
`total_amount: 150` เดิม (150 บาท) จะกลายเป็นแค่ 1.50 บาทถ้าไม่ migrate) — **ถ้าเคยรันตอนจบเฟสก่อนหน้า
ไปแล้ว รันซ้ำอีกครั้งตอนนี้ได้เลยปลอดภัยเสมอ** (marker แยกต่อ section) จะแค่เติม section ใหม่ที่ยังไม่
เคยรันให้เท่านั้น (ตอนนี้คือ `products_pricing`/`product_variants`/`product_options`/`cart_items`/
`preorder_round_items`) — **นี่คือการรัน migration ครั้งสุดท้ายของ §3.11 ทั้งโปรเจกต์** หลัง PR เฟส 5b
merge แล้ว ไม่มี field เงินไหนเหลือให้ต้องรันเพิ่มอีก

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
- `tests/integration/promotionMoney.test.ts` (11 เคส, เฟส 5a, ไฟล์ใหม่) — create/update ครบทุก
  discount_type (Amount แปลง, Percentage/FreeShipping ไม่แปลง), `min_order_amount`/
  `max_discount_amount` แปลงเสมอไม่ว่า type ใด, update สามกรณี (แก้ค่าปกติ, เปลี่ยน type พร้อมค่าใหม่
  ในคำขอเดียวกัน, เปลี่ยน type โดยไม่ส่งค่าใหม่มาด้วย — ค่าเก่าต้องไม่ถูกแตะ), list/getById คืนบาทถูก
  ตามชนิด, **end-to-end ผ่าน `validateForOrder()`**: Amount + min_order_amount เทียบเกณฑ์ถูกหน่วย
  (ทั้งผ่านและ reject), Percentage + max_discount_amount cap แปลงบาทถูกต้อง (ไม่ cap เพี้ยน ×100)
- แก้ assertion เดิมที่ query DB ตรง ๆ (bypass presenter) ใน `persistOrder.test.ts`,
  `createPaymentPreorder.test.ts`, `cancelPreorder.test.ts`, `cancelOrder.test.ts` ให้ตรงกับหน่วย
  สตางค์จริง + comment กำกับชัดว่าทำไมต่างจาก `order.*`/`preorder.*` ที่มาจาก service (บาทเหมือนเดิม)
  — `cancelOrder.test.ts`'s `makePromo()` สร้าง promotion ตรงผ่าน model (bypass promotionService)
  ด้วย `discount_value: 20` มาตั้งแต่ก่อนเฟส 5a ต้องเปลี่ยนเป็น `2000` (สตางค์)
- `tests/integration/productPricingMoney.test.ts` (10 เคส, เฟส 5b, ไฟล์ใหม่) — ครอบทุก service ที่แก้:
  `productService` create/update/list/getById แปลง `product_price`/`sale_price` ทั้งคู่ (รวมกรณี
  `sale_price: null` เคลียร์ค่า) · `productVariantService`/`productOptionService` create/update/
  list/getById แปลง `variant_price`/`extra_price` · `cartService` end-to-end: `addItem()` คำนวณ
  `price_snapshot` จาก product+variant+option ที่เป็นสตางค์ทั้งหมด (ใช้ 29.9+10.5+5.25 บาท ยืนยันไม่มี
  float drift), `getCartDetail()`/`updateItemQuantity()` คืนบาทถูกทาง · **`orderService.resolveLine()`
  end-to-end**: สร้างออเดอร์จริงจากสินค้า+option ที่เป็นทศนิยม (33.3+6.7 บาท) ยืนยัน `subtotal` เป๊ะ
  ไม่มี rounding drift หลังเอา `toSatang()` ที่เคยห่อออก · `preorderRoundService`: `addRoundItem`/
  `updateRoundItem` แปลง `price_override`, `getRoundDetail`/`listRoundItems` แปลง `current_price` +
  ซ้อนเข้าไปใน populate ของ product ด้วย, **end-to-end เต็มเส้นทางผ่าน `preorderService.
  createPreorder()`**: round item ที่มี `price_override` → `preorderItem.unit_price` เก็บสตางค์ตรง
  DB, API คืนบาทถูกต้อง
- `tests/integration/migrateMoneyToSatang.test.ts` (+1 เคส สะสมในเทสใหญ่ตัวเดิม, เฟส 5b) — เพิ่ม
  เอกสารดิบ (สร้างตรงผ่าน model ไม่ผ่าน `makeProduct()`/`makeVariant()`/`makeOption()` ที่แปลงให้
  อัตโนมัติแล้ว — กันปนกับเอกสารที่ "เป็นสตางค์อยู่แล้ว" จาก helper) ครบทั้ง 5 collection ใหม่ รวมเคส
  `price_override: null` ยืนยันว่า pipeline update ไม่พัง
- **`tests/integration/helpers.ts`**: `makeProduct()`/`makeVariant()`/`makeOption()` เปลี่ยนจาก "ปรับ
  แค่ default" (แบบที่ทำกับ `makeIngredient`/`makeRecipe` ในเฟส 4) เป็น **แปลงบาท→สตางค์ให้อัตโนมัติ
  ในตัว helper เอง** เพราะมีจุดเรียกใช้อยู่ก่อนแล้วถึง 51 จุดใน 12 ไฟล์ทั่ว test suite (ดู §3 "บั๊กที่
  ไม่ได้เจอ") — ผลคือรันเทสทั้งหมด (รวมเทสเก่าก่อนรอบ 5 เริ่ม) ผ่านหมดโดยไม่ต้องแก้จุดเรียกเดิมแม้แต่
  จุดเดียว ยกเว้น `persistOrder.test.ts` ที่อัปเดตราคาตรงผ่าน model (ไม่ผ่าน helper) 1 จุด
- unit 163 → 171 (คงที่ตั้งแต่เฟส 2) · integration 79 → 82 (เฟส 1) → 89 (เฟส 2) → 93 (เฟส 3) → 104
  (เฟส 4) → 115 (เฟส 5a) → **125** (เฟส 5b)

---

## 7. สรุปฟิลด์ที่เคยพลาดจากการสำรวจตอนแรก

การสำรวจ "17 model ที่แตะเงิน" ตอนเริ่มรอบ 5 (ก่อนเริ่มเฟส 1) พลาดไป 1 model จริง — รวมเป็น **18
model** ในที่สุด:

- `preorderRoundItemModel.price_override` — ชื่อ field มีคำว่า "price" แต่ไม่ปรากฏชัดจนกว่าจะตามอ่าน
  `preorderRoundService.getOrderableRoundItem()`/`getRoundDetail()` ว่าผูก fallback chain กับ
  `product.sale_price`/`product.product_price` โดยตรง — จับได้ระหว่างสำรวจขอบเขตก่อนเริ่มเฟส 5
  (ก่อนเขียนโค้ดจริง ไม่ใช่จากเทสพัง) แก้พร้อมกับ Product pricing ในเฟส 5b

บทเรียนสำหรับใครมาแตะเงินในโปรเจกต์นี้อีกในอนาคต: **grep หาคำว่า "price"/"amount"/"cost" อย่างเดียวไม่พอ
— ต้องตามอ่าน fallback chain (`??`) และฟังก์ชันที่ผสมค่าจากหลายแหล่งเข้าด้วยกันด้วย** เพราะ field ที่ผูก
กับแหล่งเงินอื่นแบบนี้มักไม่มีคำที่ grep เจอง่าย ๆ ในชื่อของมันเอง (`purchase_cost` ในเฟส 4 ก็ผ่าน
`??` chain เดียวกันนี้ แต่ชื่อชัดกว่า `price_override` มากจนสำรวจรอบแรกจับได้)

---

## 8. สรุปทั้งโปรเจกต์ — §3.11 เสร็จสมบูรณ์แล้วทั้งหมด

ทุกเฟสของแผนเดิม (ที่แตกเป็น 6 เฟสย่อยระหว่างทาง: 1, 2, 3, 4, 5a, 5b) เสร็จครบแล้ว ไม่มี field เงินไหน
เหลือค้างในระบบอีก — ครบทั้ง 18 model:

1. ✅ **เฟส 1 (2026-09-12):** Order + OrderItem + Preorder + PreorderItem + Payment +
   PromotionUsages + `dashboardService` — เฟสใหญ่ที่สุดเพราะ `paymentModel` เป็น collection กลางที่
   ผูก order/preorder เข้าด้วยกัน แยกแปลงไม่ได้ · เจอ+แก้บั๊ก `tests/integration/setup.ts` (ไม่เคลียร์
   raw collection ที่ไม่ผ่าน mongoose model) ไปด้วย
2. ✅ **เฟส 2 (2026-09-12):** Expense (`expenseModel.amount`) — โดดเดี่ยวตามคาด แต่เจอบั๊กมาร์กเกอร์
   เดียวทั้งไฟล์ (แก้เป็น marker แยกต่อ collection ถาวร)
3. ✅ **เฟส 3 (2026-09-12):** Delivery zone (`deliveryZoneModel.fee`) — โดดเดี่ยวตามคาด, ยืนยัน
   pattern "แปลงข้ามโดเมนตรงจุดที่ข้าม" ใช้ได้กับ cache ภายในด้วย
4. ✅ **เฟส 4 (2026-09-12):** Recipe/Component/Ingredient cost + `cost_per_unit` (ค้างจากเฟส 1) +
   `productModel.purchase_cost` (ดึงเข้ามาก่อนกำหนดเพราะผูกกับสูตรผ่าน `getUnitCostByProduct()`) —
   เจอบั๊กมาร์กเกอร์ซ้ำอีกครั้ง + บั๊กปัดเศษ + `$mul` พังกับ `null`
5. ✅ **เฟส 5a (2026-09-12):** Promotion definition — ซับซ้อนสุดในบรรดาเฟสที่ทำสำเร็จ (field เดียว
   ความหมายเปลี่ยนตามเงื่อนไข) ค้นพบ pipeline-style update แก้ปัญหา conditional + nullable ได้ดีกว่า
   `$mul` + filter
6. ✅ **เฟส 5b (2026-09-12):** Product pricing (`productModel.product_price`/`sale_price`,
   `productVariantModel.variant_price`, `productOptionModel.extra_price`, `cartItemModel.
   price_snapshot`) + `preorderRoundItemModel.price_override` (model ที่ 18 ที่พลาดจากการสำรวจรอบ
   แรก — ดู §7) — เฟสสุดท้าย ปิดท้ายด้วยการลบ "จุดข้ามโดเมน" (`toSatang()` wrapping ปลายทาง) ออกจาก
   `orderService.resolveLine()` และ `preorderService`'s round-item pricing ได้สำเร็จตามที่วางแผนไว้

**บทเรียนที่ยืนยันซ้ำตลอดทั้งโปรเจกต์** (คุ้มค่าที่จะจำไว้ใช้กับงาน migration ลักษณะเดียวกันในอนาคต):

- **แบ่งเฟสตาม domain ที่ผูกกันจริงทางโค้ด ไม่ใช่ตามหมวดหมู่ที่ดูเป็นเรื่องเดียวกัน** — ค้นพบซ้ำ 3 ครั้ง
  (order/preorder ผ่าน `paymentModel` ในเฟส 1, `purchase_cost` ผ่าน `getUnitCostByProduct()` ในเฟส 4,
  `price_override` ผ่าน fallback chain เดียวกับ product pricing ในเฟส 5b)
- **field เงินใหม่ที่เพิ่มเข้า collection ที่มี migration section อยู่แล้วต้องได้ section id ใหม่เสมอ**
  ไม่งั้น DB ที่เคย migrate ไปแล้วจะข้ามทั้ง section โดยไม่แตะ field ใหม่เลย (เจอซ้ำในเฟส 2 และเฟส 4)
- **MongoDB `$mul` (object update ธรรมดา) error ทันทีถ้าเจอ field เป็น `null`** ต้อง filter
  `$type:"number"` ก่อนเสมอสำหรับ field nullable (เฟส 4) — **หรือใช้ pipeline-style update แทนไปเลย**
  (`updateMany(filter, [stage], { updatePipeline: true })`) ซึ่งรองรับทั้ง conditional logic และ
  `null` ได้โดยไม่ต้อง filter อะไรเพิ่ม (ค้นพบในเฟส 5a — แนะนำให้ใช้เป็นค่าเริ่มต้นสำหรับ migration ใน
  อนาคต แทน `$mul` + filter)
- **grep หาคำว่า price/amount/cost ไม่พอสำหรับสำรวจ money field** — ต้องตามอ่าน fallback chain (`??`)
  และฟังก์ชันผสมค่าจากหลายแหล่งด้วย (`price_override` หลุดจากการสำรวจรอบแรกเพราะเหตุนี้)
- **สูตรปัดเศษที่ออกแบบไว้สำหรับบาท (`Math.round(x*100)/100`) ใช้ไม่ได้กับสตางค์** — ต้องเปลี่ยนเป็น
  `Math.round(x)` ตรง ๆ ทุกจุดที่เคยปัดทศนิยม 2 ตำแหน่ง (เฟส 4)
- **presenter ที่แปลง DB→API เดียวกัน มักใช้ซ้ำเป็นตัวแปลงข้ามโดเมนให้ฟังก์ชันภายในที่ยังไม่แปลงได้พอดี**
  (`presentPromotion()` ในเฟส 5a ใช้ทั้งสองบทบาท) เพราะทั้งคู่ต้องการรูปร่างผลลัพธ์แบบเดียวกัน
- **จำนวนจุดเรียกใช้ของ test helper ที่มีอยู่ก่อนควรตัดสินว่าจะแก้ที่ default ตรง ๆ (จุดเรียกน้อย) หรือ
  ให้ helper แปลงหน่วยให้เองอัตโนมัติ (จุดเรียกเยอะ)** — ผิดกันระหว่าง `makeIngredient`/`makeRecipe`
  (เฟส 4, ปรับ default) กับ `makeProduct`/`makeVariant`/`makeOption` (เฟส 5b, 51 จุดเรียก ต้องให้
  helper แปลงเอง)

**ตัวเลขรวมทั้งโปรเจกต์:** unit test 163 → 171 (คงที่ตั้งแต่เฟส 2) · integration test 79 → 82 → 89 →
93 → 104 → 115 → **125** (เพิ่มขึ้น 46 เคสตลอด 6 เฟสย่อย) · migration script มีทั้งหมด 20 section
อิสระต่อกัน (ดู `scripts/migrate-money-to-satang.ts`)
