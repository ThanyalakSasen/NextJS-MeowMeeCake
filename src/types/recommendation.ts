// ─────────────────────────────────────────────────────────────
// src/types/recommendation.ts — type ของผลแนะนำสินค้า/คำเตือนอาหารแพ้ ใช้ร่วมกันทั้ง frontend และ backend
// (backend คำนวณที่ src/services/recommendation/ · ย้ายมาจาก backend ฝั่งลูกค้า — customer-backend-merge.md §8.15)
// ─────────────────────────────────────────────────────────────

export type AllergenSeverity = "moderate" | "severe";

export type AllergenWarningLevel = "none" | "caution" | "warning" | "danger";

export interface AllergenMatchedItem {
  name: string;
  severity: AllergenSeverity;
  isMainIngredient: boolean;
}

export interface AllergenWarning {
  level: AllergenWarningLevel;
  message: string | null;
  // ค่าที่เอาไปปรับคะแนนของสินค้า (+0.2 / -0.3 / -0.5)
  scoreAdjustment: number;
  matchedAllergens: AllergenMatchedItem[];
}

export interface RecommendationItem {
  /** document สินค้า (lean) พร้อม field เติม ingredientNames */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  product: any;
  /** คะแนนรวมสุดท้าย (หลัง boost แล้ว) */
  score: number;
  /** เหตุผลที่แนะนำ (ภาษาไทย) สำหรับแสดงบน UI */
  reasons: string[];
  /** ข้อมูลคำเตือน allergen — null ถ้าไม่แพ้อะไร (level === "none") */
  allergenWarning: AllergenWarning | null;
}
