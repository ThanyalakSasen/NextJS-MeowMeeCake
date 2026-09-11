import { describe, it, expect } from "vitest";
import { updateProfileBody } from "@/schemas/user";
import { addressCreate, addressUpdate } from "@/schemas/address";
import { reviewCreateBody, reviewUpdateBody } from "@/schemas/review";

const OID = "5f9d88b9c3a1e2b3c4d5e6f7";

describe("schemas/user — updateProfileBody", () => {
  it("partial: แก้ field เดียวได้ / {} ผ่าน", () => {
    expect(updateProfileBody.safeParse({ user_fullname: "แมวเหมียว" }).success).toBe(true);
    expect(updateProfileBody.safeParse({}).success).toBe(true);
  });

  it("user_phone ผิดรูป → fail · user_birthdate coerce จาก string", () => {
    expect(updateProfileBody.safeParse({ user_phone: "123" }).success).toBe(false);
    expect(updateProfileBody.safeParse({ user_phone: "0812345678" }).success).toBe(true);
    const r = updateProfileBody.parse({ user_birthdate: "2000-05-01" });
    expect(r.user_birthdate).toBeInstanceOf(Date);
  });

  it("user_allergies = array ของ string, ทิ้ง field นอก whitelist (email)", () => {
    expect(updateProfileBody.safeParse({ user_allergies: ["ถั่ว", "นม"] }).success).toBe(true);
    expect(updateProfileBody.safeParse({ user_allergies: "ถั่ว" }).success).toBe(false);
    const r = updateProfileBody.parse({ email: "x@y.com", user_fullname: "a" });
    expect(r).not.toHaveProperty("email");
  });
});

describe("schemas/address", () => {
  const ok = {
    house_no: "99/1",
    sub_district: "ในเมือง",
    district: "เมือง",
    province: "ขอนแก่น",
    zip_code: "40000",
  };

  it("create: required 5 ช่อง + zip 5 หลัก", () => {
    expect(addressCreate.parse(ok)).toMatchObject({ province: "ขอนแก่น" });
    expect(addressCreate.safeParse({ ...ok, zip_code: "400" }).success).toBe(false);
    expect(addressCreate.safeParse({ ...ok, house_no: "" }).success).toBe(false);
  });

  it("is_default optional boolean · update = partial", () => {
    expect(addressCreate.parse({ ...ok, is_default: true }).is_default).toBe(true);
    expect(addressUpdate.safeParse({ province: "เลย" }).success).toBe(true);
    expect(addressUpdate.safeParse({}).success).toBe(true);
  });
});

describe("schemas/review", () => {
  it("create: order_item_id objectId + rating int 1-5", () => {
    expect(reviewCreateBody.parse({ order_item_id: OID, rating: 5 }).rating).toBe(5);
    expect(reviewCreateBody.parse({ order_item_id: OID, rating: "4" }).rating).toBe(4); // coerce
    expect(reviewCreateBody.safeParse({ order_item_id: OID, rating: 6 }).success).toBe(false);
    expect(reviewCreateBody.safeParse({ order_item_id: OID, rating: 3.5 }).success).toBe(false);
    expect(reviewCreateBody.safeParse({ order_item_id: "bad", rating: 3 }).success).toBe(false);
  });

  it("review_text/image optional · update = partial (ไม่มี order_item_id)", () => {
    expect(
      reviewCreateBody.parse({ order_item_id: OID, rating: 3, review_text: null, image: ["u"] })
        .image
    ).toEqual(["u"]);
    expect(reviewUpdateBody.safeParse({ rating: 2 }).success).toBe(true);
    expect(reviewUpdateBody.safeParse({}).success).toBe(true);
    expect(reviewUpdateBody.safeParse({ rating: 0 }).success).toBe(false);
  });
});
