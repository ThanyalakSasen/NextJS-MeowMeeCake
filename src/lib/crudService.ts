/**
 * crudService — โรงงานสร้าง service มาตรฐานสำหรับเอนทิตีที่เป็น CRUD ตรง ๆ
 *
 * เอนทิตีเรียบง่าย (หมวดหมู่, หน่วยนับ, แบนเนอร์ ฯลฯ) แทบไม่มี logic พิเศษ
 * จึงใช้ตัวนี้สร้าง list/getById/create/update/remove/restore ให้ครบในบรรทัดเดียว
 * เอนทิตีที่มีกฎธุรกิจ (สินค้า, ออเดอร์, สต็อก) เขียน service เองแล้วเรียก base ตัวนี้ประกอบ
 *
 * ทุกตัวใช้ soft delete ผ่านฟิลด์ deleted_at เหมือน model อื่นในโปรเจกต์ (ปิดได้ด้วย softDelete: false)
 */

import type { Model } from "mongoose";
import dbConnect from "./dbConnect";
import { notFound } from "./httpError";
import { assertObjectId, pick } from "./objectId";
import { buildMeta, escapeRegExp, type Pagination } from "./queryParams";

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyModel = Model<any>;
type Doc = Record<string, any>;

export interface PopulateSpec {
  path: string;
  select?: string;
}

export interface CrudOptions {
  /** ชื่อเอนทิตีภาษาไทยสำหรับข้อความ error เช่น "หมวดหมู่สินค้า" */
  label: string;
  /** ฟิลด์ที่ค้นด้วย ?search= ได้ (regex, case-insensitive) */
  searchFields?: string[];
  /** ฟิลด์ที่อนุญาตให้เขียนตอน create (ถ้าไม่ระบุ = รับทุกฟิลด์ตาม schema) */
  createFields?: readonly string[];
  /** ฟิลด์ที่อนุญาตให้เขียนตอน update (ถ้าไม่ระบุ = ใช้ createFields) */
  updateFields?: readonly string[];
  /** ใช้ soft delete หรือไม่ (ค่าเริ่มต้น: true) */
  softDelete?: boolean;
  /** populate ทุกครั้งที่อ่านข้อมูล */
  populate?: PopulateSpec[];
}

export interface ListArgs {
  pagination: Pagination;
  search?: string;
  sort?: Record<string, 1 | -1>;
  /** filter เพิ่มเติมจาก query string เช่น { is_active: true } */
  filter?: Record<string, unknown>;
  includeDeleted?: boolean;
}

export interface CrudService {
  model: AnyModel;
  list: (args: ListArgs) => Promise<{ items: Doc[]; meta: ReturnType<typeof buildMeta> }>;
  getById: (id: string, includeDeleted?: boolean) => Promise<Doc>;
  create: (input: Doc) => Promise<Doc>;
  update: (id: string, input: Doc) => Promise<Doc>;
  remove: (id: string) => Promise<Doc>;
  restore: (id: string) => Promise<Doc>;
  /** filter { deleted_at: null } (หรือ {} ถ้าปิด soft delete) — ใช้ประกอบ query ใน service ลูก */
  activeFilter: () => Record<string, unknown>;
}

export function createCrudService(model: AnyModel, opts: CrudOptions): CrudService {
  const softDelete = opts.softDelete ?? true;
  const createFields = opts.createFields;
  const updateFields = opts.updateFields ?? opts.createFields;

  const activeFilter = (): Record<string, unknown> =>
    softDelete ? { deleted_at: null } : {};

  function applyPopulate<Q extends { populate: (path: string, select?: string) => Q }>(q: Q): Q {
    let out = q;
    for (const p of opts.populate ?? []) out = out.populate(p.path, p.select);
    return out;
  }

  async function list(args: ListArgs) {
    await dbConnect();

    const filter: Record<string, unknown> = { ...(args.filter ?? {}) };
    if (softDelete && !args.includeDeleted) filter.deleted_at = null;

    if (args.search && opts.searchFields?.length) {
      const rx = new RegExp(escapeRegExp(args.search.trim()), "i");
      filter.$or = opts.searchFields.map((f) => ({ [f]: rx }));
    }

    const sort = args.sort ?? { created_at: -1 };

    const query = applyPopulate(
      model
        .find(filter)
        .sort(sort as Record<string, 1 | -1>)
        .skip(args.pagination.skip)
        .limit(args.pagination.limit) as any
    );

    const [items, total] = await Promise.all([
      query.lean(),
      model.countDocuments(filter),
    ]);

    return { items: items as Doc[], meta: buildMeta(total, args.pagination) };
  }

  async function getById(id: string, includeDeleted = false) {
    await dbConnect();
    assertObjectId(id);

    const filter: Record<string, unknown> = { _id: id };
    if (softDelete && !includeDeleted) filter.deleted_at = null;

    const doc = await applyPopulate(model.findOne(filter) as any).lean();
    if (!doc) throw notFound(`ไม่พบ${opts.label}ที่ระบุ`);
    return doc as Doc;
  }

  async function create(input: Doc) {
    await dbConnect();
    const payload = createFields ? pick(input, createFields) : input;
    const doc = await model.create(payload);
    return doc.toObject() as Doc;
  }

  async function update(id: string, input: Doc) {
    await dbConnect();
    assertObjectId(id);

    const payload = updateFields ? pick(input, updateFields) : input;
    const doc = await model
      .findOneAndUpdate(
        { _id: id, ...activeFilter() },
        { $set: payload },
        { new: true, runValidators: true }
      )
      .lean();

    if (!doc) throw notFound(`ไม่พบ${opts.label}ที่ระบุ`);
    return doc as Doc;
  }

  async function remove(id: string) {
    await dbConnect();
    assertObjectId(id);

    if (softDelete) {
      const doc = await model
        .findOneAndUpdate(
          { _id: id, deleted_at: null },
          { $set: { deleted_at: new Date() } },
          { new: true }
        )
        .lean();
      if (!doc) throw notFound(`ไม่พบ${opts.label}ที่ระบุ หรือถูกลบไปแล้ว`);
      return doc as Doc;
    }

    const doc = await model.findByIdAndDelete(id).lean();
    if (!doc) throw notFound(`ไม่พบ${opts.label}ที่ระบุ`);
    return doc as Doc;
  }

  async function restore(id: string) {
    await dbConnect();
    assertObjectId(id);

    if (!softDelete) throw notFound(`${opts.label}นี้ไม่รองรับการกู้คืน`);

    const doc = await model
      .findOneAndUpdate(
        { _id: id, deleted_at: { $ne: null } },
        { $set: { deleted_at: null } },
        { new: true }
      )
      .lean();
    if (!doc) throw notFound(`ไม่พบ${opts.label}ที่ถูกลบไว้`);
    return doc as Doc;
  }

  return { model, list, getById, create, update, remove, restore, activeFilter };
}
