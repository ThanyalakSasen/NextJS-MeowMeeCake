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
| 🟡 ควรแก้ | 5 (✅ Y1 · Y2 · Y4 · Y5 แก้แล้ว 2026-10-06 · เหลือ Y3 ตอน merge #56) | ~~session แบบ cookie หลักไม่ตรวจบัญชีกับ DB~~ · ~~`.env.example` ขาดตัวแปรใหม่~~ · `npm audit` · ~~ล็อกอินผ่าน next-auth ไม่มี rate limit ต่อ IP~~ · ~~sortBy สาธารณะไม่จำกัด field~~ |
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

### Y3. `npm audit` — 8 รายการ (production 2)

| แพ็กเกจ | ระดับ | ใช้ที่ | สถานะ |
|---|---|---|---|
| `postcss` ≤ 8.5.22 (ผ่าน `next@15.5.24`) | high · **production** | build ของ Next | แก้แล้วใน **PR #56** (`overrides.next.postcss`) — ยังไม่ merge · branch นี้ลบ `postcss.config.mjs` ตาม #56 แล้ว (§8.21) · ความเสี่ยงจริงต่ำ (ไม่ประมวลผล CSS จากผู้ใช้) |
| `braces` (ผ่าน `eslint-config-next` → `fast-glob` → `micromatch`) | high · dev | lint | **ใหม่** (หลัง #56 ตรวจได้ 0) · `npm audit fix --force` จะอัป eslint-config-next ข้าม major — รอดู patch หรือ override `braces` |
| `brace-expansion` | high · dev | eslint / typescript-estree | `npm audit fix` ได้ (ไม่ breaking — #56 เคยแก้ตัวนี้) |

ไม่กระทบ runtime ของ API (dev ทั้งหมด ยกเว้น postcss ที่ใช้ตอน build) · แก้รวมตอน merge #56 แล้วรัน `npm audit` ซ้ำ

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
| G1 | คอมเมนต์ยุค "เก็บเป็นสตางค์" ค้าง **54 บรรทัดใน 19 ไฟล์** — โค้ดเป็นบาทแล้ว (`toSatang` = ปัด 2 ตำแหน่ง) แต่คอมเมนต์ยังบอกว่าเป็นสตางค์/integer · คนอ่านเข้าใจผิดแล้วแก้โค้ดผิดได้ | `cartService.ts:42-84` · `bom.ts:8-10` · `preorderRoundService.ts:55` ฯลฯ (`grep -rn "เป็นสตางค์\|สตางค์ดิบ" src`) | ไล่แก้คอมเมนต์ (ไม่แตะโค้ด) — ทำหลัง merge #54/#57 กัน conflict |
| G2 | แนะนำสินค้าแบบไม่ล็อกอินโหลดสินค้า**ทั้งร้าน + สูตรทั้งหมด**ทุก request ไม่มี cache และไม่มี rate limit | `recommendationService.ts:93` `popular()` | ใช้ catalog cache เดียวกับ engine (`catalogCacheTtl`) หรือ query เฉพาะ 10 อันดับ `sort({ avg_rating: -1 }).limit(10)` |
| G3 | สรุปความรู้สึกรายแง่มุมของสินค้า (สาธารณะ) `$lookup` จาก **SentimentResults ทั้ง collection** ก่อนกรองสินค้า | `sentimentService.ts:213` | `$match` รีวิวของสินค้าก่อน (หา review_id ของสินค้า → `$in`) |
| G4 | ตัวกรองรีวิวที่แสดงยังดู `is_visible` อย่างเดียว (ไม่ใช้ `VISIBLE_REVIEW` ของ §8.20) — ตรงกันตราบที่ status/is_visible sync กัน (`migrate:reviews` รายงานรายการที่ขัดกัน) | `sentimentService.ts:228` · `recommendationEngine.ts:385/627/657` · `recommendationService.ts:95` | ใช้ `VISIBLE_REVIEW` จาก `reviewService` |
| G5 | seed แง่มุมเริ่มต้นพร้อมกัน 2 คำขอแรก → ได้ชุดซ้ำ (ไม่มี unique index ชื่อแง่มุม) | `sentimentService.ensureDefaultAspects` | unique partial index `aspect_name_th` (deleted_at null) + ข้าม 11000 — โอกาสเกิดน้อยมาก (ครั้งแรกครั้งเดียว) |
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

- [ ] merge ตามลำดับ (BACKLOG4 R1) + **#56** (postcss/audit — Y3) · ตอน merge #54: `package.json` ใช้ฝั่ง #57 + `migrate:upload-files` · `.env.example` เก็บทั้งสองฝั่ง
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
4. **Y3** ตอน merge #56 · **G1–G5** หลัง merge ชุดใหญ่ (กัน conflict)
