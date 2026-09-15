# สรุปรอบ 4c — feature เล็ก + เทสเพิ่ม (+ ปิดของค้าง §2b/§2c)

> อัปเดตล่าสุด: 2026-09-12
> สถานะ: ✅ **เสร็จสมบูรณ์ทั้งหมด** — merge เข้า `addModels` แล้ว (`a83ab10`)
> ที่มา: [`BACKLOG.md`](BACKLOG.md) §3 "ลำดับการแก้ที่เหลือ" รอบ 4c · ต่อจาก [`hardening-4b-plan.md`](hardening-4b-plan.md)
> เกี่ยวข้อง: [`preorder-payment-hardening.md`](preorder-payment-hardening.md) (§2b) ·
> [`order-cart-inventory-robustness.md`](order-cart-inventory-robustness.md) (§2c)

เอกสารนี้มี 2 ส่วน: **§0** ปัญหาที่เจอ "ก่อน" เริ่มรอบ 4c ได้จริง (งานค้างจากรอบก่อนที่เข้าใจผิดว่าเสร็จแล้ว)
กับ **§1–3** ตัวงานจริงของรอบ 4c (3 ข้อจากแผน 4 ข้อ — ข้อ 3.12 พบว่าล้าสมัยไม่ต้องทำ)

---

## §0. ปัญหาที่พบก่อนเริ่มรอบ 4c: §2b/§2c "เสร็จแล้ว" แต่ไม่ได้ merge จริง

### ปัญหา
ก่อนเริ่มรอบ 4c มีการเช็ค PR list ผ่าน GitHub API แบบสุ่ม (ตามนิสัยที่ตั้งไว้ว่าไม่เชื่อสถานะที่จำไว้เฉย ๆ)
แล้วพบว่า:

| งาน | เข้าใจว่า | ความจริง (ยืนยันจาก API) |
|---|---|---|
| PR #19 (§2b — แก้ IDOR + preorder hardening 4 ข้อ) | merge เข้า `addModels` แล้ว | `state: open`, `merged: false` |
| branch `fix-robustness-2c` (§2c — clearCart/voidTransaction 2 ข้อ) | รอ merge อยู่ | **ไม่เคยเปิด PR เลย** |

พูดง่าย ๆ คือ **ช่องโหว่ IDOR ที่ให้ลูกค้าคนหนึ่งจ่ายเงินแทนพรีออเดอร์ของคนอื่นได้ (§2b.1) ยังอยู่ใน
`addModels` จริง ๆ** ตอนนั้น — ทั้งที่เคยรายงานว่าแก้และ merge เรียบร้อยแล้ว

**สาเหตุ:** เป็นความผิดพลาดของกระบวนการรายงาน ไม่ใช่ของโค้ด — โค้ดที่แก้ไว้ถูกต้องและผ่านเทส/CI มาตั้งแต่แรก
แค่ขั้นตอน "เปิด PR" (สำหรับ §2c) และ "กด merge ให้จบจริง" (สำหรับ §2b) ไม่ได้เกิดขึ้นจริง

### วิธีแก้
1. Merge PR #19 เข้า `addModels` — ตรวจ `git merge-tree` ก่อนว่าไม่ชนกับรอบ 4b ที่ merge ไปแล้ว (clean)
2. เปิด PR ใหม่ให้ `fix-robustness-2c` (= PR #22) แล้ว merge เข้า `addModels` เช่นกัน
3. ยืนยันทุกขั้นตอนด้วย GitHub API จริง (`state`/`merged`/`addModels` HEAD sha ขยับ) ไม่เชื่อคำว่า
   "merge เสร็จแล้ว" เฉย ๆ — ระหว่างทางเจอเคส merge ค้างที่ prompt ยืนยัน method (`gh pr merge`
   แบบ interactive) หลายครั้ง จึงเปลี่ยนไปใช้ `gh pr merge N --merge --delete-branch=false`
   (non-interactive) เป็นค่าเริ่มต้น

### บทเรียน
- **"บอกว่าทำแล้ว" ≠ "ยืนยันแล้วว่าทำจริง"** — โดยเฉพาะขั้นตอนที่เกี่ยวกับระบบภายนอก (GitHub) ที่มี state
  แยกจาก local repo ต้องเช็คผ่าน API ทุกครั้งก่อนเดินหน้างานต่อ ไม่ใช่แค่ตอนสงสัย
- งานที่ "แก้โค้ดเสร็จ + เทสผ่าน" ยังไม่เท่ากับ "จบงาน" ถ้าไม่ได้ยืนยันว่า merge เข้า branch หลักจริง —
  ทำให้ commit ค้างอยู่บน feature branch เฉย ๆ นานเท่าไหร่ก็ได้โดยไม่มีใครรู้ตัว

---

## 1. ✅ 3.8 — `address_id` → checkout (PR #23)

### ปัญหา
ลูกค้าที่สั่ง `order_type: "delivery"` ต้องพิมพ์ที่อยู่ทั้งก้อน (`delivery_address`) ใหม่ทุกครั้งที่สั่งซื้อ
ทั้งที่ระบบมีสมุดที่อยู่อยู่แล้ว (`addressService` + `/api/shop/addresses`) — ไม่มีทางเลือกที่อยู่ที่เคยบันทึกไว้
มาใช้ตอน checkout ได้เลย

### วิธีแก้
เพิ่มทางเลือกที่สองให้ body ของ `POST /api/shop/orders` และ `POST /api/admin/orders`:

```ts
// src/schemas/order.ts — orderBodyBase
address_id: objectId.nullish(),        // เลือกจากสมุดที่อยู่
recipient_name: z.string().trim().min(1).max(200).nullish(),
recipient_phone: phone.nullish(),
delivery_address: deliveryAddress.nullish(),   // หรือกรอกใหม่ทั้งก้อนแบบเดิม
```

พร้อม `.refine()` บังคับ **oneOf** เมื่อ `order_type === "delivery"`:
- ต้องมี `address_id` **หรือ** `delivery_address` อย่างใดอย่างหนึ่งเท่านั้น (ห้ามมีทั้งคู่/ไม่มีเลย)
- ถ้าใช้ `address_id` ต้องมี `recipient_name`/`recipient_phone` มาด้วยเสมอ

**ทำไมต้องแยก `recipient_name`/`recipient_phone` ออกมาต่างหาก:** สมุดที่อยู่ (`addressModel`) เก็บแค่
ตำแหน่ง (`house_no`/`sub_district`/`district`/`province`/`zip_code`) ไม่เก็บชื่อ-เบอร์ผู้รับ เพราะออเดอร์
หนึ่งอาจสั่งให้คนอื่น (เช่น ส่งของขวัญ) ใช้ที่อยู่เดิมแต่ชื่อผู้รับไม่ใช่เจ้าของบัญชี — ถ้าผูกชื่อ/เบอร์ไว้กับ
ที่อยู่ตรง ๆ จะบังคับให้ผู้รับต้องเป็นคนเดียวกับเจ้าของสมุดที่อยู่เสมอ ซึ่งไม่ตรงการใช้งานจริง

ตัว resolve ที่อยู่ทำใน service ใหม่ ไม่แตะ `orderService.ts` เลย:

```ts
// src/services/addressService.ts
export async function resolveDeliverySnapshot(userId, input) {
  if (!input.address_id) return input.delivery_address ?? null;
  const addr = await getById(userId, input.address_id); // สโคปด้วย userId กัน IDOR อยู่แล้ว
  return {
    recipient_name: input.recipient_name ?? "",
    recipient_phone: input.recipient_phone ?? "",
    house_no: addr.house_no, sub_district: addr.sub_district,
    district: addr.district, province: addr.province, zip_code: addr.zip_code,
  };
}
```

route (`/api/shop/orders`, `/api/admin/orders`) เรียก `resolveDeliverySnapshot()` ก่อนส่งต่อ
`orderService.createOrder`/`createOrderFromCart` — ผลลัพธ์เป็น flat record รูปแบบเดิมทุกประการ
ที่ `orderService.persistOrder`'s `ADDRESS_FIELDS` check คาดหวังอยู่แล้ว จึง **ไม่ต้องแก้
`orderService.ts` แม้แต่บรรทัดเดียว**

**ป้องกัน IDOR:** `resolveDeliverySnapshot` เรียก `addressService.getById(userId, address_id)` ซึ่งมี
`{ _id: id, user_id: userId, deleted_at: null }` filter อยู่แล้วในตัว — ใช้ `address_id` ของคนอื่นจะได้
`404 notFound` ไม่ใช่ที่อยู่ของคนอื่นมาสวมเป็นของตัวเอง (มีเทสยืนยันเคสนี้โดยตรง)

### เทส
`tests/integration/resolveDeliverySnapshot.test.ts` (4 เคส: ใช้ address_id สำเร็จ, address_id
ของคนอื่น → 404, ไม่ใช้ address_id ส่ง delivery_address ตรงๆ, ไม่ส่งอะไรเลย → null) +
`tests/lib/schemas.test.ts` (+6 เคส ครอบ refine ทุกเงื่อนไข)

### สิ่งที่ยังไม่ทำ (บันทึกไว้กันลืม — เรียนรู้จากบทเรียน §2b)
`POST /api/shop/preorders` เป็น checkout path คู่ขนานที่ยังไม่ได้ adopt zod เลย (`req.json()` ดิบ) —
ยังใช้ `delivery_address` กรอกเองอย่างเดียว ไม่มี `address_id` ให้ ถ้าจะทำต้อง adopt zod ให้ route นี้
ก่อน (งานคนละขนาดกับ 3.8 เดิม) — จดไว้ใน [`BACKLOG.md`](BACKLOG.md) §3 ข้อ 7 ชัดเจน ไม่ให้ซ้ำรอย
ที่ order/preorder เคย diverge กันมาก่อนใน §2b

---

## 2. ✅ 3.16 — `purchase_cost` fallback สำหรับ COGS (PR #24)

### ปัญหา
`recipeService.getUnitCostByProduct()` คำนวณต้นทุนต่อหน่วยจาก `estimated_cost_per_batch / yield_qty`
ของสูตรการผลิตล่าสุดเท่านั้น — สินค้าที่ **ไม่มีสูตร** (เช่น ซื้อมาขายต่อ: น้ำดื่ม, ของฝาก) จะได้ต้นทุน
`null` เสมอ แล้ว `dashboardService` ใช้ `$ifNull: ["$cost_per_unit", 0]` ตอนรวม COGS — เท่ากับสินค้า
กลุ่มนี้ **มีต้นทุนเป็น 0 บาทเงียบ ๆ** ทำให้ "กำไรโดยประมาณ" ในแดชบอร์ดสูงกว่าความเป็นจริง

### วิธีแก้
เพิ่ม field `purchase_cost` (nullable, กรอกมือ) ใน `productModel` ให้เป็นค่า fallback:

```ts
// src/models/productModel.ts
purchase_cost: { type: Number, default: null, min: 0 },
```

`productService.createProduct`/`updateProduct` รับค่านี้เข้า whitelist + validate `>= 0` เหมือน
`sale_price` ทุกประการ

`getUnitCostByProduct()` ปรับลำดับความสำคัญเป็น 3 ชั้น — **สูตรมาก่อนเสมอเมื่อมี**, ตกไปใช้
`purchase_cost` เฉพาะตอนไม่มีสูตรจริง ๆ (หรือมีสูตรแต่ `yield_qty = 0` คำนวณไม่ได้):

```ts
// src/services/recipeService.ts
// ...คำนวณจากสูตรตามเดิมก่อน...
const missing = validIds.filter((id) => out.get(id) == null);
if (missing.length > 0) {
  const products = await productModel.find({ _id: { $in: missing } })
    .select("purchase_cost").lean();
  for (const p of products) {
    if (p.purchase_cost != null) out.set(String(p._id), p.purchase_cost);
  }
}
```

**ทำไมต้องเป็น fallback ไม่ใช่แทนที่:** สินค้าที่มีสูตรการผลิตจริง ต้นทุนควรคำนวณจากสูตร (แม่นกว่า กรอกมือ
ผิดพลาด/ลืมอัปเดตได้ง่าย) — `purchase_cost` มีไว้เฉพาะกรณีที่ "ไม่มีสูตรให้คำนวณ" เท่านั้น จึงต้องเช็คสูตร
ก่อนเสมอแล้วค่อยถามหา `purchase_cost` เมื่อจำเป็น ไม่ใช่ให้ 2 ค่านี้แข่งกันหรือ `purchase_cost` ทับสูตร

### เทส
`tests/integration/getUnitCostByProduct.test.ts` (4 เคส ครบทุกลำดับความสำคัญ: มีสูตรใช้สูตรแม้มี
`purchase_cost` ด้วย, ไม่มีสูตรใช้ `purchase_cost`, มีสูตรแต่ `yield_qty=0` ใช้ `purchase_cost`,
ไม่มีทั้งคู่ = `null` เหมือนพฤติกรรมเดิมก่อนแก้)

### สิ่งที่ยังไม่ทำ
ต้นทุนยังเป็นระดับ "สินค้า" ไม่แยกตาม variant (ข้อจำกัดเดิมตั้งแต่ §2.2 — ไม่ได้ขยายในรอบนี้)

---

## 3. ✅ 3.4 — integration tests เพิ่ม (PR #25)

### ปัญหา
3 จุดที่มี business logic ไม่ตรงไปตรงมา (คิดราคา, กันสต็อกติดลบ, คำนวณค่าส่งจากตะกร้าจริง) ไม่มี
integration test คุมไว้เลย — เปลี่ยนโค้ดจุดพวกนี้ในอนาคตแล้วพังจะไม่มีเทสจับได้ก่อนขึ้น production

### วิธีแก้ — เพิ่ม 3 ไฟล์เทสใหม่ (19 เคส รวม), integration รวม 27 → 48 (ก่อน merge PR #23/#24 อีกส่วน)

| ไฟล์ | คุมอะไร | จำนวนเคส |
|---|---|---|
| `cartService.test.ts` | `addItem`: ปฏิเสธ preorder/`is_visible=false`, คิด `price_snapshot` = base(`sale_price`)+variant+Σoption ถูกต้อง, product+variant+option set เดิมซ้ำ = merge quantity, option set ต่างกัน = แยกรายการ · `updateItemQuantity`: `0` = soft-delete, ติดลบ = badRequest · `removeItem`/`clearCart`: ลบของคนอื่นไม่ได้ (คนละ user), ล้างตะกร้าหมดจริง | 7 |
| `createTransaction.test.ts` | `receive`/`use`/`adjust` ครบทุกทาง (before/after ถูกต้อง), `use` ไม่พอสต็อก → conflict, `allowNegative` override ได้, type/qty นอกเงื่อนไข → badRequest, void รายการ `adjust` → badRequest (ไม่มียอดก่อนหน้าให้ย้อน — คู่กับ `voidTransaction.test.ts` เดิมที่คุม §2c.2 floor-guard ไปแล้ว ไม่ทับซ้อนกัน) | 8 |
| `deliveryQuoteForCart.test.ts` | ยืนยัน **wiring จริง** `cartService.getCartDetail → deliveryService.calcDeliveryFee` ไม่ใช่แค่ทดสอบ `calcDeliveryFee` เดี่ยว ๆ — ตะกร้าว่าง/มีของ/ถึงเกณฑ์ฟรีส่ง/ไม่ระบุจังหวัด | 4 |

เพิ่ม test helper: `makeVariant`, `makeOption`, `makeAddress`, `makeRecipe` ใน
`tests/integration/helpers.ts` (ตามรูปแบบเดิมของไฟล์)

---

## บันทึก: การ merge 3 PR คู่ขนานที่แก้ `BACKLOG.md` ร่วมกัน

PR #23/#24/#25 (ของ 3.8/3.16/3.4) แต่ละอันแตกจาก `addModels` คนละเวลากัน แต่ทุกอันแก้
`docs/BACKLOG.md` (อัปเดตสถานะ) และ `tests/integration/helpers.ts` (เพิ่ม helper) ในตำแหน่งใกล้กัน —
พอ merge PR แรกเข้า `addModels` แล้ว อีก 2 PR ที่เหลือจะกลายเป็น "merge conflict" ทันที (GitHub รายงาน
`the merge commit cannot be cleanly created`) แม้เนื้อหาจริงจะเป็นแค่ "เพิ่มบรรทัดคนละจุด" ไม่ใช่บั๊ก —
เกิดซ้ำ **2 รอบ** (หลัง merge #23 กระทบ #24/#25, หลัง merge #24 กระทบ #25 อีกรอบ)

**วิธีแก้ที่ใช้ทุกครั้ง:** `git merge origin/addModels` เข้า branch ที่ยังไม่ merge → resolve conflict
แบบ "เก็บทั้งคู่" (ทั้งสองฝั่งเป็นการเพิ่ม ไม่ใช่แก้จุดเดียวกัน) → รัน `typecheck`/`test`/`test:integration`/
`lint`/`build` ซ้ำให้ผ่านทั้งหมดก่อน push กลับ — ไม่เคยมีเนื้อหาจริงชนกัน มีแต่ตำแหน่งบรรทัดที่ชนกัน

---

## สรุป PR

| PR | เนื้อหา | สถานะ |
|---|---|---|
| **#19** | §2b — IDOR + preorder payment/cancellation hardening (ค้างจากรอบก่อน) | ✅ merged |
| **#22** | §2c — clearCart error handling + voidTransaction floor guard (ค้างจากรอบก่อน, ไม่เคยเปิด PR มาก่อน) | ✅ merged |
| **#23** | 3.8 — address_id → checkout | ✅ merged |
| **#24** | 3.16 — purchase_cost fallback | ✅ merged |
| **#25** | 3.4 — integration tests เพิ่ม | ✅ merged |

## เกณฑ์เสร็จรอบ 4c
- [x] ยืนยัน §2b/§2c merge เข้า `addModels` จริงผ่าน API (ไม่ใช่แค่เชื่อว่าทำแล้ว)
- [x] `address_id` ใช้ checkout ได้ทั้ง `/api/shop/orders` และ `/api/admin/orders`
- [x] `purchase_cost` fallback ใช้งานจริงใน `getUnitCostByProduct` (กระทบ COGS/กำไรใน dashboard)
- [x] integration tests เพิ่มครบ 3 จุดตามแผน (`cartService`/`ingredientTransactionService`/`deliveryService.quoteForCart`)
- [x] `typecheck` / `lint` (0 error, 5 warning เดิม) / `test` (155) / `test:integration` (56) / `build` ผ่านหมดบน `addModels` ที่ merge แล้วจริง (ไม่ใช่แค่บน feature branch ก่อน merge)
- [x] doc อัปเดตครบ (`BACKLOG.md`, เอกสารนี้)
