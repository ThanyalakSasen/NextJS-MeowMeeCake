# NextJS-MeowMeeCake
    1. npm i @heroicons/react
    2. npm install @material-tailwind/react
    3. npm install lucide-react
    4. npm install antd
    5. npm install recharts
    6. npm install mongoose
    7. npm install sweetalert2
    8. npm install -D playwright
    9. npm install qrcode
    10. npm install -D @types/qrcode
    11. npm install bcryptjs
    12. npm install multer

---

## Backend

- โครงสร้าง API: `/api/auth` · `/api/catalog` (สาธารณะ) · `/api/shop` (ลูกค้า) · `/api/admin` (พนักงาน + สิทธิ์เมนู)
- **ตัวแปร environment (`.env.local`) → [`docs/env.md`](docs/env.md)**
- **สูตรคำนวณ ราคา / ต้นทุน / กำไร-ขาดทุน → [`docs/Summary.md`](docs/Summary.md)**
- **re-price ราคาตอน checkout (บั๊ก 2.5) → [`docs/reprice.md`](docs/reprice.md)**
- **โปรโมชัน FreeShipping กับออเดอร์ไม่มีค่าส่ง (บั๊ก 2.6) → [`docs/promo-freeshipping.md`](docs/promo-freeshipping.md)**
- **ขอบเขตการยกเลิกออเดอร์ของลูกค้า (บั๊ก 2.7) → [`docs/order-cancel.md`](docs/order-cancel.md)**
- **กัน race: โปรโมชัน usage + payment ซ้ำ (บั๊ก 2.9–2.10) → [`docs/concurrency-guards.md`](docs/concurrency-guards.md)**
- **preorder payment/cancellation hardening (บั๊ก 2b.1–2b.4) → [`docs/preorder-payment-hardening.md`](docs/preorder-payment-hardening.md)**
- **clearCart error handling + voidTransaction floor guard (บั๊ก 2c.1–2c.2) → [`docs/order-cart-inventory-robustness.md`](docs/order-cart-inventory-robustness.md)**
- **สรุปรวมการแก้บั๊กความถูกต้องข้อมูล 2.8–2.11 → [`docs/data-integrity-fixes.md`](docs/data-integrity-fixes.md)**
- **บันทึกกิจกรรมผู้ใช้ (audit log) → [`docs/auditLog.md`](docs/auditLog.md)**
- **ระบบพรีออเดอร์ (รอบ / โควตา / API) → [`docs/preorder.md`](docs/preorder.md)**
- **สิ่งที่ต้องแก้ไข / ปรับ / บั๊ก + Migration checklist → [`docs/BACKLOG.md`](docs/BACKLOG.md)**
- **บั๊ก/ความเสี่ยงชุดใหม่ที่พบหลังปิด BACKLOG.md (แก้แล้ว) → [`docs/BACKLOG2.md`](docs/BACKLOG2.md)**
- **Clean code: reuse/simplification/efficiency (ไม่ใช่บั๊ก) → [`docs/BACKLOG3.md`](docs/BACKLOG3.md)**
- **สรุปงาน hardening §2 + §3 (พร้อม PR / ดัชนีเอกสาร) → [`docs/hardening-summary.md`](docs/hardening-summary.md)**
- **มาตรฐาน API (envelope / status / list / auth) → [`docs/api-conventions.md`](docs/api-conventions.md)**
- **แผนงานคุณภาพ / hardening (§3 ชั้น D) → [`docs/hardening-plan.md`](docs/hardening-plan.md)** · D3 → [`docs/hardening-d3-plan.md`](docs/hardening-d3-plan.md) · รอบ 4a → [`docs/hardening-4a-plan.md`](docs/hardening-4a-plan.md)
- **Infra / tooling: ESLint · Logger · Testing (§3.6 / 3.3 / 3.4) → [`docs/infra-tooling.md`](docs/infra-tooling.md)**
- **Validation layer (zod, §3.1) → [`docs/validation.md`](docs/validation.md)**
- **Security hardening: rate-limit · Google flow · CORS/CSRF (§3.2 / 3.9 / 3.10) → [`docs/security-hardening.md`](docs/security-hardening.md)**

สคริปต์:
```
npm run typecheck              # tsc --noEmit
npm run build
npm run seed                   # สร้าง role / units / หมวดหมู่ / owner user
npm run backfill:product-codes # เติมรหัสสินค้า pos-/pre- ให้ของเดิม
npm run sync-indexes           # ปรับ index ใน DB ให้ตรง schema (+ --fix เพื่อลบข้อมูลซ้ำ)
npm run seed:preorder-rounds   # สร้างรอบพรีออเดอร์ตัวอย่าง (ซาวโดว์) 4 รอบ สำหรับเทสฝั่งลูกค้า
npm run migrate:is-preorder    # แปลงประเภทสินค้าทุกรุ่น (product_type / product_types) → is_preorder — ✅ รันบน DB จริงแล้ว 2026-10-01 ไม่ต้องรันซ้ำ
npm run cleanup:legacy-product-fields  # ลบฟิลด์เก่าของสินค้า (product_type / delete_at) — dry-run ก่อน, --apply เขียนจริง
npm run migrate:line-user-id   # คัดลอก LINE ของลูกค้า users.lineId (ฝั่งลูกค้า) → line_user_id — dry-run ก่อน, --apply เขียนจริง · รันซ้ำได้
npm run check:data-integrity   # ตรวจข้อมูลสินค้าผิดปกติ (อ่านอย่างเดียว) · --no-notify = ไม่ส่งแจ้งเตือน
npm run backfill:payment-due   # เติมกำหนดชำระให้พรีออเดอร์เก่า — dry-run ก่อน, --apply เขียนจริง
npm run cron:preorder-rounds   # เปิด/ปิดรอบตามเวลา + ยกเลิกคนไม่จ่าย (cron ทุก 15 นาที)
npm run remind:preorders       # เตือนลูกค้าก่อนวันรับพรีออเดอร์ทาง LINE · --dry-run = ไม่ส่ง
npm run summary:monthly        # สรุปยอดเดือนที่แล้วถึงเจ้าของร้าน · --dry-run = ไม่ส่ง
npm run reset-owner-password   # ตั้งรหัสผ่าน owner ใหม่
```

---

## ก่อน deploy — คำสั่งที่ต้องรัน

> ขั้นตอนเต็ม (เซิร์ฟเวอร์ · nginx · pm2 · cron · ลำดับ merge PR) → [`docs/DEPLOY.md`](docs/DEPLOY.md) ·
> ตัวแปร environment → [`docs/env.md`](docs/env.md) · สคริปต์ที่แก้ข้อมูลจริง = **dry-run เป็นค่าเริ่มต้น** ต้องใส่ `-- --apply` ถึงจะเขียน

### 1. ตรวจโค้ด (เครื่อง dev หรือ CI — ต้องผ่านทุกข้อก่อน merge/deploy)

```bash
npm ci                    # ติดตั้งตาม package-lock.json
npm run lint              # ต้อง 0 error (warning ได้)
npm run typecheck
npm run typecheck:test
npm run test:all          # unit + integration (ใช้ mongodb-memory-server — ไม่แตะ DB จริง)
npm run build
```

### 2. เตรียมข้อมูลจริง (บนเซิร์ฟเวอร์ ก่อน build/reload — ใช้ `.env.local` ของ production)

```bash
# สำรอง DB ก่อนทุกครั้ง (หรือ snapshot ใน Atlas)
mongodump --uri "<MONGODB_URI>" --out backup-$(date +%F)

# อ่านอย่างเดียว — เก็บผลไว้เทียบหลัง deploy
npm run check:data-integrity -- --no-notify

# dry-run ดูแผนก่อน (ยังไม่เขียน)
npm run cleanup:legacy-product-fields
npm run backfill:payment-due
```

- ตรวจ `.env.local` ครบตาม [`docs/env.md`](docs/env.md) · secret ของ production ต้องคนละค่ากับ dev (`JWT_SECRET` · `SESSION_SECRET` · `NEXTAUTH_SECRET` · `CRON_SECRET`)
- ตั้ง `ADMIN_APP_URL` = URL หลังร้าน (ลิงก์ 🔗 ในแจ้งเตือน LINE) · LINE Login callback URL ของโดเมนจริง ([`docs/LINE.md`](docs/LINE.md) §4)

### 3. deploy

```bash
cd /srv/meowmeecake/app && git pull && npm ci && npm run build && pm2 reload meowmeecake-api
curl -s http://127.0.0.1:3000/api/health   # → {"ok":true,"db":"connected"}
```

รัน **instance เดียว** เท่านั้น (ห้าม `pm2 -i max` / cluster — [`docs/DEPLOY.md`](docs/DEPLOY.md) ⑤)

### 4. หลัง deploy

```bash
npm run cleanup:legacy-product-fields -- --apply   # ลบ product_type / delete_at ที่ค้าง (ไม่งั้นแจ้งเตือนทุกเช้า)
npm run backfill:payment-due -- --apply            # เฉพาะถ้าข้อ 2 dry-run เจอรายการ
npm run migrate:line-user-id                       # dry-run ดูรายชื่อ → แล้ว -- --apply (ไม่ลบ lineId · ห้ามใส่ --remove-old จนกว่าจะปิดพอร์ต 4000)
npm run check:data-integrity -- --no-notify        # ไม่ควรมี price_too_high / price_too_low / sale_not_below_price
npm run migrate:upload-files                       # หลัง merge PR #54 เท่านั้น — dry-run แล้วค่อย -- --apply
npm run summary:monthly -- --dry-run               # ทดสอบข้อความ ไม่ส่ง
npm run remind:preorders -- --dry-run
```

แล้วตั้ง cron 4 ตัว ([`docs/DEPLOY.md`](docs/DEPLOY.md) ⑧) และตรวจรับตาม ⑨

### ⚠️ ห้ามรัน / ข้อควรระวัง

| คำสั่ง | เหตุผล |
|---|---|
| `npm run migrate:is-preorder -- --apply` | รันบน DB จริงแล้ว 2026-10-01 |
| `npm run sync-indexes` | **ห้ามรันระหว่างที่ backend ฝั่งลูกค้า (พอร์ต 4000) ยังใช้ DB เดียวกัน** — `syncIndexes()` ลบ index ที่ไม่มีใน schema ของโปรเจกต์นี้ = ลบ index ของฝั่งลูกค้าด้วย ([`docs/customer-backend-merge.md`](docs/customer-backend-merge.md)) |
| สคริปต์เงินยุคสตางค์ (`fix-money-units` · `fix-orders-money` · `migrate-money-to-satang` ฯลฯ) | ระบบเก็บเงินเป็นบาทแล้ว — สคริปต์ถูกล็อกไว้ ([`docs/money-units.md`](docs/money-units.md)) |
| deploy หลักโดยไม่ deploy ฝั่งลูกค้าขั้น 0 | ถ้า backend ฝั่งลูกค้ายังเป็นโค้ดเดิม จะเขียน `product_type` + ตั้งสต็อก 0 ตอนปิดรอบต่อ → ควร deploy ฝั่งลูกค้าที่แก้ขั้น 0 พร้อมกัน แล้วค่อยรัน `cleanup:legacy-product-fields -- --apply` ([`docs/customer-backend-merge.md`](docs/customer-backend-merge.md) §8.2) |