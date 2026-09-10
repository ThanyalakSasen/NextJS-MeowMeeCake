/**
 * unitService — CRUD หน่วยนับ/หน่วยปริมาณ (Units)
 * ใช้ทั้งฝั่งวัตถุดิบ (สูตรขนม) และฝั่งสินค้า
 */
import unitModel from "../models/unitModel";
import { createCrudService } from "../lib/crudService";

const WRITABLE = [
  "unit_name",
  "unit_abbr",
  "unit_type",
  "usage_context",
] as const;

export const unitService = createCrudService(unitModel, {
  label: "หน่วยนับ",
  searchFields: ["unit_name", "unit_abbr"],
  createFields: WRITABLE,
});

export default unitService;
