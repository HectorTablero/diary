import dotenv from "dotenv";

dotenv.config();

const PORT: number = parseInt(process.env.PORT || "3000");
const MAX_WORKERS: number = parseInt(process.env.MAX_WORKERS || "10");
const MONGODB_URI: string = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/diary";
const GOOGLE_CLIENT_ID: string = process.env.GOOGLE_CLIENT_ID || "";
const GOOGLE_CLIENT_SECRET: string = process.env.GOOGLE_CLIENT_SECRET || "";
const COOKIE_SESSION_KEY1: string = process.env.COOKIE_SESSION_KEY1 || "";
const COOKIE_SESSION_KEY2: string = process.env.COOKIE_SESSION_KEY2 || "";
const SUPPORTED_LANGUAGES: string[] = process.env.SUPPORTED_LANGUAGES?.replace(", ", ",").split(
    ","
) || ["es", "en"];
const MAX_SUB_ENTRY_DEPTH: number = parseInt(process.env.MAX_SUB_ENTRY_DEPTH || "3");

export {
    PORT,
    MAX_WORKERS,
    MONGODB_URI,
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    COOKIE_SESSION_KEY1,
    COOKIE_SESSION_KEY2,
    SUPPORTED_LANGUAGES,
    MAX_SUB_ENTRY_DEPTH
};
