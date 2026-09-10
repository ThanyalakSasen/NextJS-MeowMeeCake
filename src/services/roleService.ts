/**
 * roleService — CRUD บทบาทผู้ใช้ (Roles) เช่น owner / staff / customer
 *
 * ต่อยอดจาก crudService + กันการลบบทบาทที่ยังมีผู้ใช้ผูกอยู่
 */
import type { Model } from "mongoose";
import roleModel from "../models/roleModel";
import userModel from "../models/userModel";
import { createCrudService } from "../lib/crudService";
import { conflict } from "../lib/httpError";

/* eslint-disable @typescript-eslint/no-explicit-any */

const base = createCrudService(roleModel as Model<any>, {
  label: "บทบาท",
  searchFields: ["role_name"],
  createFields: ["role_name", "role_type", "is_active"],
});

export const roleService = {
  ...base,

  async remove(id: string) {
    const inUse = await userModel.exists({ role_id: id, deleted_at: null }).lean();
    if (inUse) {
      throw conflict("ลบบทบาทนี้ไม่ได้ เพราะยังมีผู้ใช้ที่ใช้บทบาทนี้อยู่");
    }
    return base.remove(id);
  },
};

export default roleService;
