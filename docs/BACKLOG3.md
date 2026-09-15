# MeowMeeCake Backend — BACKLOG 3: Clean code (reuse / simplification / efficiency)

> สร้าง: 2026-09-15 · อัปเดตล่าสุด: 2026-09-15
> ขอบเขต: `src/services/` + `src/lib/` เท่านั้น (ตามที่ผู้ใช้เลือก) — **ไม่ใช่บั๊ก** ทุกข้อผ่านการตรวจสอบ
> ความถูกต้องมาแล้วอย่างละเอียดใน [`BACKLOG.md`](BACKLOG.md)/[`BACKLOG2.md`](BACKLOG2.md) — เอกสารนี้คุม
> เฉพาะงาน "โค้ดซ้ำ/เขียนได้กระชับกว่า/มี query เกินจำเป็น" ที่พบจาก `/code-review` (2026-09-15)
> **สถานะ: ครบทั้ง 10/10 ข้อแล้ว** (2026-09-15) — รวมกลุ่มเสี่ยงสูง/งานใหญ่ทั้งหมด

## สถานะโดยรวม

| ชั้น | สถานะ |
|---|---|
| **§1 `round2()` ปัดบาท ซ้ำ 4 ไฟล์** | ✅ **แก้แล้ว** — ย้ายมาไว้ที่ `src/lib/money.ts` ที่เดียว |
| **§2 ตัวสร้างเลขที่เอกสาร (order/preorder/production) ซ้ำ 3 จุด** | ✅ **แก้แล้ว** — รวมเป็น `generateDocNo()` ใน `src/lib/productCode.ts` |
| **§3 `productService.ts` ไม่ใช้ shared helper (`assertObjectId`/`escapeRegExp`/pagination)** | ✅ **แก้แล้ว** — เปลี่ยนมาใช้ `src/lib/objectId.ts` + `src/lib/queryParams.ts` เหมือน service อื่นทุกตัว |
| **§4 `authService.login()`/`loginWithGoogle()` fetch user ซ้ำ 3 รอบ** | ✅ **แก้แล้ว** — populate role + sync ค่าที่ update ในหน่วยความจำ ตัดการ query ซ้ำทั้งคู่ |
| **§5 `orderService.persistOrder`/`updateOrderStatus` เรียก `getOrderById` ซ้ำหลัง save** | ✅ **แก้แล้ว** — `presentOrderWithItems()` populate document ที่มีอยู่แล้วแทน re-query |
| **§6 `cartService.resolveOptions` vs `orderService.resolveLines` validate option ซ้ำ** | ✅ **แก้แล้ว** — รวมเป็น `productOptionService.resolveSelectedOptions()` |
| **§7 `permissionService.getEffectivePermissions()` ไม่มี cache** | ✅ **แก้แล้ว** — TTL cache keyed ด้วย role_id + invalidate ทุกจุดที่เขียน permission |
| **§8 `crudService.ts` ไม่มี "present" transform hook** | ✅ **แก้แล้ว** — เพิ่ม hook + migrate 7 service (deliveryZone/productOption/productVariant/expense/ingredient/component/recipe) |
| **§9 soft-delete/restore pattern ใน `crudService` ถูกก็อปมือใน 5+ service** | ✅ **แก้แล้ว** — `softDeleteDoc()`/`restoreDoc()` ใน `crudService.ts` + migrate user/promotion/product/permission/preorderRound(restore only) |
| **§10 `orderService`/`preorderService` state-machine/cancel/delivery ซ้ำ ~350 บรรทัด** | ✅ **แก้แล้ว** — `src/lib/orderLifecycle.ts` ใหม่ (auto-refund/cancel-guard/payment-status/delivery/soft-delete) — state machine หลักยังแยกเขียนเองตามโดเมนตั้งใจ |

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

## 3. ✅ `productService.ts` ไม่ใช้ shared helper — แก้แล้ว (2026-09-15)

**พบ:** `productService.ts` เป็น service เดียวที่ reimplement `assertObjectId` เอง (ซ้ำกับ
`src/lib/objectId.ts`), `escapeRegExp` เอง (ซ้ำกับ `src/lib/queryParams.ts` ไบต์ต่อไบต์), และ
`getProducts()` คำนวณ page/limit/skip + meta object (`{page, limit, total, totalPages, hasNextPage,
hasPrevPage}`) เองแทนเรียก `parsePagination`/`buildMeta` ที่ service อื่นทุกตัวใช้

**ยืนยันก่อนแก้ว่าปลอดภัย:**
- `assertObjectId` ในไฟล์ throw `new ProductError(msg, 400)` (code `"BAD_REQUEST"`) — เทียบกับของกลาง
  `src/lib/objectId.ts` ที่ throw `badRequest(msg)` (`new HttpError(msg, 400, "BAD_REQUEST")`) — **response
  shape เหมือนกันเป๊ะ** (`{status:400, code:"BAD_REQUEST", message}`) ต่างแค่ `err.name`
  (`"ProductError"` vs `"HttpError"`) ซึ่งไม่เคยถูกใช้ใน `apiResponse.ts` เลย (grep แล้วไม่มี `.name`
  ที่ไหนในไฟล์นั้น) และไม่มี `instanceof ProductError` check อยู่ที่ไหนในระบบเลยสักจุด (grep ทั้ง
  `src/`) — สลับได้โดยไม่กระทบ response ที่ client เห็น
- `escapeRegExp` ในไฟล์กับของกลางเป็นโค้ดเดียวกันไบต์ต่อไบต์อยู่แล้ว
- `parsePagination(sp, defaultLimit=20, maxLimit=100)` ของกลาง มี default เดียวกับที่
  `productService.ts` hardcode ไว้เป๊ะ (`limit` เริ่มต้น 20, สูงสุด 100) — เป็น drop-in replacement จริง
  ไม่มี edge case ต่างกัน

**วิธีแก้ที่ใช้จริง:** ลบ `assertObjectId`/`escapeRegExp` เวอร์ชัน private ออก import จาก
`src/lib/objectId.ts`/`src/lib/queryParams.ts` แทน · `ListProductQuery.page?`/`limit?` เปลี่ยนเป็น
`pagination: Pagination` (ให้ตรงกับ `*Query` interface ของทุก service อื่นในระบบ เช่น
`ListOrderQuery`/`ListPreorderQuery`) · `getProducts()` ใช้ `query.pagination.skip/limit` +
`buildMeta(total, query.pagination)` แทนของที่คำนวณเอง · 2 route ที่เรียก (`GET /api/catalog/products`,
`GET /api/admin/products`) เปลี่ยนมาสร้าง `pagination: parsePagination(sp)` แทนแกะ `page`/`limit` จาก
`URLSearchParams` เอง

**ตั้งใจไม่แตะ:** `sortBy`/`sortOrder` — `queryParams.ts` มี `parseSort(sp, allowed, fallback)` แต่ต้องส่ง
allowlist ของ field ที่ยอมให้ sort ได้ ขณะที่ `productService.getProducts()` ปัจจุบันรับ `sortBy` เป็น
field name อะไรก็ได้ไม่เช็ค allowlist — สลับไปใช้ `parseSort` จะ**เปลี่ยนพฤติกรรม** (reject sortBy บาง
ค่าที่ตอนนี้ผ่าน) ไม่ใช่ dedup ล้วน ๆ เหมือน 3 จุดข้างบน จึงไม่แตะในรอบนี้

**ไฟล์ที่แก้:** `src/services/productService.ts`, `src/app/api/catalog/products/route.ts`,
`src/app/api/admin/products/route.ts`, `tests/integration/{productPricingMoney,recipeCostMoney}.test.ts`
(2 จุดเรียก `getProducts({ limit: 100 })` เดิม ปรับเป็น `{ pagination: { page:1, limit:100, skip:0 } }`)

ยืนยันด้วย `typecheck`/`typecheck:test`/`lint`(0 error, 4 warning ไม่เปลี่ยน)/`test`(185)/
`test:integration`(141, ผ่านหมดรวม 2 เทสที่แก้ไป)/`build` ผ่านหมด

---

## 4. ✅ `authService.login()`/`loginWithGoogle()` fetch user ซ้ำ 3 รอบ — แก้แล้ว (2026-09-15)

**พบ:** `userService.verifyCredentials` ไม่ populate `role_id` → `authService.issue()`→`toSessionUser()`
query `roleModel.findById` แยกอีกรอบ → `login()` เรียก `userService.getUserById()` อีกรอบสุดท้าย — รวม 3
query ต่อการ login 1 ครั้ง · `loginWithGoogle` มี pattern เดียวกัน (findOne ไม่ populate → toSessionUser
query role แยก → getUserById ท้ายสุด) บวกอีกจุด: กรณีผูก googleId ให้ user เดิมครั้งแรก `updateOne` เขียน
DB แล้วแต่ตัวแปร `user` ในหน่วยความจำไม่ sync ตาม — เดิมกลบปัญหานี้ไว้ด้วยการ query `getUserById()` สดท้าย
สุดอยู่แล้ว (ซึ่งเป็นเหตุผลจริงที่ query ที่ 3 มีอยู่ ไม่ใช่แค่ซ้ำเฉย ๆ)

**วิธีแก้ที่ใช้จริง:**
- `userService.verifyCredentials()` เพิ่ม `.populate("role_id", "role_name role_type")` ในการ query user
  + sync `failed_login_attempts`/`lockout_until`/`last_login_at` ลง doc ในหน่วยความจำหลัง `updateOne`
  (เดิม update DB อย่างเดียว ไม่ sync กลับ — ถ้าตัดการ query ซ้ำท้ายสุดออกโดยไม่ sync ตรงนี้ response จะ
  ได้ค่าค้างก่อน login เช่น `failed_login_attempts` เก่า) — export `stripSecrets()` ให้ `authService`
  เรียกใช้ร่วมได้ (เดิม private เฉพาะไฟล์)
- `authService.login()` คืน `user` ที่ได้จาก `verifyCredentials()` ตรง ๆ (populate + sync ครบแล้ว) ตัดการ
  เรียก `getUserById()` ท้ายสุดทิ้ง
- `authService.loginWithGoogle()` — เพิ่ม populate ในการ query `userModel.findOne()` เริ่มต้น, sync
  `googleId`/`is_email_verified` ลงหน่วยความจำหลัง `updateOne` (จุดที่เคยพึ่ง query ซ้ำท้ายสุดบังตาไว้),
  `stripSecrets()` เอง (query ตรงผ่าน `userModel` ไม่ผ่าน `userService` เลยไม่เคยถูก strip มาก่อน), และ
  branch "ผู้ใช้ใหม่" (`userService.createUser`) ผูก `role_id` ด้วย `{_id, role_name, role_type}` ที่มีอยู่
  แล้วจากการ query หา role `"customer"` ก่อนหน้า (narrow เฉพาะ 3 field ให้ shape ตรงกับที่ populate ข้าง
  บนจะให้ ไม่หลุด field อื่นของ role เช่น `is_active`/timestamps เข้ามา) — ตัด `getUserById()` ท้ายสุดทิ้ง
  ทั้ง 2 branch

**เทสใหม่:** `tests/integration/authLogin.test.ts` (6 เคส) — ยืนยันทั้ง `login()` และ `loginWithGoogle()`
คืน `role_id` populate ครบ, ไม่มี secret field รั่ว (`password`/`*_token`/`*_token_expiry`), และที่สำคัญ
ที่สุด **ค่าที่เพิ่ง update สดจริงในหน่วยความจำ ไม่ใช่ค่าค้างก่อน update** (`failed_login_attempts`→0,
`last_login_at` ตั้งค่าแล้ว, `googleId`/`is_email_verified` เป็นค่าใหม่หลังผูกบัญชี) — เทียบกับ DB จริง
ด้วยทุกเคสไม่ใช่เชื่อแค่ object ในหน่วยความจำ · mock `jose.jwtVerify` กัน `loginWithGoogle` ยิง network จริง
ไปหา Google JWKS ตอนเทส (`vi.mock("jose", ...)`) · เพิ่ม `JWT_SECRET` (ค่าเทสเท่านั้น ไม่ใช่ค่าจริง) เข้า
`env` ของ vitest integration project ใน `vitest.config.mts` เพราะ `src/lib/jwt.ts` throw ตั้งแต่ตอน
import module ถ้าไม่ตั้ง — เป็นเทส integration ไฟล์แรกที่ import `authService`

ยืนยันด้วย `typecheck`/`typecheck:test`/`lint`(0 error, 4 warning ไม่เปลี่ยน)/`test`(185)/
`test:integration`(141→**147**, +6)/`build` ผ่านหมด

---

## 5. ✅ `orderService.persistOrder`/`updateOrderStatus` เรียก `getOrderById` ซ้ำ — แก้แล้ว

**พบ:** `persistOrder()` สร้าง `order` + `itemsPayload` ในหน่วยความจำแล้ว
`return getOrderById(String(order._id))` ซึ่ง query `orderModel.findOne().populate()` +
`orderItemModel.find()` ใหม่ทั้งที่ข้อมูลมีอยู่แล้ว — `updateOrderStatus()` ทำแบบเดียวกันหลัง
`order.save()` — เป็น hot path (ทุกครั้งที่สร้าง/เปลี่ยนสถานะออเดอร์)

**วิธีแก้ที่ใช้จริง:** เพิ่ม `presentOrderWithItems(order, items?)` — `await order.populate("user_id",
...)` บน document ที่มีอยู่แล้วตรง ๆ (`Document#populate()` ต่างจาก `getOrderById` ที่ populate ผ่าน
query builder เพราะเริ่มจากแค่ id ไม่มี document อยู่ในมือ) รับ `items` ที่มีอยู่แล้วได้ (เลี่ยง query ซ้ำ)
- `persistOrder()` — จับผลลัพธ์จาก `orderItemModel.insertMany()` (เดิมไม่เก็บค่าที่คืนเลย) ส่งเข้า
  helper ตรง ๆ แทนการ re-fetch — **ตัด query ได้ทั้ง header และ items**
- `updateOrderStatus()` — สาขา "สถานะเดิมอยู่แล้ว" (`current === next`) กับหลัง `order.save()` ใช้
  helper ทั้งคู่ · สาขา `cancelled` มี items อยู่ในมือแล้วจากตอนคำนวณ `stockItems` — ส่งต่อเข้า helper
  แทน re-fetch เช่นกัน

ยืนยันด้วย `typecheck`/`typecheck:test`/`lint`(0 error)/`test`(185)/`test:integration`(147, เทสเดิมของ
`persistOrder`/`cancelOrder`/`updateOrderStatus` ผ่านหมดโดยไม่ต้องแก้)/`build` ผ่านหมด (รายละเอียดเต็ม +
ฟังก์ชันที่เกี่ยวข้องกับ preorder ด้วย → §10 ด้านล่าง ที่ทำต่อพร้อมกัน)

---

## 6. ✅ `cartService.resolveOptions` vs `orderService.resolveLines` validate option ซ้ำ — แก้แล้ว

**พบ:** `cartService.resolveOptions` และ `orderService.resolveLines` ต่างตรวจ selected options กับ
`productOptionModel` ด้วยเงื่อนไขเดียวกัน (`is_text_input`/`max_text_length`) และข้อความ error ภาษาไทยที่
เกือบเหมือนกัน — ความเสี่ยง: แก้กฎที่จุดเดียวแล้วอีกจุดไม่ตรงกัน ทำให้ตะกร้ากับ checkout validate ไม่เหมือน
กัน

**วิธีแก้ที่ใช้จริง:** เพิ่ม `productOptionService.resolveSelectedOptions(productId, selected,
optionById)` — **รับ `optionById` เป็น Map ที่ผู้เรียกเตรียมมาเอง ไม่ query เอง** เพราะ
`orderService.resolveLines()` ต้อง batch query option ของทุกรายการในออเดอร์พร้อมกันครั้งเดียว (BACKLOG
§3.18 กัน N+1) — ถ้าฟังก์ชันนี้ query เองต่อ 1 เรียก จะทำให้ `resolveLines()` กลับไปเป็น N+1 ทันที ·
`cartService.resolveOptions()` ยัง query เองแบบเดิม (เพิ่ม/แก้ทีละ 1 รายการ ไม่มีอะไรให้ batch) แล้วสร้าง
Map เล็ก ๆ ส่งเข้ามา

ยืนยันด้วย `typecheck`/`typecheck:test`/`lint`(0 error)/`test`(185)/`test:integration`(147, เทส option
validation ทั้งฝั่ง cart และ order ผ่านหมด รวมเทส N+1 count ของ §3.18)/`build` ผ่านหมด

---

## 7. ✅ `permissionService.getEffectivePermissions()` ไม่มี cache — แก้แล้ว

**พบ:** `src/lib/authGuard.ts` เรียก `getEffectivePermissions(session.role_id)` ใน `requirePermission()`
ซึ่ง `withPermission()` ห่อเกือบทุก admin route ที่เขียนข้อมูล — ทุก request มี `permissionModel.find()`
round trip เพิ่ม 1 ครั้งเสมอ

**วิธีแก้ที่ใช้จริง:** TTL cache keyed ด้วย `role_id` (`Map<string, {data, expiresAt}>`) แบบเดียวกับ
`deliveryZoneService.ts` แต่ต่าง 2 จุดเพราะเป็น access-control ไม่ใช่แค่ตัวเลขค่าส่ง: TTL สั้นกว่า (30s
ไม่ใช่ 60s) และ **invalidate ทั้ง cache แบบไม่เจาะจง role** ทุกจุดที่เขียน permission
(create/update/delete/restore) — เขียนไม่บ่อยเท่าอ่าน ล้างทั้งหมดไม่แพงและปลอดภัยกว่าต้อง track ว่า write
ไหนกระทบ role ไหน · เพิ่ม `PERMISSION_CACHE_TTL_MS` env (default 30000, `0` ปิด cache ได้เหมือน
`DELIVERY_ZONE_CACHE_TTL_MS`)

**ข้อยอมรับที่บันทึกไว้:** permission ที่ตั้ง `expires_at` ไว้อาจถูกนับว่า "ใช้ได้" เกินเวลาจริงไปได้สูงสุด
TTL (ผลลัพธ์ query ถูก bake ตอน cache-write ไม่ได้ประเมิน `expires_at` ใหม่ทุกครั้งที่อ่านจาก cache) —
ยอมรับได้เพราะ TTL สั้นและเป็นเคสที่พบไม่บ่อย ต่างจากการถอนสิทธิ์ผ่านแอดมินโดยตรงที่ invalidate ทันทีเสมอ
ไม่มี grace period เลย

**เทสใหม่:** `tests/integration/permissionCache.test.ts` (6 เคส) — เป็นไฟล์เดียวที่ตั้งใจเปิด TTL จริง
(dynamic import หลัง override `PERMISSION_CACHE_TTL_MS` เพราะ module อ่าน env ตอน load ครั้งแรก) พิสูจน์
ว่า cache ทำงานจริง (เขียนตรงผ่าน model ข้าม service แล้ว query ซ้ำยังเห็นค่าเก่าค้าง) + ทั้ง 4 write path
invalidate ทันที + cache แยกกันตาม role_id · เพิ่ม `PERMISSION_CACHE_TTL_MS: "0"` ใน
`vitest.config.mts`'s integration env กันไฟล์อื่นเห็น state ค้างข้ามเทส

ยืนยันด้วย `typecheck`/`typecheck:test`/`lint`(0 error)/`test`(185)/`test:integration`(147→**153**,
+6)/`build` ผ่านหมด

---

## 8. ✅ `crudService.ts` ไม่มี "present" transform hook — แก้แล้ว

**พบ:** 7 service (`ingredientService`, `componentService`, `recipeService`, `expenseService`,
`productVariantService`, `productOptionService`, `deliveryZoneService`) เขียน wrapper ครบ 6 method
(list/getById/create/update/remove/restore) เองซ้ำ ๆ เพียงเพื่อแปลงผลลัพธ์ผ่าน `presentX()` (ส่วนใหญ่คือ
`toBahtFields`) — รวมโค้ดซ้ำ 100+ บรรทัดทั่วระบบ

**วิธีแก้ที่ใช้จริง:** เพิ่ม `present?: (doc: Doc) => Doc` ใน `CrudOptions` — `createCrudService()` เรียก
ผ่านทุกจุดที่ return (list/getById/create/update/remove/restore) — migrate ทั้ง 7 service: ตัด
list/getById/remove/restore override ทิ้งทั้งหมด (ไม่มีอะไรให้ override ต่อแล้วเมื่อ base present ให้
เอง) เหลือแค่ `create`/`update` ที่ยังต้อง override ต่อเมื่อมี validation เพิ่มหรือแปลงหน่วยเงิน
input-side (บาท→สตางค์ ซึ่ง `present` ไม่ยุ่งด้วย เพราะ present แปลงแค่ตอน "คืนค่า") ·
`componentService`/`recipeService`'s `create()` เรียก model ตรง ๆ ไม่ผ่าน `base.create()` (inject
`created_by` นอก `createFields` whitelist) เลยยังต้อง `presentX()` เองต่อไปที่จุดนั้นจุดเดียว

ผล: net **-72 บรรทัด** รวม 8 ไฟล์ · ยืนยันด้วย `typecheck`/`typecheck:test`/`lint`(0 error)/`test`(185)/
`test:integration`(153, ครอบ CRUD response shape ของทั้ง 7 service)/`build` ผ่านหมด

---

## 9. ✅ soft-delete/restore pattern ใน `crudService` ถูกก็อปมือใน 5+ service — แก้แล้ว

**พบ:** `crudService.ts` internal `remove()`/`restore()` implement เป็น `findOneAndUpdate({_id,
deleted_at: null/{$ne:null}}, {$set:{deleted_at: ...}})` + `notFound` guard แต่เข้าถึงได้แค่ผ่าน full
factory — 5 service ที่ใช้ factory เต็มไม่ได้ (ต้องมี pre-check/cascade/extra field/cache invalidation
รอบ ๆ) copy shape เดียวกันนี้มือทั้งดุ้น

**วิธีแก้ที่ใช้จริง:** เพิ่ม `softDeleteDoc(model, id, {notFoundMsg, extraSet?})` + `restoreDoc(...)` ใน
`crudService.ts` — migrate:
- `promotionService`/`productService` — swap ตรง ๆ (ยืนยันแล้วว่า `ProductError(msg,404)` เดิมกับ
  `notFound(msg)` ของ primitive คืน response shape เดียวกันเป๊ะ — {status:404, code:"NOT_FOUND"})
- `userService` — ส่ง `extraSet` toggle `is_active` ด้วย + strip secrets เองใน JS ด้วย `stripSecrets()`
  (เดิมใช้ `.select()` projection ระดับ DB ซึ่ง primitive ไม่รองรับ)
- `permissionService` — ยังคง `invalidatePermissionCache()` รอบ ๆ + try/catch แปลง duplicate-key
  เป็น 409 สำหรับ restore (ตัว primitive เองไม่รู้เรื่อง cache/duplicate-key เลย)
- `preorderRoundService` — migrate แค่ `restoreRound()` · `deleteRound()` ยังเขียนเองต่อไป (มี pre-check
  กันลบรอบที่มีพรีออเดอร์ค้าง + cascade ที่ไม่เข้ากับ primitive ง่าย ๆ)

ยืนยันด้วย `typecheck`/`typecheck:test`/`lint`(0 error)/`test`(185)/`test:integration`(153, ครอบ
delete/restore ทั้ง 5 service)/`build` ผ่านหมด

---

## 10. ✅ `orderService`/`preorderService` state-machine/cancel/delivery ซ้ำ ~350 บรรทัด — แก้แล้ว

**พบ:** `orderService.ts` (`updateOrderStatus`/`cancelOrder`/`setPaymentStatus`/`updateDelivery`/
`deleteOrder`) กับ `preorderService.ts` (ฟังก์ชันคู่ขนานทุกตัว) มี `NEXT_STATUS` shape เดียวกัน,
Saga-based cancel cleanup + dynamic-import auto-refund block เดียวกัน, allowedFrom cancel-guard
เดียวกัน, payment-status auto-confirm เดียวกัน, และ shipped/delivered timestamp defaulting logic
เดียวกัน — คอมเมนต์ในโค้ดเองก็ยืนยันว่าเคยต้อง backfill `preorderService` ให้ตรงกับ `orderService` มาแล้ว
หลายรอบ (ที่มาของ [BACKLOG.md §2b](BACKLOG.md) และ [BACKLOG2.md §4](BACKLOG2.md))

**วิธีแก้ที่ใช้จริง:** สร้าง `src/lib/orderLifecycle.ts` ใหม่ รวมเฉพาะส่วนที่เหมือนกันเป๊ะจริง ๆ:
- `registerAutoRefundOnCancel()` — auto-refund เมื่อยกเลิกเอนทิตีที่จ่ายเงินแล้ว (ลงทะเบียนเป็น Saga
  rollback step)
- `assertCustomerCancelAllowed()` — guard `allowedFrom` + `payment_status !== paid`
- `setEntityPaymentStatus()` — อัปเดต payment_status + auto-confirm `pending→confirmed`
- `applyEntityDeliveryUpdate()` — auto-set `shipped_at`/`delivered_at` + `$set` payload
- `softDeleteEntityWithItems()` — soft-delete + cascade child items เมื่อสถานะเป็น completed/cancelled

**ตั้งใจไม่รวม** ตัว `updateOrderStatus`/`updatePreorderStatus` เองเป็นฟังก์ชันเดียว — Saga cleanup ตอน
ยกเลิกต่างกันจริงตามโดเมน (order คืนสต็อกที่ตัดไปแล้ว + revoke การใช้โปรโมชัน, preorder คืนโควตาต่อ
รายการที่จองไว้ในรอบ) การยุบรวมเป็นฟังก์ชัน parameterized เดียวจะแลก duplication เล็กน้อยกับ branching
complexity ที่มากขึ้นในโค้ดที่เคลื่อนเงินจริง — ทั้งสองฟังก์ชันยังคงเขียน `Saga.onRollback()` ของตัวเองสำหรับ
ส่วนที่ต่างกัน แค่เรียก `registerAutoRefundOnCancel()` ร่วมกันสำหรับส่วนที่เหมือนกัน

**บั๊กเล็กที่เจอระหว่างทำ (แก้ไปด้วย):** `setPaymentStatus` เดิมทั้งสองฝั่งคืน `order_status` ค้างเป็น
`"pending"` หลัง auto-confirm `updateOne` เขียน `"confirmed"` ไปแล้ว (ไม่ sync กลับ) — ไม่เคยกระทบอะไรจริง
เพราะ `paymentService.propagateStatus` ไม่ได้ใช้ค่าที่คืนกลับมาเลย แต่ `setEntityPaymentStatus()` แก้ให้
sync ถูกไว้กันงงในอนาคต

**bonus:** `preorderService` ได้ optimization แบบเดียวกับ §5 ไปด้วย (`presentPreorderWithItems()` เทียบ
`presentOrderWithItems()`) เพราะมี `getPreorderById()` re-query แบบเดียวกันที่ไม่เคยถูกแก้มาก่อน

**เทสที่กระทบ:** `tests/integration/preorderDelivery.test.ts` ต้องปรับ type-only (return type ของ
`updateDelivery()` เข้มขึ้นจาก implicit `any` เป็น `Record<string, unknown> | null` — เทสเปลี่ยนมาใช้
local type cast แทนการ access property ที่ไม่มี type)

ยืนยันด้วย `typecheck`/`typecheck:test`/`lint`(0 error)/`test`(185)/`test:integration`(153, ครอบ
cancel/refund/payment/delivery/delete ทั้งสอง service)/`build` ผ่านหมด
