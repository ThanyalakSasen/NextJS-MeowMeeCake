/**
 * bannerService — CRUD แบนเนอร์หน้าร้าน (Banners)
 */
import bannerModel from "../models/bannersModel";
import { createCrudService } from "../lib/crudService";

const WRITABLE = [
  "banner_name",
  "banner_description",
  "banner_img",
  "banner_link",
  "start_date",
  "end_date",
  "sort_order",
  "is_active",
] as const;

export const bannerService = createCrudService(bannerModel, {
  label: "แบนเนอร์",
  searchFields: ["banner_name", "banner_description"],
  createFields: WRITABLE,
});

export default bannerService;
