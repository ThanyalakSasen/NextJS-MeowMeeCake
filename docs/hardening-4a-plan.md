# แผน รอบ 4a — ปิดงาน infra ให้จบ (ก่อน launch)

> อัปเดตล่าสุด: 2026-09-11
> สถานะ: 🟡 **กำลังทำ** — ✅ PR A (CI #13) · ✅ PR B (3.6 #14) · ✅ PR C (crud-factory 5 กลุ่ม #15) · 🟡 PR D (BOM: component/recipe) · ⬜ PR E (custom routes + รื้อ pick())
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

## 1. CI pipeline (หาง 3.4) — **S** ✅ เสร็จ (PR [#13](https://github.com/ThanyalakSasen/NextJS-MeowMeeCake/pull/13) merged, `verify` เขียวรอบแรก)

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

### ผลจริง PR B
```
npm run lint → 0 errors, 13 warnings (no-explicit-any: 12 × api route + 1 × crudRoutes.ts:84)
typecheck · typecheck:test · test (91) · build → ผ่าน
```
- 2c ทำแบบ: base = `warn`, override `error` เฉพาะ `src/schemas/**` + `tests/**` (`src/lib/**` ยังไม่ยกเป็น error
  เพราะ 5 ไฟล์มี `/* eslint-disable */` header + `crudRoutes.ts:84` มี `any` — ทำใน pass ถัดไป)
- 13 warning ที่เหลือ = `const result: any = await service(...)` ใน route → หายเมื่อ service คืน type จริง (ข้อ 3)

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

### ลำดับย่อยของข้อ 3 (ปรับหลังสำรวจโค้ดจริง → แตกเป็น PR C / D / E)
- **PR C** ✅ — crud-factory entity เรียบง่าย 5 กลุ่ม: `product-options` · `product-variants` · `aspects` · `semantic-terms` · `roles` (collection + `[id]`)
  - schema: `catalog.ts` (+option/variant) · `sentiment.ts` (ใหม่) · `rbac.ts` (ใหม่)
  - `update` ของ option/variant = `.omit({ product_id }).partial()` (ตรงกับ `updateFields` เดิมที่ห้ามย้ายสินค้า)
  - **คง** `createFields`/`updateFields` ใน `createCrudService` ไว้เป็น defense-in-depth (zod strip unknown อยู่แล้ว) — รื้อใน PR E
  - test: `tests/lib/schemas-crud.test.ts` (+9)
- **PR D** ✅ — BOM-shaped: `components` (`ingredients[]`) · `recipes` (`ingredients[]` + `components[]` ซ้อน) — `bom.ts` schema (array ของ `{ id, quantity≥0, unit_id }`, coerce) · `update` `.omit()` category/product + created_by · test `schemas-bom.test.ts` (+8 → unit 108/14)
  - **หมายเหตุ security:** `created_by` ยังรับจาก body (พฤติกรรมเดิม + factory route ไม่ inject session) — schema validate เป็น ObjectId, service เช็ค user มีจริง · **ย้ายไป inject จาก session ใน PR E**
- **PR E** ⬜ — custom routes: `admin/orders` (POST/PATCH) · `admin/attendances` · `shop/reviews` · `shop/addresses` · `shop/me` → `parseBody(req, schema)` · **แล้วรื้อ** `pick()` (8 ไฟล์) + `createFields`/`updateFields` ที่ซ้ำกับ zod

### รื้อ `pick()` / `Number()` (→ PR E)
- `pick(` = 8 ไฟล์ (userService ×3, addressService ×2, promotionService ×2, permissionService ×2, preorderRoundService ×2, orderService, attendanceService) — ผูกกับ custom route ที่ยังไม่ adopt → รื้อหลัง adopt route นั้น ๆ ใน PR E
- `Number(` = 42 จุด แต่ส่วนใหญ่เป็นเลขคณิต (`round2(Number(x))`) → **เก็บไว้** · ลบเฉพาะที่ coerce input
- ทำ**ทีละ service + `npm run typecheck` หลังทุกไฟล์**

### ⚠️ ผลกระทบ
schema เข้มขึ้น → payload ที่เดิมหลุด (field เกิน / type ผิด / ค่าว่าง) จะโดน **400 + issues** = fix ที่ถูกต้อง แต่ต้อง**แจ้ง frontend** ต่อ endpoint (ใส่ในตาราง [`validation.md`](validation.md) §3 เหมือนตอน adopt `/shop/*`)

---

## แผน PR

| PR | เนื้อหา | สถานะ |
|---|---|---|
| **A** | `.github/workflows/ci.yml` | ✅ #13 merged |
| **B** | 3.6 — 2a (fix warning) + 2b (ลบ `ignoreDuringBuilds`) + 2c ทางเลือก B | ✅ #14 merged |
| **C** | 3.1 — crud-factory 5 กลุ่ม (option/variant/aspect/semantic-term/role) + schema + test | ✅ #15 merged |
| **D** | 3.1 — `components` + `recipes` (BOM) `bom.ts` + test | 🟡 กำลังทำ |
| **E** | 3.1 — custom routes (admin orders/attendances, shop reviews/addresses/me) + inject `created_by` จาก session + รื้อ `pick()`/`createFields` | ⬜ |

แต่ละ PR merge เข้า `addModels` ตามเดิม

### doc ที่ต้องอัปเดตท้ายรอบ
- [`infra-tooling.md`](infra-tooling.md) — §1 "งานต่อ" (ตัดที่ทำแล้ว) · §3 เพิ่มหัวข้อ CI
- [`validation.md`](validation.md) — §3 ตาราง adopt (ปิด ⬜)
- [`hardening-summary.md`](hardening-summary.md) — §3.4 / §3.6 ตัด "ยังไม่ทำ" ที่เคลียร์แล้ว
- [`BACKLOG.md`](BACKLOG.md) §3 — ปิดข้อ 1–3 ของ "ลำดับการแก้ที่เหลือ" · อัปเดตแบนเนอร์สถานะ

---

## เกณฑ์เสร็จรอบ 4a
- [x] `.github/workflows/ci.yml` เขียวบน PR + push
- [~] `npm run lint` = 0 error (✅) / 0 warning (⬜ เหลือ 13 → PR E) · `next.config.ts` ไม่มี `eslint.ignoreDuringBuilds` (✅)
- [~] `no-explicit-any` = `error` บน `src/schemas` + `tests` (✅) · `src/lib` (⬜ PR E)
- [~] route adopt zod: crud-factory เรียบง่าย (✅ PR C) · BOM `components`/`recipes` (⬜ PR D) · custom routes (⬜ PR E)
- [ ] `pick()` / `createFields` ที่ซ้ำ zod หายจาก `src/services/**` (PR E)
- [~] doc อัปเดต: `validation.md` §2/§3/§5 (✅ PR C) · `infra-tooling.md` (✅ PR B) · `hardening-summary.md` + `BACKLOG` §3 (⬜ ท้ายรอบ)
