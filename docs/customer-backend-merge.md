# รวม backend ฝั่งลูกค้าเข้ากับ backend หลัก — ผลวิเคราะห์ (2026-10-04)

> ตรวจ: 2026-10-04 · อ่านอย่างเดียว (ไม่ได้แก้ไฟล์ · ไม่ได้อ่านค่าใน `.env`)
> backend หลัก: `D:\1.2569\MeowMeeCake\NextJS-MeowMeeCake` (branch `fix/backlog4-y7-y11`)
> ฝั่งลูกค้า: `C:\Users\KimThanyalak\Downloads\backend\backend` (ไม่ใช่ git repo — ได้มาเป็นโฟลเดอร์ดาวน์โหลด)
> เกี่ยวข้อง: [`BACKLOG4.md`](BACKLOG4.md) R7 / §8.3 · [`money-units.md`](money-units.md)

## สรุป

**รวมได้ แต่เป็นงานใหญ่** — "ฝั่งลูกค้า" ไม่ใช่หน้าเว็บ แต่เป็น **backend ตัวที่ 2 ที่ต่อ MongoDB ตัวเดียวกัน** (321 ไฟล์ · model ~50 ·
controller ~70 · ไม่มีหน้าเว็บสักหน้า) มีทั้ง API ลูกค้า (`/api/customer/*` ~60 route) **และ** API เจ้าของร้าน (`/api/owner/*`) ซ้อนกับของหลัก
→ การรวม = รวม backend 2 ตัว ไม่ใช่ย้ายหน้าเว็บ · หน้าเว็บที่ลูกค้าใช้จริงน่าจะเป็นอีกโปรเจกต์ที่เรียกพอร์ต 4000 ตัวนี้

ตัวนี้คือที่มาของ "FrontOffice เขียน DB ตรง" ใน R7 (เลขออเดอร์ `ORD-<timestamp>` · เงินเป็นบาท · ไม่มี userlog ของหลัก)

## 1. เทียบ 2 backend

| เรื่อง | backend หลัก | ฝั่งลูกค้า |
|---|---|---|
| framework | Next 15.5 (App Router) · API + หลังร้าน frontend แยก repo | Next 16.2.6 · API ล้วน · `next dev -p 4000` |
| โครงโค้ด | `src/services/*` + route handler | `src/controllers/{Customer,Owner}/*` + `src/lib/*` (createCrudController) |
| API | `/api/admin/*` · `/api/shop/*` · `/api/catalog/*` · `/api/cron/*` | `/api/customer/*` · `/api/owner/*` · `/api/{products,orders,...}` ทั่วไป |
| ล็อกอิน | JWT cookie ของตัวเอง (`src/lib/session.ts`) · Google | **next-auth** (`/api/auth/[...nextauth]`) · ยืนยันอีเมล / ลืมรหัสผ่าน (nodemailer) |
| เลขออเดอร์ | `ORD-YYYYMMDD-xxxxxx` · `POS-` · `PRE-` | `ORD-<timestamp>-xxxx` · `PRE-<timestamp>-xxxx` (`checkoutController.ts:76`, `preorderController.ts:70`) |
| หน่วยเงิน | บาท (หลัง PR #57) | บาท |
| ประเภทสินค้า | `is_preorder` (boolean) | **`product_type`** แบบเก่า ("ready" / "preorder") |
| ผูก LINE ลูกค้า | `users.line_user_id` | `users.lineId` |
| ค่าส่ง | `DeliveryZones` | `ShippingZones` (+ จุดรับสินค้า / ตลาดนัดรายสัปดาห์) |
| dependencies เด่น | mongoose 9 · zod · LINE Messaging/Login | mongoose 9 · next-auth 4 · nodemailer 7 · promptpay-qr · qrcode |

## 2. 🔴 จุดที่ขัดกันตอนนี้ (กระทบข้อมูลจริงแล้ว)

| # | เรื่อง | ผล |
|---|---|---|
| 1 | **`product_type` กับ `is_preorder`** — DB จริงย้ายเป็น `is_preorder` แล้ว (2026-10-01, R2) แต่ฝั่งลูกค้ายังกรอง `product_type: { $ne: "preorder" }` (`cartItemController.ts:100`, `checkoutController.ts:158`, `posCheckoutController.ts:128`) | สินค้าพรีออเดอร์ถูกมองเป็นสินค้าปกติ → ใส่ตะกร้า/ขายได้ |
| 2 | ตอนปิดรอบ `preorderRoundController.ts:207-208` เขียน **`{ product_type: "ready", product_stock_quantity: 0 }`** กลับลง DB | ฟิลด์เก่ากลับมา (ตัวตรวจ Y11 แจ้ง `legacy_fields`) · **สต็อกถูกตั้งเป็น 0** |
| 3 | ผูก LINE คนละฟิลด์ (`lineId` / `line_user_id`) | ลูกค้าผูกฝั่งหนึ่ง อีกฝั่งไม่เห็น → แจ้งเตือนลูกค้าของหลักไม่ถึง |
| 4 | ค่าส่งคนละระบบ (`ShippingZones` / `DeliveryZones`) | ค่าส่งของออเดอร์จาก 2 ทางคิดคนละตาราง |
| 5 | ตัดสต็อก · แจ้งเตือน · กฎพรีออเดอร์ (กำหนดชำระ #55 · ใบผลิตอัตโนมัติ · ลดใบผลิตเมื่อยกเลิก) คนละชุด | ออเดอร์จากฝั่งลูกค้าไม่เข้ากฎของหลัก (ไม่มี LINE ถึงร้าน · ไม่มี `payment_due_at` · ไม่บวก/ลดใบผลิต) |
| 6 | เลขออเดอร์ `ORD-<timestamp>` | dashboard / สรุปรายเดือนนับเป็นช่อง "อื่น ๆ" ไม่ใช่ "เว็บ" |

## 3. เทียบ model (collection เดียวกันใน MongoDB)

**เฉพาะหลัก:** `Attendances` · `DeliveryZones`
**เฉพาะฝั่งลูกค้า:** `Bundles` · `CustomerNotifications` · `Interactions` · `PointTransactions` · `ProductVariantGroups` · `ReviewPresets` ·
`SearchSynonyms` · `ShippingZones` · `StoreProfile` · `StoreSettings` · `TemporaryPermissions` · `UserCoupons`

**มีทั้งสองฝั่ง — field ต่างกัน** (field ตรงกัน: Addresses · Carts · ComponentCategory · Components · Expenses · IngredientCategory ·
Ingredients · Permissions · PreorderRoundItems · ProductionOrders · PromotionUsages · Recipes · Roles · SentimentResults · Units · UserLogs)

| model | มีเฉพาะหลัก | มีเฉพาะฝั่งลูกค้า |
|---|---|---|
| Products | `product_id` · `purchase_cost` · `is_preorder` · `low_stock_threshold` | `product_type` |
| Orders | — | `bundle_id` · `bundle_lines` · `point_id/point_name` · `pickup_date/pickup_point` · `address` · `note` · `stock_deducted/stock_restored` · `points_redeemed/points_discount` · `user_coupon_id` ฯลฯ |
| OrderItems / CartItems / PreorderItems | — | `group_name` · `variant_price` · `selected_variants` · `bundle_id` · `customization_key` (+ option ใน PreorderItems) |
| Preorders | `pickup_reminded_at` · `payment_due_at` · `added_to_production_at` · `removed_from_production_at` | `point_id/point_name` · `pickup_point` · `points_*` · `user_coupon_id` ฯลฯ |
| Users | `line_user_id` | `lineId` · `refund_promptpay_id/name` · `password_changed_at` |
| Promotions | `applicable_products` · `applicable_categories` · `min_quantity` | `points_cost` · `customer_notified_at` |
| Reviews | — | `video` · `aspect_feedback` · `status` · `is_pinned` · `shop_reply` · `internal_tags/note` · `read_at/by` |
| ProductVariants / ProductOptions | — | `group_id` · `display_order` |
| อื่น ๆ | Notifications `line_sent/line_error` · ProductionItems `product_stock_added_*` · IngredientTransactions `production_item_id` · Banners `banner_description` | ProductCategories `ships_nationwide` · PreorderRounds `customer_notified_at` · Aspects `is_active/display_order/icon/placeholder_text` · SemanticTerms `kind` |

## 4. ฟีเจอร์ที่มีเฉพาะฝั่งลูกค้า (ต้องย้ายถ้ารวม)

> รายละเอียดระดับ route + ตารางเทียบ → [§7](#7-เทียบระดับ-api--ฝั่งลูกค้ามีแต่หลักไม่มี-ตรวจ-2026-10-05)

ชุดสินค้า (bundles) · แต้มสะสม (points + แชร์แต้ม) · คูปองส่วนตัว (`UserCoupons`) · รายการโปรด · จุดรับสินค้า / ตลาดนัดรายสัปดาห์ ·
payment link · แนะนำสินค้า + ตรวจสารก่อภูมิแพ้ · คำค้นหาเทียบเคียง (search synonyms) · ตั้งค่า/ข้อมูลร้าน (store settings/profile/logo/map) ·
แจ้งเตือนถึงลูกค้าในเว็บ (`CustomerNotifications`) · จัดการรีวิว (ปักหมุด · ตอบกลับ · preset · analytics) · ตัวเลือกสินค้าแบบกลุ่ม
(`ProductVariantGroups` · product customization) · ยืนยันอีเมล / ลืมรหัสผ่าน · ติดต่อร้าน · สิทธิ์ชั่วคราว (`TemporaryPermissions`) · QR พร้อมเพย์

## 5. แนวทางที่แนะนำ (เป็นขั้น)

| ขั้น | ทำอะไร | ผล |
|---|---|---|
| **0 (ด่วน)** | ฝั่งลูกค้า: `product_type` → `is_preorder` (กรองตะกร้า/checkout/POS) · เลิกเขียน `product_type`/ตั้งสต็อก 0 ตอนปิดรอบ | หยุดข้อมูลเพี้ยนทันที — แก้ไม่กี่จุด |
| 1 | ขยาย model ของหลักให้มีฟิลด์ฝั่งลูกค้า (bundle · points · pickup · variant groups · review moderation ฯลฯ) · เลือกฟิลด์ผูก LINE ตัวเดียว (+ ย้ายข้อมูล) · เลือกระบบค่าส่งชุดเดียว | schema เดียวกันทั้ง DB |
| 2 | ย้าย `/api/customer/*` เข้า backend หลัก **path เดิม** (หน้าเว็บลูกค้าไม่ต้องแก้) — เรียก service ของหลัก (สต็อก · เงิน · เลขออเดอร์ · แจ้งเตือน LINE · กำหนดชำระ · ใบผลิต) · ฟีเจอร์เฉพาะฝั่งลูกค้าย้ายตามทีละกลุ่ม | กฎธุรกิจชุดเดียว |
| 3 | ล็อกอินลูกค้าจาก next-auth → ระบบของหลัก (มี Google อยู่แล้ว · เพิ่มยืนยันอีเมล/ลืมรหัสผ่าน) · ปิด backend พอร์ต 4000 | เหลือ backend ตัวเดียว |
| — | `/api/owner/*` ของฝั่งลูกค้า **ไม่ต้องย้าย** — หลังร้านใช้ `/api/admin/*` ของหลักอยู่แล้ว · ย้ายเฉพาะฟีเจอร์ที่หลักยังไม่มี (รีวิว moderation · ตั้งค่าร้าน · จุดรับสินค้า) | — |

## 6. ต้องตอบก่อนเริ่ม

1. **หน้าเว็บลูกค้า (ตัวที่เรียกพอร์ต 4000) อยู่ที่ path ไหน** — ต้องดูว่าเรียก API ไหนบ้าง
2. ฝั่งลูกค้ายังมีทีมพัฒนาต่อไหม · โค้ดที่ส่งมา (`Downloads`, ไม่มี git) ตรงกับตัวที่รันจริงหรือเปล่า
3. เริ่ม**ขั้น 0** เลยไหม (แก้ในโปรเจกต์ฝั่งลูกค้า)
4. ฟิลด์ผูก LINE (`lineId` / `line_user_id`) และระบบค่าส่ง (`ShippingZones` / `DeliveryZones`) จะใช้ตัวไหนเป็นหลัก

---

## 7. เทียบระดับ API — ฝั่งลูกค้ามีแต่หลักไม่มี (ตรวจ 2026-10-05)

> ฝั่งลูกค้า 138 route · หลัก 168 route · เทียบ route + model + `src/lib/*` (อ่านอย่างเดียว) · ละเอียดกว่า §4

### 7.1 ❌ ไม่มีในหลักเลย (ต้องย้ายถ้ารวม)

| # | ฟีเจอร์ | route ฝั่งลูกค้า | หมายเหตุ |
|---|---|---|---|
| 1 | ชุดสินค้า (bundle) | `/bundles` · `/customer/bundles` | ออเดอร์มี `bundle_id` · `bundle_lines` |
| 2 | แต้มสะสม + แชร์แต้ม | `/customer/points` · `/points/share` | model `PointTransactions` · ออเดอร์ `points_redeemed/discount` |
| 3 | คูปองส่วนตัว (ดู/เช็ค/แลก) | `/customer/coupons` · `/check` · `/redeem` | model `UserCoupons` · โปรโมชัน `points_cost` (แลกด้วยแต้ม) |
| 4 | รายการโปรด | `/customer/favorites` | |
| 5 | จุดรับสินค้า / ตลาดนัดรายสัปดาห์ | `/customer/pickup-locations` · `/weekly-markets` | ออเดอร์ `pickup_point` · `pickup_date` |
| 6 | payment link | `/customer/payment-link` · `/redeem` | |
| 7 | QR พร้อมเพย์ให้ลูกค้าจ่าย | `/customer/orders/[id]/payment` | ไลบรารี `promptpay-qr` · หลักมีแค่ `promptpay_ref` |
| 8 | แนะนำสินค้า / สินค้าคล้ายกัน / ตรวจสารก่อภูมิแพ้ | `/customer/recommendations` · `/similar/[id]` · `/products/recommended` · `/customer/ingredients` | model `Interactions` |
| 9 | คำค้นหาเทียบเคียง | `/customer/search-synonyms` · `/owner/search-synonyms` | |
| 10 | ข้อมูล/ตั้งค่าร้าน (โลโก้ · แผนที่) | `/owner/store-profile` · `/store-settings` · `/map-link` · `/customer/store-info` · `/store-logo` | |
| 11 | แจ้งเตือนถึงลูกค้าในเว็บ | `/customer/notifications` | หลักแจ้งลูกค้าทาง LINE อย่างเดียว |
| 12 | ติดต่อร้าน (อีเมล) | `/customer/contact` | nodemailer |
| 13 | ยืนยันอีเมล / ลืมรหัสผ่าน / ตั้งรหัสใหม่ | `/user/verify-email` · `/auth/forgot-password` · `/auth/reset-password` | หลักมี field ใน user model แต่ไม่มี route |
| 14 | จัดการรีวิวขั้นสูง | `/owner/reviews` (+ `bulk` · `analytics` · `dashboard` · `filter-options` · `products/[id]`) · `/owner/review-presets` | ตอบกลับ · ปักหมุด · สถานะ · แท็ก/โน้ตภายใน · อ่านแล้ว — หลักมีแค่ซ่อน + sentiment |
| 15 | อัปโหลดรูป/วิดีโอในรีวิว | `/customer/reviews/upload` | |
| 16 | หมวดรีวิว (aspect) แบบเต็ม | `/owner/aspects/reorder` | เรียงลำดับ · เปิด/ปิด · ไอคอน |
| 17 | ตัวเลือกสินค้าแบบกลุ่ม | `/owner/products/[id]/customization` | `ProductVariantGroups` (เช่นเลือกครีมชีส/มะยงชิด) — ⚠️ ชนกับ Y9 ของหลัก (ตัวเลือกมีสต็อก) |
| 18 | แจ้งลูกค้าเมื่อเปิดรอบ/มีโปรใหม่ | (`customerBroadcast`) | `customer_notified_at` ของรอบ/โปรโมชัน |
| 19 | dashboard รอบพรีออเดอร์ + รายชื่อลูกค้าในรอบ | `/owner/preorder-rounds/dashboard` · `/[id]/customers` | หลักกรองพรีออเดอร์ตามรอบได้ แต่ไม่มีหน้าสรุป |
| 20 | ยกเลิกออเดอร์ทั่วไปที่ไม่จ่ายอัตโนมัติ + นโยบายยกเลิกของลูกค้า | (`orderExpiry` · `cancelPolicy`) | หลักมีกำหนดชำระเฉพาะพรีออเดอร์ |
| 21 | ข้อมูลคืนเงินพร้อมเพย์ของลูกค้า | (field user) | `refund_promptpay_id/name` |
| 22 | หมวดสินค้าส่งทั่วประเทศ | (field หมวด) | `ships_nationwide` |

### 7.2 ⚠️ มีในหลัก แต่ออกแบบต่างกัน (ต้องเลือกมาตรฐาน)

| เรื่อง | ฝั่งลูกค้า | หลัก |
|---|---|---|
| ค่าส่ง | `ShippingZones` | `DeliveryZones` + `/admin/delivery-fee` |
| ล็อกอิน | next-auth | JWT cookie + Google |
| ผูก LINE | `/line/connect` · `/callback` · `lineId` | `/shop/me/line` · `line_user_id` |
| ขายหน้าร้าน | เรียกครั้งเดียว `/owner/pos-checkout` | สร้างออเดอร์ → ชำระเงิน → ยืนยัน (หลายครั้ง) |
| สิทธิ์ชั่วคราว | `/permissions/temporary` | `expires_at` บน permission |
| รายงานยอดขาย | `/reports/sales` | `/admin/dashboard/*` |

### 7.3 ✅ มีเทียบเท่ากันแล้ว

สมัคร/ล็อกอิน · ที่อยู่ · ตะกร้า · สั่งซื้อ · พรีออเดอร์ + รอบ · ชำระเงิน/สลิป · แคตตาล็อก/หมวด/รายละเอียดสินค้า/รีวิว · แบนเนอร์ ·
ตรวจโค้ดโปรโมชัน · แจ้งเตือนเจ้าของร้าน · ฝั่งเจ้าของร้านทั้งหมด (สินค้า · หมวด · วัตถุดิบ · สูตร · ส่วนประกอบ · การผลิต · ค่าใช้จ่าย ·
โปรโมชัน · ผู้ใช้ · role · สิทธิ์ · userlog · หน่วย · aspect · คำวิเคราะห์รีวิว)

### 7.4 หลักมี แต่ฝั่งลูกค้าไม่มี (ประกอบการตัดสินใจ)

กำหนดชำระพรีออเดอร์ + ยกเลิกอัตโนมัติ · สร้างใบผลิตอัตโนมัติตอนปิดรอบ · เพิ่มสต็อกเมื่อผลิตเสร็จ · แจ้งเตือน LINE ถึงร้าน (+ ลิงก์ 🔗) ·
สรุปยอดรายเดือน · ตรวจข้อมูลผิดปกติรายวัน · ลงเวลาทำงาน · สลิปเป็นไฟล์ส่วนตัว (#54) · สถานะจัดส่ง/เลขพัสดุ · dashboard แยกช่องทาง
