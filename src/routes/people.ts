import { Router } from "express";
import { z } from "zod";
import User from "../models/User";
import Booking from "../models/Booking";
import { AuditLog } from "../models/Misc";
import { authenticate, isAdmin, isManager, AuthRequest } from "../middleware/auth";
import { ApiError, asyncHandler, escapeRegex, paginate, validate, objectId } from "../utils/http";
import { audit } from "../services/audit";
import { cloudinaryEnabled, uploadBuffer } from "../services/cloudinary";
import multer from "multer";

/* =========================== USERS (staff management) =========================== */
export const userRouter = Router();
userRouter.use(authenticate);

userRouter.get("/", isManager, asyncHandler(async (req, res) => {
  const { role, search } = req.query as Record<string, string>;
  const { page, limit, skip } = paginate(req.query);
  const q: any = { role: { $in: ["staff", "manager", "admin"] } };
  if (role) q.role = role;
  if (search) { const rx = new RegExp(escapeRegex(search), "i"); q.$or = [{ firstName: rx }, { lastName: rx }, { email: rx }, { employeeId: rx }]; }
  const [users, total] = await Promise.all([User.find(q).sort({ createdAt: -1 }).skip(skip).limit(limit), User.countDocuments(q)]);
  res.json({ users, total, page, pages: Math.ceil(total / limit) });
}));

/** Guest directory built from bookings (covers walk-ins who never made an account). */
userRouter.get("/guests", isManager, asyncHandler(async (req, res) => {
  const { search } = req.query as Record<string, string>;
  const match: any = { isBlock: false };
  if (search) { const rx = new RegExp(escapeRegex(search), "i"); match.$or = [{ guestName: rx }, { guestEmail: rx }, { guestPhone: rx }]; }
  const guests = await Booking.aggregate([
    { $match: match },
    { $sort: { createdAt: -1 } },
    { $group: {
        _id: "$guestEmail", name: { $first: "$guestName" }, phone: { $first: "$guestPhone" },
        stays: { $sum: { $cond: [{ $eq: ["$status", "checked_out"] }, 1, 0] } },
        bookings: { $sum: 1 }, spent: { $sum: "$paidAmount" }, lastStay: { $max: "$checkIn" },
    } },
    { $sort: { lastStay: -1 } },
    { $limit: 300 },
  ]);
  res.json(guests.map((g) => ({ email: g._id, ...g, _id: undefined })));
}));

const staffBody = z.object({
  firstName: z.string().trim().min(1).max(60), lastName: z.string().trim().max(60).default(""),
  email: z.string().email().toLowerCase(), phone: z.string().trim().max(20).default(""),
  password: z.string().min(8).max(100), role: z.enum(["staff", "manager", "admin"]),
  department: z.string().max(60).optional(), employeeId: z.string().max(30).optional(),
});

userRouter.post("/", isAdmin, validate(staffBody), asyncHandler(async (req: AuthRequest, res) => {
  if (await User.exists({ email: req.body.email })) throw new ApiError(409, "That email is already in use");
  const u = await User.create(req.body);
  audit(req, "user.create", "user", u.id, { role: u.role });
  res.status(201).json(u);
}));

userRouter.patch("/:id", isAdmin,
  validate(staffBody.omit({ password: true }).partial().extend({ isActive: z.boolean().optional() })),
  asyncHandler(async (req: AuthRequest, res) => {
    if (req.params.id === req.user!.id && (req.body.isActive === false || (req.body.role && req.body.role !== "admin"))) {
      throw new ApiError(400, "You can't deactivate or demote your own account");
    }
    const u = await User.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!u) throw new ApiError(404, "User not found");
    audit(req, "user.update", "user", u.id, req.body);
    res.json(u);
  }));

userRouter.post("/:id/reset-password", isAdmin, validate(z.object({ password: z.string().min(8).max(100) })), asyncHandler(async (req: AuthRequest, res) => {
  const u = await User.findById(req.params.id).select("+password +refreshTokens");
  if (!u) throw new ApiError(404, "User not found");
  u.password = req.body.password;
  u.refreshTokens = [];
  await u.save();
  audit(req, "user.reset-password", "user", u.id);
  res.json({ message: "Password reset" });
}));

/* =========================== UPLOADS =========================== */
export const uploadRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 }, fileFilter: (_r, f, cb) => cb(null, /^image\/(jpe?g|png|webp|avif)$/.test(f.mimetype)) });

uploadRouter.post("/image", authenticate, isManager, upload.single("file"), asyncHandler(async (req: AuthRequest, res) => {
  if (!cloudinaryEnabled) throw new ApiError(503, "Image uploads are not configured on the server");
  if (!req.file) throw new ApiError(400, "Attach an image (JPG, PNG, WebP up to 8MB)");
  const folder = String(req.body.folder || "misc").replace(/[^a-z0-9-_]/gi, "");
  const r = await uploadBuffer(req.file.buffer, folder);
  res.status(201).json(r);
}));

/* =========================== AUDIT =========================== */
export const auditRouter = Router();
auditRouter.get("/", authenticate, isAdmin, asyncHandler(async (req, res) => {
  const { page, limit, skip } = paginate(req.query, 50);
  const [logs, total] = await Promise.all([AuditLog.find().sort({ createdAt: -1 }).skip(skip).limit(limit), AuditLog.countDocuments()]);
  res.json({ logs, total, page, pages: Math.ceil(total / limit) });
}));

void objectId;
