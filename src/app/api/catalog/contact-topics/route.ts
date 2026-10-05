/** GET /api/catalog/contact-topics — หัวข้อของฟอร์มติดต่อร้าน + ความยาวข้อความสูงสุด (สาธารณะ · §8.17) */
import { ok, route } from "@/lib/apiResponse";
import { CONTACT_MESSAGE_MAX_LENGTH, CONTACT_TOPICS } from "@/lib/contactTopics";

export const GET = route(async () => ok({ topics: CONTACT_TOPICS, max_length: CONTACT_MESSAGE_MAX_LENGTH }));
