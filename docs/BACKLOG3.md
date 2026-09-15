# MeowMeeCake Backend — BACKLOG 3: Clean code (reuse / simplification / efficiency)

> สร้าง: 2026-09-15 · อัปเดตล่าสุด: 2026-09-15
> ขอบเขต: `src/services/` + `src/lib/` เท่านั้น (ตามที่ผู้ใช้เลือก) — **ไม่ใช่บั๊ก** ทุกข้อผ่านการตรวจสอบ
> ความถูกต้องมาแล้วอย่างละเอียดใน [`BACKLOG.md`](BACKLOG.md)/[`BACKLOG2.md`](BACKLOG2.md) — เอกสารนี้คุม
> เฉพาะงาน "โค้ดซ้ำ/เขียนได้กระชับกว่า/มี query เกินจำเป็น" ที่พบจาก `/code-review` (2026-09-15)
> **สถานะ: กลุ่มเสี่ยงต่ำ 2/2 แก้แล้ว** — เหลือกลุ่มปานกลาง (4 ข้อ) + กลุ่มเสี่ยงสูง/งานใหญ่ (4 ข้อ) รอ
> ตัดสินใจว่าจะทำต่อไหม

## สถานะโดยรวม

| ชั้น | สถานะ |
|---|---|
| **§1 `round2()` ปัดบาท ซ้ำ 4 ไฟล์** | ✅ **แก้แล้ว** (2026-09-15) — ย้ายมาไว้ที่ `src/lib/money.ts` ที่เดียว |
| **§2 ตัวสร้างเลขที่เอกสาร (order/preorder/production) ซ้ำ 3 จุด** | ✅ **แก้แล้ว** (2026-09-15) — รวมเป็น `generateDocNo()` ใน `src/lib/productCode.ts` |
| §3 `productService.ts` ไม่ใช้ shared helper (`assertObjectId`/`escapeRegExp`/pagination) | 🟡 ยังไม่ทำ — ปานกลาง |
| §4 `authService.login()` fetch user ซ้ำ 3 รอบ | 🟡 ยังไม่ทำ — ปานกลาง |
| §5 `orderService.persistOrder`/`updateOrderStatus` เรียก `getOrderById` ซ้ำหลัง save | 🟡 ยังไม่ทำ — ปานกลาง (hot path) |
| §6 `cartService.resolveOptions` vs `orderService.resolveLines` validate option ซ้ำ | 🟡 ยังไม่ทำ — ปานกลาง |
| §7 `permissionService.getEffectivePermissions()` ไม่มี cache | 🟡 ยังไม่ทำ — เสี่ยงสูง (auth hot path, ต้องระวัง stale permission) |
| §8 `crudService.ts` ไม่มี "present" transform hook | 🟡 ยังไม่ทำ — งานใหญ่ (แตะ 7 service) |
| §9 soft-delete/restore pattern ใน `crudService` ถูกก็อปมือใน 5+ service | 🟡 ยังไม่ทำ — งานใหญ่ |
| §10 `orderService`/`preorderService` state-machine/cancel/delivery ซ้ำ ~350 บรรทัด | 🟡 ยังไม่ทำ — ใหญ่สุด เสี่ยงสุด |

---

## 1. ✅ `round2()` ปัดบาททศนิยม 2 ตำแหน่ง ซ้ำ 4 ไฟล์ — แก้แล้ว (2026-09-15)

**พบ:** `src/lib/discountEngine.ts:54` มี `round2` ของตัวเองแบบ private (`const round2 = (n) => Math.round(n*100)/100`)
ทั้งที่ `src/lib/money.ts` เป็นเจ้าของสูตรเงินของทั้งระบบอยู่แล้ว (`toSatang`/`toBaht`/`percentOfSatang`) —
`src/services/dashboardService.ts` (8 จุด), `expenseService.ts` (2 จุด), `reviewService.ts` (2 จุด) ก็ inline
สูตรเดียวกันตรง ๆ อีก 12 จุดรวม — ถ้าสูตรปัดเงินต้องเปลี่ยน (เช่นเปลี่ยนเป็น banker's rounding สำหรับรายงาน
การเงิน) ต้องไล่แก้ 4 ไฟล์แยกกัน

**วิธีแก้:** เพิ่ม `export function round2(baht: number): number` ใน `src/lib/money.ts` (ปัดบาท ไม่ใช่สตางค์ —
คอมเมนต์กำกับไว้ชัดว่าใช้กับค่าที่เป็นบาทอยู่แล้ว เช่นผลลัพธ์ผ่าน `toBaht()` มาแล้ว หรือ `avg_rating`) แล้วแก้
ทุกจุดให้ import มาใช้แทน `Math.round(x*100)/100` inline — `discountEngine.ts` ลบ private `round2` ทิ้ง

**ไฟล์ที่แก้:** `src/lib/money.ts` (+`round2`), `src/lib/discountEngine.ts`, `src/services/dashboardService.ts`,
`src/services/expenseService.ts`, `src/services/reviewService.ts`

**เทสใหม่:** `tests/lib/money.test.ts` (+1 describe block, 4 assertion) ยืนยันพฤติกรรมปัดเหมือนสูตรเดิมทุก
ประการ (`19.999→20`, `1/3→0.33`, `100→100`, `0→0`)

ยืนยันด้วย `typecheck`/`typecheck:test`/`lint`(0 error, 4 warning ไม่เปลี่ยน)/`test`(181→**185**, +4)/
`test:integration`(141, ไม่เปลี่ยน — ไม่แตะ behavior)/`build` ผ่านหมด

---

## 2. ✅ ตัวสร้างเลขที่เอกสาร (order/preorder/production) ซ้ำ 3 จุด — แก้แล้ว (2026-09-15)

**พบ:** `randomOrderNo()` (`orderService.ts`), `randomPreorderNo()` (`preorderService.ts`),
`randomProductionNo()` (`productionOrderService.ts`) เป็นฟังก์ชันรูปแบบ `<prefix>-YYYYMMDD-<สุ่ม base36
ตัวพิมพ์ใหญ่>` เหมือนกันเป๊ะทุก byte ต่างแค่ prefix (`OP-`/`PRE-`/`PRD-`) และความยาวสุ่ม (order/preorder = 6
ตัว, production = 5 ตัว) — โค้ดปะติดปะต่อ 3 ชุด ถ้าจะแก้รูปแบบ (เช่นขยายความยาวสุ่มกันชนกันบ่อยตอน retry)
ต้องแก้ 3 จุดแยกกัน เสี่ยงพลาดจุดใดจุดหนึ่ง

**วิธีแก้:** เพิ่ม `export function generateDocNo(prefix: string, randomLength = 6, now: Date = new Date()):
string` ใน `src/lib/productCode.ts` (เป็นเจ้าของ "human-readable code generation" ของระบบอยู่แล้ว — คนละ
รูปแบบกับ `generateProductCode()` เดิม (`pos-DDYYzzz`) แต่เป็นหมวดเดียวกัน) — ลบฟังก์ชัน private ทั้ง 3 ตัว
ออก เปลี่ยนจุดเรียกเป็น `generateDocNo("OP")` / `generateDocNo("PRE")` / `generateDocNo("PRD", 5)` — พฤติกรรม
เดิมทุกประการ (รูปแบบ, ความยาวสุ่มต่อจุดเรียก, ตัวพิมพ์ใหญ่, ผู้เรียกยังต้อง retry-on-duplicate-key เองเหมือน
เดิม — `generateDocNo` ไม่การันตี unique)

**ไฟล์ที่แก้:** `src/lib/productCode.ts` (+`generateDocNo`), `src/services/orderService.ts`,
`src/services/preorderService.ts`, `src/services/productionOrderService.ts`

**เทสใหม่:** `tests/lib/productCode.test.ts` (+1 describe block, 3 เคส: รูปแบบ+ความยาวสุ่มตามที่ระบุ, `now`
กำหนดวันที่ได้, สุ่มไม่ซ้ำกันในทางปฏิบัติ)

ยืนยันด้วย `typecheck`/`typecheck:test`/`lint`(0 error, 4 warning ไม่เปลี่ยน)/`test`(185)/
`test:integration`(141, ผ่านหมด — ยืนยันว่า `order_no`/`preorder_no`/`production_no` ที่เทส integration
เดิมเช็ครูปแบบ/ความยาวไว้ยังตรงเป๊ะหลังเปลี่ยน)/`build` ผ่านหมด

---

## 3. 🟡 `productService.ts` ไม่ใช้ shared helper — ยังไม่ทำ

`productService.ts` เป็น service เดียวที่ reimplement `assertObjectId` เอง (ซ้ำกับ `src/lib/objectId.ts`),
`escapeRegExp` เอง (ซ้ำกับ `src/lib/queryParams.ts` ไบต์ต่อไบต์), และ `getProducts()` คำนวณ
page/limit/skip + meta object (`{page, limit, total, totalPages, hasNextPage, hasPrevPage}`) เองแทนเรียก
`parsePagination`/`buildMeta` ที่ service อื่นทุกตัวใช้ — ความเสี่ยงถ้าไม่แก้: บั๊ก edge-case ของ
pagination-meta (เช่น `totalPages` fallback) หรือ ObjectId validation ที่แก้ที่ `src/lib/` จะไม่มีผลกับ
product listing/lookup โดยอัตโนมัติ

**ทำไมยังไม่แก้:** ต้องไล่เทียบพฤติกรรม edge case ของ `buildMeta`/`parsePagination` กับโค้ดมือของ
`productService.ts` ให้ตรงกันก่อนสลับ (ความเสี่ยงว่า metadata เปลี่ยนรูปเงียบ ๆ ถ้าสูตรไม่ตรงกันเป๊ะ) —
เป็นงานปานกลาง ไม่ใช่แค่ swap import ตรง ๆ

---

## 4. 🟡 `authService.login()` fetch user ซ้ำ 3 รอบ — ยังไม่ทำ

`userService.verifyCredentials` ไม่ populate `role_id` → `authService.issue()`→`toSessionUser()` query
`roleModel.findById` แยกอีกรอบ → `login()` เรียก `userService.getUserById()` อีกรอบสุดท้าย — รวม 3 query
ต่อการ login 1 ครั้ง (`loginWithGoogle` มี pattern เดียวกัน)

**ทำไมยังไม่แก้:** แตะ auth flow ตรง ๆ (login/Google login) — ต้องตรวจให้แน่ใจว่า field ที่คืนจาก
`getUserById()` (ที่ query สุดท้ายให้) กับ response shape ที่ประกอบเองจาก doc ที่ populate ไว้ตรงกันทุก field
ก่อนเปลี่ยน เสี่ยงถ้าพลาด field ใน response `POST /api/auth/login`/`POST /api/auth/google`

---

## 5. 🟡 `orderService.persistOrder`/`updateOrderStatus` เรียก `getOrderById` ซ้ำ — ยังไม่ทำ

`persistOrder()` สร้าง `order` + `itemsPayload` ในหน่วยความจำแล้ว `return getOrderById(String(order._id))`
ซึ่ง query `orderModel.findOne().populate()` + `orderItemModel.find()` ใหม่ทั้งที่ข้อมูลมีอยู่แล้ว —
`updateOrderStatus()` ทำแบบเดียวกันหลัง `order.save()` — เป็น hot path (ทุกครั้งที่สร้าง/เปลี่ยนสถานะออเดอร์)

**ทำไมยังไม่แก้:** ต้อง populate แค่ `user_id` บน doc ในหน่วยความจำ (`order.populate("user_id", ...)`) แล้ว
ประกอบ response จาก `itemsPayload`/items ที่เพิ่ง insert เอง — เสี่ยงถ้า `getOrderById()` มี transform/field
เพิ่มเติมที่ไม่เห็นชัดจากชื่อฟังก์ชัน (เช่น presenter แปลงหน่วยเงิน) ต้องไล่ตรวจให้ครบก่อนตัด query ออก

---

## 6. 🟡 `cartService.resolveOptions` vs `orderService.resolveLines` validate option ซ้ำ — ยังไม่ทำ

`cartService.ts:116-157` (`resolveOptions`) และ `orderService.ts:167-243` (`resolveLines`) ต่างตรวจ
selected options กับ `productOptionModel` ด้วยเงื่อนไขเดียวกัน (`is_text_input`/`max_text_length`) และ
ข้อความ error ภาษาไทยที่เกือบเหมือนกัน — ความเสี่ยง: แก้กฎที่จุดเดียว (เช่น เพิ่ม option type ใหม่ หรือแก้
ขอบเขต `max_text_length`) แล้วอีกจุดไม่ตรงกัน ทำให้ตะกร้ากับ checkout validate ไม่เหมือนกัน

**ทำไมยังไม่แก้:** ควรย้ายไปเป็นฟังก์ชันกลางใน `productOptionService.ts` (เจ้าของ domain) ให้ทั้งสองจุด
เรียก — เป็นงานปานกลางที่ต้องไล่เทียบ error message เดิมทุกคำให้ตรงกันก่อนรวม (มีเทสอิง error message อยู่
ทั้งสองฝั่ง)

---

## 7. 🟡 `permissionService.getEffectivePermissions()` ไม่มี cache — ยังไม่ทำ (เสี่ยงสูง)

`src/lib/authGuard.ts:40` เรียก `getEffectivePermissions(session.role_id)` ใน `requirePermission()` ซึ่ง
`withPermission()` ห่อ**เกือบทุก** admin route ที่เขียนข้อมูล — ทุก request แบบนี้มี `permissionModel.find()`
round trip เพิ่ม 1 ครั้งเสมอ — `deliveryZoneService.ts:37-62` มี TTL cache pattern (invalidate ทันทีตอนแก้)
อยู่แล้วสำหรับ path ที่เรียกน้อยกว่านี้มาก น่าจะเอามาใช้ตรงนี้ได้

**ทำไมยังไม่แก้ตอนนี้ (เสี่ยงสูงกว่าข้ออื่น):** เป็น auth/permission hot path โดยตรง — ถ้า cache
invalidation พลาดแม้แต่จุดเดียว (เช่น ถอนสิทธิ์ผ่าน `PATCH /admin/permissions/[id]` แล้ว cache ไม่ invalidate)
จะกลายเป็นช่องโหว่ความปลอดภัย (ผู้ใช้ที่ถูกถอนสิทธิ์ไปแล้วยังใช้สิทธิ์เดิมได้ต่อจนกว่า cache หมดอายุ) —
ต่างจาก `deliveryZoneService` ที่ cache ผิดแค่ทำให้ค่าส่งคำนวณผิดชั่วคราว ไม่ใช่ security-sensitive ระดับ
เดียวกัน ควรคุยเรื่อง TTL/invalidation strategy ให้ชัดก่อนลงมือ

---

## 8. 🟡 `crudService.ts` ไม่มี "present" transform hook — ยังไม่ทำ (งานใหญ่)

7 service (`ingredientService`, `componentService`, `recipeService`, `expenseService`,
`productVariantService`, `productOptionService`, `deliveryZoneService`) ต้องเขียน wrapper ครบ 6 method
(list/getById/create/update/remove/restore) เองซ้ำ ๆ เพียงเพื่อแปลงผลลัพธ์ผ่าน `presentX()` (ส่วนใหญ่คือ
`toBahtFields`) — รวมโค้ดซ้ำ 100+ บรรทัดทั่วระบบ

**ทำไมยังไม่แก้:** ต้องเพิ่ม `present?: (doc) => doc` ใน `CrudOptions` + แก้ `createCrudService()` ให้เรียก
ผ่านทุก method แล้วไล่ migrate ทีละ 7 service (แต่ละตัวมี wrapper/override เพิ่มเติมที่ไม่เหมือนกัน เช่น
`ingredientService` มี custom `createFields`/`updateFields` แยกกันอยู่แล้ว) — งานใหญ่ระดับ "รอบ" ไม่ใช่งานแก้
จุดเดียว ควรแยกเป็นงานของตัวเอง (เหมือนที่ §3.1 zod-adopt เคยทำทีละกลุ่ม)

---

## 9. 🟡 soft-delete/restore pattern ใน `crudService` ถูกก็อปมือใน 5+ service — ยังไม่ทำ (งานใหญ่)

`crudService.ts:143-179` implement remove/restore เป็น `findOneAndUpdate({_id, deleted_at:
null/{$ne:null}}, {$set:{deleted_at: ...}})` + `notFound` guard — service ที่ต้องมี side-effect เพิ่ม
(`userService`, `permissionService`, `promotionService`, `preorderRoundService`, `productService`) แต่ละตัว
copy โครงนี้มือทั้งดุ้นแล้วแปะ side-effect เข้าไป (เช่น `userService` เพิ่ม toggle `is_active`)

**ทำไมยังไม่แก้:** ควร export `softDeleteDoc`/`restoreDoc(model, id, {notFoundMsg, extraSet?})` จาก
`crudService.ts` ให้ทั้ง internal ของ factory เองและ 5 service นี้เรียกร่วมกัน — ต้องออกแบบ signature ให้
รองรับ side-effect ที่ต่างกันของแต่ละ service (ไม่ใช่แค่ `extraSet` ธรรมดา บางตัวมี logic เงื่อนไขก่อน/หลัง
delete เช่น เช็ค reference count) — งานใหญ่ ควรแยกทำเป็นรอบเดียวกับ §8

---

## 10. 🟡 `orderService`/`preorderService` state-machine/cancel/delivery ซ้ำ ~350 บรรทัด — ยังไม่ทำ (ใหญ่สุด เสี่ยงสุด)

`orderService.ts` (`updateOrderStatus`/`cancelOrder`/`updateDelivery`, บรรทัด ~601-757) กับ
`preorderService.ts` (ฟังก์ชันคู่ขนาน บรรทัด ~364-526) มี `NEXT_STATUS` shape เดียวกัน, Saga-based cancel
cleanup + dynamic-import auto-refund block เดียวกัน, และ shipped/delivered timestamp defaulting logic
เดียวกัน — คอมเมนต์ในโค้ดเอง (ใกล้บรรทัด 499 ของ `preorderService.ts`) ก็ยืนยันว่าเคยต้อง backfill
`preorderService` ให้ตรงกับ `orderService` มาแล้วรอบหนึ่ง (คือที่มาของ [BACKLOG2.md §4](BACKLOG2.md) และ
[BACKLOG.md §2b](BACKLOG.md))

**ทำไมยังไม่แก้ (ใหญ่สุด เสี่ยงสุดในทั้ง 10 ข้อ):** ต้อง extract shared helper (เช่น `orderLifecycle(model,
opts)`) ที่ใช้ร่วมกันได้ทั้งสองโดเมนที่มี field ไม่เหมือนกัน 100% (order มี field บางตัวที่ preorder ไม่มี
และกลับกัน) — แตะ core money-moving flow ของทั้งออเดอร์ปกติและพรีออเดอร์พร้อมกัน ถ้าพลาดกระทบทั้งสองระบบ
พร้อมกัน ควรทำเป็นงานแยกที่มี integration test ครอบคลุมก่อน-หลังให้ครบทุก branch ของ state machine ทั้งคู่
ก่อนลงมือจริง — **ไม่ใช่เป้าหมายที่จะทำในรอบ "clean code เสี่ยงต่ำ" นี้**
