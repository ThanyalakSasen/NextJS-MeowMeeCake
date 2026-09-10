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

### ปัญหาเดิม
`console.error` กระจาย 5 จุด ใน 3 ไฟล์ (`apiResponse.ts`, `orderService.ts`, `userLogService.ts`) —
format ไม่คงที่, ไม่มี level, parse ต่อยาก

### สิ่งที่ทำ

**`src/lib/logger.ts`** — ไม่เพิ่ม dependency:
```ts
import { log } from "@/lib/logger";
log.info("order.created", { order_id, total_amount });
log.error("order.auto_refund_failed", { order_id, err });   // err: Error → { name, message, stack } อัตโนมัติ
```
- output = **JSON บรรทัดเดียว** `{ t, level, event, ...ctx }` → log aggregator parse ได้
- 4 level: `debug < info < warn < error` · ต่ำกว่า `LOG_LEVEL` ถูกข้าม
- `LOG_LEVEL` (env) — ไม่ตั้ง = `production:"info"` / อื่น ๆ `"debug"` · เพิ่มใน `.env.example`
- key `err` ใน ctx → serialize `Error` ให้เอง · payload ที่ stringify ไม่ได้ → fallback บรรทัดสั้น
- ภายในใช้ `console.*` (มี `// eslint-disable-next-line no-console` จุดเดียว) — ที่อื่นห้าม `console.log` (`no-console` warn จาก §1)

**แทน 5 จุด:**
| ไฟล์ | event ใหม่ |
|---|---|
| `apiResponse.ts` (`toErrorResponse` fallback) | `api.unhandled_error` |
| `orderService.ts` (`persistOrder` — recordUsage ล้ม non-422) | `order.record_usage_failed` |
| `orderService.ts` (cancel — auto-refund ล้ม) | `order.auto_refund_failed` |
| `orderService.ts` (cancel — refund ข้าม: ไม่พบ paid payment / ไม่มี cancelled_by) | `order.auto_refund_skipped` (warn) |
| `userLogService.ts` (`writeLog` best-effort ล้ม) | `userlog.write_failed` |

ตรวจ: `npm run lint` (0 error) · `npm run typecheck` · `npm run build` — ผ่าน

### งานต่อ
- ค่อย ๆ ใส่ `log.info` ที่ mutation สำคัญ (สร้าง/เปลี่ยนสถานะ order, verify payment) เพื่อ trace
- ต่อ transport จริง (ship ไป Datadog/Loki ฯลฯ) แก้ที่ `logger.ts` ที่เดียว
- §3.3b `src/lib/compensation.ts` (best-effort rollback helper) — แยกอีก task (ดู `hardening-plan.md` D3)

---

## 3. Testing (BACKLOG §3.4)

### ปัญหาเดิม
ไม่มี test infra เลย

### สิ่งที่ทำ

**deps** (devDependencies): `vitest ^5` · `@vitest/coverage-v8 ^5` · `mongodb-memory-server ^11` (เตรียมไว้สำหรับ integration test รอบหน้า — ยังไม่ใช้)

**`vitest.config.mts`** (ใช้ `.mts` — เลี่ยง warning ESM-as-CJS):
- `environment: "node"` · `include: tests/**/*.test.ts`
- `resolve.alias` `@` → `src` (ให้ test import `@/lib/...` ได้เหมือนโค้ดจริง)
- `test.env.MONGODB_URI` = dummy — เพราะ `src/lib/dbConnect.ts` `throw` ตั้งแต่ตอน import ถ้าไม่มีค่านี้
  (unit ชุดนี้ **ไม่ต่อ DB จริง**)
- `coverage`: v8, include `src/lib/**` + `src/services/**`

**`package.json` scripts:** `test` (unit เท่านั้น) · `test:integration` · `test:all` · `test:watch` · `test:cov` · `typecheck:test`

> **อัปเดต 2026-09-11 (D3.3):** แยกเป็น **vitest projects** — `unit` (`tests/lib/`, ไม่ต่อ DB) กับ
> `integration` (`tests/integration/`, `mongodb-memory-server`) · `tests/` ถูก exclude จาก `tsconfig.json`
> หลัก (กัน `next build` compile top-level await ใน setup) → typecheck tests ด้วย `tsconfig.test.json`

**ชุดแรก — unit ล้วน (`tests/lib/`), 35 tests / 4 ไฟล์:**
| ไฟล์ | ครอบ |
|---|---|
| `discountEngine.test.ts` | Percentage (+cap), Amount (clamp), FreeShipping (reject fee=0 → §2.6), zero-discount reject (§2.11), channel, min_order/min_qty, scoped products |
| `productCode.test.ts` | `generateProductCode` prefix `pos-`/`pre-` + DDYY, `isProductCode` (รูปแบบ/trim/non-string), `isStockProductType` |
| `deliveryService.test.ts` | `calcDeliveryFee`: กทม.=40 / ต่างจังหวัด=80 / ฟรีเมื่อ ≥1500 / normalize "จังหวัด"·"จ." / null → catch-all |
| `queryParams.test.ts` | `parsePagination` (clamp), `parseSort` (reject unknown), `parseBool`/`parseNumber`, `buildMeta`, `escapeRegExp` |

### ชุด integration (`tests/integration/`, D3.3 — 2026-09-11)
- `setup.ts` — top-level await เริ่ม `MongoMemoryServer` → ตั้ง `MONGODB_URI` + `mongoose.connect` +
  pre-populate `global._mongoose` (cache ของ `dbConnect`) · `afterEach` เคลียร์ทุก collection ·
  binary โหลดอัตโนมัติครั้งแรก (cache ไว้)
- `promotionUsage.test.ts` (5) — §2.9: atomic claim / ถึง limit → 422 / **ยิงพร้อมกัน 8 กับ limit=3 → สำเร็จ 3** / per-user rollback / revoke
- `persistOrder.test.ts` (4) — happy path / re-price / **compensation: สต็อกไม่พอ → ไม่มีออเดอร์** / preorder reject
- `cancelOrder.test.ts` (4) — cancel ไม่จ่าย (restock+status) / cancel + โปรฯ (revoke → `used_count` กลับ) / cancel จ่ายแล้ว (auto-refund) / ลูกค้ายกเลิกจ่ายแล้ว → 409
- **ยังไม่ครอบ:** `cartService`, `ingredientTransactionService`, `deliveryService.quoteForCart`

ตรวจ (ทั้งหมด): `npm run typecheck` · `typecheck:test` · `lint` · `npm test` (unit **91**) · `test:integration` (**13**) · `npm run build` — ผ่าน

### งานต่อ
- CI: step `typecheck && typecheck:test && lint && test && test:integration && build`
- integration เพิ่ม: cancel order, cart, ingredient transaction, delivery quote
