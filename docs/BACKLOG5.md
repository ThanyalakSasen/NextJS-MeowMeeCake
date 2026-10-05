# MeowMeeCake Backend — BACKLOG 5: ตรวจทั้งโปรเจกต์หลังรวม backend ฝั่งลูกค้า (2026-10-05)

> ตรวจ: 2026-10-05 · ฐานโค้ด: `fix/backlog4-y7-y11` (PR #57) commit `84a72da` — รวมงานย้าย backend ฝั่งลูกค้า §8.1–§8.21 ของ
> [`customer-backend-merge.md`](customer-backend-merge.md)
> วิธีตรวจ: อ่านโค้ด (middleware · authGuard · route ทั้ง 211 เส้น · service ที่เปิดสาธารณะ) + `typecheck` / `typecheck:test` / `lint` /
> เทสทั้งหมด (84 ไฟล์ · **573 ผ่าน**) / `next build` / `npm audit` · เทียบ env ในโค้ดกับ `.env.example` / [`env.md`](env.md)
> backlog ก่อนหน้า: [`BACKLOG4.md`](BACKLOG4.md) (§8 งาน deploy ที่ยังค้าง — ยกมาไว้ §5 ด้านล่าง)

---

## สถานะโดยรวม

| ระดับ | จำนวน | สรุป |
|---|---|---|
| 🔴 ต้องแก้ก่อนใช้งานจริง | 1 (✅ R1 แก้แล้ว 2026-10-06) | ~~ต้นทุนสินค้า + สูตรหลุดทาง API สาธารณะ~~ |
| 🟡 ควรแก้ | 5 (✅ ครบ Y1–Y5 แก้แล้ว 2026-10-06) | ~~session แบบ cookie หลักไม่ตรวจบัญชีกับ DB~~ · ~~`.env.example` ขาดตัวแปรใหม่~~ · ~~`npm audit`~~ · ~~ล็อกอินผ่าน next-auth ไม่มี rate limit ต่อ IP~~ · ~~sortBy สาธารณะไม่จำกัด field~~ |
| 🟢 เล็กน้อย / เก็บกวาด | 6 | คอมเมนต์ยุคสตางค์ค้าง 54 บรรทัด · หน้าแนะนำสินค้าโหลดทั้งร้านทุกครั้ง · ตัวกรองรีวิวที่ยังดู `is_visible` อย่างเดียว ฯลฯ |
| ⏸ รอ FrontEnd / ทีม | 4 | ปิด `product_stock_quantity` ใน PATCH · R5 แดชบอร์ดรีวิว · P4/P5 หลังร้าน + ปิดพอร์ต 4000 · FrontOffice เขียน DB ตรง |
| ✅ ตรวจแล้วไม่พบปัญหา | — | §6 |

ผลตรวจอัตโนมัติ: typecheck ✅ · typecheck:test ✅ · lint 0 error (5 warning เดิม) · เทส 573/573 ✅ · build ✅ · log `MongoNotConnectedError` ในเทส = 0 (§8.21)

---

## 1. 🔴 ต้องแก้ก่อนใช้งานจริง

### R1. ✅ ต้นทุนสินค้าและสูตรหลุดทาง API สาธารณะ — แก้แล้ว 2026-10-06

**ทำแล้ว:** `src/lib/publicProduct.ts` `toPublicProduct()` (allow-list — field ใหม่ใน productModel ไม่หลุดเอง) ใช้ที่
`/api/catalog/products` · `/api/catalog/products/[id]` · `recommendationService` (`recommendedProducts` · `similar` · `personalized` → ครอบ
`/api/catalog/products/recommended` · `/[id]/similar` · `/api/shop/recommendations`) · แนะนำแบบไม่ล็อกอินส่ง `ingredientNames` (ชื่ออย่างเดียว)
+ `category_name` แทน `recipe_id` (สูตรทั้งก้อน) · หลังร้านได้เอกสารเต็มเหมือนเดิม · ตรวจหน้าเว็บลูกค้าแล้ว: ไม่ได้อ่าน `purchase_cost` /
`low_stock_threshold` / `yield_per_batch` / `recipe_id` · ตะกร้า/รีวิว/รายการโปรด/รอบพรีออเดอร์ เลือก field อยู่แล้ว (ไม่หลุด) ·
เทส `tests/integration/publicProduct.test.ts` (เรียก route จริง)

<details><summary>ปัญหาเดิม</summary>


**อาการ:** endpoint ใต้ `/api/catalog/*` (ไม่ต้องล็อกอิน) ส่งเอกสารสินค้าทั้งก้อน → มี `purchase_cost` (ต้นทุนซื้อมาขายต่อ) ·
`low_stock_threshold` · และบางเส้นมีสูตร (วัตถุดิบ + ปริมาณ) ติดไปด้วย — คู่แข่ง/ใครก็ได้ดึงต้นทุนและสูตรของร้านได้

| endpoint | ที่มา | หลุดอะไร |
|---|---|---|
| `GET /api/catalog/products` | `productService.getProducts` → `presentProduct` (`src/services/productService.ts:61`) | `purchase_cost` · `low_stock_threshold` |
| `GET /api/catalog/products/[id]` | `productService.getProductById` (`productService.ts:397`) | เหมือนข้างบน |
| `GET /api/catalog/products/recommended` | `recommendationService.recommendedProducts` (`src/services/recommendation/recommendationService.ts:94-105`) | ทั้งเอกสาร + `recipe_id.ingredients` (**ปริมาณวัตถุดิบในสูตร**) |
| `GET /api/catalog/products/[id]/similar` · `/api/shop/recommendations` | `recommendationEngine` `product: { ...item.doc }` (`recommendationEngine.ts:1161`, `:1383`, `:1423`) | ทั้งเอกสารสินค้า |

> ที่มา: สินค้าเดิม (ก่อน §8) หลุดเฉพาะ `purchase_cost` · ส่วนแนะนำ/สินค้าคล้าย ย้ายมาจากฝั่งลูกค้าใน §8.15 พร้อมรูปแบบ response เดิม
> (ฝั่งลูกค้าก็ส่งทั้งเอกสารเหมือนกัน) — ตอนย้ายไม่ได้กรอง field

**แก้:** ทำ `toPublicProduct()` ที่เดียว (allow-list: ชื่อ · ราคา/ราคาลด · รูป · คำอธิบาย · หมวด · `is_preorder`/`preorder_config` ·
สต็อก (ถ้าหน้าเว็บต้องใช้) · คะแนนรีวิว) แล้วใช้กับทุก route สาธารณะ + `similar`/`recommended` · สูตรส่งแค่ชื่อวัตถุดิบ
(`ingredientNames` สำหรับเตือนแพ้อาหาร — มีอยู่แล้ว) ไม่ส่งปริมาณ · เพิ่มเทสว่า response สาธารณะไม่มี `purchase_cost` / `quantity`
หลังร้าน (`/api/admin/products*`) ยังส่งครบตามเดิม · ⚠️ ตรวจ FrontEnd/หน้าเว็บลูกค้าว่าไม่ได้อ่าน field ที่จะตัด

</details>

---

## 2. 🟡 ควรแก้

### Y1. ✅ session แบบ cookie ของหลัก (JWT) ไม่ตรวจบัญชีกับ DB — แก้แล้ว 2026-10-06

**ทำแล้ว:**
- `assertSessionStillValid` ตรวจ**ทั้ง JWT และ next-auth** ทุก request: ไม่พบ/ลบ/ปิดบัญชี → 401 · เปลี่ยนรหัสหลังออก token → 401
  (เทียบระดับวินาที — JWT `iat` เป็นวินาที · `verifySession` ส่ง `source: "jwt"` + `auth_time` = iat) · **role_id / role_type จาก DB เสมอ**
  (ย้าย role มีผลทันที · token อ้าง owner แต่ DB เป็น staff = staff) · role ถูกลบ/ปิด → 403
- `authenticate(req)` ใหม่ใน `authGuard` แทน `requireAuth` ที่เคยข้ามการตรวจ: `crudRoutes` (guard ของทุก route CRUD) ·
  `/api/admin/attendances` (+ check-in/out) · `/api/admin/notifications` (+ `[id]`) · LINE callback (`/api/shop/me/line/callback` → login_required)
- เปลี่ยนรหัสผ่านตัวเอง (`PATCH /api/shop/me/password`) ออก cookie `session` ใหม่ให้เครื่องนี้ (เครื่องอื่นหลุด) · next-auth ต้องล็อกอินใหม่ (แบบฝั่งลูกค้าเดิม) ·
  แอดมินตั้งรหัสให้พนักงาน (`adminSetPassword`) → session เดิมของพนักงานหลุด
- ต้นทุน: +2 query ตาม `_id` ต่อ request ที่ต้องล็อกอิน (users + roles) · เทส `tests/integration/sessionValidation.test.ts` 6 เคส ·
  unit test ที่ไม่มี DB mock การตรวจนี้ (`notificationRoute` · `lineCallback`)
- ยังใช้ token เดิมจาก cookie (`getSession`) โดยไม่ตรวจ DB: `audit` (แค่บันทึกชื่อ) · `logout` · แนะนำสินค้า/สินค้าคล้าย (แค่ปรับผลแนะนำ) — ไม่ให้สิทธิ์อะไร

ปัญหาเดิม:


- `src/lib/jwt.ts:29` `verifySession` เชื่อ payload อย่างเดียว · `src/lib/authGuard.ts` `assertSessionStillValid` ตรวจ DB **เฉพาะ session จาก next-auth**
  (`if (session.source !== "nextauth") return session`)
- ผล: พนักงานที่ถูกปิดบัญชี (`is_active: false`) / ลบ / ย้าย role ยังเรียก `/api/admin/*` ด้วยสิทธิ์เดิมได้จน cookie หมดอายุ (`JWT_COOKIE_EXPIRE` ค่าเริ่มต้น 7 วัน)
  · เปลี่ยนรหัสผ่านแล้ว session ที่ขโมยไปยังใช้ได้
- ฝั่ง next-auth ทำถูกแล้ว (§8.9) — สองระบบพฤติกรรมไม่เท่ากัน
- **แก้:** ให้ `assertSessionStillValid` ตรวจทั้งสองแบบ (query เบา ๆ `is_active deleted_at password_changed_at role_id` — มีอยู่แล้ว) ·
  JWT ใส่ `iat` เทียบ `password_changed_at` · role_id ใช้ค่าจาก DB (ไม่ใช่จาก token) · พิจารณา cache สั้น ๆ ถ้ากังวลจำนวน query

### Y2. ✅ `.env.example` ขาดตัวแปรที่เพิ่มในรอบรวม backend — แก้แล้ว 2026-10-06

**ทำแล้ว:** เพิ่มหมวด next-auth (`NEXTAUTH_SECRET` · `NEXTAUTH_URL` · `STOREFRONT_URL`) · `GOOGLE_CLIENT_SECRET` (แก้คอมเมนต์ Google ที่บอกว่าไม่ต้องใช้ SECRET — ล้าสมัยตั้งแต่ next-auth) ·
`EMAIL_HOST` / `EMAIL_PORT` · `PROMPTPAY_ID` · ค่าปรับแต่ง (`DELIVERY_FEE_*` · `DELIVERY_FREE_MIN` · cache TTL 3 ตัว) · `UPLOAD_DRIVER` + `S3_*` (คอมเมนต์ไว้) ·
ตรวจซ้ำ: ตัวแปรทุกตัวที่โค้ดอ่านมีใน `.env.example` แล้ว ยกเว้นที่แพลตฟอร์มตั้งให้เอง (`NODE_ENV` · `NEXT_RUNTIME` · `VERCEL` · `NODE_APP_INSTANCE`) ·
เพิ่มกลางไฟล์ + ท้ายไฟล์ — ตอน merge #54 ถ้าชนที่ท้ายไฟล์ให้เก็บทั้งสองฝั่ง (#54 ไม่มี S3 ใน `.env.example` จึงไม่ซ้ำ)

ปัญหาเดิม:

ในโค้ดใช้แต่ `.env.example` ไม่มี: `NEXTAUTH_SECRET` · `NEXTAUTH_URL` · `STOREFRONT_URL` · `EMAIL_HOST` · `EMAIL_PORT` ·
`GOOGLE_CLIENT_SECRET` · `PROMPTPAY_ID` · `RECOMMENDATION_CACHE_TTL_MS` · `PERMISSION_CACHE_TTL_MS` · `DELIVERY_ZONE_CACHE_TTL_MS` ·
`DELIVERY_FEE_*` / `DELIVERY_FREE_MIN` · `UPLOAD_DRIVER` + `S3_*` (S3 อยู่ใน PR #54)
— มีใน [`env.md`](env.md) ครบแล้ว แต่คน deploy มักคัดลอกจาก `.env.example` → **ไม่ตั้ง `NEXTAUTH_SECRET` = ล็อกอินหน้าเว็บลูกค้าไม่ได้ ·
ไม่ตั้ง `EMAIL_*` = สมัครสมาชิกไม่ได้ (502)** · แก้: เติมลง `.env.example` (ค่าว่าง + คอมเมนต์) ระวังชนกับ #54 ที่ท้ายไฟล์ (เก็บทั้งสองฝั่ง)

### Y3. ✅ `npm audit` — แก้แล้ว 2026-10-06 (รวม PR #56 เข้า #57 — ผู้ใช้เลือก)

**ทำแล้ว:**
- merge branch `chore/postcss-override` (PR #56) เข้า `fix/backlog4-y7-y11` (PR #57) — **ไม่แตะ main** · ชนแค่ `package-lock.json`
  (ใช้ของ #57 แล้วสร้างใหม่ด้วย `npm install`) · `package.json` รวมได้เอง · `postcss.config.mjs` ลบไปแล้วทั้งสองฝั่ง (§8.21)
- **พบเพิ่ม:** `npm install` บน #57 ล้มด้วย ERESOLVE — `next-auth@4` ประกาศ peer `nodemailer@^7` แต่โปรเจกต์ใช้ `nodemailer@10`
  (อัปตอน §8.9 เพราะ 7.x มีช่องโหว่) · `npm ci` ยังผ่านเพราะใช้ lock เดิม แต่ `npm install`/`npm audit fix` ทำไม่ได้ →
  เพิ่ม `overrides: { "next-auth": { "nodemailer": "$nodemailer" } }` (next-auth ใช้ nodemailer เฉพาะ Email provider ซึ่งไม่ได้เปิด — ส่งอีเมลใช้ `src/lib/mailer.ts`)
- `overrides.next.postcss: ^8.5.23` (จาก #56 · ได้ 8.5.28/8.5.29) + `npm audit fix` (brace-expansion)
- ผล: **production `npm audit --omit=dev` = 0** · ทั้งหมดเหลือ 5 high = `braces` สายเดียว
  (`eslint-config-next` → `@next/eslint-plugin-next` → `fast-glob` → `micromatch` → `braces@3.0.3`)
  — **ยอมรับความเสี่ยง:** 3.0.3 คือรุ่นล่าสุด ยังไม่มีแพตช์ · `audit fix --force` = ถอย `eslint-config-next` ไป 14 (ใช้ไม่ได้) ·
  ใช้เฉพาะตอน lint ไม่รับ pattern จากผู้ใช้ · ตรวจใหม่เมื่อ `braces` ออกรุ่นแก้
- ตรวจ: typecheck · typecheck:test · lint 0 error · เทส 583/583 · build ✅ · ทดลองใน worktree แยกก่อนทำจริง
- เทส `lineCallback.test.ts` ล้มเป็นครั้งคราวตอนรันครั้งแรกหลัง `npm ci` (beforeAll import route+middleware เกิน 10 วิ ทั้งไฟล์ skip) → hook timeout 60 วิ
- **PR #56 หลังจากนี้:** merge เข้า main ได้โดยไม่ชน (commit ของ #56 อยู่ใน #57 แล้ว) หรือปิดไปเลยก็ได้ — DEPLOY ③ อัปเดตแล้ว

<details><summary>สภาพก่อนแก้</summary>


| แพ็กเกจ | ระดับ | ใช้ที่ | สถานะ |
|---|---|---|---|
| `postcss` ≤ 8.5.22 (ผ่าน `next@15.5.24`) | high · **production** | build ของ Next | แก้แล้วใน **PR #56** (`overrides.next.postcss`) — ยังไม่ merge · branch นี้ลบ `postcss.config.mjs` ตาม #56 แล้ว (§8.21) · ความเสี่ยงจริงต่ำ (ไม่ประมวลผล CSS จากผู้ใช้) |
| `braces` (ผ่าน `eslint-config-next` → `fast-glob` → `micromatch`) | high · dev | lint | **ใหม่** (หลัง #56 ตรวจได้ 0) · `npm audit fix --force` จะอัป eslint-config-next ข้าม major — รอดู patch หรือ override `braces` |
| `brace-expansion` | high · dev | eslint / typescript-estree | `npm audit fix` ได้ (ไม่ breaking — #56 เคยแก้ตัวนี้) |

ไม่กระทบ runtime ของ API (dev ทั้งหมด ยกเว้น postcss ที่ใช้ตอน build) · แก้รวมตอน merge #56 แล้วรัน `npm audit` ซ้ำ

</details>

### Y4. ✅ ล็อกอินผ่าน next-auth (credentials) ไม่มี rate limit ต่อ IP — แก้แล้ว 2026-10-06

**ทำแล้ว:** `authorize(credentials, req)` เรียก `rateLimit(ip, "auth:login", 10/นาที)` — **โควตาเดียวกับ `POST /api/auth/login`** (สลับ endpoint ไม่ช่วยให้ยิงได้มากขึ้น) ·
IP อ่านด้วย `clientIpFromHeaders` (ใหม่ใน `src/lib/request.ts` — ใช้ร่วมกับ `clientIp`) · เกินโควตา = หน้าเว็บได้ข้อความ "คำขอถี่เกินไป …" ·
เทส `tests/integration/nextAuthRateLimit.test.ts`

ปัญหาเดิม:

`POST /api/auth/login` มี `rateLimit(ip, "auth:login", 10/นาที)` แต่ `src/lib/nextAuth.ts:38` (`authorize`) เรียก `userService.verifyCredentials`
ตรง ๆ — มีแค่ล็อกบัญชีหลังผิด 5 ครั้ง (ต่อบัญชี) · ยิงสุ่มหลายบัญชีจาก IP เดียว (credential stuffing) ได้ไม่จำกัด และใช้ล็อกบัญชีคนอื่นเล่นได้
**แก้:** ใน `authorize` อ่าน IP จาก `req.headers` แล้ว `rateLimit(ip, "auth:login", …)` scope เดียวกับ `/api/auth/login`

### Y5. ✅ `GET /api/catalog/products?sortBy=` รับชื่อ field อะไรก็ได้ — แก้แล้ว 2026-10-06

**ทำแล้ว:** `productService.getProducts` ตรวจ `sortBy` กับ allow-list (นอกรายการ = 400) · หน้าร้าน `PUBLIC_PRODUCT_SORTS`
(`created_at` · `product_name_th` · `product_name_eng` · `product_price` · `avg_rating` · `review_count`) · หลังร้าน `ADMIN_PRODUCT_SORTS`
(+ `updated_at` · `product_id` · `sale_price` · `purchase_cost` · `product_stock_quantity`) · ตรวจแล้วไม่มีหน้าเว็บไหนส่ง `sortBy` มา (เรียงฝั่ง client)

ปัญหาเดิม:

`productService.ts:375` `.sort({ [query.sortBy]: dir })` ไม่มี allow-list (route อื่นใช้ `parseSort(sp, allowed, …)` ที่ตรวจแล้ว) →
เรียงตาม `purchase_cost` เพื่อเดาต้นทุนได้แม้แก้ R1 แล้ว · เรียงตาม field ที่ไม่มี index บนข้อมูลใหญ่ = query หนัก
**แก้:** ใช้ `parseSort(sp, ["created_at", "product_name_th", "product_price", "avg_rating", "review_count"], …)` ทั้ง catalog และ admin

---

## 3. 🟢 เล็กน้อย / เก็บกวาด

| # | เรื่อง | ที่ | แก้ |
|---|---|---|---|
| ~~G1~~ ✅ (branch `fix/backlog5-g1-money-comments`) | คอมเมนต์ยุค "เก็บเป็นสตางค์" ค้าง **54 บรรทัดใน 19 ไฟล์** — โค้ดเป็นบาทแล้ว (`toSatang` = ปัด 2 ตำแหน่ง) แต่คอมเมนต์ยังบอกว่าเป็นสตางค์/integer · คนอ่านเข้าใจผิดแล้วแก้โค้ดผิดได้ | `cartService.ts:42-84` · `bom.ts:8-10` · `preorderRoundService.ts:55` ฯลฯ (`grep -rn "เป็นสตางค์\|สตางค์ดิบ" src`) | ไล่แก้คอมเมนต์ (ไม่แตะโค้ด) — ทำหลัง merge #54/#57 กัน conflict |
| ~~G2~~ ✅ | แนะนำสินค้าแบบไม่ล็อกอินโหลดสินค้า**ทั้งร้าน + สูตรทั้งหมด**ทุก request ไม่มี cache และไม่มี rate limit | `recommendationService.ts:93` `popular()` | ใช้ catalog cache เดียวกับ engine (`catalogCacheTtl`) หรือ query เฉพาะ 10 อันดับ `sort({ avg_rating: -1 }).limit(10)` |
| ~~G3~~ ✅ | สรุปความรู้สึกรายแง่มุมของสินค้า (สาธารณะ) `$lookup` จาก **SentimentResults ทั้ง collection** ก่อนกรองสินค้า | `sentimentService.ts:213` | `$match` รีวิวของสินค้าก่อน (หา review_id ของสินค้า → `$in`) |
| ~~G4~~ ✅ | ตัวกรองรีวิวที่แสดงยังดู `is_visible` อย่างเดียว (ไม่ใช้ `VISIBLE_REVIEW` ของ §8.20) — ตรงกันตราบที่ status/is_visible sync กัน (`migrate:reviews` รายงานรายการที่ขัดกัน) | `sentimentService.ts:228` · `recommendationEngine.ts:385/627/657` (ตรวจบน main 2026-10-06 — `recommendationService.ts` เป็นตัวกรองสินค้า ไม่ใช่รีวิว) | ใช้ `VISIBLE_REVIEW` จาก `reviewService` |
| ~~G5~~ ✅ (branch `fix/backlog5-g5-aspect-names`) | seed แง่มุมเริ่มต้นพร้อมกัน 2 คำขอแรก → ได้ชุดซ้ำ (ไม่มี unique index ชื่อแง่มุม) | `sentimentService.ensureDefaultAspects` | unique partial index `aspect_name_th` (deleted_at null) + ข้าม 11000 — โอกาสเกิดน้อยมาก (ครั้งแรกครั้งเดียว) |
| G6 | `rateLimit` / cache สิทธิ์ / cache แนะนำสินค้า เป็น in-memory ต่อ instance | `rateLimit.ts` · `permissionService.ts:82` · `recommendationEngine` | ตามที่บันทึกไว้แล้ว (BACKLOG4 Y8) — รัน instance เดียว (DEPLOY ⑤) |

---

## 4. ⏸ รอ FrontEnd / ทีม (โค้ดใน repo นี้ทำต่อไม่ได้)

| เรื่อง | รออะไร | อ้างอิง |
|---|---|---|
| ปฏิเสธ `product_stock_quantity` ใน `PATCH /api/admin/products/[id]` (บังคับใช้ `/stock` — แจ้งสินค้าใกล้หมด · atomic) | FrontEnd เปลี่ยน 2 จุด: `productForm.ts` (แก้สินค้า) · `productStock/useProductStockViewModel.ts:104` | [`customer-backend-merge.md`](customer-backend-merge.md) §8.21 |
| R5 แดชบอร์ด / analytics / รายงานรีวิวรายสินค้า (~900 บรรทัด) | ทีมเลือกหลังร้าน | §8.20 |
| P4 API หลังร้านที่เหลือ · P5 ปิด backend ฝั่งลูกค้า (พอร์ต 4000) | ทีมเลือกหลังร้าน + หน้าเว็บลูกค้าย้าย path ครบ (`/api/customer/*` → `/api/catalog/*` / `/api/shop/*`) | §8.2 · §8.7–§8.20 |
| FrontOffice เขียน MongoDB ตรง (ไม่มี userlog / validation) | ทีมตัดสินใจ | BACKLOG4 §8.3 |

---

## 5. งานตอน deploy ที่ยังค้าง (ยกมาจาก BACKLOG4 §8 + รอบรวม backend)

คำสั่งทั้งหมดอยู่ใน [`README.md`](../README.md) "ก่อน deploy — คำสั่งที่ต้องรัน" ข้อ 1–6 · ขั้นตอนเต็ม [`DEPLOY.md`](DEPLOY.md)

- [x] ~~merge ตามลำดับ (BACKLOG4 R1) + **#56**~~ — **merge เข้า main ครบแล้ว 2026-10-06** (§8)
- [ ] deploy backend ฝั่งลูกค้าที่แก้ขั้น 0 พร้อมกัน (§8.5) แล้ว `cleanup:legacy-product-fields -- --apply`
- [ ] env production ครบ (Y2) · secret ใหม่ทั้งหมด · **หมุน `LINE_LOGIN_CHANNEL_SECRET`** (เคยวางในแชต)
- [ ] `migrate:line-user-id` → `--apply` (ห้าม `--remove-old` จนปิดพอร์ต 4000) · `migrate:reviews` → `--apply` (ก่อนเปิดรีวิวพรีออเดอร์)
- [ ] cron 6 ตัว · nginx `/uploads/` · Atlas แยก DB user + เปลี่ยนรหัส user เดิม
- [ ] หลังร้าน: เลขพร้อมเพย์ · ข้อมูลร้าน/โลโก้ · สิทธิ์ `reports` (รีวิว) และ `store_info` (หน้าร้านประจำสัปดาห์) ให้พนักงาน
- [ ] ออเดอร์ค้าง `ORD-1790786142302-M2PY` · `WEB-1790317257577` (BACKLOG4 §8.3)

---

## 6. ✅ ตรวจแล้วไม่พบปัญหา

| เรื่อง | ผล |
|---|---|
| route ที่ไม่มี guard | 34 เส้นไม่มี `withAuth`/`withPermission` — ทั้งหมดเป็น `/api/auth/*` · `/api/catalog/*` · `/api/health` (สาธารณะตั้งใจ) + `revenue-by-type` ที่ re-export route ที่มี guard |
| header ปลอม `x-mmc-user` | middleware ลบทิ้งก่อนทุก request (`middleware.ts:87`) แล้วค่อยใส่จาก cookie ที่ตรวจแล้ว |
| CSRF / CORS | mutation ตรวจ origin ทุก `/api/*` · preflight ตอบเฉพาะ origin ใน allowlist |
| rate limit IP ปลอม | `clientIp` อ่าน `X-Forwarded-For` ตัวแรก + nginx ตั้งทับด้วย `$remote_addr` (DEPLOY ⑥) |
| regex จากผู้ใช้ | ทุกจุดผ่าน `escapeRegExp` (เหลือแค่ regex คงที่ใน `parseCoordinates.ts`) |
| `JSON.parse` จาก input | อยู่ใน try ทั้งหมด (`session.ts`, `store-profile`) |
| pagination | `parsePagination` จำกัด limit ≤ 100 |
| ลิงก์แผนที่ (SSRF) | https + โดเมน Google ทุกขั้น · ไม่มีพอร์ต/บัญชีใน URL · ≤ 6 ขั้น 8 วินาที (§8.19 · เทส) |
| ลิงก์ชำระเงิน | token 192 บิต · เก็บ SHA-256 · ครั้งเดียว · 30 นาที · ผูกเจ้าของ (§8.8) |
| รีวิวสาธารณะ | ไม่มีโน้ต/แท็กภายใน · ชื่อปิดบางส่วน (§8.20 · เทส) |
| รอบพรีออเดอร์สาธารณะ | populate สินค้าเฉพาะ field ที่ควรเห็น (`PRODUCT_SELECT`) |
| index | unique ทุกตัวเป็น partial (`deleted_at: null`) หรือ field ที่ไม่ซ้ำอยู่แล้ว · รีวิวใช้ index ชื่อใหม่ไม่ชนของฝั่งลูกค้า |
| สิทธิ์เมนู | enum `Permissions` = `MENU_KEYS` (รวม `preorder` ที่เคยขาด + `store_info`) — TypeScript บังคับ route ใช้ key ที่มีจริง |
| เทสรั่วข้ามกัน | งานเบื้องหลังรอจบก่อนล้าง DB (§8.21) |

---

## 7. ลำดับที่แนะนำ

1. ~~**R1** (ต้นทุน/สูตรหลุด) + **Y5** (sortBy)~~ ✅ 2026-10-06
2. ~~**Y1** (session cookie ตรวจ DB)~~ ✅ 2026-10-06
3. ~~**Y2** (`.env.example`) + **Y4** (rate limit next-auth)~~ ✅ 2026-10-06
4. ~~**Y3** ตอน merge #56~~ ✅ 2026-10-06 (รวม #56 เข้า #57)
5. **G1–G6 หลัง merge ชุดใหญ่เข้า main** (กัน conflict กับ #52–#55 / #54 ที่ยังเปิดอยู่) — ลำดับด้านล่าง

### 7.1 ลำดับแก้ 🟢 G1–G6 (จัดใหม่หลัง merge ชุดใหญ่ 2026-10-06)

merge ครบแล้ว (§8) — ไม่มี PR ค้างให้ชนแล้ว จึงไม่ต้องรอ · ตรวจตำแหน่งทุกข้อซ้ำบน main `8e6930b` (G1 ยัง 54 บรรทัด / 19 ไฟล์ · #54 ไม่ได้เพิ่ม)

| PR | ลำดับ | ข้อ | ทำไมลำดับนี้ | ต้องรออะไร | ขนาด |
|---|---|---|---|---|---|
| **A** ✅ | 1 | **G4** ตัวกรองรีวิวที่แสดงใช้ `VISIBLE_REVIEW` (4 จุด) | ความถูกต้องของข้อมูล — รีวิวที่ร้านซ่อนด้วย `status` (หลังร้านฝั่งลูกค้ายังตั้งแค่ status ได้) ยังถูกนับในสรุปแง่มุม/แนะนำสินค้า | ไม่ต้องรอ (`VISIBLE_REVIEW` รองรับเอกสารที่ยังไม่มี status แล้ว — ไม่ต้องรอ `migrate:reviews`) | เล็ก |
| **A** ✅ | 2 | **G2** แนะนำสินค้าแบบไม่ล็อกอินโหลดทั้งร้าน + สูตรทุก request | endpoint สาธารณะ ไม่มี cache/rate limit — ยิงรัวแล้ว DB หนัก | — | เล็ก |
| **A** ✅ | 3 | **G3** สรุปแง่มุมรายสินค้า `$lookup` ทั้ง collection | endpoint สาธารณะ · ช้าลงตามจำนวนผลวิเคราะห์ | — | เล็ก |
| **B** ✅ | 4 | **G5** seed แง่มุมเริ่มต้นซ้ำ (unique index ชื่อแง่มุม) | สร้าง unique index บน collection ที่ backend ฝั่งลูกค้า (พอร์ต 4000) เขียนอยู่ด้วย — **ต้องตรวจชื่อซ้ำใน DB จริงก่อน** (มีซ้ำ = สร้าง index ไม่ได้) | ผู้ใช้รันสคริปต์ตรวจ (dry-run) บน DB จริง | เล็ก + สคริปต์ |
| **C** ✅ | 5 | **G1** คอมเมนต์ยุคสตางค์ 54 บรรทัด / 19 ไฟล์ | แก้คอมเมนต์อย่างเดียว แต่แตะไฟล์มากสุด — PR แยกให้ review ง่าย ไม่ปนโค้ด | — | กลาง (คอมเมนต์ล้วน) |
| — | — | **G6** in-memory ต่อ instance | ไม่ต้องแก้ตราบที่รัน instance เดียว (DEPLOY ⑤) | ตอนจะขยายหลาย instance (Redis) | ใหญ่ |

**✅ PR A ทำแล้ว 2026-10-06 (branch `fix/backlog5-g4-g2-g3`):**
- **G4:** นิยาม `VISIBLE_REVIEW` ย้ายไป `src/lib/reviewVisibility.ts` (+ `visibleReviewMatch(prefix)`) · `reviewService` re-export ของเดิม ·
  ใช้ที่สรุปแง่มุมรายสินค้า + ระบบแนะนำ 3 จุด (รีวิวของตัวเอง · รีวิวสินค้าเดียวกันของคนอื่น · รีวิวของเพื่อนบ้าน) — รีวิวที่ซ่อนด้วย status (แม้ is_visible ยัง true) ไม่นับแล้ว
- **G3:** หา `_id` รีวิวที่แสดงของสินค้าก่อน (index `product_id`) แล้ว aggregate ผลวิเคราะห์เฉพาะ `review_id` เหล่านั้น — ไม่มีรีวิว = ไม่ query ผลวิเคราะห์เลย
- **G2:** DB เรียง `avg_rating ↓ · review_count ↓ · _id` + `limit(10)` แล้วโหลดสูตรเฉพาะ 10 ตัว (เดิมโหลดทั้งร้าน + สูตรทั้งหมด) · cache ผลอายุเท่า
  catalog cache ของ engine (`RECOMMENDATION_CACHE_TTL_MS` ค่าเริ่มต้น 3 นาที · `resetPopularCache()`) · ผลเหมือนเดิม (10 อันดับตามคะแนน ไม่รวมที่ซ่อน/ลบ)
- เทส `tests/integration/backlog5ReviewSignals.test.ts` 4 เคส · ทั้งหมด 603/603 · build ✅

**PR A** (G4 + G2 + G3) อยู่ในไฟล์กลุ่มเดียวกัน (`sentimentService` · `recommendation/*`) จึงรวม PR เดียว + เทสพฤติกรรม ·
**✅ PR B (G5) ทำแล้ว 2026-10-06 — branch `fix/backlog5-g5-aspect-names`:**
- unique index `uniq_active_aspect_name_th` บน `Aspects.aspect_name_th` (แง่มุมที่ยังไม่ลบ · ไม่สนตัวพิมพ์ — collation `en` strength 2) ·
  **`autoIndex: false`** — แอปไม่สร้างเองตอนเปิด (DB จริงอาจมีชื่อซ้ำ → สร้างไม่ผ่าน) · สร้างผ่านสคริปต์เท่านั้น
- **`npm run check:aspect-names`** (ตรวจอย่างเดียว · exit 2 เมื่อพบซ้ำ) → รายงานกลุ่มชื่อซ้ำ (ตัดช่องว่างหัวท้าย + ไม่สนตัวพิมพ์) พร้อมจำนวนที่ถูกอ้างถึง
  (รีวิว `aspect_feedback` · `SemanticTerms` · `SentimentResults`) ช่วยเลือกตัวที่จะเก็บ · ชื่อที่มีช่องว่างหัว/ท้าย · มี index แล้วหรือยัง ·
  **`-- --apply`** สร้าง index เฉพาะเมื่อไม่มีชื่อซ้ำ · ไม่แก้/ลบข้อมูลใด ๆ · รันซ้ำได้
- มีชื่อซ้ำ → แก้ชื่อ หรือลบ (soft delete) ตัวที่ไม่ใช้ในหลังร้าน (`/api/admin/aspects/[id]`) แล้วรันใหม่ — รีวิวเดิมเก็บชื่อแง่มุมไว้ใน `aspect_feedback` จึงไม่หาย
- `ensureDefaultAspects`: `insertMany(..., { ordered: false })` + ข้าม 11000 — เรียกพร้อมกันครั้งแรกได้ชุดเริ่มต้น 4 ด้านพอดี (เมื่อมี index) ·
  เพิ่ม/แก้ชื่อชนกันพร้อมกัน → 409 (ตัวแปลง 11000 กลางใน `apiResponse`)
- เทส `tests/integration/aspectNames.test.ts` 3 เคส · **แก้เทสที่ล้มสุ่มเพิ่ม:** `publicProduct.test.ts` (R1) เคยตรวจว่า JSON ไม่มีตัวเลข "987" (ปริมาณในสูตร)
  ซึ่งบังเอิญโผล่ใน `_id`/รหัสสินค้า/มิลลิวินาทีของ `created_at` ได้ → เปลี่ยนเป็นตรวจว่าไม่มี key `"quantity"`
- **DB จริง (ผู้ใช้รันเอง):** `npm run check:aspect-names` → ถ้ามีชื่อซ้ำ แก้ในหลังร้าน → `npm run check:aspect-names -- --apply`

**PR B** แยกเพราะต้องมีสคริปต์ตรวจ DB จริงก่อน · **✅ PR C (G1) ทำแล้ว 2026-10-06 — branch `fix/backlog5-g1-money-comments` (ต่อจาก PR B):**
- แก้คอมเมนต์ยุค "เก็บเงินเป็นสตางค์" **50 จุดใน 19 ไฟล์** (`src/lib/bom.ts` + 18 service) ให้ตรงกับระบบปัจจุบัน: เงินเก็บเป็นบาท ทศนิยม 2 ตำแหน่ง ·
  `toSatang`/`toBaht`/`toBahtFields` แค่ปัด 2 ตำแหน่ง (ชื่อฟังก์ชันคงไว้ตามที่ `money.ts` อธิบาย) · ตัวแปร local ที่ชื่อลงท้าย `Satang` เปลี่ยนชื่อ
  (`lineTotal` · `subtotalRaw` · `unitPrice` · พารามิเตอร์ `total` ใน `customerMessages.created`) — ไม่แตะ logic อื่น
- คงไว้ (ถูกต้อง): `dataIntegrityService` (ตรวจค่าที่น่าจะถูกเขียนเป็นสตางค์ / ประวัติ) · `money.ts` (ประวัติ)
- **⚠️ เจอบั๊กระหว่างไล่คอมเมนต์ (แก้แล้ว):** `paymentService` `AMOUNT_TOLERANCE = 1` — สมัยเก็บสตางค์ = เผื่อ 1 สตางค์ แต่หลังเปลี่ยนเป็นบาท
  (BACKLOG4 R7 · PR #57) กลายเป็น **ยอมให้ชำระขาด/เกินได้ถึง 1 บาท** โดยไม่ตั้งใจ (ใช้ตอนสร้างรายการชำระเงินของออเดอร์และพรีออเดอร์) →
  `0.01 + 1e-9` (1 สตางค์ + กัน float) · เทสเพิ่มใน `createPaymentPreorder.test.ts` (ขาด 0.5 / 0.02 · เกิน 0.02 = 400 · ขาด 0.01 ผ่าน)
- ตรวจค่าคงที่เงินอื่นแล้ว (`MAX_PRICE` · ค่าส่ง · เกณฑ์ data-integrity · แต้ม) ไม่พบค่าที่ค้างจากยุคสตางค์ · เทส 607/607 · build ✅

**PR C** แยกให้ review ง่าย — ส่วนใหญ่เป็นคอมเมนต์ล้วน ยกเว้นบั๊ก `AMOUNT_TOLERANCE` (แก้โค้ด 1 บรรทัด + เทส) ที่เจอระหว่างไล่คอมเมนต์

---

### 7.2 งดทดสอบส่ง LINE จริงจนถึงตอน deploy (ผู้ใช้ตัดสินใจ 2026-10-06)

เหตุผล: กันโควตาข้อความ LINE OA ของเดือนหมดก่อนใช้งานจริง → **ทดสอบส่ง LINE จริงตอน deploy / เปิดใช้งานจริงเท่านั้น** (DEPLOY ⑨ ข้อส่งข้อความทดสอบเข้า LINE เจ้าของร้าน + ผูก LINE ลูกค้า)

- **เทสอัตโนมัติ (vitest / CI) ไม่ใช้โควตา** — ตรวจแล้ว: เทสไม่เห็น `LINE_CHANNEL_ACCESS_TOKEN` จริง (vitest ไม่โหลด `.env.local`) · เทสที่ทดสอบ LINE ใช้ token ปลอม + stub `fetch` ทั้งหมด
- **ที่ใช้โควตาจริง:** `npm run dev` / `npm start` ที่มี token จริงใน `.env.local` (สร้างออเดอร์ทดสอบ = แจ้งเจ้าของร้าน + ลูกค้าที่ผูก LINE) · สคริปต์ที่โหลด `.env.local`
  (`remind:preorders` · `summary:monthly` · `cron:preorder-rounds` · `cron:order-expiry`) — ระหว่างนี้ใช้ `-- --dry-run` (มีใน `remind:preorders` / `summary:monthly`)
  หรือเว้นว่าง `LINE_CHANNEL_ACCESS_TOKEN` ใน `.env.local` ของเครื่อง dev (ระบบบันทึกแจ้งเตือนในเว็บตามปกติ · LINE ข้ามพร้อมเหตุผลใน `line_error`)

## 8. ผล merge ชุดใหญ่เข้า main (2026-10-06)

| ลำดับ | PR | merge commit | หมายเหตุ |
|---|---|---|---|
| 1 | #56 postcss override | `bae3cb4` | commit เดียวกันรวมอยู่ใน #57 แล้ว (Y3) |
| 2 | #52 is_preorder + เลขออเดอร์ | `9603276` | |
| 3 | #53 แจ้งเตือน LINE | `0f5d4e6` | ⚠️ ถูกปิดอัตโนมัติชั่วคราว — ดูด้านล่าง |
| 4 | #55 รอบพรีออเดอร์ | `0a766d0` | |
| 5 | #57 Y7–Y11 + เงินเป็นบาท + รวม backend ฝั่งลูกค้า | `7def045` | merge main เข้า branch ก่อน (`85e5eae` — ไม่มีไฟล์เปลี่ยน) |
| 6 | #54 สลิป/ใบเสร็จเป็นไฟล์ | `8e6930b` | merge main เข้า branch (`47dd0e1`) แก้ conflict 4 ไฟล์ |

CI ผ่านทุกขั้น · CI ของ main หลัง #54 ผ่าน · ทดลองใน worktree แยกก่อน push ทุกครั้งที่มี conflict

**ก่อน merge:** CI ของ #57 ล้ม 1 เทส (`preorderRoundFlow` "แก้ชื่อรอบอย่างเดียว → ไม่แจ้งลูกค้า") — แจ้งเตือนตอนสั่งวิ่งเบื้องหลังแล้วมาถึงหลัง
`fetchSpy.mockClear()` บนเครื่อง CI ที่ช้ากว่า → รอ `flushBackground()` ก่อนล้าง · เทสที่ยืนยัน "ไม่มีแจ้งเตือนเพิ่ม" อีก 3 ไฟล์เปลี่ยนจากรอเวลาตายตัวเป็น `flushBackground()` (`f9e1b28`)

**conflict ของ #54 (มากกว่าที่ DEPLOY ③ บันทึกไว้ 2 ไฟล์):**
- `package.json`: scripts ของ main + `migrate:upload-files` (ไม่เอา `migrate:money-to-satang`)
- `.env.example`: ของ main ทั้งไฟล์ + `PRIVATE_UPLOAD_DIR` ไว้หมวดที่เก็บไฟล์
- `src/lib/upload.ts`: เก็บ export ของ #54 (`ValidatedFile` · `validateFiles` · `randomFilename` ที่ `privateFiles.ts` ใช้) + วิดีโอ/prefix/`contentTypeOf` ของ main (§8.18)
- `paymentService.createPayment`: `assertSlipUrl()` (#54) **ก่อน** เปิดออเดอร์ที่หมดเวลากลับ (§8.8) — ตรวจสลิปก่อนตัดสต็อก
- เพิ่ม: `/api/files/slips/[filename]` (route ใหม่ของ #54) ใช้ `authenticate()` ตรวจบัญชีกับ DB (Y1) · เทส `privateSlips` สร้าง role จริงตามที่ session อ้าง

**⚠️ เหตุการณ์ #53 ถูกปิด:** `gh pr merge 52 --delete-branch` ลบ branch ฐานของ #53 ผ่าน API แต่ GitHub **ไม่ย้าย base ให้อัตโนมัติ** (ต่างจากกดใน
หน้าเว็บ) → #53 ถูกปิด · กู้: สร้าง branch `feat/product-types-and-order-no-prefix` คืนที่ commit เดิม (`d42eda2`) → reopen #53 → เปลี่ยน base เป็น main →
ลบ branch อีกครั้ง · ไม่มีโค้ด/ประวัติหาย · **บทเรียน:** PR ซ้อนกัน ให้ `gh pr edit <ถัดไป> --base main` **ก่อน** merge + ลบ branch ของตัวก่อนหน้า
(ทำแบบนี้กับ #55 และ #57 แล้วไม่มีปัญหา)

**branch ที่ยังอยู่ (ไม่ได้ลบ):** `fix/backlog4-y7-y11` (#57) · `fix/uploads-slips-receipts` (#54) — merge แล้ว ลบได้เมื่อไม่ใช้
