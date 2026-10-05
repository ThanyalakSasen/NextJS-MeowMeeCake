//lib/services/allergenChecker.ts
/* eslint-disable @typescript-eslint/no-explicit-any */
// ═══════════════════════════════════════════════════════════════════════════════
// allergenChecker.ts — ระบบตรวจสอบวัตถุดิบที่ผู้ใช้แพ้ (Allergen Warning System)
//
// กลยุทธ์ D: Allergen-Aware Filter (น้ำหนัก 20%)
//   - สินค้าไม่มี allergen ของ user  → bonus +0.2
//   - สินค้ามี allergen ของ user     → penalty -0.3 (ไม่ลบออกจากรายการ ยังแสดงอยู่!)
//   - severity = "severe"           → penalty -0.5
//
// สินค้าที่มี allergen ยังคงแสดงบนเว็บ แต่:
//   1. ถูกจัดอันดับต่ำลงใน recommendation
//   2. มี allergenWarning object แนบมาใน API response
//   3. ฝั่ง UI นำไปแสดง warning badge/banner
// ───────────────────────────────────────────────────────────────────────────────

// ─── Types ─────────────────────────────────────────────────────────────────────
// type ที่ frontend ใช้ด้วยอยู่ที่ src/types/recommendation.ts (frontend มีสำเนาไฟล์เดียวกัน)
import type {
  AllergenSeverity,
  AllergenWarningLevel,
  AllergenMatchedItem,
  AllergenWarning,
} from "@/types/recommendation";

export type { AllergenSeverity, AllergenWarningLevel, AllergenMatchedItem, AllergenWarning };

export interface AllergenProfileItem {
  name: string;
  severity?: AllergenSeverity | string; // "severe" | "moderate" (ไม่เจาะจง = moderate)
}

export interface AllergenProfile {
  items: AllergenProfileItem[];
}

export interface ProductAllergenInfo {
  // ส่วนผสมหลัก = ส่วนผสมที่ระบุใน recipe ของสินค้าโดยตรง
  mainIngredientNames: string[];
  // ส่วนผสมทั้งหมด = main + ส่วนผสมย่อยที่อยู่ใน components
  allIngredientNames: string[];
}

// ─── ค่าคงที่ bonus/penalty ตาม spec ───────────────────────────────────────────
export const ALLERGEN_BONUS_NONE = 0.2;
export const ALLERGEN_PENALTY_MATCH = -0.3;
export const ALLERGEN_PENALTY_SEVERE = -0.5;

// ─── Helpers ───────────────────────────────────────────────────────────────────

function normalizeName(name: unknown): string {
  return String(name ?? "").trim().toLowerCase();
}

/**
 * ทำให้ชื่อเปรียบเทียบกันง่ายขึ้น:
 *  - lowercase
 *  - ลบวรรณยุกต์ไทย (่ ้ ๊ ๋) เพื่อกันพิมพ์ต่างกันแล้ว match ไม่เจอ
 *  - ตัดอักขระพิเศษ/วงเล็บ เหลือเฉพาะตัวอักษร ตัวเลข และช่องว่าง
 */
function normalizeCompare(name: unknown): string {
  return String(name ?? "")
    .toLowerCase()
    .replace(/[\u0E48-\u0E4B]/g, "")
    .replace(/[^a-z0-9\u0E00-\u0E7F\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * ตรวจว่า allergen ตรงกับชื่อส่วนผสมหรือไม่ (normalized)
 *  - เท่ากัน / allergen เป็นส่วนย่อยของชื่อ ("นม" → "นมสด", "นมข้นหวาน")
 *  - ชื่อเป็นส่วนย่อยของ allergen (กันกรณีที่ชื่อผู้ใช้เฉพาะกว่า เช่น "นมข้นหวาน" vs "นมข้น")
 */
function allergenMatchesIngredient(allergen: string, ingredient: string): boolean {
  if (!allergen || !ingredient) return false;
  const key = normalizeCompare(allergen);
  const name = normalizeCompare(ingredient);
  if (!key || !name) return false;
  if (name === key) return true;
  if (name.includes(key)) return true;
  if (key.includes(name)) return true;
  return false;
}

/** เช็คว่า allergen นี้เป็นส่วนผสมหลักของสินค้าไหม (อยู่ใน recipe หลัก) */
export function isMainIngredient(
  info: ProductAllergenInfo,
  allergenName: string
): boolean {
  return info.mainIngredientNames.some((n) =>
    allergenMatchesIngredient(allergenName, n)
  );
}

/**
 * สร้าง AllergenProfile จากข้อมูลผู้ใช้จริง
 *
 * ปรับให้เข้ากับ schema เดิมของโปรเจกต์ (users.user_allergies: string[]):
 *  - สนับสนุนรูปแบบ "ชื่อวัตถุดิบ" หรือ "ชื่อวัตถุดิบ:severe"
 *  - ถ้าในอนาคต schema มี field allergenProfile (array ของ {name, severity})
 *    ก็จะอ่านใช้ได้ทันทีผ่านอาร์กิวเมนต์ advancedProfile
 */
export function parseAllergenProfile(
  userAllergies?: string[] | null,
  advancedProfile?: any
): AllergenProfile {
  if (Array.isArray(advancedProfile?.items)) {
    return {
      items: advancedProfile.items
        .filter((it: any) => it && it.name)
        .map((it: any) => ({
          name: String(it.name),
          severity: String(it.severity ?? "moderate"),
        })),
    };
  }
  const items: AllergenProfileItem[] = [];
  for (const raw of userAllergies ?? []) {
    if (raw == null || String(raw).trim() === "") continue;
    const [name, severity] = String(raw).split(/[:|]/).map((x) => x.trim());
    if (!name) continue;
    items.push({
      name,
      severity:
        String(severity ?? "").toLowerCase() === "severe" ? "severe" : "moderate",
    });
  }
  return { items };
}

/**
 * ดึงข้อมูล allergen ของสินค้าจาก recipe (populate แล้ว)
 *
 *  - recipe.ingredients           → ส่วนผสมหลัก
 *  - recipe.components[].ingredients → ส่วนผสมย่อย (เช่น ชั้นครีม/แป้งที่เตรียมไว้ล่วงหน้า)
 */
export function buildAllergenInfoFromRecipe(recipe: any): ProductAllergenInfo {
  const main: string[] = [];
  const all: string[] = [];

  for (const item of recipe?.ingredients ?? []) {
    const name = normalizeName(
      item?.ingredient_id?.ingredient_name ?? item?.ingredient_name
    );
    if (name) {
      main.push(name);
      all.push(name);
    }
  }

  for (const comp of recipe?.components ?? []) {
    const component = comp?.component_id;
    for (const item of component?.ingredients ?? []) {
      const name = normalizeName(item?.ingredient_id?.ingredient_name);
      if (name && !main.includes(name)) all.push(name);
    }
  }

  return {
    mainIngredientNames: [...new Set(main)],
    allIngredientNames: [...new Set(all)],
  };
}
/**
 * หัวใจของ Allergen Warning System — ตรวจสอบสินค้าหนึ่งตัวกับ profile ผู้ใช้
 *
 * ระดับ warning (4 level ตาม spec):
 *  | none    | ไม่มี allergen ตรงกัน              → ไม่แสดงข้อความ, bonus +0.2
 *  | caution | มี allergen แต่ไม่ใช่ส่วนผสมหลัก     → "สินค้านี้มีวัตถุดิบที่คุณอาจแพ้", penalty -0.3
 *  | warning | มี allergen เป็นส่วนผสมหลัก         → "สินค้านี้มีวัตถุดิบหลักที่คุณแพ้: [ชื่อ]", penalty -0.3
 *  | danger  | user severity = "severe"           → "คำเตือน! สินค้านี้มี [ชื่อ] ที่คุณแพ้รุนแรง", penalty -0.5
 *
 * หมายเหตุ: สินค้าที่มี allergen จะไม่ถูกตัดออกจากรายการ (ยกเว้นฝั่ง route ขอ excludeAllergens=true)
 */
export function checkAllergenForProduct(
  info: ProductAllergenInfo,
  profile: AllergenProfile
): AllergenWarning {
  const matched: AllergenMatchedItem[] = [];

  for (const item of profile?.items ?? []) {
    const alias = String(item?.name ?? "").trim();
    if (!alias) continue;

    // ให้ใช้การ match แบบ normalized (เทียบสระ/วรรณยุกต์ + contains ทั้ง 2 ทิศทาง)
    // เช่น user ลงทะเบียน "นม" → ตรงกับส่วนผสม "นมสด", "นมข้นหวาน"
    const isMain = isMainIngredient(info, alias);
    const present =
      isMain ||
      info.allIngredientNames.some((n) => allergenMatchesIngredient(alias, n));
    if (!present) continue;

    const severe =
      String(item?.severity ?? "moderate").toLowerCase() === "severe";
    matched.push({
      name: alias,
      severity: severe ? "severe" : "moderate",
      isMainIngredient: isMain,
    });
  }

  // ไม่มี allergen ตรงกันเลย
  if (matched.length === 0) {
    // ถ้า user ยังไม่ได้ลงทะเบียนสารที่แพ้ → ไม่มีโบนัส (neutral) เพื่อไม่ให้คะแนนเพี้ยน
    const adjustment =
      (profile?.items?.length ?? 0) > 0 ? ALLERGEN_BONUS_NONE : 0;
    return {
      level: "none",
      message: null,
      scoreAdjustment: adjustment,
      matchedAllergens: [],
    };
  }

  const severeAllergens = matched
    .filter((m) => m.severity === "severe")
    .map((m) => m.name);
  const mainAllergens = matched
    .filter((m) => m.isMainIngredient)
    .map((m) => m.name);

  // danger: user ระบุ severity = "severe"
  if (severeAllergens.length > 0) {
    return {
      level: "danger",
      message: `คำเตือน! สินค้านี้มี ${severeAllergens.join(", ")} ที่คุณแพ้รุนแรง`,
      scoreAdjustment: ALLERGEN_PENALTY_SEVERE,
      matchedAllergens: matched,
    };
  }
  // warning: allergen เป็นส่วนผสมหลัก
  if (mainAllergens.length > 0) {
    return {
      level: "warning",
      message: `สินค้านี้มีวัตถุดิบหลักที่คุณแพ้: ${mainAllergens.join(", ")}`,
      scoreAdjustment: ALLERGEN_PENALTY_MATCH,
      matchedAllergens: matched,
    };
  }
  // caution: มี allergen แต่ไม่ใช่ส่วนผสมหลัก
  const cautionAllergens = matched.map((m) => m.name);
  return {
    level: "caution",
    message: `สินค้านี้มีวัตถุดิบที่คุณอาจแพ้: ${cautionAllergens.join(", ")}`,
    scoreAdjustment: ALLERGEN_PENALTY_MATCH,
    matchedAllergens: matched,
  };
}