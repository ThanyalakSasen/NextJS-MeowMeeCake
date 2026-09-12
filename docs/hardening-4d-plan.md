# สรุปรอบ 4d — object storage abstraction + ลบรูปที่ไม่ใช้ + delivery zone เป็น DB

> อัปเดตล่าสุด: 2026-09-12
> สถานะ: ✅ **เสร็จสมบูรณ์ทั้ง 3 ข้อ**
> ที่มา: [`BACKLOG.md`](BACKLOG.md) §3 "ลำดับการแก้ที่เหลือ" รอบ 4d · ต่อจาก [`hardening-4c-plan.md`](hardening-4c-plan.md)

รอบนี้ต่างจากรอบก่อน ๆ ตรงที่ข้อ 3.13 เดิมเขียนไว้ว่า **"ขึ้นกับการตัดสินใจ hosting"** — ก่อนลงมือจึง
ตรวจโค้ดจริงก่อนว่าปัญหาแต่ละข้อ "จริง" แค่ไหน แล้วถามผู้ใช้ว่าจะ deploy แบบไหน เพื่อไม่ให้เสียแรงสร้าง
driver ที่ไม่มีวันได้ใช้จริง — คำตอบคือ **"ทำแบบเผื่ออนาคตไว้ก่อน"** (ตัวเลือกที่แนะนำ): สร้าง interface
ที่ไม่ต้องเขียนใหม่ทั้งหมดตอนตัดสินใจ hosting จริง

---

## 1. ✅ 3.13 — Object storage abstraction

### ปัญหาที่ยืนยันจากโค้ดจริง

`src/lib/upload.ts` (ก่อนแก้) เขียนไฟล์ลง `public/uploads/` ด้วย `node:fs/promises` ตรง ๆ ไม่มี
abstraction เลย — comment ในไฟล์เตือนไว้เองว่าใช้ได้เฉพาะ self-host เพราะบน serverless (Vercel ฯลฯ)
`public/` เป็น read-only ตอน runtime และไฟล์ที่เขียนจะหายเมื่อ instance รีสตาร์ท (ephemeral filesystem)

ตรวจเพิ่มเจอว่า `multer` อยู่ใน `package.json` แต่ **ไม่ถูก import ที่ไหนเลยในโค้ด** (route ใช้
`req.formData()` ของ Next.js เอง ไม่ใช่ multer) — dead dependency ถอนได้ทันที

### วิธีแก้

แยก `upload.ts` เป็น `UploadDriver` interface (`save` + `delete`) เลือก driver ผ่าน env
`UPLOAD_DRIVER`:

```ts
export interface UploadDriver {
  save(files: File[], dir: string): Promise<SavedFile[]>;
  delete(url: string): Promise<void>;
}
```

- **`localDiskDriver`** (ดีฟอลต์เมื่อไม่ตั้ง env — พฤติกรรมเดิมทุกประการ ไม่กระทบ self-host ปัจจุบัน) —
  ย้ายโค้ด `writeFile` เดิมเข้ามาเป็น `save()` + เพิ่ม `delete()` ใหม่ (ใช้ใน §3.14)
- **`s3Driver`** — S3-compatible (AWS S3 / Cloudflare R2 / GCS ผ่าน interop API) ใช้
  `@aws-sdk/client-s3` แบบ **lazy import** (`await import("@aws-sdk/client-s3")`) — โหลดจริงเฉพาะตอน
  `UPLOAD_DRIVER=s3` เท่านั้น ไม่กระทบขนาด bundle/เวลา build ตอนใช้ local disk
- ตรวจไฟล์ 3 ชั้นเดิม (ขนาด → นามสกุล → magic bytes) แยกเป็นฟังก์ชันกลาง `validateFiles()` ใช้ร่วมกัน
  ทั้งสอง driver — สลับ driver แล้วไม่มีทางหลุดการตรวจ
- ถอน `multer` ออกจาก `package.json`

### ทำไมแก้แบบนี้ (แทนที่จะรอให้ตัดสินใจ hosting ก่อน)

- **`localDiskDriver` เป็นดีฟอลต์ พฤติกรรมไม่เปลี่ยนเลยสำหรับ self-host** — ถ้าตัดสินใจ deploy แบบเดิม
  ต่อไป งานนี้ก็แค่ "จัดโครงโค้ดใหม่ให้สะอาดขึ้น" ไม่มีความเสี่ยงอะไรเพิ่ม
- **`s3Driver` เขียนไว้ล่วงหน้าแต่ไม่ผูกมัดอะไร** — ถ้าจะ deploy serverless ในอนาคต แค่ตั้ง env
  (`UPLOAD_DRIVER=s3` + credential) ไม่ต้องเขียนโค้ดใหม่หรือแก้จุดที่เรียกใช้ (`saveImages`/`deleteImages`)
  เลยสักบรรทัด
- **lazy import กัน dependency หนักโหลดฟรี** — `@aws-sdk/client-s3` เป็น dependency ใหม่ที่ไม่เล็ก
  ถ้า import แบบ static ที่หัวไฟล์จะถูกโหลดเข้า bundle ทุกครั้งแม้ไม่ได้ใช้ driver นี้เลย

---

## 2. ✅ 3.14 — ลบรูปสินค้าที่ไม่ใช้

### ปัญหาที่ยืนยันจากโค้ดจริง

grep `deleteProduct`/`hardDeleteProduct`/`updateProduct` ทั้งหมดใน `productService.ts` ไม่พบการเรียก
ลบไฟล์เลยสักจุด — แอดมินอัปเดตรูป (แทนที่ `product_img` array เดิมด้วยชุดใหม่) หรือลบสินค้าถาวร ไฟล์เดิม
ใน `public/uploads/products/` ค้างอยู่บนดิสก์ตลอดไป ไม่มีกลไกเก็บกวาดเลย

### วิธีแก้

```ts
// productService.updateProduct — จำรูปเดิมไว้ก่อนเขียนทับ
const oldImages = input.product_img !== undefined ? [...(existing.product_img ?? [])] : [];
// ... เขียนทับ + save ...
if (oldImages.length > 0) {
  const kept = new Set(result.product_img ?? []);
  const removed = oldImages.filter((url) => !kept.has(url));
  if (removed.length > 0) await deleteImages(removed);
}
```

```ts
// productService.hardDeleteProduct — ลบถาวรแล้วไม่มีทาง restore กลับมาแสดงรูปเดิมได้อีก
if (product.product_img?.length) await deleteImages(product.product_img);
```

`deleteImages()` (ใน `upload.ts`) ดักจับ error ของตัวเองทุกไฟล์ (`log.error` แทนที่จะ throw) —
`productService` เรียกตรง ๆ ได้เลย ไม่ต้องห่อ `.catch()` เพิ่มอีกชั้น

### ทำไมแก้แบบนี้

- **`updateProduct` ลบเฉพาะรูปที่ "หายไปจากชุดใหม่" ไม่ใช่ลบทั้งหมดแล้วสร้างใหม่** — เทียบ `oldImages`
  กับ `result.product_img` หลัง save แล้ว diff เอา ถ้าแอดมินส่งชุดเดิมซ้ำ (ไม่ได้ตั้งใจลบอะไร) จะไม่มี
  ไฟล์ไหนถูกลบเลย
- **soft delete (`deleteProduct`) ไม่ลบไฟล์ — hard delete เท่านั้นที่ลบ** — สินค้าที่ soft-delete ยัง
  `restoreProduct()` กลับมาได้ ถ้าลบไฟล์ไปตอน soft-delete แล้วมีคน restore ทีหลัง รูปจะหายแต่ข้อมูล
  `product_img` ใน DB ยังชี้ไปที่ไฟล์ที่ไม่มีอยู่จริง (broken image) — hard delete เท่านั้นที่ไม่มีทาง
  ย้อนกลับ จึงเป็นจุดเดียวที่ปลอดภัยจะลบไฟล์จริง
- **best-effort เสมอ ไม่ทำให้ update/delete พังถ้าลบไฟล์ไม่สำเร็จ** — สอดคล้องกับ pattern อื่นในโปรเจกต์
  (`clearCart().catch()` ใน §2c.1, `notify().catch()`) — ลบรูปเป็นงาน "เก็บกวาด" ไม่ใช่ core operation
  ที่ user รอผลอยู่

---

## 3. ✅ 3.15 — Delivery zone เป็น DB

### ปัญหาที่ยืนยันจากโค้ดจริง

`deliveryService.ts` (ก่อนแก้) มีแค่ 2 โซนตายตัวอ่านจาก env (`DELIVERY_FEE_METRO`/
`DELIVERY_FEE_UPCOUNTRY`) — ตรวจ `GET /api/admin/delivery-fee` แล้วพบว่าเป็น **read-only จริง** (มีแค่
`listZones()` ไว้ดู ไม่มี endpoint แก้เลย) เจ้าของร้านที่อยากปรับค่าส่งหรือเพิ่มโซนใหม่ต้องให้ developer
ไปแก้ env แล้ว restart/redeploy เอง ทำเองจากหน้าแอดมินไม่ได้เลย

### วิธีแก้

**Model ใหม่** `deliveryZoneModel.ts` — `zone_name`, `provinces: string[]`, `is_catch_all`, `fee`,
`sort_order`, `is_active`, soft delete

**Service** `deliveryZoneService.ts` — ห่อ `createCrudService` (factory เดิมของโปรเจกต์ ใช้แบบเดียวกับ
`recipeService`/`bannerService`) แล้วเพิ่ม 2 อย่างทับ `create`/`update`:
1. ตั้ง `is_catch_all: true` ที่โซนใหม่ → ปลด `is_catch_all` โซนอื่นให้อัตโนมัติ (โซน catch-all
   active พร้อมกันได้แค่ 1 โซนเสมอ — เหมือน `addressService.is_default`)
2. cache ผลลัพธ์ `getActiveZonesCached()` ไว้ TTL สั้น ๆ (ดีฟอลต์ 60 วิ ปรับได้ผ่าน
   `DELIVERY_ZONE_CACHE_TTL_MS`) กันยิง query ทุกครั้งที่คิดค่าส่ง (เรียกถี่ทุกออเดอร์/พรีวิวตะกร้า) —
   ล้าง cache ทันทีทุกครั้งที่ create/update/remove/restore ไม่ต้องรอ TTL หมดอายุ

**Route ใหม่** `/api/admin/delivery-zones` (+ `[id]`, `[id]/restore`) — ใช้ `collectionRoutes`/
`itemRoutes`/`restoreRoute` factory เดิม (permission menu `orders` — จุดเดิมที่คุม
`/admin/delivery-fee` อยู่แล้ว ไม่ต้องเพิ่ม menu ใหม่)

**`deliveryService.calcDeliveryFee()` เปลี่ยนเป็น async** เช็คโซนจาก DB ก่อนเสมอ:

```ts
const dbZones = await getActiveZonesCached();
if (dbZones.length > 0) {
  const specific = dbZones.find((z) => !z.is_catch_all && z.provinces.includes(province));
  const matched = specific ?? dbZones.find((z) => z.is_catch_all);
  if (matched) return { fee: ..., zone: matched.zone_name, ... };
  // มีโซนแต่ไม่ match เลย (ไม่มี catch-all) → ตกไป fallback ด้านล่าง
}
// ไม่มีโซนใน DB เลย หรือมีแต่ไม่ match → fallback env เดิม (กันคิดค่าส่งไม่ได้กลางทาง)
const zone = FALLBACK_ZONES.find((z) => z.match(province)) ?? FALLBACK_ZONES[...];
```

### ทำไมแก้แบบนี้

- **fallback ไป env เดิมเสมอเมื่อ DB ยังไม่พร้อม** — ตรงกับที่ BACKLOG ขอไว้ ("fallback config เดิม")
  ระบบที่เพิ่ง deploy ใหม่ (DB ยังไม่มีโซนไหนตั้งไว้เลย) ยังคิดค่าส่งได้ปกติจาก env ทันทีไม่ต้อง seed
  ข้อมูลก่อนถึงจะใช้งานได้ — และถ้าตั้งโซนแล้วแต่จังหวัดหลุดไม่ตรงโซนไหนเลย (ลืมตั้ง catch-all) ก็ไม่ทำให้
  คิดค่าส่งพัง (throw error กลางทาง) แค่ตกไปใช้ fallback เงียบ ๆ
- **cache ต้อง invalidate ทันทีตอนแก้ ไม่ใช่รอ TTL** — เจ้าของร้านแก้ค่าส่งแล้วคาดหวังว่าจะมีผลทันที
  ไม่ใช่ "รอ 1 นาทีค่อยเห็นผล" — TTL มีไว้กันยิง DB ตอน**ไม่มีการแก้ไข**เท่านั้น ไม่ใช่กัน "เห็นค่าใหม่ช้า"
- **`calcDeliveryFee` เปลี่ยนเป็น `async`** — ผลกระทบเดียวคือต้องเติม `await` ที่ 2 จุดเรียก
  (`orderService.persistOrder`, `preorderService`) ซึ่งอยู่ใน async function อยู่แล้วทั้งคู่ — เทส
  `tests/lib/deliveryService.test.ts` เดิมที่เรียกแบบ sync ต้องย้ายไป `tests/integration/` (ต้องมี DB
  จริงให้เช็คว่า "ยังไม่มีโซนไหนตั้งไว้" ได้ — ไม่ใช่ pure function อีกต่อไป)
- **`Number(...) || 60_000` เปลี่ยนเป็นเช็ค `Number.isFinite` แทน** — `0` เป็น falsy ใน JS ถ้าใช้ `||`
  ตรง ๆ จะไม่มีทางตั้ง `DELIVERY_ZONE_CACHE_TTL_MS=0` (ปิด cache ตอนเทส) ได้เลย

---

## เทส

- `tests/lib/upload.test.ts` (9 เคส) — `localDiskDriver`: บันทึก/ลบไฟล์จริงบนดิสก์, ปฏิเสธไฟล์ใหญ่เกิน/
  นามสกุลผิด/เนื้อหาไม่ใช่รูปจริง/เกิน 8 ไฟล์, รองรับ JPEG, `deleteImages` ไม่ throw แม้ไฟล์ไม่มีอยู่จริง
  หรือ url เป็น path traversal (`s3Driver` ต้องมี credential จริงถึงทดสอบได้ — ไม่ครอบในนี้)
- `tests/integration/productImageCleanup.test.ts` (5 เคส) — `updateProduct` ลบเฉพาะไฟล์ที่หายจาก
  ชุดใหม่, ไม่แตะ `product_img` เลย = ไฟล์ไม่หาย, แทนที่ด้วย `[]` = ลบหมด, `hardDeleteProduct` ลบไฟล์
  ทั้งหมดตามไปด้วย, ลบสินค้าที่ไม่มีรูปเลยไม่ error
- `tests/integration/deliveryService.test.ts` (13 เคส, ย้ายมาจาก `tests/lib/` เดิม + เพิ่มใหม่) —
  fallback env ครบทุกเคสเดิม + โซนจาก DB ทับ fallback, catch-all, ไม่มี catch-all ตกไป fallback,
  `is_catch_all` เอกสิทธิ์ (ตั้งใหม่ปลดเก่า), `is_active: false` มองไม่เห็น, ลบโซนแล้วกลับไป fallback
  ทันทีไม่ต้องรอ cache หมดอายุ, `listZones()` บอก `source` ถูกต้อง
- `tests/lib/schemas-admin.test.ts` (+4 เคส) — `deliveryZoneCreate`/`deliveryZoneUpdate`
- unit 155 → **163** · integration 66 → **79**

## สรุป PR

| PR | เนื้อหา |
|---|---|
| **#28** (คาดการณ์) | 3.13 (object storage abstraction) + 3.14 (ลบรูปที่ไม่ใช้) + 3.15 (delivery zone DB) — ทำในรอบเดียวเพราะ 3.14 ต้องมี `upload.ts` แบบ interface จาก 3.13 ก่อน |

## เกณฑ์เสร็จรอบ 4d
- [x] `upload.ts` เป็น interface เลือก driver ผ่าน env ได้ (`localDisk` ดีฟอลต์ พฤติกรรมไม่เปลี่ยน)
- [x] ถอน `multer` ที่ไม่ได้ใช้ออกจาก `package.json`
- [x] `updateProduct`/`hardDeleteProduct` ลบไฟล์รูปที่ไม่ใช้แล้ว best-effort
- [x] แอดมินแก้ค่าส่ง/โซนได้เองผ่าน `/api/admin/delivery-zones` ไม่ต้องแก้ env+redeploy
- [x] ยังไม่ได้ตั้งโซนใน DB เลย → คิดค่าส่งได้ตามปกติจาก fallback env (ไม่ breaking change)
- [x] `typecheck` / `lint` (5 pre-existing warning เดิม) / `test` (163) / `test:integration` (79) /
      `build` ผ่านหมด
- [x] doc อัปเดตครบ (`env.md`, `validation.md`, `BACKLOG.md`, เอกสารนี้)
