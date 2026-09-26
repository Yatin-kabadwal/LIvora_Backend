import { NextFunction, Request, RequestHandler, Response } from "express";
import { ZodTypeAny, z } from "zod";

export class ApiError extends Error {
  status: number;
  details?: unknown;
  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const asyncHandler =
  (fn: (req: any, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };

/** Validate req.body / req.query against a zod schema and replace with the parsed (typed, stripped) value. */
export const validate =
  (schema: ZodTypeAny, source: "body" | "query" = "body"): RequestHandler =>
  (req: Request, _res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      const first = result.error.issues[0];
      const msg = first ? `${first.path.join(".") || "input"}: ${first.message}` : "Invalid input";
      return next(new ApiError(400, msg, result.error.flatten()));
    }
    (req as any)[source] = result.data;
    next();
  };

export const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid id");

export const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const paginate = (q: any, defLimit = 20, maxLimit = 100) => {
  const page = Math.max(1, parseInt(q.page as string) || 1);
  const limit = Math.min(maxLimit, Math.max(1, parseInt(q.limit as string) || defLimit));
  return { page, limit, skip: (page - 1) * limit };
};
