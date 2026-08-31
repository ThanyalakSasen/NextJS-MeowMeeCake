"use client";

import { useEffect } from "react";
import { App, ConfigProvider } from "antd";
import type { ThemeConfig } from "antd";
import thTH from "antd/locale/th_TH";
import enUS from "antd/locale/en_US";
import { useLocale } from "next-intl";
import dayjs from "dayjs";
import "dayjs/locale/th";
import "dayjs/locale/en";

// ตั้ง dayjs locale เริ่มต้นตรงนี้ (ก่อนคอมโพเนนต์ใน tree เรนเดอร์) กัน DatePicker/Calendar
// แสดงเดือน/วันเป็นภาษาผิดหลุดมาแวบหนึ่งตอนโหลดหน้าครั้งแรก — ค่าจริงถูกซิงก์กับ i18n ใน useEffect ด้านล่าง
dayjs.locale("th");

// antd render ฟอนต์ของ Table/Select/Input/Button/Tag ฯลฯ ด้วย design token ของตัวเอง
// (ไม่ผ่านคลาส Tailwind text-*) — ตั้ง token ที่นี่ครั้งเดียวให้ทุกคอมโพเนนต์ antd อยู่ในช่วง 14–22px
const theme: ThemeConfig = {
  token: {
    fontSize: 14,
    fontSizeSM: 14,
    fontSizeLG: 16,
    fontSizeXL: 18,
    fontSizeIcon: 14,
    fontSizeHeading1: 22,
    fontSizeHeading2: 20,
    fontSizeHeading3: 18,
    fontSizeHeading4: 16,
    fontSizeHeading5: 14,

    // ธีมสีน้ำตาล (Coffee) — สีหลักของแบรนด์ ให้คอมโพเนนต์ antd ที่ไม่ได้ครอบสีด้วย Tailwind
    // ใช้สีนี้แทนสีฟ้า default ของ antd (Switch ตอนเปิด, focus ring, ปุ่ม primary เปล่า, ลิงก์)
    colorPrimary: "#4B2E2B",
    colorPrimaryHover: "#603D2A",
    colorPrimaryActive: "#37201D",
    colorLink: "#7C4F35",
    colorLinkHover: "#4B2E2B",
  },
};

export default function Providers({ children }: { children: React.ReactNode }) {
  const locale = useLocale();

  // ซิงก์ dayjs กับภาษาที่ผู้ใช้เลือก (i18n) — กระทบ DatePicker/Calendar/relativeTime ทั้งแอป
  useEffect(() => {
    dayjs.locale(locale === "en" ? "en" : "th");
  }, [locale]);

  return (
    // locale ของ antd (ชื่อเดือน/วัน, ปุ่ม "วันนี้"/"ตกลง", ข้อความแบ่งหน้า ฯลฯ) ตามภาษาที่เลือก
    <ConfigProvider theme={theme} locale={locale === "en" ? enUS : thTH}>
      {/* <App> ส่ง theme ต่อไปถึง feedback component ของ antd (เช่น Popconfirm)
          popup แจ้งเตือน/ยืนยันหลักย้ายไปใช้ sweetalert2 แล้ว — ดู src/lib/alert.ts */}
      <App>{children}</App>
    </ConfigProvider>
  );
}
