import { describe, it, expect, beforeEach } from "vitest";
import * as searchSynonymService from "@/services/searchSynonymService";
import * as productService from "@/services/productService";
import { makeProduct } from "./helpers";

/** คำพ้องค้นหา (customer-backend-merge.md §8.16) */

beforeEach(() => searchSynonymService.clearSynonymCache());

const search = (q: string, expandSynonyms = true) =>
  productService.getProducts({
    pagination: { page: 1, limit: 50, skip: 0 },
    search: q,
    expandSynonyms,
    is_visible: true,
  }) as Promise<{ items: Array<{ product_name_th: string }> }>;

describe("คำพ้องค้นหา", () => {
  it("ขยายคำค้น: ตรงตัว / คำค้นมีคำนั้น / คำนั้นขึ้นต้นด้วยคำค้น (กติกาเดียวกับหน้าเว็บลูกค้า)", () => {
    const groups = [{ term: "ช็อกโกแลต", synonyms: ["chocolate", "ช็อค"] }];
    expect(searchSynonymService.expandQueryWithSynonyms("choco", groups).words).toContain("ช็อกโกแลต");
    expect(searchSynonymService.expandQueryWithSynonyms("Chocolate", groups).groups).toEqual(["ช็อกโกแลต"]);
    expect(searchSynonymService.expandQueryWithSynonyms("เค้กช็อค", groups).words).toContain("chocolate");
    expect(searchSynonymService.expandQueryWithSynonyms("c", groups).words).toEqual(["c"]);
  });

  it("ค้นหน้าร้านด้วยคำพ้อง · หลังร้าน (ไม่ขยาย) ค้นตามคำเดิม · แก้กลุ่มแล้วมีผลทันที", async () => {
    await makeProduct({ product_name_th: "เค้กช็อกโกแลตหน้านิ่ม", product_name_eng: "Soft cake" });
    await makeProduct({ product_name_th: "ชีสเค้ก", product_name_eng: "Cheesecake" });
    expect((await search("chocolate")).items).toHaveLength(0);

    const g = (await searchSynonymService.createSynonym({ term: "ช็อกโกแลต", synonyms: ["chocolate", " chocolate ", "ช็อค"] })) as {
      _id: unknown; synonyms: string[];
    };
    expect(g.synonyms).toEqual(["chocolate", "ช็อค"]); // ตัดซ้ำ
    expect((await search("chocolate")).items.map((p) => p.product_name_th)).toEqual(["เค้กช็อกโกแลตหน้านิ่ม"]);
    expect((await search("chocolate", false)).items).toHaveLength(0);

    await searchSynonymService.deleteSynonym(String(g._id));
    expect((await search("chocolate")).items).toHaveLength(0);
  });

  it("ตรวจข้อมูล: คำหลักซ้ำ (ไม่สนวรรณยุกต์/ตัวพิมพ์) = 409 · คำสั้นเกิน = 400", async () => {
    await searchSynonymService.createSynonym({ term: "Matcha", synonyms: ["มัทฉะ"] });
    await expect(searchSynonymService.createSynonym({ term: "matcha", synonyms: [] })).rejects.toMatchObject({ status: 409 });
    await expect(searchSynonymService.createSynonym({ term: "ช", synonyms: [] })).rejects.toMatchObject({ status: 400 });
    await expect(searchSynonymService.createSynonym({ term: "ชาไทย", synonyms: ["x"] })).rejects.toMatchObject({ status: 400 });
    expect((await searchSynonymService.getSynonymGroups()).map((g) => g.term)).toEqual(["Matcha"]);
  });
});
