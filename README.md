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
- **สรุปรวมการแก้บั๊กความถูกต้องข้อมูล 2.8–2.11 → [`docs/data-integrity-fixes.md`](docs/data-integrity-fixes.md)**
- **บันทึกกิจกรรมผู้ใช้ (audit log) → [`docs/auditLog.md`](docs/auditLog.md)**
- **ระบบพรีออเดอร์ (รอบ / โควตา / API) → [`docs/preorder.md`](docs/preorder.md)**
- **สิ่งที่ต้องแก้ไข / ปรับ / บั๊ก + Migration checklist → [`docs/BACKLOG.md`](docs/BACKLOG.md)**
- **แผนงานคุณภาพ / hardening (§3 ชั้น D) → [`docs/hardening-plan.md`](docs/hardening-plan.md)**
- **Infra / tooling: ESLint · Logger · Testing (§3.6 / 3.3 / 3.4) → [`docs/infra-tooling.md`](docs/infra-tooling.md)**

สคริปต์:
```
npm run typecheck              # tsc --noEmit
npm run build
npm run seed                   # สร้าง role / units / หมวดหมู่ / owner user
npm run backfill:product-codes # เติมรหัสสินค้า pos-/pre- ให้ของเดิม
npm run sync-indexes           # ปรับ index ใน DB ให้ตรง schema (+ --fix เพื่อลบข้อมูลซ้ำ)
npm run seed:preorder-rounds   # สร้างรอบพรีออเดอร์ตัวอย่าง (ซาวโดว์) 4 รอบ สำหรับเทสฝั่งลูกค้า
```