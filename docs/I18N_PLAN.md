# แผน i18n — รองรับ 2 ภาษา (ไทย / อังกฤษ)

> ทำ **ก่อน** เริ่มสร้าง component/screen — เพื่อให้ทุกชิ้น i18n-ready ตั้งแต่แรก ไม่ต้องย้อนมาแก้
> เพิ่มเป็น **เฟส 0.5** ใน `REBUILD_PLAN.md`

---

## 1. ขอบเขต

- 2 locale: `th` (ค่าเริ่มต้น) · `en`
- ต้นทางเป็นภาษาไทย hardcode ทั้งหมด (JSX, label maps, enum config, เมนู, breadcrumb, sweetalert)
- **ไม่แตะ URL** — ไม่มี `/th` `/en` prefix (คง 27 route เดิม) → เก็บ locale ใน cookie
- สกุลเงินคง THB ทั้ง 2 ภาษา (ธุรกิจอยู่ไทย) — ต่างแค่การจัดรูปแบบ/ข้อความ

---

## 2. เลือกไลบรารี

| ตัวเลือก | ข้อดี | ข้อเสีย |
|---|---|---|
| **`next-intl` (no i18n routing)** ← แนะนำ | App Router native (RSC + client) · key แบบ typed · อ่าน locale จาก cookie ผ่าน `getRequestConfig` · จับคู่กับ `proxy.ts` ได้ | ต้องตั้ง provider ที่ root |
| `react-i18next` + `i18next` | เบา, ecosystem ใหญ่, ทุกอย่างเป็น client อยู่แล้ว | RSC ไม่รองรับดี · เสี่ยง hydrate flash · ต้องจัด init เอง |

**สรุป: `next-intl`** — เพราะ providers.tsx/layout เป็น server component ได้ และคุมทั้ง server (API error message) + client ด้วย catalog เดียว

> ⚠️ เวอร์ชัน: `next-intl@3.26` peer = `next ^10..^15` **ไม่รับ next 16** → ต้องใช้ **`next-intl@^4`** (v4 รองรับ Next 15+/16) · ตรวจ peer + API เปลี่ยน (`getRequestConfig`, `requestLocale`) ตอนติดตั้งจริงเฟส 0.5

---

## 3. โครงไฟล์

```
src/i18n/
  config.ts        # locales = ['th','en'] · defaultLocale = 'th' · LOCALE_COOKIE = 'mmc_locale'
  request.ts       # next-intl getRequestConfig: อ่าน cookie → import messages/<locale>.json
  format.ts        # currency/number/percent/date helpers รับ locale (แทน fmtBaht/formatCurrency/fmt/fmtDateTH/fmtPct)
  useLocale.ts     # hook อ่าน locale ปัจจุบัน + setLocale(next) (เขียน cookie + router.refresh())
  messages/
    th.json
    en.json
```

`proxy.ts` (เดิม): เพิ่ม — ถ้าไม่มี cookie `mmc_locale` ให้ set = `defaultLocale` (หรือเดาจาก `Accept-Language` ครั้งแรก)

`app/layout.tsx`: ครอบ `<NextIntlClientProvider>` + ส่ง `locale` ลง `<html lang={locale}>`

`app/providers.tsx`: เลือก antd locale ตาม active locale
```
locale === 'th' ? thTH : enUS      // antd ConfigProvider
dayjs.locale(locale)                // th | en
```

---

## 4. โครง message catalog (namespace = key ระดับบนสุด)

| namespace | ที่มา |
|---|---|
| `common` | ปุ่ม/ข้อความซ้ำ: บันทึก, ยกเลิก, ลบ, แก้ไข, เพิ่ม, ค้นหา, กำลังโหลด..., ไม่มีข้อมูล |
| `nav` | label เมนู sidebar (`menuSections`) |
| `breadcrumb` | `ROUTE_LABELS` ใน `owner/layout.tsx` (key = route path) |
| `auth` | หน้า login |
| `dashboard` `products` `orders` `pos` `ingredients` `production` `recipes` `employees` `permissions` `attendance` `finance` `storeDesign` `notifications` | ข้อความเฉพาะแต่ละ screen group (27 หน้า) |
| `entities` | `ENTITY_LABELS_TH` (37 คีย์ = modelName) |
| `fields` | `FIELD_LABELS_TH` (~90 คีย์ = ชื่อ field) |
| `actions` | `ACTION_VERB_TH` (CREATE/UPDATE/DELETE) |
| `enums` | ค่าที่แสดงจาก enum — ดู §5 |
| `validation` | ข้อความ error ฟอร์ม + จาก API |
| `alert` | ปุ่ม/หัวข้อ sweetalert (`lib/alert.ts`) |

**คีย์:** ใช้ `camelCase.dot.path` · ห้ามใช้ข้อความไทยเป็นคีย์

---

## 5. Enum values → i18n

`enums` namespace map จาก **ค่าที่เก็บใน DB/type** → ข้อความ:

| enum group | ค่า (key) | มาจาก |
|---|---|---|
| `enums.orderStatus` | pending, confirmed, preparing, ready, completed, cancelled | `orderTypes.STATUS_CONFIG` |
| `enums.paymentStatus` | pending, paid, failed, refunded | `orderTypes.PAYMENT_STATUS_CONFIG` |
| `enums.productionStatus` | planned, in_progress, done, cancelled | `productionTypes` |
| `enums.productionItemStatus` | pending, in_progress, done, cancelled | `productionTypes` |
| `enums.sourceType` | manual, preorder | `productionTypes` |
| `enums.stockStatus` | ok, low, out | `Ingredienttypes` |
| `enums.ingredientTxnType` | use, receive, adjust | `ingredientTransactionModel` |
| `enums.unitType` | IngredientWeight, ... , Custom (11) | `unitContext.UNIT_TYPE_LABELS` |
| `enums.promotionChannel` | online, instore | `promotionChannel` |
| `enums.salesChannel` | online, walkin | `salesTypes` |
| `enums.recipeCategory` | *(ค่าปัจจุบันเป็นไทย)* เนื้อเค้ก/ครีม/ไส้/ท็อปปิ้ง/แป้ง/อื่นๆ | `recipetypes` |
| `enums.notificationType` | warning, info, success, error | `notificationModel` |
| `enums.notificationModule` | order, ingredient, production, employee, finance, system | `notificationModel` |
| `enums.attendanceStatus` | *(ค่าปัจจุบันเป็นไทย)* มาทำงาน/มาสาย/ขาดงาน/ลาป่วย/ลากิจ/วันหยุด | `attendanceModel` |
| `enums.expenseCategory` | *(ไทย)* วัตถุดิบ/บรรจุภัณฑ์/... (8) | `expenseModel` |
| `enums.expensePaymentMethod` | *(ไทย)* เงินสด/โอนเงิน/บัตรเครดิต/QR Code | `expenseModel` |
| `enums.employmentType` | full_time, part_time | `types/index.ts` |
| `enums.authProvider` | local, google | `types/index.ts` |

### DB enum ที่เก็บค่าไทย — วิธีจัดการ (ตัดสินใจ)
`Attendances.status`, `Expenses.category`, `Expenses.payment_method` เก็บสตริงไทยเป็นค่า enum

- **แนวทาง A (แนะนำรอบนี้):** คงค่าใน DB เดิม · UI ไม่ render ค่าดิบ — ผ่าน `t('enums.<group>.<value ไทย>')` เสมอ · `en.json` map ค่าไทยนั้น → English · ข้อดี: ไม่มี migration, ไม่ต่างจากต้นทาง (สอดคล้อง D2)
- **แนวทาง B (อนาคต):** เปลี่ยน schema enum เป็น key EN เสถียร (`present`/`late`/...) + สคริปต์ migrate ข้อมูลเดิม · สะอาดกว่า แต่แตะ model + ต้อง migrate

---

## 6. แปลง constant/util เดิม (ดู `INVENTORY.md` §3–4)

| เดิม | ใหม่ |
|---|---|
| `entityLabelTh(x)` | wrapper บาง ๆ ของ `t('entities.'+x)` (หรือแทน call site) |
| `fieldLabelTh(x)` | wrapper ของ `t('fields.'+x)` |
| `UNIT_TYPE_LABELS` / `UNIT_TYPE_OPTIONS` | `t('enums.unitType.*')` + hook `useUnitTypeOptions()` |
| `CHANNEL_LABEL_TH` | `t('enums.promotionChannel.*')` |
| `*_CONFIG` ที่มี `label` | แยก `label` ออก — เหลือแต่สี/flow ใน `constants/enumConfig/` · ข้อความไป `enums.*` |
| `formatCurrency` `fmtBaht` `fmt` `fmtDateTH` `fmtPct` | `src/i18n/format.ts` ตัวเดียว รับ `locale` (ใช้ `Intl.NumberFormat` / `next-intl` `useFormatter`) |
| `alert.ts` ปุ่มไทย | รับ label จาก `t('alert.*')` / `t('common.*')` |

---

## 7. Locale switcher (UI)

- เพิ่มใน `UserMenuDropdown` (navbar): ปุ่ม TH / EN
- กด → `setLocale('en')` → เขียน cookie `mmc_locale` + `router.refresh()`
- (อนาคต) จำค่าไว้ใน user profile ด้วย

---

## 8. ป้องกัน regression

- สคริปต์ lint: หา literal อักษรไทย (`[฀-๿]`) ใน `src/**/*.tsx` ที่ **ไม่ได้อยู่ใน** `src/i18n/messages/` → เตือน
- รันใน CI / ก่อน commit เฟส 3–4

---

## 9. ลำดับงาน i18n (เฟส 0.5)

1. ติดตั้ง `next-intl` · สร้าง `src/i18n/{config,request,format,useLocale}.ts` + `messages/{th,en}.json` เปล่า (โครง namespace §4)
2. เดินสาย provider: `proxy.ts` (set cookie) → `app/layout.tsx` (`NextIntlClientProvider`, `<html lang>`) → `providers.tsx` (antd locale + dayjs)
3. ย้าย label map เดิม (`entityLabels`, `fieldLabels`, `unitContext`, `promotionChannel`, breadcrumb, sidebar) เข้า catalog — เติมทั้ง `th` (จากต้นทาง) + `en` (แปลใหม่)
4. `src/i18n/format.ts` แทนฟังก์ชัน format ที่กระจาย
5. `enums` namespace ครบทุกกลุ่ม §5 + ตัดสิน DB-enum แนวทาง A
6. Locale switcher ใน navbar
7. สคริปต์ lint §8
8. ตั้งแต่เฟส 3 เป็นต้นไป: **ทุก component/screen ใช้ `t()` ตั้งแต่เขียนครั้งแรก** — ห้าม hardcode

---

## 10. เชื่อมกับ REBUILD_PLAN

- เฟส 0.5 (นี้) แทรกหลังเฟส 0 ก่อนเฟส 1
- เฟส 3 (component library): เพิ่มเกณฑ์ — component ผ่านได้ต่อเมื่อไม่มี literal ข้อความ
- เฟส 6 (verify): รันสคริปต์ lint i18n + สลับ locale เดินครบ 27 screen
- D9 (ใหม่): ไลบรารี i18n = `next-intl` · DB-enum = แนวทาง A
