/**
 * GET /api/catalog/search-synonyms — กลุ่มคำพ้องค้นหา (สาธารณะ) ให้หน้าเว็บขยายคำค้นเอง → [{ term, synonyms }]
 * ย้ายมาจากฝั่งลูกค้า /api/customer/search-synonyms · /api/catalog/products?search= ขยายให้ฝั่ง server อยู่แล้ว (§8.16)
 */
import { okList, route } from "@/lib/apiResponse";
import * as searchSynonymService from "@/services/searchSynonymService";

export const GET = route(async () => okList(await searchSynonymService.getSynonymGroups()));
