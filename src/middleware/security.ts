import rateLimit from "express-rate-limit";
import { NextFunction, Request, Response } from "express";
import { ApiError } from "../utils/http";
import { isProd } from "../config/env";

const limiter = (windowMs: number, max: number, message: string) =>
  rateLimit({
    windowMs,
    max: isProd ? max : max * 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message },
  });

export const globalLimiter = limiter(60_000, 300, "Too many requests. Please slow down.");
export const authLimiter = limiter(15 * 60_000, 25, "Too many attempts. Try again in a few minutes.");
export const publicFormLimiter = limiter(60 * 60_000, 12, "You've sent a lot of messages. Please try again later.");
export const bookingLimiter = limiter(60 * 60_000, 20, "Too many booking attempts. Please try again later.");

/** Strips keys beginning with "$" or containing "." from request payloads (NoSQL-injection guard). */
function clean(obj: any): any {
  if (Array.isArray(obj)) return obj.map(clean);
  if (obj && typeof obj === "object") {
    const out: any = {};
    for (const [k, v] of Object.entries(obj)) {
      if (k.startsWith("$") || k.includes(".")) continue;
      out[k] = clean(v);
    }
    return out;
  }
  return obj;
}
export const sanitize = (req: Request, _res: Response, next: NextFunction) => {
  if (req.body) req.body = clean(req.body);
  if (req.query) {
    const q = clean(req.query);
    Object.keys(req.query).forEach((k) => delete (req.query as any)[k]);
    Object.assign(req.query, q);
  }
  next();
};

export function errorHandler(err: any, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ApiError) {
    return res.status(err.status).json({ message: err.message, ...(err.details && !isProd ? { details: err.details } : {}) });
  }
  if (err?.name === "ValidationError") {
    const first = Object.values(err.errors || {})[0] as any;
    return res.status(400).json({ message: first?.message || "Validation failed" });
  }
  if (err?.name === "CastError") return res.status(400).json({ message: "Invalid identifier" });
  if (err?.code === 11000) return res.status(409).json({ message: "Duplicate value: that record already exists" });
  if (err?.type === "entity.too.large") return res.status(413).json({ message: "Request too large" });
  if (err?.message?.startsWith?.("CORS")) return res.status(403).json({ message: err.message });
  console.error("[error]", err);
  res.status(500).json({ message: isProd ? "Something went wrong on our side" : err?.message || "Server error" });
}
