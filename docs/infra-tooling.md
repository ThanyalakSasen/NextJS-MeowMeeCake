# Infra / tooling — ESLint · Logger · Testing

> อัปเดตล่าสุด: 2026-09-10
> ที่มา: [`BACKLOG.md`](BACKLOG.md) §3 (ชั้น D) · แผนเต็ม → [`hardening-plan.md`](hardening-plan.md)
> เฟส D1 = 3.6 ESLint → 3.3 Logger → 3.4 Testing → 3.1 zod (เก็บไว้ทำทีหลัง)

---

## 1. ESLint (BACKLOG §3.6)

### ปัญหาเดิม
`package.json` มี `"lint": "next lint"` แต่ไม่มี config → รันไม่ได้ · `next build` เลย skip lint ·
คอมเมนต์ `/* eslint-disable */` ในโค้ดไม่มีผล

### สิ่งที่ทำ

**deps** (devDependencies):
```
eslint ^9.39            — ESLint 9 (flat config)
eslint-config-next ^15  — preset ของ Next 15 (ตรงกับ next ^15.1.6)
@eslint/eslintrc ^3     — FlatCompat: ใช้ preset แบบ .eslintrc ใน flat config
```

**`eslint.config.mjs`** (flat config):
- `compat.extends("next/core-web-vitals", "next/typescript")` — preset หลัก
- `ignores`: `.next/**`, `node_modules/**`, `next-env.d.ts`, `coverage/**`, `eslint.config.mjs`
- `linterOptions.reportUnusedDisableDirectives: "off"` — ชั่วคราว เพราะไฟล์ `src/services/*` มี
  `/* eslint-disable @typescript-eslint/no-explicit-any */` แบบเหมาทั้งไฟล์ ซึ่งตอนนี้ rule ถูกปิด
  → directive เลย "ไม่ถูกใช้" · จะกลับมามีผลเองเมื่อเปิด `no-explicit-any` (pass แยก)
- rules ที่ปรับ:
  | rule | ค่า | เหตุผล |
  |---|---|---|
  | `@typescript-eslint/no-explicit-any` | `off` | โค้ด backend ใช้ `any` เยอะ (`mongoose .lean<any>()`) — เปิดเป็น pass แยกตอนใส่ type ให้ครบ |
  | `@typescript-eslint/no-unused-vars` | `warn` (ignore `^_`) | ไม่บล็อก build · จับ dead import |
  | `no-console` | `warn` (allow `warn`/`error`) | ใช้ `src/lib/logger.ts` แทน (§3.3) |
  | `prefer-const` / `no-var` | `error` | พื้นฐาน |
  - override: `scripts/**/*.ts` → `no-console: off` (CLI seed/sync-indexes = console คือ output ปกติ)

**`package.json` scripts:**
```
"lint":     "eslint ."        (เดิม "next lint" — deprecated ใน Next 15, จะถูกลบใน Next 16)
"lint:fix": "eslint . --fix"
```

**`next.config.ts`:** เพิ่ม `eslint: { ignoreDuringBuilds: true }` **ชั่วคราว**
- repo ไม่เคย lint → มี warning ค้าง · ไม่ให้ `next build` แดง
- รัน `npm run lint` แยก แล้วทยอยเก็บ → เมื่อสะอาด **ให้ลบบรรทัดนี้ออก** เพื่อให้ lint กั้น build จริง

**quick fixes ที่ทำไปพร้อมกัน:**
- ลบ dead `import bcrypt` ใน `src/models/userModel.ts` (hash ย้ายไป `userService` แล้ว)
- ลบ dead `import type { Model }` ใน `src/services/productionOrderService.ts`
- `--fix`: `let round_status` → `const` ใน `preorderRoundService.ts`

### สถานะหลังทำ
```
npm run lint  → 0 errors, 1 warning
  └ src/services/productService.ts:796  import/no-anonymous-default-export
    (export default { ... } — style nit, ไม่บล็อก · เก็บทีหลังตอนแตะไฟล์นั้น)
npm run typecheck / npm run build → ผ่าน
```

### งานต่อ (pass แยก)
1. เก็บ warning `import/no-anonymous-default-export` (productService)
2. เปิด `@typescript-eslint/no-explicit-any` เป็น `warn` → ไล่ใส่ type ให้ `.lean<T>()` → ลบ `/* eslint-disable */` เหมาทั้งไฟล์ → เปิด `reportUnusedDisableDirectives` กลับ
3. เพิ่ม type-aware linting (`@typescript-eslint/no-floating-promises`) — ต้องตั้ง `parserOptions.projectService` · จะจับ fire-and-forget (`audit()`, `notify()`, best-effort `.catch()` ที่ลืม)
4. ลบ `eslint.ignoreDuringBuilds` เมื่อ lint สะอาด

---

## 2. Logger (BACKLOG §3.3)

_(เพิ่มใน commit ถัดไป)_

---

## 3. Testing (BACKLOG §3.4)

_(เพิ่มใน commit ถัดไป)_
