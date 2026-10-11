/**
 * auditDiff — เตรียมข้อมูล "ก่อน/หลัง" ให้ UserLog (pure ไม่แตะ DB/request · เทสได้ตรง ๆ)
 *
 *   diffFields(beforeDoc, afterDoc, keys) → { before: { field: ค่าเดิม }, after: { field: ค่าใหม่ } } เฉพาะฟิลด์ที่เปลี่ยน
 *   docLabel(doc)                         → ชื่อของรายการ (ชื่อสินค้า/โปรโมชัน/เลขออเดอร์ …) ไว้ใส่ในข้อความ log
 *
 * ค่าที่เก็บผ่าน normalize ก่อนเสมอ: Date → ISO · ObjectId → string · ref ที่ populate แล้ว → ชื่อของมัน
 * ฟิลด์ระบบ (_id, timestamps, deleted_at, *_by) และฟิลด์ลับ (password/token/secret) ไม่ถูกบันทึกเด็ดขาด
 *
 * ชื่อฟิลด์ของค่าที่ซ้อน:
 *   object ซ้อน          → "social_links.facebook"
 *   รายการที่มีชื่อต่อแถว → "weekly_markets[ถนนคนเดิน].close_time" (จับคู่แถวด้วยชื่อ · แถวที่เพิ่ม/ลบ = ก่อนหรือหลังเป็น null)
 */

const SYSTEM_KEYS = new Set([
  "_id", "__v", "id",
  "created_at", "updated_at", "createdAt", "updatedAt", "deleted_at",
  "created_by", "updated_by", "deleted_by",
]);
const SECRET_RE = /password|token|secret|otp/i;

/** ฟิลด์ชื่อที่ใช้เป็นป้ายของรายการ — เรียงตามลำดับความเจาะจง (fallback: คีย์แรกที่ลงท้าย _name) */
const LABEL_KEYS = [
  "order_no", "preorder_no", "product_name_th", "promotion_name", "coupon_code", "ingredient_name", "recipe_name",
  "component_name", "category_name", "unit_name", "role_name", "user_fullname", "expense_name", "zone_name",
  "store_name", "aspect_name", "term", "name", "title",
];

/** ref ที่ populate มามักเลือกไม่กี่ฟิลด์ (ชื่อ + อีเมล/ตัวย่อ) — มากกว่านี้ถือเป็นเอกสารซ้อนจริง (เช่น แถวตลาด) */
const MAX_REF_FIELDS = 3;

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date);

const isObjectIdLike = (v: unknown): boolean =>
  !!v && typeof v === "object" && (v as { _bsontype?: string })._bsontype === "ObjectId";

export const isLoggableKey = (key: string): boolean => !SYSTEM_KEYS.has(key) && !SECRET_RE.test(key);

export function docLabel(doc: unknown): string | undefined {
  if (!isPlainObject(doc)) return undefined;
  for (const k of LABEL_KEYS) {
    const v = doc[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  for (const [k, v] of Object.entries(doc)) {
    if (k.endsWith("_name") && typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

/** ค่าที่อ่านง่ายและเทียบกันได้ (JSON-safe) */
export function normalize(value: unknown): unknown {
  if (value === undefined || value === null) return null;
  if (value instanceof Date) return value.toISOString();
  if (isObjectIdLike(value)) return String(value);
  if (Array.isArray(value)) return value.map(normalize);
  if (isPlainObject(value)) {
    const fields = Object.keys(value).filter(isLoggableKey);
    // ref ที่ populate แล้ว → เก็บแค่ชื่อ (ก่อน/หลังอาจ populate ไม่เหมือนกัน — ชื่อเทียบกันได้เสมอ)
    if ("_id" in value && fields.length <= MAX_REF_FIELDS) {
      const label = docLabel(value);
      if (label) return label;
    }
    return Object.fromEntries(fields.map((k) => [k, normalize(value[k])]));
  }
  return value;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** รายการที่ทุกแถวเป็น object มีชื่อ → เทียบรายแถวได้ (ไม่ใช่ทั้งก้อน) */
const isLabeledList = (v: unknown): v is Record<string, unknown>[] =>
  Array.isArray(v) && v.every((x) => isPlainObject(x) && !!docLabel(x));

export interface FieldDiff {
  before: Record<string, unknown>;
  after: Record<string, unknown>;
}

function diffValue(path: string, from: unknown, to: unknown, out: FieldDiff): void {
  if (same(from, to)) return;
  if (isPlainObject(from) && isPlainObject(to)) {
    for (const k of new Set([...Object.keys(from), ...Object.keys(to)])) {
      if (isLoggableKey(k)) diffValue(`${path}.${k}`, from[k] ?? null, to[k] ?? null, out);
    }
    return;
  }
  if (isLabeledList(from) && isLabeledList(to)) {
    const byLabel = (list: Record<string, unknown>[]) => new Map(list.map((x) => [docLabel(x)!, x]));
    const [b, a] = [byLabel(from), byLabel(to)];
    for (const label of new Set([...b.keys(), ...a.keys()])) {
      diffValue(`${path}[${label}]`, b.get(label) ?? null, a.get(label) ?? null, out);
    }
    return;
  }
  out.before[path] = from;
  out.after[path] = to;
}

/**
 * ฟิลด์ที่เปลี่ยนระหว่าง 2 doc — `keys` = จำกัดเฉพาะฟิลด์ที่ผู้ใช้ส่งมาแก้ (ปกติ Object.keys(body))
 * กันฟิลด์ที่ระบบคำนวณเอง (updated_at, ยอดสะสม …) ปนมา · ไม่ใส่ = เทียบทุกฟิลด์ · ไม่มีอะไรเปลี่ยน = null
 */
export function diffFields(beforeDoc: unknown, afterDoc: unknown, keys?: string[]): FieldDiff | null {
  const b = isPlainObject(beforeDoc) ? beforeDoc : {};
  const a = isPlainObject(afterDoc) ? afterDoc : {};
  const fields = (keys ?? [...new Set([...Object.keys(b), ...Object.keys(a)])]).filter(isLoggableKey);
  const out: FieldDiff = { before: {}, after: {} };
  for (const f of fields) {
    // ฟิลด์ที่ doc ทั้งสองฝั่งไม่มีเลย (เช่น body ส่งคีย์ที่ service ไม่รู้จัก) — ไม่ใช่การเปลี่ยนแปลงจริง
    if (!(f in a) && !(f in b)) continue;
    diffValue(f, normalize(b[f]), normalize(a[f]), out);
  }
  return Object.keys(out.after).length ? out : null;
}

/** ภาพรวมของ doc ตอนสร้าง/ลบ (เฉพาะ `keys` ถ้าระบุ) — ใช้เป็น after ของ CREATE / before ของ DELETE */
export function snapshot(doc: unknown, keys?: string[]): Record<string, unknown> | undefined {
  if (!isPlainObject(doc)) return undefined;
  const fields = (keys ?? Object.keys(doc)).filter((k) => isLoggableKey(k) && k in doc);
  if (!fields.length) return undefined;
  return Object.fromEntries(fields.map((f) => [f, normalize(doc[f])]));
}
