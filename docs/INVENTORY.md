# แจกแจง Model / Type / Constant / Util (จากต้นทาง `-MeowMeeCake-NextJS5`)

> ใช้เป็นรายการอ้างอิงตอน port + ตอนทำ i18n (ดู `I18N_PLAN.md`)
> ตัวเลข: **38 models · 38 controllers · 12 lib · 6 type files · 84 api route.ts · 40 api resource**

---

## 1. Models (38) — `src/models/`

modelName = ชื่อที่ `mongoose.model()` · ใช้เป็น key ของ `ENTITY_LABELS_TH`

### 1.1 สินค้า / แคตตาล็อก
| ไฟล์ | modelName | หน้าที่ | มี enum ภาษาไทยใน schema |
|---|---|---|---|
| `productModel.ts` | `Products` | สินค้า (มี `product_img` base64) | — |
| `productCategoryModel.ts` | `ProductCategories` | หมวดหมู่สินค้า | — |
| `productVariantModel.ts` | `ProductVariants` | ตัวเลือกสินค้า (ไซซ์/รส) | — |
| `productOptionModel.ts` | `ProductOptions` | ออปชันสินค้า | — |
| `bundleModel.ts` | `Bundles` | แพ็กเกจสินค้า | — |

### 1.2 คำสั่งซื้อ / ขาย
| ไฟล์ | modelName | หน้าที่ | enum ไทย |
|---|---|---|---|
| `orderModel.ts` | `Orders` | คำสั่งซื้อ | ตรวจตอน port |
| `orderItemModel.ts` | `OrderItems` | รายการในออเดอร์ | — |
| `cartModel.ts` | `Carts` | ตะกร้า | — |
| `cartItemModel.ts` | `CartItems` | รายการในตะกร้า | — |
| `paymentModel.ts` | `Payments` | การชำระเงิน (omise) | — |
| `addressModel.ts` | `Addresses` | ที่อยู่จัดส่ง | — |

### 1.3 พรีออเดอร์
| ไฟล์ | modelName |
|---|---|
| `preorderModel.ts` | `Preorders` |
| `preorderItemModel.ts` | `PreorderItems` |
| `preorderRoundModel.ts` | `PreorderRounds` |
| `preorderRoundItemModel.ts` | `PreorderRoundItems` |

### 1.4 วัตถุดิบ / สต็อก / หน่วยนับ
| ไฟล์ | modelName | หน้าที่ | enum ไทย |
|---|---|---|---|
| `ingredientModel.ts` | `Ingredients` | วัตถุดิบ | — |
| `ingredientCategoryModel.ts` | `IngredientCategory` | หมวดหมู่วัตถุดิบ | — |
| `ingredientTransactionModel.ts` | `IngredientTransactions` | รับเข้า/เบิกใช้/ปรับ (`type`: use/receive/adjust) | key EN |
| `unitModel.ts` | `Units` | หน่วยนับ (`usage_context`: Ingredient/Product/Both) | key EN |

### 1.5 สูตร / การผลิต
| ไฟล์ | modelName | หน้าที่ |
|---|---|---|
| `recipeModel.ts` | `Recipes` | สูตรหลัก |
| `componentModel.ts` | `Components` | สูตรย่อย (sub-recipe) |
| `componentsCategory.ts` | `ComponentCategory` | หมวดหมู่สูตรย่อย |
| `productionOrderModel.ts` | `ProductionOrders` | ใบสั่งผลิต |
| `productionItemModel.ts` | `ProductionItems` | รายการในใบสั่งผลิต |

### 1.6 ผู้ใช้ / สิทธิ์ / เวลางาน
| ไฟล์ | modelName | หน้าที่ | enum ไทย |
|---|---|---|---|
| `userModel.ts` | `Users` | ผู้ใช้/พนักงาน (bcrypt, google auth) | — |
| `roleModel.ts` | `Roles` | ตำแหน่ง | `role_type` (admin/owner/...) |
| `permissionModel.ts` | `Permissions` | สิทธิ์ต่อ menu_key × 5 action | — |
| `userLogModel.ts` | `UserLogs` | audit log (before/after diff) | action CREATE/UPDATE/DELETE |
| `attendanceModel.ts` | `Attendances` | เข้า-ออกงานรายวัน | **`status` เป็นค่าไทย**: มาทำงาน/มาสาย/ขาดงาน/ลาป่วย/ลากิจ/วันหยุด |

### 1.7 การตลาด / หน้าร้าน
| ไฟล์ | modelName | หน้าที่ |
|---|---|---|
| `promotionModel.ts` | `Promotions` | โปรโมชัน/คูปอง (`channels`: online/instore) |
| `promotionUsagesModel.ts` | `PromotionUsages` | ประวัติการใช้โปร |
| `bannersModel.ts` | `Banners` | แบนเนอร์หน้าร้าน |

### 1.8 การเงิน
| ไฟล์ | modelName | enum ไทย |
|---|---|---|
| `expenseModel.ts` | `Expenses` | **`category`**: วัตถุดิบ/บรรจุภัณฑ์/ค่าจ้างแรงงาน/ค่าสาธารณูปโภค/ค่าเช่า/ค่าการตลาด/ค่าซ่อมบำรุง/อื่นๆ · **`payment_method`**: เงินสด/โอนเงิน/บัตรเครดิต/QR Code |

### 1.9 แจ้งเตือน
| ไฟล์ | modelName | enum |
|---|---|---|
| `notificationModel.ts` | `Notifications` | `type`: warning/info/success/error · `module`: order/ingredient/production/employee/finance/system (key EN) |

### 1.10 รีวิว / วิเคราะห์ความรู้สึก (NLP)
| ไฟล์ | modelName |
|---|---|
| `reviewModel.ts` | `Reviews` |
| `aspectModel.ts` | `Aspects` |
| `semanticTermModel.ts` | `SemanticTerms` |
| `sentimentResultModel.ts` | `SentimentResults` |

> **หมายเหตุ i18n:** schema ที่ enum เป็นค่าไทย (`Attendances.status`, `Expenses.category`, `Expenses.payment_method`) = **ข้อมูล ไม่ใช่ข้อความ UI** → เก็บค่าเดิม, map เป็นภาษาผ่าน `t('enums.*')` ตอนแสดง (ดู I18N_PLAN §5)

---

## 2. Types (6 ไฟล์) — `src/types/`

| ไฟล์ | Types / Interfaces | Enums (union) | Constant มาด้วย | Util มาด้วย | Mock มาด้วย |
|---|---|---|---|---|---|
| `index.ts` | `BreadcrumbItem`, `NotificationItem`, `Employee` | `AuthProvider`, `EmploymentType` | — | — | — |
| `orderTypes.ts` | `OrderItem`, `Order` | `OrderType`, `OrderStatus`, `PaymentStatus` | `STATUS_FLOW`, `STATUS_CONFIG`, `PAYMENT_STATUS_CONFIG` | `getStatusFlow`, `getNextStatus`, `isFinalStatus`, `formatCurrency` | — |
| `Ingredienttypes.ts` | `Ingredient`, `StockTransaction` | `StockStatus`, `TransactionType` | `STATUS_CONFIG`, `TRANSACTION_CONFIG`, `CATEGORY_OPTIONS` (ไทย) | `getStatus`, `stockPct`, `progressColor`, `fmt` | `MOCK_INGREDIENTS`, `MOCK_TRANSACTIONS` |
| `productionTypes.ts` | `IUnit`, `IProductCategory`, `IProduct`, `IIngredientItem`, `IComponentItem`, `IRecipe`, `IStockImpact`, `IProductionItem`, `IUser`, `IPreorderRound`, `IProductionOrder`, `ICreateProductionOrderPayload`, `IUpdateProductionOrderPayload` | `ProductionStatus`, `ProductionItemStatus`, `SourceType`, `ProductType`, `UnitType`, `RoundStatus`, `UpdateProductionOrderBody` | `PRODUCTION_STATUS_CONFIG`, `ITEM_STATUS_CONFIG`, `SOURCE_TYPE_CONFIG`, `PRODUCT_RECIPE_MAP` | `getNextStatus`, `isFinalStatus`, `fmtDateTH`, `calcTotalCost` | `MOCK_UNITS`, `MOCK_PRODUCTS`, `MOCK_RECIPES`, `MOCK_STAFF`, `MOCK_ROUNDS`, `MOCK_PRODUCTION_ORDERS` |
| `recipetypes.ts` | `RecipeIngredient`, `RecipeSubRef`, `RecipeStep`, `SubRecipe`, `MainRecipe` | `RecipeCategory` (ค่าไทย) | `SUB_CATEGORY_COLORS`, `SUB_RECIPE_CATEGORIES` | — | `MOCK_SUB_RECIPES`, `MOCK_MAIN_RECIPES`, `MOCK_PRODUCTS_WITHOUT_RECIPE` |
| `salesTypes.ts` | `SaleTransaction`, `DailyStat`, `ProductStat` | `Channel`, `Period`, `PeriodTab` | `CHANNEL_CONFIG`, `CATEGORY_COLORS` | `fmtBaht`, `fmtPct`, `marginColor` | — |

**สิ่งที่ต้องจัดระเบียบตอน port:**
- `*_CONFIG` ปนกัน 2 อย่าง: `label` (ข้อความไทย) + สี/`antColor` → **แยก**: สีอยู่ `types/`, `label` เอาออก ใช้ `t('enums.*')` แทน
- `MOCK_*` ทั้งหมด → ย้ายไป `src/mocks/` + ลงทะเบียนใน `MOCKS.md`
- ฟังก์ชัน format ซ้ำ (`formatCurrency`, `fmtBaht`, `fmt`, `fmtDateTH`, `fmtPct`) → รวมเป็น `src/i18n/format.ts` ตัวเดียว รับ locale
- ตั้งชื่อไฟล์ให้สม่ำเสมอ: `Ingredienttypes.ts` → `ingredientTypes.ts`, `recipetypes.ts` → `recipeTypes.ts`

---

## 3. Constants (ค่าคงที่ + label map)

| แหล่ง | export | ประเภท | ปลายทางหลัง i18n |
|---|---|---|---|
| `lib/menuKeys.ts` | `MenuKey`, `ALL_MENU_KEYS`, `FULL_MENU_ACCESS`, `NO_MENU_ACCESS`, `ROUTE_MENU_MAP` (ภายใน) | routing/permission keys | คงเดิม (ไม่ใช่ข้อความ) |
| `lib/entityLabels.ts` | `ENTITY_LABELS_TH` (37 คีย์), `ACTION_VERB_TH` | label map ไทย | → `messages/*/entities`, `messages/*/actions` |
| `lib/fieldLabels.ts` | `FIELD_LABELS_TH` (~90 คีย์) | label map ไทย | → `messages/*/fields` |
| `lib/unitContext.ts` | `UNIT_TYPE_LABELS` (11), `UNIT_TYPE_OPTIONS` | label map + options | `UNIT_TYPE_LABELS` → `enums.unitType`; `UNIT_TYPE_OPTIONS` → hook `useUnitTypeOptions()` |
| `lib/promotionChannel.ts` | `CHANNEL_LABEL_TH`, `PromotionChannel` | label map ไทย | → `enums.promotionChannel` |
| `types/orderTypes.ts` | `STATUS_CONFIG`, `PAYMENT_STATUS_CONFIG`, `STATUS_FLOW` | enum config (label+สี) | สีคงใน type; label → `enums.orderStatus` / `enums.paymentStatus` |
| `types/productionTypes.ts` | `PRODUCTION_STATUS_CONFIG`, `ITEM_STATUS_CONFIG`, `SOURCE_TYPE_CONFIG`, `PRODUCT_RECIPE_MAP` | enum config | เช่นเดียวกัน → `enums.productionStatus` ฯลฯ |
| `types/Ingredienttypes.ts` | `STATUS_CONFIG`, `TRANSACTION_CONFIG`, `CATEGORY_OPTIONS` | enum config + options ไทย | → `enums.stockStatus`, `enums.ingredientTxnType`, `enums.ingredientCategory` |
| `types/salesTypes.ts` | `CHANNEL_CONFIG`, `CATEGORY_COLORS` | enum config | → `enums.salesChannel`; `CATEGORY_COLORS` คงเดิม |
| `types/recipetypes.ts` | `SUB_CATEGORY_COLORS`, `SUB_RECIPE_CATEGORIES` | enum config ไทย | สีคง; ค่าหมวด → `enums.recipeCategory` |
| `app/components/sidebar.tsx` | `menuSections` (label เมนูไทย inline) | โครงเมนู | label → `nav.*` |
| `app/owner/layout.tsx` | `ROUTE_LABELS` (breadcrumb ไทย ~25 คีย์) | route→label | → `breadcrumb.*` |
| `lib/session.ts` | `SESSION_COOKIE = "mmc_session"` | cookie name | คงเดิม (+ เพิ่ม `mmc_locale`) |

---

## 4. Utils (ฟังก์ชันล้วน / helper)

| ไฟล์ | export | หมายเหตุ |
|---|---|---|
| `lib/createCrudController.ts` | `createCrudController<T>()`, `CrudController`, `CrudOptions` | โรงงานสร้าง GET/POST/PATCH/DELETE + audit log + unique check + `listOnlyExcludeFields` |
| `lib/dbConnect.ts` | `dbConnect` (default) | cache connection · **ต้องเพิ่ม branch mock เมื่อไม่มี `MONGODB_URI` (D6)** |
| `lib/session.ts` | `signSession`, `verifySession`, `setSessionCookie`, `clearSessionCookie`, `SessionPayload` | JWT httpOnly `mmc_session` |
| `lib/menuAccess.ts` | `hasMenuPermission`, `canViewMenu`, `getFullMenuAccessMap`, `PermAction` + re-export จาก menuKeys | server-only (แตะ DB) |
| `lib/menuKeys.ts` | `resolveMenuKey`, `isUnrestrictedRole` + types/consts | pure — ใช้ได้ทั้ง client/server |
| `lib/fieldLabels.ts` | `fieldLabelTh`, `formatFieldValue`, `computeFieldDiff`, `FieldDiff` | `fieldLabelTh` → เปลี่ยนเป็น wrapper ของ `t('fields.*')`; อีก 2 ตัวเป็น util แท้ |
| `lib/entityLabels.ts` | `entityLabelTh` | → wrapper ของ `t('entities.*')` |
| `lib/exportCsv.ts` | `exportToCsv`, `forceText`, `ExportCell` | export CSV ฝั่ง client (BOM + escape) |
| `lib/alert.ts` | `alert` (success/error/...), `confirmAlert` | wrapper sweetalert2 — **ปุ่ม/ข้อความไทย hardcode → localize** |
| `lib/omise.ts` | `createPromptPayCharge`, `getCharge`, `OmiseCharge` | เรียก Omise API — **mock เมื่อไม่มี key (D6)** |
| `lib/promotionChannel.ts` | `isInstoreChannel`, `isOnlineChannel`, `isPromotionCurrentlyValid`, `checkPromotionEligibility`, `calcPromotionDiscount` + types | ตรรกะโปรโมชัน pure |
| `lib/unitContext.ts` | `isIngredientUnit`, `isProductUnit` | pure |
| `types/orderTypes.ts` | `getStatusFlow`, `getNextStatus`, `isFinalStatus`, `formatCurrency` | `formatCurrency` → ย้าย `i18n/format.ts` |
| `types/productionTypes.ts` | `getNextStatus`, `isFinalStatus`, `fmtDateTH`, `calcTotalCost` | `fmtDateTH` → `i18n/format.ts` (locale-aware) |
| `types/Ingredienttypes.ts` | `getStatus`, `stockPct`, `progressColor`, `fmt` | `fmt` → `i18n/format.ts` |
| `types/salesTypes.ts` | `fmtBaht`, `fmtPct`, `marginColor` | 2 ตัวแรก → `i18n/format.ts` |

> ชื่อ `getNextStatus` / `isFinalStatus` ซ้ำใน 2 type files — ตอน port ระวัง import ชนกัน (แยก namespace หรือ prefix `order` / `production`)

---

## 5. ปลายทางโครงสร้าง (หลัง port + i18n)

```
src/
  i18n/        config.ts · request.ts · format.ts · messages/{th,en}.json
  constants/   menuKeys.ts · enumConfig/ (สี/flow เท่านั้น ไม่มี label)
  utils/       (= lib เดิมที่เป็น util แท้) csv, diff, promotion, unit, status helpers
  lib/         dbConnect · session · menuAccess · createCrudController · omise · alert   (มี side-effect / server / 3rd-party)
  types/       *.ts (ชื่อสม่ำเสมอ, ไม่มี MOCK_, ไม่มี label)
  mocks/       fixtures ย้ายมาจาก MOCK_* (D6)
  models/ controllers/
```
