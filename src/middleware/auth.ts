import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import User, { Role } from "../models/User";
import { env } from "../config/env";
import { ApiError } from "../utils/http";

export interface AuthRequest extends Request {
  user?: { id: string; role: Role; email: string; name: string };
}

async function resolveUser(req: AuthRequest) {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
  if (!token) return null;
  const decoded = jwt.verify(token, env.JWT_SECRET) as { id: string };
  const user = await User.findById(decoded.id).select("_id role email isActive firstName lastName");
  if (!user || !user.isActive) throw new ApiError(401, "Session expired. Please sign in again.");
  return { id: user._id.toString(), role: user.role, email: user.email, name: `${user.firstName} ${user.lastName}`.trim() };
}

export const authenticate = async (req: AuthRequest, _res: Response, next: NextFunction) => {
  try {
    const u = await resolveUser(req);
    if (!u) return next(new ApiError(401, "Authentication required"));
    req.user = u;
    next();
  } catch (e) {
    next(e instanceof ApiError ? e : new ApiError(401, "Invalid or expired token"));
  }
};

/** Attaches req.user when a valid token is present but never blocks the request. */
export const optionalAuth = async (req: AuthRequest, _res: Response, next: NextFunction) => {
  try {
    const u = await resolveUser(req);
    if (u) req.user = u;
  } catch {
    /* ignore invalid token for public endpoints */
  }
  next();
};

const need = (roles: Role[], label: string) => (req: AuthRequest, _res: Response, next: NextFunction) =>
  roles.includes(req.user?.role as Role) ? next() : next(new ApiError(403, `${label} access required`));

export const isStaff = need(["staff", "manager", "admin"], "Staff");
export const isManager = need(["manager", "admin"], "Manager");
export const isAdmin = need(["admin"], "Admin");
