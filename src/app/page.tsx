import { getTranslations } from "next-intl/server";

// Placeholder หน้าแรก (เฟส 0)
// เฟส 5 จะแทนที่ด้วย logic redirect ตาม session:
//   verifySession(cookie) ? redirect("/owner/dashboard") : redirect("/login")
export default async function Home() {
  const t = await getTranslations("common");
  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-2 text-brown-900">
      <h1 className="text-xl font-medium">{t("appName")}</h1>
      <p className="text-sm text-gray-500">
        {t("appTagline")} — {t("setupInProgress")} (เฟส 0.5)
      </p>
    </main>
  );
}
