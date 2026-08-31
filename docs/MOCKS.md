# จุดที่ Mock ไว้ (ต้องถอดเมื่อได้ของจริง)

> เหตุ: ยังไม่มี `.env.local` / `MONGODB_URI` (D6) — ผู้ใช้จะส่งให้ทีหลัง
> กติกา: ทุกจุดที่ mock ต้องมีคอมเมนต์ `// MOCK:` ในโค้ด + ลงตารางนี้
> ตรวจครบด้วย: `grep -rn "MOCK:" src/`

---

## สถานะ

| หมวด | สถานะ | หมายเหตุ |
|---|---|---|
| DB connection | ⏳ ยังไม่ทำ | รอเริ่มเฟส 1 |
| Auth / session | ⏳ ยังไม่ทำ | |
| API data (CRUD) | ⏳ ยังไม่ทำ | |
| External services | ⏳ ยังไม่ทำ | omise (QR payment), email |

---

## รายการ mock

| # | ไฟล์ / จุด | mock อะไร | ของจริงคือ | เงื่อนไข fallback | ถอดอย่างไร |
|---|---|---|---|---|---|
| _(ยังไม่มี — จะเพิ่มระหว่างเฟส 1–4)_ | | | | | |

<!--
ตัวอย่างรูปแบบแถว:
| 1 | `src/lib/dbConnect.ts` | ข้ามการต่อ MongoDB เมื่อไม่มี `MONGODB_URI` | ต่อ mongoose จริง | `!process.env.MONGODB_URI` | ใส่ `MONGODB_URI` ใน `.env.local` แล้วลบ branch `// MOCK:` |
| 2 | `src/mocks/db.ts` | fixture ให้ `createCrudController` คืนแทน query | query จาก collection จริง | flag `USE_MOCK_DB` | ลบ import ใน controller base |
| 3 | `src/app/api/auth/login/route.ts` | รับ login ทุก credential → คืน user owner ปลอม | ตรวจ bcrypt กับ Users จริง | `USE_MOCK_DB` | ลบ branch mock |
| 4 | `src/app/api/auth/me/route.ts` | คืน currentUser + menuAccess ปลอม (role owner, full access) | อ่านจาก session + Role จริง | `USE_MOCK_DB` | ลบ branch mock |
| 5 | `src/lib/omise.ts` | คืน QR/charge ปลอม | เรียก Omise API | ไม่มี key | ใส่ key จริง |
-->

---

## Fixture ที่เตรียมไว้ (`src/mocks/`)

| ไฟล์ | entity | จำนวน record | ใช้กับ screen |
|---|---|---|---|
| _(จะเพิ่มตอนทำ)_ | | | |

---

## Checklist ตอนได้ `.env.local` จริง

- [ ] ใส่ค่าใน `.env.local`: `MONGODB_URI`, `JWT_SECRET`, `JWT_EXPIRE`, `JWT_COOKIE_EXPIRE` (+ Google OAuth / email / omise ถ้าเปิดใช้)
- [ ] เอา `USE_MOCK_DB` ออก / ลบทุก branch `// MOCK:`
- [ ] ลบโฟลเดอร์ `src/mocks/`
- [ ] seed: อย่างน้อย 1 Role (owner, full permission) + 1 User login ได้
- [ ] `grep -rn "MOCK:" src/` → ต้องไม่เหลือ
- [ ] เดิน 27 screen ซ้ำด้วยข้อมูลจริง
