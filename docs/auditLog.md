# Audit Log — บันทึกกิจกรรมผู้ใช้

> อัปเดตล่าสุด: 2026-09-02

## 1. Audit log คืออะไร ทำไมต้องมี

**Audit log** = บันทึกว่า **"ใคร ทำอะไร กับข้อมูลไหน เมื่อไหร่ จาก IP ไหน"**

ตัวอย่างคำถามที่ audit log ตอบได้:
- ใครเปลี่ยนสถานะออเดอร์ #OP-260902-A1B2 เป็น "cancelled" เมื่อวานนี้
- พนักงานคนไหนอนุมัติสลิปที่ยอดไม่ตรง
- ใครลบสินค้า / ใครให้สิทธิ์เมนู "payments" กับบทบาท staff
- บัญชีนี้มีการปรับสต็อกวัตถุดิบกี่ครั้งในเดือนนี้

ใช้สำหรับ: ตรวจสอบย้อนหลังเมื่อข้อมูลผิดปกติ · หาสาเหตุทุจริต · ความรับผิดชอบของพนักงาน (accountability)

**ข้อสำคัญ:** log เป็นแบบ **append-only** — เขียนเข้าอย่างเดียว ไม่มี API ให้แก้ไข/ลบ (กันคนลบร่องรอยตัวเอง)

---

## 2. เก็บที่ไหน

MongoDB collection **`userlogs`** (model `UserLogs` — `src/models/userLogModel.ts`)

| ฟิลด์ | ชนิด | ความหมาย |
|---|---|---|
| `user_id` | ObjectId → Users | **ผู้กระทำ** (actor) — คนที่ล็อกอินอยู่ตอนยิง request |
| `action` | String | ข้อความอธิบายสิ่งที่ทำ เช่น `"เปลี่ยนสถานะออเดอร์เป็น \"confirmed\""` |
| `action_type` | String (enum) | ประเภท: `CREATE` `READ` `UPDATE` `DELETE` `LOGIN` `LOGOUT` `OTHER` |
| `entity` | String | ชนิดข้อมูลที่ถูกกระทำ เช่น `"Order"` `"Payment"` `"Product"` |
| `entity_id` | ObjectId \| null | `_id` ของเอกสารที่ถูกกระทำ (ไว้ trace กลับ) |
| `ip_address` | String \| null | IP ของ client (จาก header `x-forwarded-for` / `x-real-ip`) |
| `details` | Mixed | ข้อมูลเสริมย่อ ๆ เช่น `{ order_status: "confirmed", cancelled_reason: null }` |
| `before` | Mixed | (ออปชัน) ข้อมูลก่อนแก้ — ตอนนี้ยังไม่ค่อยได้ใช้ |
| `after` | Mixed | (ออปชัน) ข้อมูลหลังแก้ |
| `created_at` | Date | เวลาที่บันทึก (timestamps อัตโนมัติ) |

**Index:** `user_id` · `{entity, entity_id}` · `action_type` · `created_at` (ใหม่→เก่า)

---

## 3. ระบบทำงานอย่างไร (ภาพรวม)

```
Route handler (เช่น PATCH /api/admin/orders/[id]/status)
    │
    ├─ 1. withPermission(...) ตรวจสิทธิ์ผ่าน
    ├─ 2. เรียก service ทำงานจริง (updateOrderStatus)  ← ถ้า service throw ก็ไม่ถึงขั้น log
    ├─ 3. audit(req, { action, action_type, entity, entity_id, details })
    │         │
    │         ├─ getSession(req)  → { user_id, ... }   (จาก header x-mmc-user ที่ middleware แนบ)
    │         ├─ clientIp(req)    → "1.2.3.4"
    │         └─ void writeLog({ user_id, ip_address, ...entry })   ← ไม่ await (fire-and-forget)
    │                  └─ userLogModel.create(...)  ← ถ้าพังจะ log warning เฉย ๆ ไม่ทำให้ request fail
    │
    └─ 4. return ok(result)   ← response กลับทันที ไม่รอ log เขียนเสร็จ
```

**หลักการ 3 ข้อ:**

1. **เรียกจาก route handler ไม่ใช่จาก service** — เพราะ actor (`user_id`) กับ IP รู้ได้เฉพาะที่ชั้น route (จาก session) · service ชั้นล่างไม่รู้ว่าใครเป็นคนสั่ง
2. **Fire-and-forget** — `audit()` ไม่ `await` การเขียน log → response ไม่ช้าลง · log เขียนต่อในพื้นหลัง (Node runtime process ยังอยู่)
3. **ไม่มีวันทำให้ request พัง** — `writeLog()` จับ error ของตัวเองทั้งหมด ถ้าเขียน log ไม่ได้ก็แค่ `console.error` แล้วผ่านไป

---

## 4. `audit(req, entry)` — ใช้ยังไง

**ไฟล์:** `src/lib/audit.ts`

```ts
import { audit } from "@/lib/audit";

audit(req, {
  action: `เปลี่ยนสถานะออเดอร์เป็น "${body.order_status}"`,  // ข้อความอ่านเข้าใจ
  action_type: "UPDATE",                                     // CREATE | UPDATE | DELETE | ...
  entity: "Order",                                           // ชนิดข้อมูล
  entity_id: id,                                             // _id ของเอกสาร
  details: { order_status: body.order_status },              // (ออปชัน) ข้อมูลเสริม
});
```

| พารามิเตอร์ | จำเป็น | หมายเหตุ |
|---|---|---|
| `req` | ✅ | `NextRequest` ที่ handler รับเข้ามา — ใช้ดึง session + IP |
| `entry.action` | ✅ | ข้อความไทยอ่านรู้เรื่อง (แสดงในหน้า log) |
| `entry.action_type` | ✅ | `"CREATE"` เมื่อสร้างใหม่, `"DELETE"` เมื่อลบ, `"UPDATE"` เมื่ออื่น ๆ ที่แก้ข้อมูล |
| `entry.entity` | ✅ | ชื่อ entity แบบ PascalCase อังกฤษ เช่น `"Order"`, `"IngredientTransaction"` |
| `entry.entity_id` | แนะนำ | `_id` ของเอกสาร (string) — ถ้าไม่มีให้ใส่ `null` |
| `entry.details` | ไม่ | object เล็ก ๆ สรุปสิ่งที่เปลี่ยน (อย่าใส่ข้อมูลใหญ่/ลับ เช่น รหัสผ่าน) |
| `entry.before` / `entry.after` | ไม่ | สแนปช็อตก่อน/หลัง (ยังไม่ค่อยใช้) |

> ถ้าเรียก `audit()` โดยไม่มี session (เช่นใน endpoint สาธารณะ) → ฟังก์ชันจะไม่ทำอะไร (return เงียบ ๆ)

---

## 5. `crudRoutes` — option `audit: { entity }`

route ที่สร้างจากโรงงาน (`collectionRoutes` / `itemRoutes` / `restoreRoute`) เพิ่มบรรทัดเดียวก็ log อัตโนมัติ:

```ts
// src/app/api/admin/recipes/[id]/route.ts
export const { GET, PATCH, DELETE } = itemRoutes(recipeService, {
  auth: { menu: "recipes" },
  audit: { entity: "Recipe" },   // ← เพิ่มแค่นี้
});
```

จะได้ log อัตโนมัติเมื่อ:

| operation | `action` ที่บันทึก | `action_type` |
|---|---|---|
| POST (create) | `สร้างRecipe` | `CREATE` |
| PATCH (update) | `แก้ไขRecipe` | `UPDATE` |
| DELETE (remove) | `ลบRecipe` | `DELETE` |
| POST /restore | `กู้คืนRecipe` | `UPDATE` |

`entity_id` ดึงจาก `_id` ของเอกสารที่ service คืนกลับ

---

## 6. ตอนนี้ log อะไรบ้าง

### 6.1 Login / Logout (จาก `authService`)

| เหตุการณ์ | action | action_type | entity |
|---|---|---|---|
| เข้าสู่ระบบ (email/password) | `เข้าสู่ระบบ` | `LOGIN` | — |
| เข้าสู่ระบบผ่าน Google | `เข้าสู่ระบบผ่าน Google` | `LOGIN` | — |
| สมัครสมาชิก | `สมัครสมาชิก` | `CREATE` | `User` |
| ออกจากระบบ | `ออกจากระบบ` | `LOGOUT` | — |

### 6.2 ออเดอร์

| เหตุการณ์ | action | entity |
|---|---|---|
| ลูกค้าสั่งซื้อ | `สั่งซื้อ OP-...` | `Order` |
| แอดมินสั่งแทนลูกค้า | `สร้างออเดอร์แทนลูกค้า OP-...` | `Order` |
| เปลี่ยนสถานะ | `เปลี่ยนสถานะออเดอร์เป็น "confirmed"` | `Order` |
| อัปเดตจัดส่ง | `อัปเดตสถานะจัดส่ง` | `Order` |
| ลูกค้ายกเลิก | `ลูกค้ายกเลิกออเดอร์` | `Order` |
| ลบออเดอร์ | `ลบออเดอร์` | `Order` |

### 6.3 การชำระเงิน

| เหตุการณ์ | action | entity |
|---|---|---|
| อนุมัติสลิป | `อนุมัติการชำระเงิน` | `Payment` |
| ปฏิเสธสลิป | `ปฏิเสธการชำระเงิน` | `Payment` |
| คืนเงิน | `คืนเงิน` | `Payment` |
| ลบรายการชำระเงิน | `ลบรายการชำระเงิน` | `Payment` |

### 6.4 สต็อก

| เหตุการณ์ | action | entity |
|---|---|---|
| เคลื่อนไหวสต็อกวัตถุดิบ | `เคลื่อนไหวสต็อกวัตถุดิบ (receive) จำนวน 5` | `IngredientTransaction` |
| ยกเลิกรายการเคลื่อนไหว | `ยกเลิกรายการเคลื่อนไหวสต็อกวัตถุดิบ` | `IngredientTransaction` |
| ตั้งค่าสต็อกสินค้า | `ตั้งค่าสต็อกสินค้าเป็น 20` | `Product` |
| ปรับสต็อกสินค้า | `ปรับสต็อกสินค้า` | `Product` |

### 6.5 สิทธิ์ / ผู้ใช้ / บทบาท

| เหตุการณ์ | action | entity |
|---|---|---|
| ให้สิทธิ์เมนู | `ให้สิทธิ์เมนู "payments" แก่บทบาท` | `Permission` |
| แก้ไข / ถอน / กู้คืนสิทธิ์ | `แก้ไขสิทธิ์เมนู` / `ถอนสิทธิ์เมนู` / `กู้คืนสิทธิ์เมนู` | `Permission` |
| สร้าง / แก้ / ลบ / กู้คืน บทบาท | `สร้างRole` / `แก้ไขRole` / ... | `Role` |
| สร้างผู้ใช้ | `สร้างผู้ใช้ใหม่` | `User` |
| แก้ role / สถานะบัญชี | `แก้ไขสิทธิ์/สถานะบัญชีผู้ใช้` | `User` |
| ลบ / กู้คืน / ปลดล็อก ผู้ใช้ | `ลบผู้ใช้` / `กู้คืนผู้ใช้` / `ปลดล็อกบัญชีผู้ใช้` | `User` |
| แอดมินตั้งรหัสผ่านให้ | `แอดมินตั้งรหัสผ่านใหม่ให้ผู้ใช้` | `User` |

### 6.6 การผลิต

| เหตุการณ์ | action | entity |
|---|---|---|
| เริ่มงานผลิต | `เริ่มงานผลิต` | `ProductionOrder` |
| ปิดงานผลิต | `ปิดงานผลิต (หักสต็อกวัตถุดิบ)` | `ProductionOrder` |
| ยกเลิกงานผลิต | `ยกเลิกงานผลิต (คืนสต็อกวัตถุดิบ)` | `ProductionOrder` |
| หัก / คืน สต็อกรายการผลิต | `หักสต็อกวัตถุดิบตามสูตร (รายการผลิต)` / `คืนสต็อกวัตถุดิบ (รายการผลิต)` | `ProductionItem` |

### 6.7 แคตตาล็อก (ผ่าน `audit: { entity }` ของ factory)

| entity | route |
|---|---|
| `Product` | สร้าง/แก้/ลบ/กู้คืน + `ProductImage` (อัปโหลดรูป) |
| `Recipe`, `Component` | `/api/admin/recipes`, `/api/admin/components` |
| `Ingredient` | `/api/admin/ingredients` |
| `Promotion` | `/api/admin/promotions` |
| `Expense` | `/api/admin/expenses` |

---

## 7. ยังไม่ log (จะเพิ่มทีหลัง)

- `Unit`, หมวดหมู่สินค้า/วัตถุดิบ/ส่วนประกอบ, `Banner`, `ProductVariant`, `ProductOption`, `Aspect`, `SemanticTerm`
  → เพิ่ม `audit: { entity: "..." }` ในไฟล์ factory route ได้ทันที
- `shop/payments` (ลูกค้าแจ้งชำระเงิน / แนบสลิป)
- **`before` / `after` snapshot** — ตอนนี้เก็บแค่ `action` + `entity_id` + `details` ย่อ (เช่น รายชื่อ field ที่แก้) ยังไม่เก็บค่าก่อน/หลังแบบเต็ม

---

## 8. วิธีดู log

### API

| Method | Path | สิทธิ์ | หมายเหตุ |
|---|---|---|---|
| `GET` | `/api/admin/user-logs` | `employees.view` | รายการ log (ใหม่→เก่า) + pagination |
| `GET` | `/api/admin/user-logs/[id]` | `employees.view` | log รายตัว |
| `POST` | `/api/admin/user-logs` | `employees.create` | บันทึก log ด้วยมือ (กรณีพิเศษ) |

**Query params ของ `GET /api/admin/user-logs`:**

| param | ตัวอย่าง | ความหมาย |
|---|---|---|
| `user_id` | `?user_id=<id>` | เฉพาะกิจกรรมของผู้ใช้คนนี้ |
| `entity` | `?entity=Order` | เฉพาะ entity ชนิดนี้ |
| `entity_id` | `?entity_id=<id>` | เฉพาะเอกสารตัวนี้ (ประวัติของ 1 ออเดอร์) |
| `action_type` | `?action_type=DELETE` | เฉพาะประเภทนี้ |
| `date_from` / `date_to` | `?date_from=2026-09-01&date_to=2026-09-30` | ช่วงเวลา |
| `page` / `limit` | `?page=2&limit=50` | แบ่งหน้า |

**ตัวอย่าง:** ดูประวัติทั้งหมดของออเดอร์หนึ่ง
```
GET /api/admin/user-logs?entity=Order&entity_id=68b1...c3&limit=100
```

**ตัวอย่าง:** ดูว่าใครลบอะไรบ้างเดือนนี้
```
GET /api/admin/user-logs?action_type=DELETE&date_from=2026-09-01
```

---

## 9. วิธีเพิ่ม audit ให้ route ใหม่

### 9.1 route ที่เขียนเอง (hand-written)

```ts
import { audit } from "@/lib/audit";

export const PATCH = withPermission("orders", "update", async (_s, req, ctx) => {
  const { id } = await ctx.params;
  const body = await req.json();

  const result = await someService.doSomething(id, body);   // ← ทำงานจริงก่อน

  audit(req, {                                               // ← แล้วค่อย log (หลังสำเร็จ)
    action: "ทำอะไรบางอย่าง",
    action_type: "UPDATE",
    entity: "SomeEntity",
    entity_id: id,
    details: { changed: Object.keys(body) },
  });

  return ok(result);
});
```

**กติกา:**
- เรียก `audit()` **หลัง** service สำเร็จเสมอ (ถ้า service throw จะไม่ถึงบรรทัด audit — ไม่มี log ของสิ่งที่ไม่เกิดขึ้น)
- ต้องมี `req` ใน handler — ถ้าเดิมเป็น `_req` ให้เปลี่ยนเป็น `req`
- `details` ใส่ของเล็ก ๆ พอ **ห้ามใส่รหัสผ่าน / token / ข้อมูลบัตร**

### 9.2 route ที่ใช้ factory

```ts
export const { GET, POST } = collectionRoutes(xxxService, {
  sortable: [...], defaultSort: "...",
  auth: { menu: "..." },
  audit: { entity: "Xxx" },   // ← เพิ่มบรรทัดนี้
});
```

---

## 10. ข้อจำกัด / สิ่งที่ต้องรู้

| # | เรื่อง |
|---|---|
| 10.1 | **Fire-and-forget** → ถ้า process crash ทันทีหลัง response บาง log อาจหาย · เพียงพอสำหรับ audit-of-actions ไม่เหมาะเป็น "บัญชีการเงิน" ที่ห้ามหายแม้แต่รายการเดียว |
| 10.2 | **Actor มาจาก session** → ถ้า endpoint ไหนยังไม่ได้ต่อ auth layer (`getSession` คืน null) จะไม่มี log |
| 10.3 | **log เฉพาะที่ผ่าน route handler** → งานที่ service เรียกกันเอง (เช่น `orderService` เรียก `promotionUsageService`) ไม่ถูก log แยก |
| 10.4 | **ไม่มี before/after เต็ม** → ดูได้แค่ว่า "แก้ field ไหนบ้าง" ไม่เห็นค่าเดิม |
| 10.5 | **`action` เป็นข้อความ** ไม่ใช่ code → การกรอง/รายงานเชิงลึกต้องอิง `action_type` + `entity` เป็นหลัก |
| 10.6 | ข้อความ `action` ของ factory เป็นไทย+อังกฤษติดกัน เช่น `"สร้างRecipe"` (ตั้งใจให้สั้น — ปรับใน `crudRoutes.ACTION_LABEL` ได้) |
| 10.7 | log **ไม่มี TTL / ไม่มีการลบอัตโนมัติ** → ระยะยาวควรมี job ย้าย log เก่าไป cold storage |

---

## 11. ตัวอย่างเอกสารใน `userlogs`

**เปลี่ยนสถานะออเดอร์:**
```json
{
  "_id": "...",
  "user_id": "68b0f2...a1",              // พนักงานที่กด
  "action": "เปลี่ยนสถานะออเดอร์เป็น \"confirmed\"",
  "action_type": "UPDATE",
  "entity": "Order",
  "entity_id": "68b1c9...4d",
  "ip_address": "203.0.113.7",
  "details": { "order_status": "confirmed", "cancelled_reason": null },
  "created_at": "2026-09-02T03:21:44.000Z"
}
```

**อนุมัติการชำระเงิน:**
```json
{
  "user_id": "68b0f2...a1",
  "action": "อนุมัติการชำระเงิน",
  "action_type": "UPDATE",
  "entity": "Payment",
  "entity_id": "68b2aa...9f",
  "ip_address": "203.0.113.7",
  "details": { "approved": true },
  "created_at": "2026-09-02T03:25:10.000Z"
}
```

**ให้สิทธิ์เมนู:**
```json
{
  "user_id": "68af00...owner",
  "action": "ให้สิทธิ์เมนู \"payments\" แก่บทบาท",
  "action_type": "CREATE",
  "entity": "Permission",
  "entity_id": "68b3bb...12",
  "details": { "role_id": "68ae...staff", "menu_key": "payments" },
  "created_at": "2026-09-02T04:00:00.000Z"
}
```
