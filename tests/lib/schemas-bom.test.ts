import { describe, it, expect } from "vitest";
import {
  componentCreate,
  componentUpdate,
  recipeCreate,
  recipeUpdate,
} from "@/schemas/bom";

const OID = "5f9d88b9c3a1e2b3c4d5e6f7";
const item = { ingredient_id: OID, quantity: 2, unit_id: OID };
const compItem = { component_id: OID, quantity: 1, unit_id: OID };

describe("schemas/bom — component", () => {
  const ok = {
    component_name: "ครีมสด",
    componentcategory_id: OID,
    yield_qty: 10,
    yield_unit_id: OID,
    created_by: OID,
  };

  it("create: required fields + created_by", () => {
    expect(componentCreate.parse(ok)).toMatchObject({ component_name: "ครีมสด", yield_qty: 10 });
    expect(componentCreate.safeParse({ ...ok, created_by: undefined }).success).toBe(false);
    expect(componentCreate.safeParse({ ...ok, componentcategory_id: "bad" }).success).toBe(false);
  });

  it("create: ingredients[] — แต่ละรายการต้องมี id/quantity/unit_id, quantity ≥ 0", () => {
    expect(componentCreate.parse({ ...ok, ingredients: [item] }).ingredients).toHaveLength(1);
    expect(
      componentCreate.safeParse({ ...ok, ingredients: [{ ...item, quantity: -1 }] }).success
    ).toBe(false);
    expect(
      componentCreate.safeParse({ ...ok, ingredients: [{ ingredient_id: OID, quantity: 1 }] }).success
    ).toBe(false); // ไม่มี unit_id
  });

  it("create: yield_qty รับ string → coerce", () => {
    expect(componentCreate.parse({ ...ok, yield_qty: "5" }).yield_qty).toBe(5);
  });

  it("update: partial + strip componentcategory_id / created_by", () => {
    const r = componentUpdate.parse({ componentcategory_id: OID, created_by: OID, note: "x" });
    expect(r).not.toHaveProperty("componentcategory_id");
    expect(r).not.toHaveProperty("created_by");
    expect(componentUpdate.safeParse({}).success).toBe(true);
  });
});

describe("schemas/bom — recipe", () => {
  const ok = {
    recipe_name: "เค้กวานิลลา",
    product_id: OID,
    yield_qty: 1,
    yield_unit_id: OID,
    created_by: OID,
  };

  it("create: required + ingredients[] + components[] ซ้อน", () => {
    const r = recipeCreate.parse({ ...ok, ingredients: [item], components: [compItem] });
    expect(r.ingredients).toHaveLength(1);
    expect(r.components).toHaveLength(1);
  });

  it("create: components[].component_id ผิดรูป → fail", () => {
    expect(
      recipeCreate.safeParse({ ...ok, components: [{ ...compItem, component_id: "nope" }] }).success
    ).toBe(false);
  });

  it("create: ขาด product_id / created_by → fail", () => {
    expect(recipeCreate.safeParse({ ...ok, product_id: undefined }).success).toBe(false);
    expect(recipeCreate.safeParse({ ...ok, created_by: undefined }).success).toBe(false);
  });

  it("update: partial + strip product_id / created_by", () => {
    const r = recipeUpdate.parse({ product_id: OID, created_by: OID, duration_minutes: 30 });
    expect(r).not.toHaveProperty("product_id");
    expect(r).not.toHaveProperty("created_by");
    expect(r.duration_minutes).toBe(30);
  });
});
