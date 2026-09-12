# แผน รอบ 4b — จบ §3.1 (zod tail) + §3.6 (no-explicit-any บน src/lib)

> อัปเดตล่าสุด: 2026-09-12
> สถานะ: ✅ **เสร็จสมบูรณ์ทั้ง 3 ข้อ (A, B รวม B2, C)** — บน `addModels` แล้ว
> (PR #20 merge ข้อ A+C+B core · branch `hardening-4b-pick-cleanup-b2` ปิด B2)
> ที่มา: [`BACKLOG.md`](BACKLOG.md) §3 "ลำดับการแก้ที่เหลือ" รอบ 4b · ต่อจาก [`hardening-4a-plan.md`](hardening-4a-plan.md) §"ยกไปรอบ 4b"

รอบ 4b = 3 งานที่เหลือจาก 4a เรียงตาม**ลำดับพึ่งพา** (ทำ A ก่อนเพราะ B ต้องมี schema ของ A
เป็นฐานให้ตัดสินใจว่า `pick()` ไหนตัดได้จริง):

```
A. adopt zod: /admin/orders + /admin/attendances   (M)
B. รื้อ pick() / createFields / pickWritable() (8 service)  (M)
C. no-explicit-any = error บน src/lib (4 ไฟล์ header + crudRoutes.ts)  (S–M)
```

**Prereq ที่ตรวจแล้ว (2026-09-12):**
- `npm run lint` = 0 error / 13 warning (`no-explicit-any` ใน `src/app/api/**/route.ts` × 12 + `crudRoutes.ts` × 1) — ตัวเลขเดิมจาก 4a ยังไม่เปลี่ยน
- `pick(` ใน `src/services/**` = **8 ไฟล์**: `addressService.ts`, `attendanceService.ts`, `orderService.ts`, `permissionService.ts`, `preorderRoundService.ts`, `preorderService.ts`, `promotionService.ts`, `userService.ts`
- ไฟล์ `src/lib/**` ที่มี `/* eslint-disable @typescript-eslint/no-explicit-any */` เหมาทั้งไฟล์ = **4 ไฟล์**: `bom.ts` (16 จุด `any`), `crudService.ts` (5 จุด), `discountEngine.ts` (3 จุด), `refs.ts` (3 จุด) — รวม **27 จุด**
- `crudRoutes.ts:85` มี `doc: any` ตัวเดียว (`eslint-disable-next-line`) ใน `logMutation()` — ใช้แค่ `doc?._id`
- `src/schemas/order.ts` มีคอมเมนต์เตรียมไว้แล้ว: `"validation ของ /api/shop/orders (+ ใช้ต่อกับ admin orders ภายหลัง)"` — ออกแบบมาให้ต่อยอดตรงนี้ได้เลย

---

## A. adopt zod: `/admin/orders` + `/admin/attendances` — **M** ✅ เสร็จแล้ว (2026-09-12)

### ผลจริง
- `src/schemas/order.ts`: แยก `orderBodyBase` (ไม่ผ่าน `.refine()`) ออกมาก่อน แล้วให้ `createOrderBody`
  (shop) กับ `adminCreateOrderBody` (admin, `.extend()` เพิ่ม `user_id`/`delivery_fee`/
  `discount_amount`/`channel`) ต่างคนต่าง `.refine()` เอง — ตามที่คาดไว้ใน prereq: zod v4 ไม่ให้
  `.extend()` schema ที่ผ่าน `.refine()` มาแล้ว (คืน type ที่ extend ไม่ได้) ลองใช้ generic helper
  ฟังก์ชันห่อ `.refine()` ก่อนแต่ TS อนุมาน field ในตัว callback เป็น `unknown` เพราะไม่รู้ shape —
  เปลี่ยนมาเขียน `.refine()` ซ้ำ 2 รอบตรง ๆ แทน (สั้นกว่าสู้กับ generic type)
- ยืนยันจากโค้ดจริงว่า **ไม่มี** `PATCH /admin/orders/[id]` (มีแค่ GET/DELETE) — 4a-plan เดิมเข้าใจผิด
  scope ตรงนี้ ข้อ A เลยมีแค่ POST
- `src/schemas/attendance.ts` (ใหม่) — 3 schema: `recordAttendanceBody` (POST), `updateAttendanceBody`
  (PATCH — มี `recorded_by` แก้ตรงได้ ต่างจาก POST ที่ inject จาก session เสมอ, พฤติกรรมเดิม),
  `checkInOutBody` (check-in/check-out — `user_id` optional)
- check-in/check-out เดิมใช้ `req.json().catch(() => ({}))` เพื่อให้ self check-in ไม่ต้องส่ง body
  ก็ได้ — เปลี่ยนไปใช้ `parseBody()` ตรง ๆ ไม่ได้ (จะ throw badRequest ถ้า body ว่างจริง ทำลาย UX เดิม)
  ใช้ `parse(await req.json().catch(() => ({})), schema)` (helper `parse()` จาก `validate.ts` ที่รับ
  ค่าที่ resolve แล้ว) แทน — คง fallback `{}` เดิมไว้ + ได้ validate `user_id` เป็น ObjectId ด้วย
- `admin/orders/route.ts`: ลบ `order: any` ออกได้ด้วย (TS อนุมาน union type จาก
  `createOrder`/`createOrderFromCart` เองพอ input เป็น typed แล้ว) — lint warning ลด 13 → 12
- เทส: `tests/lib/schemas.test.ts` (+4 สำหรับ `adminCreateOrderBody`) · `tests/lib/schemas-admin.test.ts`
  (+9 สำหรับ 3 schema ของ attendance) → unit **137/17**
- `typecheck` / `typecheck:test` / `lint` (0 error, 12 warning) / `test` (137/137) /
  `test:integration` (13/13) / `build` ผ่านหมด

### A1. `POST /api/admin/orders` (สร้างออเดอร์แทนลูกค้า)

route ปัจจุบัน (`src/app/api/admin/orders/route.ts`) ไม่ validate เลย — อ่าน `body` ดิบแล้วประกอบ
object ส่งเข้า service ตรง ๆ field ที่แอดมินมีแต่ลูกค้าไม่มี: `user_id` (บังคับ), `delivery_fee`
(override ได้), `channel`

**แนวทาง:** ขยาย `createOrderBody` (`src/schemas/order.ts`) เป็น schema ใหม่ `adminCreateOrderBody`
ที่ `.extend()` ทับของเดิม แทนที่จะก๊อปทั้งก้อน:
```ts
export const adminCreateOrderBody = createOrderBody.innerType().extend({
  user_id: objectId,
  delivery_fee: z.coerce.number().min(0).nullish(),
  channel: z.enum(["online", "instore"]).default("instore"),
}).refine(/* copy refine เดิม 2 ตัวจาก createOrderBody */);
```
⚠️ ต้องเช็คว่า `.extend()` ใช้กับ `ZodEffects` (ที่ผ่าน `.refine()` มาแล้ว) ได้ไหม — ถ้าไม่ได้ (zod v4
`.refine()` คืน `ZodEffects` ไม่ใช่ `ZodObject` แล้ว extend ตรง ๆ ไม่ได้) ให้แยก base object ออกมาเป็น
`orderBodyBase` ก่อน แล้วให้ทั้ง `createOrderBody` (shop) และ `adminCreateOrderBody` (admin) ต่างคน
ต่าง `.extend()` จาก base คนละทาง — ตรวจตอนเขียนจริง

`delivery_fee_override` (boolean) ไม่ต้องอยู่ใน schema — คำนวณจาก `data.delivery_fee != null` ที่ route
เหมือนเดิม (ไม่ใช่ input จาก client)

### A2. `PATCH /api/admin/orders/[id]` — **ยืนยันแล้วว่าไม่มี route นี้จริง**
(`src/app/api/admin/orders/[id]/route.ts` มีแค่ `GET`/`DELETE` — เปลี่ยนสถานะออเดอร์ทำผ่าน
`/admin/orders/[id]/status` คนละ route ต่างหาก, ไม่ได้อยู่ใน scope ของ item นี้) — **4a-plan เดิม
เขียนว่ามี "PATCH" ผิด** แก้ scope ตรงนี้ให้ถูก: ข้อ A มีแค่ POST เท่านั้น

### A3. `/admin/attendances` — 2 schema

```ts
// src/schemas/attendance.ts (ใหม่)
export const recordAttendanceBody = z.object({
  user_id: objectId,
  work_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'ต้องเป็นรูปแบบ "YYYY-MM-DD"'),
  status: z.enum([...ATTENDANCE_STATUSES]).optional(),
  note: z.string().max(1000).optional(),
  check_in_at: z.coerce.date().nullish(),
  check_out_at: z.coerce.date().nullish(),
});
export const updateAttendanceBody = recordAttendanceBody.omit({ user_id: true }).partial();
```
`recorded_by` **ไม่อยู่ใน schema** — inject จาก session ที่ route เหมือนเดิม (`createInject` ถ้าใช้
`crudRoutes`, หรือ merge มือถ้า custom route — `admin/attendances/route.ts` ไม่ได้ผ่าน `crudRoutes`
factory เพราะ auth logic พิเศษ (`user_id !== session.user_id` ต้องเช็ค permission เพิ่ม) เลยต้องเป็น
`parseBody` มือใน 2 ไฟล์: `route.ts` (POST) และ `[id]/route.ts` (PATCH)

`check-in`/`check-out` (2 ไฟล์) รับ body แค่ `{ user_id? }` — เพิ่ม schema เล็ก ๆ ได้เหมือนกันแต่ผลกระทบ
ต่ำ (ไม่ใช่ priority)

---

## B. รื้อ `pick()` / `createFields` / `pickWritable()` — **M** ✅ ปิดครบ 8/8 ไฟล์ (2026-09-12, B + B2)

**หลักการ:** หลัง route มี zod เป็นด่านแรกแล้ว (`.strip()` ทิ้ง field เกินอัตโนมัติ) service **ไม่ต้อง
whitelist ซ้ำ** ด้วย `pick()` อีกชั้น — แต่ต้องเช็ค**ทีละไฟล์**ว่า route ที่เรียก service นั้น adopt zod
ครบหรือยัง ก่อนถอด `pick()` ออก (ถอดก่อนแล้ว route ยังไม่ validate = เปิดช่อง mass-assignment กลับมา)

| ไฟล์ | route ที่เรียก | adopt zod แล้วหรือยัง | ผล |
|---|---|---|---|
| `addressService.ts` | `/shop/addresses` | ✅ (4a PR E) | ✅ **ถอดแล้ว** (รอบ B) |
| `promotionService.ts` | `/admin/promotions` | ✅ (ก่อน 4a) | ✅ **ถอดแล้ว** (รอบ B, + ลบเช็ค required/enum ซ้ำที่ zod ทำแทนแล้ว) |
| `attendanceService.ts` | `/admin/attendances*` (POST/PATCH/check-in/check-out) | ✅ (ข้อ A รอบนี้) | ✅ **ถอดแล้ว** (รอบ B, เฉพาะ `updateAttendance` — ฟังก์ชันเดียวที่มี `pick()`) |
| `orderService.ts` | ⚠️ `pick()` เดียวอยู่ใน `updateDelivery()` ซึ่งเรียกจาก `PATCH /admin/orders/[id]/delivery` **คนละ route** กับ `createOrder`/`createOrderFromCart` | ✅ adopt แล้ว (B2 — เพิ่ม `order.ts` `updateDeliveryBody`) | ✅ **ถอดแล้ว** (B2) |
| `permissionService.ts` | `/admin/permissions` + `[id]` | ✅ adopt แล้ว (B2 — เพิ่ม `rbac.ts` `permissionCreate`/`permissionUpdate`) | ✅ **ถอดแล้ว** (B2, ทั้ง `createPermission`/`updatePermission`) |
| `preorderRoundService.ts` | `/admin/preorder-rounds*` + `/admin/preorder-round-items/[id]` | ✅ adopt แล้ว (B2 — ไฟล์ใหม่ `preorderRound.ts` 4 schema) | ✅ **ถอดแล้ว** (B2, ทั้ง `updateRound`/`updateRoundItem`) |
| `preorderService.ts` | `/shop/preorders`, `/admin/preorders` (ยังไม่ adopt เต็มรูปแบบ — items/discount ซับซ้อน แยกเป็นงานใหญ่กว่านี้) | ❌ ยังไม่ adopt | ✅ **ถอดแล้ว** (B2) — **ข้อยกเว้นของกฎ:** `pick(addr, ADDRESS_FIELDS)` ตัวนี้ไม่ใช่ whitelist ที่ทับซ้อนกับ validation ชั้นไหน (แค่ narrow shape หลังเช็ค required field ครบแล้วในบรรทัดก่อนหน้า) เปลี่ยนเป็น `Object.fromEntries(ADDRESS_FIELDS.map(...))` ได้อย่างปลอดภัยโดยไม่ต้องรอ route adopt |
| `userService.ts` | `/admin/users` + `[id]` (create/update) · `/shop/me` (`updateProfile`, adopt แล้วตั้งแต่ 4a) | ✅ adopt แล้ว (B2 — เพิ่ม `user.ts` `createUserBody`/`updateUserBody`) | ✅ **ถอดแล้ว** (B2, ทั้ง `createUser`/`updateUser` — `updateProfile` ถอดไปแล้วในรอบ B) |

**บทเรียนจากรอบนี้:** "route adopt แล้วหรือยัง" ต้องเช็คเป็น**ต่อฟังก์ชัน**ไม่ใช่ต่อไฟล์ — `orderService.ts`
มีทั้งฟังก์ชันที่ route adopt แล้ว (`createOrder`) และยังไม่ adopt (`updateDelivery`) ปนกันในไฟล์เดียว
ตอนแรกเข้าใจผิดว่า "ไฟล์นี้ route adopt แล้ว" จนเกือบถอด `pick()` ผิดจุด — ต้อง grep `pick(` แล้วไล่ดูว่า
อยู่ในฟังก์ชันไหน เรียกจาก route ไหนจริง ๆ เสมอ · อีกบทเรียน: **ไม่ใช่ `pick()` ทุกจุดต้องรอ route adopt
zod ก่อน** — `preorderService.ts` เป็นตัวอย่างที่ `pick()` แค่ narrow shape หลังเช็ค required ผ่านแล้ว
ไม่ได้ทำหน้าที่กัน mass-assignment เลย ถอดได้ทันทีโดยไม่กระทบความปลอดภัย

### สรุป B2 — adopt zod เพิ่ม 5 กลุ่ม route (แผนเดิมเข้าใจผิดว่ามี 5 "ไฟล์" ต้องข้าม แต่จริง ๆ
ทำได้ทั้งหมดในรอบเดียวเมื่อลงมือ adopt route จริง — ไม่มีจุดไหนซับซ้อนเกินคาด):
- schema ใหม่: `preorderRound.ts` (ทั้งไฟล์) · เพิ่มใน `rbac.ts` (permission) และ `user.ts` (create/update user) · เพิ่มใน `order.ts` (`updateDeliveryBody`)
- เทสใหม่: 13 เคส กระจายใน `schemas.test.ts` (+2) และ `schemas-admin.test.ts` (+11) → unit **149/17**
- lint warning ลดจาก 11 (ตอนจบ A+C) → **5** (ทุกจุดที่เคย `const result: any = await service(...)` หายไปพร้อมกับที่ route มี type จริงจาก zod)

### วิธีถอด (ต่อไฟล์)
```ts
// เดิม
async function updateX(id: string, input: Record<string, any>) {
  const data = pick(input, ["field1", "field2", ...]);
  ...
}
// หลัง (route ส่ง typed object จาก z.infer<> มาแล้ว)
async function updateX(id: string, input: UpdateXBody) {
  ...  // ใช้ input ตรง ๆ ไม่ pick
}
```
ทำทีละไฟล์ + `npm run typecheck` ทันทีหลังทุกไฟล์ (type ที่หายไปจาก `Record<string, any>` จะฟ้อง
จุดที่ service เคย assume field ที่ไม่ได้ประกาศใน schema)

### `Number()` coercion
42 จุดจาก 4a-plan ส่วนใหญ่เป็นเลขคณิต (`round2(Number(x))`) — **ไม่แตะ** ยกเว้นจุดที่ coerce
body/query ตรง ๆ (`Number(body.qty)`) ที่ตอนนี้ zod `z.coerce.number()` ทำแทนแล้วในไฟล์ที่ adopt
เสร็จ — เก็บเป็น cleanup เล็ก ๆ ไปพร้อมกับถอด `pick()` ของไฟล์นั้น ไม่แยก pass

---

## C. `no-explicit-any` = error บน `src/lib` — **S–M** ✅ เสร็จแล้ว (2026-09-12)

### ผลจริง (ทำตามลำดับที่วางแผนไว้ เล็ก→ใหญ่ ไม่มีเซอร์ไพรส์ใหญ่)
1. **`refs.ts`** (3 จุด) — `assertRefExists`/`assertRefExistsHard` เปลี่ยนเป็น generic
   `<T>(model: Model<T>, ...)` ตามแผน — ไม่กระทบ call site ไหนเลย (โมเดลทุกตัวใน `src/models/**`
   ถูก infer เป็น `any`/loose type อยู่แล้วจาก `mongoose.models.X || mongoose.model(...)` — generic
   แค่ห่อ `any` เดิมให้ไม่ต้องเขียน `any` เอง ไม่ได้เพิ่มความปลอดภัยของ type จริง ๆ แต่ผ่าน lint)
2. **`discountEngine.ts`** (3 จุด) — เพิ่ม interface `PromotionLike` (field ที่ `computeDiscount`
   ใช้จริงทั้งหมด) แทน `promo: any` · `idIn()` เปลี่ยน `any[]` → `unknown[]` (แค่ `String(x)` เทียบ
   ไม่ต้องรู้ type จริง) · เทส `discountEngine.test.ts` (12 เคส) ผ่านหมดไม่ต้องแก้อะไร
3. **`crudService.ts`** (5 จุด) — `AnyModel = Model<any>` → `Model<unknown>`, `Doc = Record<string,any>`
   → `Record<string,unknown>` **ไม่กระทบ build/typecheck ทั้งโปรเจกต์เลย** (รันแล้วเช็คก่อนแก้ 2 จุด
   ที่เหลือ) — พอเปลี่ยน 2 type alias แล้ว 2 จุด `as any` ที่เหลือ (query chaining กับ mongoose
   `applyPopulate`) **compile ผ่านได้เองโดยไม่ต้อง cast อะไรเลย** ดีกว่าที่แผนคาดไว้มาก (คิดว่าต้องคง
   `as any`/disable-next-line ไว้บางจุด)
4. **`bom.ts`** (16 จุด, เยอะสุด) — เจอว่าไฟล์นี้**มี interface `IngredientItem`/`ComponentItem`
   ประกาศไว้อยู่แล้วตั้งแต่ต้น แต่ไม่เคยถูกใช้จริงในฟังก์ชันไหนเลย** (ทุกฟังก์ชันรับ `any[]` แทน) — แก้
   `ingredientItemsCost`/`componentItemsCost` ให้รับ interface ที่มีอยู่แล้วตรง ๆ · เพิ่ม
   `RawItem = Record<string,unknown>` สำหรับฟังก์ชัน validate (ยังไม่รู้ shape จนกว่าจะเช็คผ่าน — ใช้
   `IngredientItem` ตรงนั้นจะผิดความหมาย) · type `.lean<T>()` ให้ตรง field ที่ `.select()` เลือกจริง
5. **`crudRoutes.ts`** — 2 จุด (ไม่ใช่ 1 อย่างที่คิดตอนสำรวจ): `readBody()` return type (มี
   `eslint-disable-next-line` เดิมอยู่แล้ว) + `logMutation()` `doc: any` (บรรทัด 85, ไม่มี disable —
   เป็น `warning` อยู่ก่อนแล้วในทุกรอบ lint ของ session นี้) — `readBody` คืน
   `Record<string,unknown>` (ต้อง cast `parseBody()` เพราะ `z.infer<z.ZodType>` แบบ base class
   resolve เป็น `unknown` ไม่ใช่ object shape) · `logMutation` รับ
   `{ _id?: unknown } | null | undefined`

**ผลลัพธ์เกินคาด:** ไม่มีไฟล์ไหนต้องเหลือ `eslint-disable-next-line` เลยสักจุด — `src/lib/**`
สะอาด 100% ไม่มี `any` explicit เหลือแม้แต่ตัวเดียว

### เกณฑ์ "เสร็จ"
```js
// eslint.config.mjs
{
  files: ["src/schemas/**/*.ts", "tests/**/*.ts", "src/lib/**/*.ts"],  // เพิ่ม src/lib แล้ว
  rules: { "@typescript-eslint/no-explicit-any": "error" },
},
```
`npm run lint` → **0 error, 11 warning** (ลดจาก 13 เดิม — `crudRoutes.ts:85` หายไปพร้อมกับที่แก้)
ที่เหลือทั้งหมดอยู่ใน `src/app/api/**/route.ts` — เก็บไว้รอบถัดไปเมื่อ service คืน type จริง

---

## แผน PR (ร่าง — ปรับได้หลังเริ่มทำจริง)

| PR | เนื้อหา |
|---|---|
| **4b-A** | ✅ zod: `admin/orders` POST + `admin/attendances` (4 ไฟล์) — branch `hardening-4b-orders-attendances` |
| **4b-B** | ✅ รื้อ `pick()` — addressService, promotionService, attendanceService (3/8, `orderService` ข้ามเพราะ `pick()` เดียวผูกกับ route ที่ยังไม่ adopt) — branch เดียวกับ 4b-A |
| **4b-B2** | ✅ adopt zod: `admin/orders/[id]/delivery` + `admin/permissions` + `admin/preorder-rounds*`/`preorder-round-items` + `admin/users` → ถอด `pick()` ที่เหลือทั้งหมด (5 ไฟล์: orderService/permissionService/preorderRoundService/preorderService/userService) — branch `hardening-4b-pick-cleanup-b2` |
| **4b-C** | ✅ `no-explicit-any` error บน `src/lib` (5 ไฟล์: `refs`/`discountEngine`/`crudService`/`bom`/`crudRoutes`) — branch เดียวกับ 4b-A/B |

### doc ที่ต้องอัปเดตท้ายรอบ
- [x] [`validation.md`](validation.md) — §3 ตาราง adopt ครบทุก route (4b-A/B2) + §5 pick() ปิด 8/8
- [x] [`infra-tooling.md`](infra-tooling.md) — §1 no-explicit-any error บน src/lib (4b-C)
- [x] [`BACKLOG.md`](BACKLOG.md) §3 — ปิดข้อ 4/5/6 ครบทั้ง 3 ข้อ

## เกณฑ์เสร็จรอบ 4b
- [x] `/admin/orders` POST + `.../delivery` PATCH validate ด้วย zod (ไม่มี `PATCH /admin/orders/[id]` ตรง ๆ)
- [x] `/admin/attendances` ทั้ง 4 route validate ด้วย zod (`recorded_by` inject จาก session เสมอตอน POST)
- [x] `/admin/permissions`, `/admin/preorder-rounds*` + `preorder-round-items`, `/admin/users` validate ด้วย zod (B2)
- [x] `pick()` ถูกถอดออกครบ **8/8 ไฟล์** — ไม่เหลือไฟล์ไหนที่ยัง whitelist ซ้ำกับ zod
- [x] `no-explicit-any` = error บน `src/lib/**` ทั้งหมด — `npm run lint` 0 error (5 warning เหลือใน route layer, ลดจาก 13 ตอนเริ่มรอบ)
- [x] `typecheck` / `typecheck:test` / `test` (149) / `test:integration` (13) / `build` ผ่านหมดทุก PR (A+B+B2+C)
- [x] doc อัปเดตครบ (`validation.md`, `infra-tooling.md`, `BACKLOG.md`, `hardening-4b-plan.md`)
