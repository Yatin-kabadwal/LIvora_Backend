import express from "express";
import { createServer } from "http";
import mongoose from "mongoose";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import morgan from "morgan";
import { env, isProd, allowedOrigins } from "./config/env";
import { errorHandler, globalLimiter, sanitize } from "./middleware/security";

import authRoutes from "./routes/auth";
import roomRoutes from "./routes/rooms";
import bookingRoutes from "./routes/bookings";
import messageRoutes from "./routes/messages";
import { settingsRouter, menuRouter, reviewRouter, promoRouter } from "./routes/content";
import { housekeepingRouter, roomServiceRouter, foodRouter, expenseRouter } from "./routes/operations";
import { userRouter, uploadRouter, auditRouter } from "./routes/people";
import analyticsRoutes from "./routes/analytics";

export const app = express();
export const httpServer = createServer(app);

app.set("trust proxy", 1); // Render sits behind a proxy
app.disable("x-powered-by");
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(compression());
if (!isProd) app.use(morgan("dev"));
else app.use(morgan("tiny", { skip: (req) => req.path === "/health" }));

app.use(
  cors({
    origin: (origin, cb) => {
      // Mobile apps and server-to-server calls send no Origin header.
      if (!origin || allowedOrigins.includes(origin.replace(/\/$/, ""))) return cb(null, true);
      return cb(new Error(`CORS: origin ${origin} is not allowed`));
    },
    credentials: true,
  })
);
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));
app.use(sanitize);

app.get("/", (_req, res) => res.json({ service: "Corbett The Vedant API", status: "ok" }));
app.get("/health", (_req, res) =>
  res.json({ status: "ok", db: mongoose.connection.readyState === 1 ? "connected" : "connecting", uptime: Math.round(process.uptime()), time: new Date() })
);

app.use("/api", globalLimiter);
app.use("/api/auth", authRoutes);
app.use("/api/rooms", roomRoutes);
app.use("/api/bookings", bookingRoutes);
app.use("/api/messages", messageRoutes);
app.use("/api/settings", settingsRouter);
app.use("/api/menu", menuRouter);
app.use("/api/reviews", reviewRouter);
app.use("/api/promotions", promoRouter);
app.use("/api/housekeeping", housekeepingRouter);
app.use("/api/roomservice", roomServiceRouter);
app.use("/api/foodorders", foodRouter);
app.use("/api/expenses", expenseRouter);
app.use("/api/users", userRouter);
app.use("/api/uploads", uploadRouter);
app.use("/api/audit", auditRouter);
app.use("/api/analytics", analyticsRoutes);

app.use((_req, res) => res.status(404).json({ message: "Route not found" }));
app.use(errorHandler);


export default app;
