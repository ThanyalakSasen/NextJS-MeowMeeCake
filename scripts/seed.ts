import "./_env"; // ต้องมาก่อน import ที่อ่าน env ตอนโหลดโมดูล

import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import dbConnect from "../src/lib/dbConnect";
import roleModel from "../src/models/roleModel";
import unitModel from "../src/models/unitModel";
import productCategoryModel from "../src/models/productCategoryModel";
import ingredientCategoryModel from "../src/models/ingredientCategoryModel";
import componentCategoryModel from "../src/models/componentsCategory";
import userModel from "../src/models/userModel";

/* eslint-disable @typescript-eslint/no-explicit-any */

// บัญชีเจ้าของร้านเริ่มต้น — เปลี่ยนรหัสผ่านทันทีหลัง seed
const OWNER_EMAIL = "thanyalak.sas@kkumail.com";
const OWNER_PASSWORD = "MeowMee@1234";

type Doc = Record<string, unknown>;

/** สร้างเฉพาะเอกสารที่ยังไม่มี (idempotent — รันซ้ำได้) */
async function ensureMany(label: string, model: any, key: string, docs: Doc[]) {
  let created = 0;
  for (const doc of docs) {
    const exists = await model.exists({ [key]: doc[key] });
    if (!exists) {
      await model.create(doc);
      created++;
    }
  }
  console.log(`  ${label.padEnd(22)} +${created} ใหม่ / ${docs.length} ทั้งหมด`);
}

async function main() {
  await dbConnect();
  console.log("เชื่อมต่อ MongoDB สำเร็จ — เริ่ม seed\n");

  await ensureMany("roles", roleModel, "role_name", [
    { role_name: "owner", role_type: "owner", is_active: true },
    { role_name: "staff", role_type: "staff", is_active: true },
    { role_name: "customer", role_type: "customer", is_active: true },
  ]);

  await ensureMany("units", unitModel, "unit_name", [
    { unit_name: "กรัม", unit_abbr: "g", unit_type: "IngredientWeight", usage_context: ["Ingredient"] },
    { unit_name: "กิโลกรัม", unit_abbr: "kg", unit_type: "IngredientWeight", usage_context: ["Ingredient"] },
    { unit_name: "มิลลิลิตร", unit_abbr: "ml", unit_type: "IngredientVolume", usage_context: ["Ingredient"] },
    { unit_name: "ลิตร", unit_abbr: "L", unit_type: "IngredientVolume", usage_context: ["Ingredient"] },
    { unit_name: "ฟอง", unit_abbr: "ฟอง", unit_type: "Custom", usage_context: ["Ingredient"] },
    { unit_name: "ชิ้น", unit_abbr: "ชิ้น", unit_type: "ProductCount", usage_context: ["Product"] },
    { unit_name: "กล่อง", unit_abbr: "กล่อง", unit_type: "Package", usage_context: ["Product"] },
    { unit_name: "ปอนด์", unit_abbr: "lb", unit_type: "ProductWeight", usage_context: ["Product"] },
    { unit_name: "ถาด", unit_abbr: "ถาด", unit_type: "Tray", usage_context: ["Both"] },
    { unit_name: "แผ่น", unit_abbr: "แผ่น", unit_type: "Sheet", usage_context: ["Product"] },
  ]);

  await ensureMany(
    "product categories",
    productCategoryModel,
    "product_category_name",
    ["ซาวโดว์", "เค้กชิ้น", "เค้กปอนด์", "คัพเค้ก", "คุกกี้", "ขนมปัง", "เครื่องดื่ม", "อื่นๆ"].map((n) => ({
      product_category_name: n,
    }))
  );

  await ensureMany(
    "ingredient categories",
    ingredientCategoryModel,
    "ingredient_category_name",
    [
      "แป้ง",
      "น้ำตาล",
      "ไข่และนม",
      "เนยและไขมัน",
      "ช็อกโกแลตและโกโก้",
      "สารแต่งกลิ่นและสี",
      "ผงฟูและสารช่วย",
      "บรรจุภัณฑ์",
    ].map((n) => ({ ingredient_category_name: n }))
  );

  await ensureMany(
    "component categories",
    componentCategoryModel,
    "component_category_name",
    ["ครีมและฟรอสติ้ง", "ไส้ขนม", "ฐานและสปันจ์", "ท็อปปิ้งและตกแต่ง"].map((n) => ({
      component_category_name: n,
    }))
  );

  // เจ้าของร้าน
  const ownerRole: any = await roleModel.findOne({ role_name: "owner" }).lean();
  if (!ownerRole) throw new Error("ไม่พบ role owner หลัง seed roles");

  const existingOwner = await userModel.exists({ email: OWNER_EMAIL.toLowerCase() });
  if (existingOwner) {
    console.log(`  owner user             มีอยู่แล้ว (${OWNER_EMAIL})`);
  } else {
    await userModel.create({
      user_fullname: "MeowMeeCake (เจ้าของร้าน)",
      email: OWNER_EMAIL,
      password: await bcrypt.hash(OWNER_PASSWORD, 10),
      auth_provider: "local",
      role_id: ownerRole._id,
      is_active: true,
      is_email_verified: true,
    });
    console.log(`  owner user             สร้างใหม่ ${OWNER_EMAIL}`);
    console.log(`                         รหัสผ่านชั่วคราว: ${OWNER_PASSWORD}  ← เปลี่ยนทันที`);
  }

  console.log("\nseed เสร็จสมบูรณ์");
}

main()
  .catch((err) => {
    console.error("\nseed ล้มเหลว:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
