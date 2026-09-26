import mongoose from "mongoose";
import { env } from "./config/env";
import { app, httpServer } from "./app";
import { initSocket } from "./socket";
import User from "./models/User";
import { seedDatabase } from "./seed";

initSocket(httpServer);

async function start() {
  mongoose.set("strictQuery", true);
  await mongoose.connect(env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 });
  console.log("✅ MongoDB connected");
  // Make sure unique indexes (double-booking protection!) exist before serving traffic.
  await mongoose.syncIndexes().catch((e) => console.warn("Index sync warning:", e.message));
  // First boot on a fresh database: create admin/staff accounts, rooms, menu, settings (idempotent).
  // Render's free plan has no shell, so this replaces running `npm run seed` by hand.
  if (process.env.AUTO_SEED !== "false" && !(await User.exists({ role: "admin" }))) {
    console.log("No admin found, running first-time seed…");
    await seedDatabase().catch((e) => console.error("Auto-seed failed:", e));
  }
  httpServer.listen(env.PORT, "0.0.0.0", () => console.log(`🚀 API listening on :${env.PORT} (${env.NODE_ENV})`));
}

start().catch((err) => {
  console.error("Failed to start:", err);
  process.exit(1);
});

const shutdown = () => {
  console.log("Shutting down…");
  httpServer.close(() => mongoose.disconnect().finally(() => process.exit(0)));
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
process.on("unhandledRejection", (r) => console.error("Unhandled rejection:", r));

