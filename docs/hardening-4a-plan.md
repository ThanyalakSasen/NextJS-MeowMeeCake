# แผน รอบ 4a — ปิดงาน infra ให้จบ (ก่อน launch)

> อัปเดตล่าสุด: 2026-09-11
> สถานะ: ⬜ **ยังไม่เริ่ม — รอยืนยันก่อนลงมือ**
> ที่มา: [`BACKLOG.md`](BACKLOG.md) §3 "ลำดับการแก้ที่เหลือ" รอบ 4a · ต่อจาก [`hardening-summary.md`](hardening-summary.md)

รอบ 4a = หางงานของ D1/D3 ที่ควรปิดก่อน launch · 3 งานเรียงตาม**ลำดับพึ่งพา**:

```
1. CI pipeline      (S)   ── กันถอยหลังก่อน
2. 3.6 cleanup      (S–M) ── ให้ lint/build เป็นตะแกรงจริง
3. 3.1 adopt tail   (M)   ── ต่อยอดบน CI ที่คุ้มกันแล้ว + รื้อ pick()
```

**Prereq ที่ตรวจแล้ว (2026-09-11):**
- `package-lock.json` มีและ track อยู่ → `npm ci` ใช้ได้
- ยังไม่มี `.github/`
- `npm run lint` = **0 error / 1 warning** (`productService.ts:797` `import/no-anonymous-default-export`)
- ไฟล์ที่มี `/* eslint-disable @typescript-eslint/no-explicit-any */` เหมาทั้งไฟล์ = **36 ไฟล์**
- `pick(` ใน `src/services/**` = 8 ไฟล์ (14 จุด) · `Number(`/`parseInt` = 17 ไฟล์ (42 จุด, ส่วนใหญ่เป็นเลขคณิต)
- route ที่ยังไม่ adopt zod = 11 กลุ่ม (ดู [`validation.md`](validation.md) §3 แถว ⬜)

---

## 1. CI pipeline (หาง 3.4) — **S**

### เป้าหมาย
ทุก push / PR รัน 6 ขั้นเดียวกับที่รันมือ (`typecheck → typecheck:test → lint → test → test:integration → build`) — ขั้นไหนแดง = merge ไม่ได้ · ล็อกผลงาน D1–D3 ไม่ให้ regress

### ไฟล์ใหม่ `.github/workflows/ci.yml`

```yaml
name: CI
on:
  push:
    branches: [addModels, main]
  pull_request:

jobs:
  verify:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    env:
      # dbConnect.ts throw ตั้งแต่ import ถ้าไม่มีค่านี้ (ดู vitest.config.mts) — build/typecheck ต้องมี dummy
      MONGODB_URI: mongodb://127.0.0.1:27017/ci-dummy
      JWT_SECRET: ci-dummy-secret-000000000000000000000000
      SESSION_SECRET: ci-dummy-secret-000000000000000000000000
      NODE_ENV: test
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 22          # ตรงกับ nvm local (v22.14.0)
          cache: npm

      # cache binary ของ mongodb-memory-server (~120MB) ไม่งั้นโหลดใหม่ทุกครั้ง
      - uses: actions/cache@v4
        with:
          path: ~/.cache/mongodb-binaries
          key: mongodb-binaries-${{ runner.os }}

      - run: npm ci

      - run: npm run typecheck
      - run: npm run typecheck:test
      - run: npm run lint
      - run: npm test                 # unit (project: unit)
      - run: npm run test:integration  # project: integration (mongodb-memory-server)
      - run: npm run build
```

### จุดตัดสินใจ
| ประเด็น | ทางเลือก | แนะนำ |
|---|---|---|
| mongo สำหรับ integration | (a) `mongodb-memory-server` เดิม + cache binary · (b) service container `mongo:7` + override `MONGODB_URI` | **(a)** — `tests/integration/setup.ts` ผูกกับ `MongoMemoryServer` อยู่แล้ว ไม่ต้องแก้โค้ด |
| แยก job หรือ job เดียว | job เดียว (ลำดับ) · matrix (typecheck/test/build ขนาน) | **job เดียว** ก่อน (~3–5 นาที) · แยกทีหลังถ้าช้า |
| branch protection | เปิด "require CI to pass" บน `addModels` | เปิดหลัง workflow เขียวรอบแรก |

### ความเสี่ยง
ต่ำ — ไม่แตะ runtime code · workflow แดง = bug จริงที่ควรรู้

---

## 2. 3.6 cleanup — **S–M** (4 ขั้นย่อย เรียงจากเสี่ยงน้อย→มาก)

### 2a. เก็บ warning เดียวที่เหลือ — `productService.ts:797`
```ts
// เดิม
export default { ... };
// หลัง
const productService = { ... };
export default productService;
```
เสร็จแล้ว `npm run lint` = **0 warning สะอาด** → ปลดล็อก 2b

### 2b. ลบ `eslint.ignoreDuringBuilds` ออกจาก `next.config.ts`
```ts
const nextConfig: NextConfig = {
  serverExternalPackages: ["mongoose", "bcryptjs"],
  // ลบ eslint block ทั้งก้อน
};
```
- ผล: `next build` รัน eslint เองอีกชั้น + **แดงถ้ามี error** (warning ไม่แดง)
- ปลอดภัยเพราะตอนนี้ 0 error · เป็น safety net ที่สอง

### 2c. เปิด `@typescript-eslint/no-explicit-any` — **ส่วน M** · 3 ทางเลือก
| | วิธี | ผล |
|---|---|---|
| A | เปิด `"warn"` ทั้ง repo + ลบ `reportUnusedDisableDirectives: "off"` | เห็น any ทุกจุดเป็น warning · ไม่บล็อก · ไล่เก็บเรื่อย ๆ |
| **B** | เปิด `"error"` **เฉพาะ** `src/lib/**` `src/schemas/**` `tests/**` · `src/services/**` + `src/app/api/**` = `"warn"` | **กันโค้ดใหม่ถอย · ไม่แตะ services 36 ไฟล์** |
| C | เปิด `"warn"` + `--max-warnings <N>` ใน `lint` script เป็นเพดาน แล้วลดทีละ PR (ratchet) | บังคับตัวเลขลดอย่างเดียว |

**แนะนำ B:**
```js
// eslint.config.mjs — เพิ่ม 2 block
{
  files: ["src/lib/**/*.ts", "src/schemas/**/*.ts", "tests/**/*.ts"],
  rules: { "@typescript-eslint/no-explicit-any": "error" },
},
{
  files: ["src/services/**/*.ts", "src/app/api/**/*.ts"],
  rules: { "@typescript-eslint/no-explicit-any": "warn" },
},
```

### 2d. type-aware `no-floating-promises` — **sub-pass แยก (เลื่อน)**
```js
languageOptions: {
  parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
},
rules: { "@typescript-eslint/no-floating-promises": "warn" },
```
- จับ `audit()` / `notify()` / best-effort `.catch()` ที่ลืม `await`/`void`
- แลกกับ lint ช้าลงมาก (ต้อง typecheck ทั้งโปรเจกต์) → เปิดเป็น `warn` หรือเลื่อนเป็นงานแยก

### สรุปขอบเขตรอบนี้
ทำ **2a + 2b** (เสร็จชัด) · **2c** ทางเลือก B · **2d** เลื่อน

---

## 3. 3.1 adopt route ที่เหลือ + รื้อ `pick()` — **M**

### route ที่เหลือ (จาก [`validation.md`](validation.md) §3 แถว ⬜)
`recipes` · `product-options` · `product-variants` · `aspects` · `semantic-terms` · `reviews` · `attendances` · `admin/orders` (custom) · `shop/reviews` · `shop/addresses` · `shop/me`

### วิธีการ — 2 รูปแบบตามชนิด route

**แบบ 1: route ผ่าน `crudRoutes` factory** — เหลือ 2 บรรทัด:
```ts
// src/schemas/<domain>.ts
export const productOptionCreate = z.object({ ... });
export const productOptionUpdate = productOptionCreate.partial();

// src/app/api/admin/product-options/route.ts
export const { GET, POST } = collectionRoutes(productOptionService, {
  ...,
  validate: { create: productOptionCreate },      // ← เพิ่ม
});
// [id]/route.ts → validate: { update: productOptionUpdate }
```

**แบบ 2: custom route** (`admin/orders`, `shop/me`, …):
```ts
// เดิม
const body = await req.json();
// หลัง
import { parseBody } from "@/lib/validate";
import { updateMeBody } from "@/schemas/user";
const data = await parseBody(req, updateMeBody);
```

**`recipes` = หนักสุด** — BOM ซ้อน (recipe → component[] → ingredient[]) ต้องออกแบบ schema nested + `superRefine` เช็ค qty > 0 ทุกชั้น → **แยกเป็น PR สุดท้าย**

### รื้อ `pick()` / `Number()`
- `pick(` = 8 ไฟล์ (userService ×3, addressService ×2, promotionService ×2, permissionService ×2, preorderRoundService ×2, orderService, attendanceService) — หลัง route มี zod เป็นด่านแรกแล้ว service ไม่ต้อง whitelist ซ้ำ → รับ typed object จาก schema ตรง ๆ ลบ `pick()`
- `Number(` = 42 จุด แต่ส่วนใหญ่เป็นเลขคณิต (`round2(Number(x))`, ราคา) → **เก็บไว้** · ลบเฉพาะที่ coerce body/query (`Number(body.qty)`) ที่ `z.coerce.number()` ทำแทน
- ทำ**ทีละ service + `npm run typecheck` หลังทุกไฟล์** (type จะฟ้องจุดที่ยัง assume `any`)

### ลำดับย่อยของข้อ 3
1. crud-factory routes ที่เหลือ (product-options/variants, aspects, semantic-terms, reviews, attendances)
2. custom routes (admin/orders, shop/reviews, shop/addresses, shop/me)
3. รื้อ `pick()` ทีละ service (คู่กับ route ที่เพิ่ง adopt)
4. `recipes` (BOM schema) — แยก

### ⚠️ ผลกระทบ
schema เข้มขึ้น → payload ที่เดิมหลุด (field เกิน / type ผิด / ค่าว่าง) จะโดน **400 + issues** = fix ที่ถูกต้อง แต่ต้อง**แจ้ง frontend** ต่อ endpoint (ใส่ในตาราง [`validation.md`](validation.md) §3 เหมือนตอน adopt `/shop/*`)

---

## แผน PR

| PR | เนื้อหา | ขึ้นกับ |
|---|---|---|
| **A** | `.github/workflows/ci.yml` | — (merge ก่อน ให้ PR ถัดมี CI คุม) |
| **B** | 3.6 — 2a (fix warning) + 2b (ลบ `ignoreDuringBuilds`) + 2c ทางเลือก B | A |
| **C** | 3.1 — crud-factory routes + custom routes + รื้อ `pick()` service ที่เกี่ยว | B |
| **D** | 3.1 — `recipes` BOM schema + ปิด ⬜ ใน [`validation.md`](validation.md) §3 | C |

แต่ละ PR merge เข้า `addModels` ตามเดิม

### doc ที่ต้องอัปเดตท้ายรอบ
- [`infra-tooling.md`](infra-tooling.md) — §1 "งานต่อ" (ตัดที่ทำแล้ว) · §3 เพิ่มหัวข้อ CI
- [`validation.md`](validation.md) — §3 ตาราง adopt (ปิด ⬜)
- [`hardening-summary.md`](hardening-summary.md) — §3.4 / §3.6 ตัด "ยังไม่ทำ" ที่เคลียร์แล้ว
- [`BACKLOG.md`](BACKLOG.md) §3 — ปิดข้อ 1–3 ของ "ลำดับการแก้ที่เหลือ" · อัปเดตแบนเนอร์สถานะ

---

## เกณฑ์เสร็จรอบ 4a
- [ ] `.github/workflows/ci.yml` เขียวบน PR + push
- [ ] `npm run lint` = 0 error / 0 warning · `next.config.ts` ไม่มี `eslint.ignoreDuringBuilds`
- [ ] `no-explicit-any` = `error` บน `src/lib` / `src/schemas` / `tests`
- [ ] route ทั้ง 11 กลุ่ม adopt zod ครบ (รวม `recipes`)
- [ ] `pick()` หายจาก `src/services/**` (เหลือ 0 ไฟล์)
- [ ] doc 4 ไฟล์ด้านบนอัปเดต
