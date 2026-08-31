# โครงสร้างโค้ดในแต่ละ Screen / Component — MVVM (View + ViewModel)

> รูปแบบ: **MVVM** ทำผ่าน React = **custom hook (ViewModel) + presentational component (View)**
> ชื่ออื่นที่หมายถึงสิ่งเดียวกัน: Container/Presentational (Smart/Dumb), headless component, logic–view separation
> ต้นทางมีเค้าโครงนี้อยู่แล้ว: `useStaffRoles.ts`, `useProductionData.ts`, `useSalesTransactions.ts`

---

## 1. หลักการ

- **View** = โครงสร้าง/JSX ล้วน — รับข้อมูล+handler จาก ViewModel มา render เท่านั้น
- **ViewModel** = state ทั้งหมด + effect + fetch + handler + derived value + permission gating — ไม่มี JSX
- **page.tsx / index** = จุดเชื่อม (route entry / component export) — บางที่สุด
- **Model** = `src/models/` (mongoose) + `src/types/` + API (`/api/*`) — มีอยู่แล้ว

---

## 2. Screen — `app/owner/<route>/`

```
products/
  page.tsx                    # route entry (บาง)
  ProductsView.tsx            # View
  useProductsViewModel.ts     # ViewModel
  ProductsView.types.ts       # (ออปชัน) props + type เฉพาะหน้า
  _components/                # component เฉพาะหน้า (split เองถ้าซับซ้อน — §3)
```

```tsx
// page.tsx  — ห้ามมี logic
"use client";
import { useProductsViewModel } from "./useProductsViewModel";
import { ProductsView } from "./ProductsView";

export default function ProductsPage() {
  const vm = useProductsViewModel();
  return <ProductsView {...vm} />;
}
```

```ts
// useProductsViewModel.ts  — ไม่มี JSX
export function useProductsViewModel() {
  const t = useT("products");
  const perm = usePermission("products");
  const [filters, setFilters] = useState<ProductFilters>(DEFAULT_FILTERS);
  const [data, setData] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { /* fetch("/api/products?...") */ }, [filters]);

  const visibleRows = useMemo(() => /* derive */ [], [data, filters]);
  const handleDelete = async (id: string) => { /* ... */ };

  return { t, perm, filters, setFilters, data: visibleRows, loading, handleDelete };
}
```

```tsx
// ProductsView.tsx  — ไม่มี fetch / business useEffect / API
type Props = ReturnType<typeof useProductsViewModel>;
export function ProductsView({ t, perm, filters, setFilters, data, loading, handleDelete }: Props) {
  return (
    <ListPageLayout title={t("title")}>
      <FilterToolbar value={filters} onChange={setFilters} />
      {loading ? <LoadingSpin /> : <DataTable rows={data} onDelete={perm.delete ? handleDelete : undefined} />}
    </ListPageLayout>
  );
}
```

**Screen ง่ายมาก** (เช่น Access Denied) — ยุบเหลือ `page.tsx` ไฟล์เดียวได้ ไม่ต้อง split

**หมายเหตุ RSC:** ต้นทาง fetch ฝั่ง client ทั้งหมด → `page.tsx` เป็น `"use client"` · การย้าย initial load ไป server component = optimization เฟสหลัง ไม่ทำรอบนี้

---

## 3. Component

### 3.1 ไฟล์เดียว (ไม่ split) — เมื่อเป็น presentation ล้วน
- ทุกตัวใน `components/base/` (atom / antd wrapper)
- molecule ที่ไม่มี state จริง: `StatCard`, `Badge`, `CategoryChip`, `RatingDisplay`, `Divider`, `Logo`, ...
```
base/Button.tsx
shared/stats/StatCard.tsx
```

### 3.2 split — เมื่อมี state/effect/handler/fetch ที่ไม่ trivial
เช่น `DataTable`, `DetailDrawer`, `FilterToolbar`, modal ทุกตัว, `KanbanBoard`, `CartPanel`, `ProductionOrderForm`, `ExpenseForm`, `IngredientEditor`
```
DataTable/
  index.ts               # export { DataTable } from "./DataTable"
  DataTable.tsx          # View
  useDataTable.ts        # ViewModel (sort/filter/pagination/selection)
  DataTable.types.ts     # props + internal types
```

### เกณฑ์ตัดสิน
| สัญญาณว่าต้อง split | สัญญาณว่าไฟล์เดียวพอ |
|---|---|
| มี `useState`/`useEffect`/`useReducer` มากกว่า 1–2 | รับ props แล้ว render ตรง ๆ |
| มี `fetch` / เรียก API | ไม่มี side effect |
| มี handler ที่มี business logic | มีแต่ callback ส่งต่อ (`onClick` ผ่าน props) |
| derived value ซับซ้อน (`useMemo` หลายชั้น) | — |

> อย่าฝืนใส่ ViewModel ให้ dumb component — เพิ่ม ceremony เปล่า ๆ

---

## 4. แบ่งหน้าที่ (สรุป)

| อยู่ใน ViewModel (`useXxx.ts`) | อยู่ใน View (`XxxView.tsx`) |
|---|---|
| `useState` / `useReducer` / `useRef` | JSX + compose `base/` + `shared/` |
| `useEffect` (fetch, subscribe, timer, polling) | `t()` ทุกข้อความ (ห้าม literal) |
| `fetch("/api/...")` — หรือเรียก `src/services/<x>.ts` | UI-state จิ๊บจ๊อยเท่านั้น (dropdown เปิด/ปิด, hover) |
| event handler + business logic (`handleSubmit`, `handleDelete`) | ส่ง event ต่อ (`onClick={props.onDelete}`) |
| `useMemo` derived: filter/sort/total/group | conditional render ตาม prop (`loading ? ... : ...`) |
| `usePermission(key)` → gate ค่า/handler ที่ส่งออก | render ปุ่มตาม `perm.create` ที่ได้จาก props |
| i18n key สำหรับ toast/alert (`alert.success(t("saved"))`) | — |
| **return object ธรรมดา — ไม่มี JSX** | **ไม่มี fetch / business useEffect / API / mongoose** |

---

## 5. Services layer (ออปชัน แต่แนะนำ)

แทนที่จะ `fetch("/api/...")` กระจายใน viewmodel หลายตัว → รวมเป็น
```
src/services/
  products.ts   # listProducts(params), getProduct(id), createProduct(body), ...
  orders.ts
  ...
```
- viewmodel เรียก `productsService.list(filters)` — เทส/mock ง่าย (จับคู่ D6)
- 1 service ต่อ 1 resource (ล้อกับ `controllers/` ฝั่ง server)

---

## 6. Naming convention

| สิ่ง | รูปแบบ | ตัวอย่าง |
|---|---|---|
| Screen route entry | `page.tsx` | — |
| Screen View | `<Route>View.tsx` (PascalCase) | `ProductsView.tsx` |
| Screen ViewModel | `use<Route>ViewModel.ts` | `useProductsViewModel.ts` |
| Component (split) โฟลเดอร์ | `<Name>/` + `index.ts` | `DataTable/` |
| Component View | `<Name>.tsx` | `DataTable.tsx` |
| Component ViewModel | `use<Name>.ts` | `useDataTable.ts` |
| Types เฉพาะที่ | `<Name>.types.ts` | `DataTable.types.ts` |
| Service | `src/services/<resource>.ts` | `services/products.ts` |
| Shared hook (ข้ามหลาย screen) | `src/hooks/use<X>.ts` | `hooks/useCurrentUser.ts` |

---

## 7. เชื่อมกับ REBUILD_PLAN

- **D10 (ใหม่):** ทุก screen + component ที่มี logic ใช้รูปแบบ MVVM (View + ViewModel hook) ตามเอกสารนี้
- **เฟส 3 (component library):** component ที่เข้าเกณฑ์ §3.2 ต้อง split · `COMPONENT_MAP.md` เพิ่มคอลัมน์ "split? (Y/N)"
- **เฟส 4 (screens):** ทุกหน้ามี `page.tsx` + `View` + `use...ViewModel` (เว้นหน้าจิ๋ว) · ViewModel เรียก `src/services/*`
- **เฟส 6 (verify):** ไม่มี `fetch` / `useEffect` ที่ทำ data-loading ในไฟล์ `*View.tsx` หรือ `page.tsx` · ไม่มี literal ข้อความใน View
