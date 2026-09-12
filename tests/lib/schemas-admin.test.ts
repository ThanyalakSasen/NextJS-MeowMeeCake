import { describe, it, expect } from "vitest";
import { expenseCreate, expenseUpdate } from "@/schemas/expense";
import { ingredientCreate, ingredientUpdate } from "@/schemas/inventory";
import { promotionCreate, promotionUpdate } from "@/schemas/promotion";
import { ingredientCategoryCreate, componentCategoryCreate } from "@/schemas/catalog";
import {
  recordAttendanceBody,
  updateAttendanceBody,
  checkInOutBody,
} from "@/schemas/attendance";
import { permissionCreate, permissionUpdate } from "@/schemas/rbac";
import { createUserBody, updateUserBody } from "@/schemas/user";
import {
  createRoundBody,
  updateRoundBody,
  addRoundItemBody,
  updateRoundItemBody,
} from "@/schemas/preorderRound";

const OID = "507f1f77bcf86cd799439011";

describe("schemas/expense", () => {
  const ok = {
    date: "2026-01-10",
    description: "ซื้อแป้ง",
    category: "วัตถุดิบ",
    amount: 500,
    payment_method: "เงินสด",
  };
  it("create: date coerce → Date, enum ถูก", () => {
    const r = expenseCreate.parse(ok);
    expect(r.date).toBeInstanceOf(Date);
  });
  it("create: category/payment_method นอก enum, amount ติดลบ → fail", () => {
    expect(expenseCreate.safeParse({ ...ok, category: "ค่ากาแฟ" }).success).toBe(false);
    expect(expenseCreate.safeParse({ ...ok, payment_method: "PayPal" }).success).toBe(false);
    expect(expenseCreate.safeParse({ ...ok, amount: -1 }).success).toBe(false);
  });
  it("update: partial", () => {
    expect(expenseUpdate.safeParse({ amount: 20 }).success).toBe(true);
  });
});

describe("schemas/inventory — ingredient", () => {
  const ok = { ingredient_name: "แป้งเค้ก", ingredient_category_id: OID, unit_id: OID, cost_per_unit: 30 };
  it("create: ต้องมี category/unit เป็น ObjectId + cost_per_unit", () => {
    expect(ingredientCreate.parse(ok)).toMatchObject({ ingredient_name: "แป้งเค้ก" });
    expect(ingredientCreate.safeParse({ ...ok, ingredient_category_id: "x" }).success).toBe(false);
    expect(ingredientCreate.safeParse({ ...ok, cost_per_unit: undefined }).success).toBe(false);
  });
  it("update: current_stock ถูก omit (ตั้งผ่าน transactions เท่านั้น)", () => {
    const r = ingredientUpdate.parse({ current_stock: 999, cost_per_unit: 40 });
    expect("current_stock" in r).toBe(false);
    expect(r.cost_per_unit).toBe(40);
  });
});

describe("schemas/promotion", () => {
  const ok = {
    promotion_code: "NY2026",
    promotion_name: "ปีใหม่",
    discount_type: "Percentage",
    discount_value: 15,
    start_date: "2026-01-01",
    end_date: "2026-01-31",
  };
  it("create: ผ่านเคสปกติ", () => {
    expect(promotionCreate.safeParse(ok).success).toBe(true);
  });
  it("create: end_date ก่อน start_date → fail", () => {
    expect(promotionCreate.safeParse({ ...ok, end_date: "2025-12-01" }).success).toBe(false);
  });
  it("create: Percentage แต่ discount_value > 100 → fail", () => {
    expect(promotionCreate.safeParse({ ...ok, discount_value: 150 }).success).toBe(false);
  });
  it("create: Amount + discount_value > 100 → ผ่าน (ไม่ติด cap %)", () => {
    expect(promotionCreate.safeParse({ ...ok, discount_type: "Amount", discount_value: 150 }).success).toBe(true);
  });
  it("update: partial (ไม่ต้องมี start/end)", () => {
    expect(promotionUpdate.safeParse({ is_active: false }).success).toBe(true);
  });
});

describe("schemas/catalog — ingredient/component category (name-only)", () => {
  it("ต้องมีชื่อไม่ว่าง", () => {
    expect(ingredientCategoryCreate.safeParse({ ingredient_category_name: "ผง" }).success).toBe(true);
    expect(ingredientCategoryCreate.safeParse({ ingredient_category_name: "" }).success).toBe(false);
    expect(componentCategoryCreate.safeParse({ component_category_name: "ไส้" }).success).toBe(true);
  });
});

describe("schemas/attendance — recordAttendanceBody (BACKLOG §3.1, รอบ 4b)", () => {
  it("ผ่านเคสปกติ — status ภาษาไทย, work_date รูปแบบถูก", () => {
    const r = recordAttendanceBody.parse({ user_id: OID, work_date: "2026-01-10", status: "มาทำงาน" });
    expect(r.status).toBe("มาทำงาน");
  });
  it("work_date ผิดรูปแบบ → fail", () => {
    expect(
      recordAttendanceBody.safeParse({ user_id: OID, work_date: "10-01-2026" }).success
    ).toBe(false);
  });
  it("status นอก enum ภาษาไทยที่กำหนด → fail", () => {
    expect(
      recordAttendanceBody.safeParse({ user_id: OID, work_date: "2026-01-10", status: "present" })
        .success
    ).toBe(false);
  });
  it("check_in_at/check_out_at coerce จาก string เป็น Date ได้", () => {
    const r = recordAttendanceBody.parse({
      user_id: OID,
      work_date: "2026-01-10",
      check_in_at: "2026-01-10T09:00:00Z",
    });
    expect(r.check_in_at).toBeInstanceOf(Date);
  });
});

describe("schemas/attendance — updateAttendanceBody", () => {
  it("partial ทุก field รวม recorded_by", () => {
    expect(updateAttendanceBody.safeParse({}).success).toBe(true);
    expect(updateAttendanceBody.safeParse({ recorded_by: OID, status: "มาสาย" }).success).toBe(true);
    expect(updateAttendanceBody.safeParse({ recorded_by: "not-an-id" }).success).toBe(false);
  });
});

describe("schemas/attendance — checkInOutBody", () => {
  it("ไม่ส่ง user_id (self check-in) → ผ่าน · ส่งมาผิดรูป ObjectId → fail", () => {
    expect(checkInOutBody.safeParse({}).success).toBe(true);
    expect(checkInOutBody.safeParse({ user_id: OID }).success).toBe(true);
    expect(checkInOutBody.safeParse({ user_id: "abc" }).success).toBe(false);
  });
});

describe("schemas/rbac — permissionCreate/Update (BACKLOG §3, รอบ 4b ข้อ B2)", () => {
  it("create: ต้องมี role_id + menu_key ที่ถูก enum, flag เป็น optional", () => {
    expect(permissionCreate.safeParse({ role_id: OID, menu_key: "orders" }).success).toBe(true);
    expect(permissionCreate.safeParse({ role_id: OID, menu_key: "flying" }).success).toBe(false);
    expect(permissionCreate.safeParse({ menu_key: "orders" }).success).toBe(false); // ไม่มี role_id
  });
  it("update: ต้องมีอย่างน้อย 1 ฟิลด์ (refine)", () => {
    expect(permissionUpdate.safeParse({}).success).toBe(false);
    expect(permissionUpdate.safeParse({ can_view: true }).success).toBe(true);
    expect(permissionUpdate.safeParse({ expires_at: "2026-01-01" }).success).toBe(true);
  });
});

describe("schemas/preorderRound — createRoundBody/updateRoundBody", () => {
  const ok = {
    round_name: "รอบทดสอบ",
    open_date: "2026-01-01",
    close_date: "2026-01-10",
    pickup_date: "2026-01-15",
  };
  it("create: ผ่านเคสปกติ, coerce วันที่จาก string", () => {
    const r = createRoundBody.parse(ok);
    expect(r.open_date).toBeInstanceOf(Date);
  });
  it("create: มี items ซ้อนได้ (ตรวจ shape แต่ละรายการ)", () => {
    expect(
      createRoundBody.safeParse({
        ...ok,
        items: [{ product_id: OID, max_qty_total: 10 }],
      }).success
    ).toBe(true);
    expect(
      createRoundBody.safeParse({ ...ok, items: [{ product_id: "abc", max_qty_total: 10 }] })
        .success
    ).toBe(false);
  });
  it("update: ต้องมีอย่างน้อย 1 ฟิลด์ (refine)", () => {
    expect(updateRoundBody.safeParse({}).success).toBe(false);
    expect(updateRoundBody.safeParse({ round_name: "ใหม่" }).success).toBe(true);
  });
});

describe("schemas/preorderRound — addRoundItemBody/updateRoundItemBody", () => {
  it("add: ต้องมี product_id + max_qty_total, coerce ตัวเลขจาก string", () => {
    const r = addRoundItemBody.parse({ product_id: OID, max_qty_total: "5" });
    expect(r.max_qty_total).toBe(5);
    expect(addRoundItemBody.safeParse({ product_id: OID }).success).toBe(false); // ไม่มี max_qty_total
  });
  it("update: ต้องมีอย่างน้อย 1 ฟิลด์ (refine)", () => {
    expect(updateRoundItemBody.safeParse({}).success).toBe(false);
    expect(updateRoundItemBody.safeParse({ is_active: false }).success).toBe(true);
  });
});

describe("schemas/user — createUserBody/updateUserBody (BACKLOG §3, รอบ 4b ข้อ B2)", () => {
  const okCreate = {
    user_fullname: "พนักงานทดสอบ",
    email: "Test@Example.com",
    auth_provider: "local" as const,
    role_id: OID,
  };
  it("create: ผ่านเคสปกติ, normalize email เป็น lowercase", () => {
    const r = createUserBody.parse(okCreate);
    expect(r.email).toBe("test@example.com");
  });
  it("create: ขาด field บังคับ / email ผิดรูป → fail", () => {
    expect(createUserBody.safeParse({ ...okCreate, role_id: undefined }).success).toBe(false);
    expect(createUserBody.safeParse({ ...okCreate, email: "not-an-email" }).success).toBe(false);
  });
  it("update: ทุกฟิลด์ optional รวม last_working_date ที่ create ไม่มี", () => {
    expect(updateUserBody.safeParse({}).success).toBe(true);
    expect(updateUserBody.safeParse({ last_working_date: "2026-01-01" }).success).toBe(true);
    expect(updateUserBody.safeParse({ role_id: "abc" }).success).toBe(false);
  });
});
