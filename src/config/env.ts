import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().default(5000),
  MONGODB_URI: z.string().min(10, "MONGODB_URI is required"),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  JWT_REFRESH_SECRET: z.string().min(32, "JWT_REFRESH_SECRET must be at least 32 characters"),
  JWT_EXPIRES_IN: z.string().default("15m"),
  JWT_REFRESH_EXPIRES_IN: z.string().default("30d"),

  // Comma separated lists are allowed for both.
  FRONTEND_GUEST_URL: z.string().default("http://localhost:3000"),
  FRONTEND_ADMIN_URL: z.string().default("http://localhost:3001"),
  EXTRA_ALLOWED_ORIGINS: z.string().default(""),

  CLOUDINARY_CLOUD_NAME: z.string().optional(),
  CLOUDINARY_API_KEY: z.string().optional(),
  CLOUDINARY_API_SECRET: z.string().optional(),

  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default("Corbett The Vedant <onboarding@resend.dev>"),
  NOTIFY_EMAIL: z.string().default("Livorahospitality06@gmail.com"),

  SEED_ADMIN_EMAIL: z.string().default("admin@livora.com"),
  SEED_ADMIN_PASSWORD: z.string().default("ChangeMe@12345"),
  SEED_STAFF_EMAIL: z.string().default("staff@livora.com"),
  SEED_STAFF_PASSWORD: z.string().default("ChangeMe@12345"),

  RESORT_NAME: z.string().default("Corbett The Vedant By Livora"),
  RESORT_GST_NUMBER: z.string().default(""),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error("❌ Invalid environment configuration:");
  parsed.error.issues.forEach((i) => console.error(`   - ${i.path.join(".")}: ${i.message}`));
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === "production";

const split = (s: string) => s.split(",").map((x) => x.trim().replace(/\/$/, "")).filter(Boolean);

export const guestUrls = split(env.FRONTEND_GUEST_URL);
export const adminUrls = split(env.FRONTEND_ADMIN_URL);
export const allowedOrigins = [...guestUrls, ...adminUrls, ...split(env.EXTRA_ALLOWED_ORIGINS)];
export const primaryGuestUrl = guestUrls[0] || "http://localhost:3000";
export const primaryAdminUrl = adminUrls[0] || "http://localhost:3001";
