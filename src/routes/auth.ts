import { Router } from "express";
import jwt, { SignOptions } from "jsonwebtoken";
import { z } from "zod";
import User, { IUser } from "../models/User";
import { authenticate, AuthRequest } from "../middleware/auth";
import { authLimiter } from "../middleware/security";
import { ApiError, asyncHandler, validate } from "../utils/http";
import { env } from "../config/env";
import { randomToken, sha256 } from "../utils/id";
import { emailPasswordReset, emailWelcome } from "../services/email";
import { audit } from "../services/audit";

const router = Router();

const password = z.string().min(8, "Password must be at least 8 characters").max(100);
const email = z.string().email().toLowerCase().trim();

function signAccess(u: IUser) {
  return jwt.sign({ id: u._id, role: u.role, email: u.email }, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN } as SignOptions);
}
function signRefresh(u: IUser) {
  return jwt.sign({ id: u._id, jti: randomToken(8) }, env.JWT_REFRESH_SECRET, { expiresIn: env.JWT_REFRESH_EXPIRES_IN } as SignOptions);
}
const publicUser = (u: IUser) => ({
  id: u._id, firstName: u.firstName, lastName: u.lastName, email: u.email, phone: u.phone, role: u.role, department: u.department,
});

async function issueTokens(user: IUser) {
  const accessToken = signAccess(user);
  const refreshToken = signRefresh(user);
  const decoded = jwt.decode(refreshToken) as { exp: number };
  const fresh = await User.findById(user._id).select("+refreshTokens");
  const list = (fresh?.refreshTokens || []).filter((t) => t.expiresAt > new Date());
  list.push({ hash: sha256(refreshToken), expiresAt: new Date(decoded.exp * 1000) });
  await User.updateOne({ _id: user._id }, { refreshTokens: list.slice(-6), lastLogin: new Date() });
  return { accessToken, refreshToken };
}

router.post(
  "/login",
  authLimiter,
  validate(z.object({ email, password: z.string().min(1), area: z.enum(["guest", "admin"]).optional() })),
  asyncHandler(async (req, res) => {
    const user = await User.findOne({ email: req.body.email }).select("+password");
    if (!user || !user.isActive || !(await user.comparePassword(req.body.password))) {
      throw new ApiError(401, "Incorrect email or password");
    }
    if (req.body.area === "admin" && user.role === "guest") throw new ApiError(403, "This portal is for resort staff only");
    const tokens = await issueTokens(user);
    res.json({ ...tokens, user: publicUser(user) });
  })
);

router.post(
  "/register",
  authLimiter,
  validate(
    z.object({
      firstName: z.string().trim().min(1).max(60),
      lastName: z.string().trim().max(60).default(""),
      email,
      phone: z.string().trim().min(7).max(20),
      password,
    })
  ),
  asyncHandler(async (req, res) => {
    if (await User.exists({ email: req.body.email })) throw new ApiError(409, "An account with this email already exists");
    const user = await User.create({ ...req.body, role: "guest" });
    const tokens = await issueTokens(user);
    emailWelcome(user.email, user.firstName).catch(() => undefined);
    res.status(201).json({ ...tokens, user: publicUser(user) });
  })
);

router.post(
  "/refresh",
  validate(z.object({ refreshToken: z.string().min(10) })),
  asyncHandler(async (req, res) => {
    let decoded: { id: string };
    try {
      decoded = jwt.verify(req.body.refreshToken, env.JWT_REFRESH_SECRET) as { id: string };
    } catch {
      throw new ApiError(401, "Session expired. Please sign in again.");
    }
    const user = await User.findById(decoded.id).select("+refreshTokens");
    const hash = sha256(req.body.refreshToken);
    const found = user?.refreshTokens.find((t) => t.hash === hash && t.expiresAt > new Date());
    if (!user || !user.isActive || !found) throw new ApiError(401, "Session expired. Please sign in again.");
    // rotate
    user.refreshTokens = user.refreshTokens.filter((t) => t.hash !== hash);
    await user.save({ validateBeforeSave: false });
    const tokens = await issueTokens(user);
    res.json({ ...tokens, user: publicUser(user) });
  })
);

router.post(
  "/logout",
  validate(z.object({ refreshToken: z.string().optional() })),
  asyncHandler(async (req, res) => {
    if (req.body.refreshToken) {
      try {
        const d = jwt.verify(req.body.refreshToken, env.JWT_REFRESH_SECRET) as { id: string };
        await User.updateOne({ _id: d.id }, { $pull: { refreshTokens: { hash: sha256(req.body.refreshToken) } } });
      } catch { /* already invalid */ }
    }
    res.json({ message: "Signed out" });
  })
);

router.get("/me", authenticate, asyncHandler(async (req: AuthRequest, res) => {
  const user = await User.findById(req.user!.id);
  if (!user) throw new ApiError(404, "User not found");
  res.json(user);
}));

router.put(
  "/profile",
  authenticate,
  validate(z.object({ firstName: z.string().trim().min(1).max(60).optional(), lastName: z.string().trim().max(60).optional(), phone: z.string().trim().max(20).optional() })),
  asyncHandler(async (req: AuthRequest, res) => {
    const user = await User.findByIdAndUpdate(req.user!.id, req.body, { new: true });
    res.json(user);
  })
);

router.put(
  "/change-password",
  authenticate,
  authLimiter,
  validate(z.object({ currentPassword: z.string().min(1), newPassword: password })),
  asyncHandler(async (req: AuthRequest, res) => {
    const user = await User.findById(req.user!.id).select("+password");
    if (!user || !(await user.comparePassword(req.body.currentPassword))) throw new ApiError(400, "Current password is incorrect");
    user.password = req.body.newPassword;
    user.refreshTokens = [];
    await user.save();
    audit(req, "password.change", "user", user.id);
    res.json({ message: "Password updated. Please sign in again on other devices." });
  })
);

router.post(
  "/forgot-password",
  authLimiter,
  validate(z.object({ email, area: z.enum(["guest", "admin"]).default("guest") })),
  asyncHandler(async (req, res) => {
    const user = await User.findOne({ email: req.body.email, isActive: true });
    if (user) {
      const token = randomToken(24);
      user.resetTokenHash = sha256(token);
      user.resetTokenExpires = new Date(Date.now() + 30 * 60_000);
      await user.save({ validateBeforeSave: false });
      emailPasswordReset(user.email, user.firstName, token, req.body.area).catch(() => undefined);
    }
    // Always the same answer so emails can't be enumerated.
    res.json({ message: "If that email is registered, a reset link is on its way." });
  })
);

router.post(
  "/reset-password",
  authLimiter,
  validate(z.object({ token: z.string().min(10), password })),
  asyncHandler(async (req, res) => {
    const user = await User.findOne({ resetTokenHash: sha256(req.body.token), resetTokenExpires: { $gt: new Date() } }).select(
      "+resetTokenHash +resetTokenExpires +refreshTokens"
    );
    if (!user) throw new ApiError(400, "This reset link is invalid or has expired");
    user.password = req.body.password;
    user.resetTokenHash = undefined;
    user.resetTokenExpires = undefined;
    user.refreshTokens = [];
    await user.save();
    res.json({ message: "Password updated. You can sign in now." });
  })
);

export default router;
