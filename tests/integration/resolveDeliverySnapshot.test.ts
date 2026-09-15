import { describe, it, expect } from "vitest";
import * as addressService from "@/services/addressService";
import { makeUser, makeAddress } from "./helpers";

/**
 * BACKLOG §3.8 — address_id → checkout
 * addressService.resolveDeliverySnapshot รวม address_id (สมุดที่อยู่ — เก็บแค่ตำแหน่ง) +
 * recipient_name/recipient_phone (แยกมาต่างหาก เพราะสมุดที่อยู่ไม่เก็บชื่อ/เบอร์ผู้รับ) ให้เป็น
 * flat record รูปแบบเดียวกับที่ orderService.persistOrder คาดหวัง (ADDRESS_FIELDS)
 */
describe("addressService.resolveDeliverySnapshot (BACKLOG §3.8)", () => {
  it("ระบุ address_id → คืน snapshot รวม recipient_name/phone + ตำแหน่งจากสมุดที่อยู่", async () => {
    const user = await makeUser();
    const addr = await makeAddress(String(user._id), {
      house_no: "99/9",
      sub_district: "บางรัก",
      district: "บางรัก",
      province: "กรุงเทพมหานคร",
      zip_code: "10500",
    });

    const snapshot = await addressService.resolveDeliverySnapshot(String(user._id), {
      address_id: String(addr._id),
      recipient_name: "สมชาย ใจดี",
      recipient_phone: "0812345678",
    });

    expect(snapshot).toMatchObject({
      recipient_name: "สมชาย ใจดี",
      recipient_phone: "0812345678",
      house_no: "99/9",
      sub_district: "บางรัก",
      district: "บางรัก",
      province: "กรุงเทพมหานคร",
      zip_code: "10500",
    });
  });

  it("address_id ของผู้ใช้อื่น → notFound (สโคปด้วย userId กัน IDOR)", async () => {
    const owner = await makeUser();
    const stranger = await makeUser();
    const addr = await makeAddress(String(owner._id));

    await expect(
      addressService.resolveDeliverySnapshot(String(stranger._id), {
        address_id: String(addr._id),
        recipient_name: "คนอื่น",
        recipient_phone: "0899999999",
      })
    ).rejects.toMatchObject({ status: 404 });
  });

  it("ไม่ระบุ address_id → ส่ง delivery_address ที่กรอกมาเองกลับตรง ๆ", async () => {
    const user = await makeUser();
    const manual = {
      recipient_name: "มือกรอกเอง",
      recipient_phone: "0898765432",
      house_no: "1",
      sub_district: "ก",
      district: "ข",
      province: "ค",
      zip_code: "11111",
    };
    const snapshot = await addressService.resolveDeliverySnapshot(String(user._id), {
      delivery_address: manual,
    });
    expect(snapshot).toEqual(manual);
  });

  it("ไม่ระบุอะไรเลย → คืน null", async () => {
    const user = await makeUser();
    const snapshot = await addressService.resolveDeliverySnapshot(String(user._id), {});
    expect(snapshot).toBeNull();
  });
});
