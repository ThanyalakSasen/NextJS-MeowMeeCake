/**
 * roleService — CRUD บทบาทผู้ใช้ (Roles) เช่น owner / staff / customer
 *
 * ต่อยอดจาก crudService + กันการลบบทบาทที่ยังมีผู้ใช้ผูกอยู่
 * + แก้ไข: เปลี่ยนชื่อ / เปิด-ปิดได้ แต่**เปลี่ยนประเภท (role_type) ไม่ได้** — กันคนที่มีแค่สิทธิ์ employees.update
 *   เปลี่ยนบทบาทตัวเองเป็น owner (owner ผ่านทุกสิทธิ์ — authGuard) · ต้องการประเภทอื่นให้สร้างบทบาทใหม่
 *   ชื่อซ้ำกับบทบาทที่ยังไม่ลบ = 409 (unique index role_name)
 */
import type { Model } from "mongoose";
import roleModel from "../models/roleModel";
import userModel from "../models/userModel";
import { createCrudService } from "../lib/crudService";
import { badRequest, conflict } from "../lib/httpError";

/* eslint-disable @typescript-eslint/no-explicit-any */

const base = createCrudService(roleModel as Model<any>, {
  label: "บทบาท",
  searchFields: ["role_name"],
  createFields: ["role_name", "role_type", "is_active"],
});

export const roleService = {
  ...base,

  async update(id: string, input: Record<string, any>) {
    if (input.role_type !== undefined) {
      const current = (await base.getById(id)) as { role_type?: string };
      if (input.role_type !== current.role_type) {
        throw badRequest("เปลี่ยนประเภทของบทบาทไม่ได้ — สร้างบทบาทใหม่ตามประเภทที่ต้องการแทน");
      }
    }
    return base.update(id, input);
  },

  async remove(id: string) {
    const inUse = await userModel.exists({ role_id: id, deleted_at: null }).lean();
    if (inUse) {
      throw conflict("ลบบทบาทนี้ไม่ได้ เพราะยังมีผู้ใช้ที่ใช้บทบาทนี้อยู่");
    }
    return base.remove(id);
  },
};

export default roleService;
