# แผน รอบ 4b — จบ §3.1 (zod tail) + §3.6 (no-explicit-any บน src/lib)

> อัปเดตล่าสุด: 2026-09-12
> สถานะ: 🟡 **ข้อ A เสร็จแล้ว + ข้อ B ทำแล้ว 3/8 ไฟล์** (branch `hardening-4b-orders-attendances`) — ข้อ C ยังไม่เริ่ม
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

## B. รื้อ `pick()` / `createFields` / `pickWritable()` — **M** 🟡 ทำแล้ว 3/8 ไฟล์ (2026-09-12)

**หลักการ:** หลัง route มี zod เป็นด่านแรกแล้ว (`.strip()` ทิ้ง field เกินอัตโนมัติ) service **ไม่ต้อง
whitelist ซ้ำ** ด้วย `pick()` อีกชั้น — แต่ต้องเช็ค**ทีละไฟล์**ว่า route ที่เรียก service นั้น adopt zod
ครบหรือยัง ก่อนถอด `pick()` ออก (ถอดก่อนแล้ว route ยังไม่ validate = เปิดช่อง mass-assignment กลับมา)

| ไฟล์ | route ที่เรียก | adopt zod แล้วหรือยัง | ผล |
|---|---|---|---|
| `addressService.ts` | `/shop/addresses` | ✅ (4a PR E) | ✅ **ถอดแล้ว** |
| `promotionService.ts` | `/admin/promotions` | ✅ (ก่อน 4a) | ✅ **ถอดแล้ว** (+ ลบเช็ค required/enum ซ้ำที่ zod ทำแทนแล้ว) |
| `attendanceService.ts` | `/admin/attendances*` (POST/PATCH/check-in/check-out) | ✅ (ข้อ A รอบนี้) | ✅ **ถอดแล้ว** (เฉพาะ `updateAttendance` — ฟังก์ชันเดียวที่มี `pick()`) |
| `orderService.ts` | ⚠️ **แก้ไขจากแผนเดิม** — `pick()` เดียวใน service นี้อยู่ใน `updateDelivery()` ซึ่งเรียกจาก `PATCH /admin/orders/[id]/delivery` **คนละ route** กับที่ข้อ A adopt zod ไป (shop/orders + admin/orders POST) — route `.../delivery` ยังเป็น `req.json()` ดิบ | ❌ `updateDelivery` ยังไม่ adopt | ⬜ **ข้าม** — ต้อง adopt zod ให้ route `.../delivery` ก่อนถึงจะถอดได้ (ยกไปทำพร้อม route นี้ทีหลัง ไม่ใช่ scope ของรอบนี้) |
| `permissionService.ts` | `/admin/permissions` | ❌ ยืนยันแล้ว — ไม่มี route ไหน import `@/lib/validate` เลย | ⬜ ข้าม |
| `preorderRoundService.ts` | `/admin/preorder-rounds*` | ❌ ยืนยันแล้ว | ⬜ ข้าม |
| `preorderService.ts` | `/shop/preorders`, `/admin/preorders` | ❌ ยืนยันแล้ว | ⬜ ข้าม |
| `userService.ts` | `/admin/users` | ❌ ยืนยันแล้ว | ⬜ ข้าม |

**บทเรียนจากรอบนี้:** "route adopt แล้วหรือยัง" ต้องเช็คเป็น**ต่อฟังก์ชัน**ไม่ใช่ต่อไฟล์ — `orderService.ts`
มีทั้งฟังก์ชันที่ route adopt แล้ว (`createOrder`) และยังไม่ adopt (`updateDelivery`) ปนกันในไฟล์เดียว
โชคดีที่ฟังก์ชันที่ adopt แล้วไม่มี `pick()` อยู่แล้ว (ไม่งั้นจะถอดผิดฟังก์ชันได้) — **ตรวจ grep `pick(`
แล้วไล่ดูว่าอยู่ในฟังก์ชันไหน เรียกจาก route ไหนจริง ๆ ทุกครั้ง อย่าเชื่อว่า "ไฟล์นี้ route adopt แล้ว" เฉย ๆ**
4 ไฟล์ที่เหลือ (permission/preorderRound/preorder/user) ยืนยันด้วย grep ตรง ๆ ว่าไม่มี route ไหน
import `@/lib/validate` เลยสักไฟล์ — ชัดเจนว่ายังไม่ adopt ไม่ต้องไล่ทีละฟังก์ชัน

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

## C. `no-explicit-any` = error บน `src/lib` — **S–M**

### ลำดับ (ไฟล์เล็ก→ใหญ่ กันเสีย momentum)
1. `refs.ts` (3 จุด) — เป็น utility เดียว `assertRefExists` น่าจะ type ง่ายด้วย generic `<T extends { _id: unknown }>` หรือ `Model<unknown>` จาก mongoose
2. `discountEngine.ts` (3 จุด) — มี pure function `computeDiscount` เทสครบแล้ว (`tests/lib/discountEngine.test.ts`) safety net ดี ก่อนรีแฟคเตอร์
3. `crudService.ts` (5 จุด) — เป็น factory ที่ generic อยู่แล้ว (`createCrudService<T>`) น่าจะแค่ปรับ signature บางจุดที่หลุดเป็น `any`
4. `bom.ts` (16 จุด — เยอะสุด ทำท้าย) — โครง BOM (component/recipe ซ้อน ingredient/component) มี type ซับซ้อนกว่าไฟล์อื่น อาจต้องนิยาม interface ใหม่ 2-3 ตัว
5. `crudRoutes.ts:85` — `doc: any` → เปลี่ยนเป็น `doc: { _id?: unknown } | null | undefined` (ใช้แค่ `doc?._id`)

### เกณฑ์ "เสร็จ"
```js
// eslint.config.mjs — เพิ่ม src/lib/**/*.ts เข้า block error เดิม
{
  files: ["src/schemas/**/*.ts", "tests/**/*.ts", "src/lib/**/*.ts"],  // ← เพิ่ม src/lib
  rules: { "@typescript-eslint/no-explicit-any": "error" },
},
```
`npm run lint` ต้องเหลือ 0 error (13 warning เดิมใน `src/app/api/**/route.ts` ยังคงอยู่ — เก็บไว้
สำหรับรอบถัดไปเมื่อ service คืน type จริงแทน `any` ที่ route ประกาศรับ)

### ความเสี่ยง
กลาง — ไม่ใช่แค่ปิด warning แต่ต้อง**คิด type จริง**ให้ generic/utility function พวกนี้ อาจเจอจุดที่
type เดิมกว้างเกินไปจนซ่อนบั๊ก (ดี — แต่ต้อง `npm run typecheck` + `test` ครบหลังทุกไฟล์ ไม่ใช่แค่ปิด
error แล้วจบ)

---

## แผน PR (ร่าง — ปรับได้หลังเริ่มทำจริง)

| PR | เนื้อหา |
|---|---|
| **4b-A** | ✅ zod: `admin/orders` POST + `admin/attendances` (4 ไฟล์) — branch `hardening-4b-orders-attendances` |
| **4b-B** | ✅ รื้อ `pick()` — addressService, promotionService, attendanceService (3/8, `orderService` ข้ามเพราะ `pick()` เดียวผูกกับ route ที่ยังไม่ adopt) — branch เดียวกับ 4b-A |
| **4b-B2** | (ค้าง) adopt zod ให้ `admin/orders/[id]/delivery` + route ที่เหลือ (permissions/preorder-rounds/preorders/users) แล้วค่อยถอด `pick()` ของ orderService (`updateDelivery`) + permissionService/preorderRoundService/preorderService/userService — **5 ไฟล์เหลือ** |
| **4b-C** | `no-explicit-any` error บน `src/lib` (4 ไฟล์เรียงเล็ก→ใหญ่ + `crudRoutes.ts`) |

### doc ที่ต้องอัปเดตท้ายรอบ
- [x] [`validation.md`](validation.md) — §3 ตาราง adopt (ปิด `admin/orders`, `admin/attendances`) + §5 pick() (4b-A/B)
- [ ] [`infra-tooling.md`](infra-tooling.md) — §1 no-explicit-any error บน src/lib (รอ 4b-C)
- [x] [`BACKLOG.md`](BACKLOG.md) §3 — ปิดข้อ 4-5 ของ "ลำดับการแก้ที่เหลือ" (บางส่วนสำหรับข้อ 5)

## เกณฑ์เสร็จรอบ 4b
- [x] `/admin/orders` POST validate ด้วย zod (ไม่มี PATCH endpoint จริง)
- [x] `/admin/attendances` ทั้ง 4 route validate ด้วย zod (`recorded_by` inject จาก session เสมอตอน POST)
- [x] `pick()` ในไฟล์ที่ route adopt zod ครบแล้วถูกถอดออก — **3/8** (address/promotion/attendance) — เหลือ 5 ไฟล์ที่ route ต้นทางยังไม่ adopt zod (ไม่ใช่บั๊ก แค่ยังไม่ถึงคิว)
- [ ] `no-explicit-any` = error บน `src/lib/**` ทั้งหมด — `npm run lint` 0 error
- [x] `typecheck` / `typecheck:test` / `test` / `test:integration` / `build` ผ่านหมด (4b-A + 4b-B)
- [x] doc อัปเดตครบสำหรับ A+B (`validation.md`, `BACKLOG.md`) — `infra-tooling.md` รอ 4b-C
