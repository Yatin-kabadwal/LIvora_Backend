import { Router } from "express";
import { z } from "zod";
import { MenuItem, Review, Promotion, Settings } from "../models/Misc";
import Booking from "../models/Booking";
import { authenticate, isManager, isStaff, isAdmin, AuthRequest } from "../middleware/auth";
import { ApiError, asyncHandler, objectId, validate } from "../utils/http";
import { getSettings, clearSettingsCache } from "../services/settings";
import { findValidPromo } from "../services/pricing";
import { audit } from "../services/audit";
import { primaryGuestUrl } from "../config/env";

/* =========================== SETTINGS =========================== */
export const settingsRouter = Router();

settingsRouter.get("/public", asyncHandler(async (_req, res) => {
  const s = await getSettings();
  res.json({ ...s.toObject(), gstNumber: undefined, assetBaseUrl: primaryGuestUrl });
}));

settingsRouter.get("/", authenticate, isStaff, asyncHandler(async (_req, res) => res.json(await getSettings())));

settingsRouter.put(
  "/",
  authenticate,
  isManager,
  validate(z.object({
    resortName: z.string().min(2),
tagline: z.string(),
phone: z.string(),
phoneSecondary: z.string(),
whatsapp: z.string(),
email: z.string().email(),
    address: z.string(), mapsUrl: z.string(), mapsEmbedUrl: z.string(),
    checkInTime: z.string(), checkOutTime: z.string(), cancellationHours: z.coerce.number().min(0),
    gstNumber: z.string(),
    mealPlans: z.array(z.object({ code: z.enum(["ep", "cp", "map", "ap"]), label: z.string(), adultPrice: z.coerce.number().min(0), childPrice: z.coerce.number().min(0), description: z.string() })),
    social: z.object({ instagram: z.string(), facebook: z.string(), youtube: z.string() }),
    bookingsOpen: z.boolean(), announcement: z.string(),
  }).partial()),
  asyncHandler(async (req: AuthRequest, res) => {
    await getSettings();
    const s = await Settings.findOneAndUpdate({ key: "main" }, req.body, { new: true });
    clearSettingsCache();
    audit(req, "settings.update", "settings", undefined, Object.keys(req.body));
    res.json(s);
  })
);

/* =========================== MENU =========================== */
export const menuRouter = Router();

menuRouter.get("/", asyncHandler(async (req, res) => {
  const all = req.query.all === "1";
  const items = await MenuItem.find(all ? {} : { isAvailable: true }).sort({ category: 1, sortOrder: 1, name: 1 });
  res.json(items);
}));

const menuBody = z.object({
  name: z.string().trim().min(2), description: z.string().optional(), category: z.string().trim().min(2),
  price: z.coerce.number().min(0), isVeg: z.boolean().default(true), imageUrl: z.string().optional(),
  isAvailable: z.boolean().default(true), isSignature: z.boolean().default(false), sortOrder: z.coerce.number().default(0),
});
menuRouter.post("/", authenticate, isManager, validate(menuBody), asyncHandler(async (req, res) => res.status(201).json(await MenuItem.create(req.body))));
menuRouter.put("/:id", authenticate, isManager, validate(menuBody.partial()), asyncHandler(async (req, res) => {
  const m = await MenuItem.findByIdAndUpdate(req.params.id, req.body, { new: true });
  if (!m) throw new ApiError(404, "Item not found");
  res.json(m);
}));
menuRouter.delete("/:id", authenticate, isManager, asyncHandler(async (req, res) => { await MenuItem.findByIdAndDelete(req.params.id); res.json({ message: "Deleted" }); }));

/* =========================== REVIEWS =========================== */
export const reviewRouter = Router();

reviewRouter.get("/", asyncHandler(async (_req, res) => {
  const list = await Review.find({ status: "approved" }).sort({ featured: -1, createdAt: -1 }).limit(30).select("-bookingId");
  res.json(list);
}));

reviewRouter.post(
  "/",
  validate(z.object({
    ref: z.string().min(5), email: z.string().email().toLowerCase(), rating: z.coerce.number().int().min(1).max(5),
    title: z.string().max(100).optional(), comment: z.string().trim().min(10).max(2000), location: z.string().max(80).optional(),
  })),
  asyncHandler(async (req, res) => {
    const b = await Booking.findOne({ bookingRef: req.body.ref.trim().toUpperCase(), guestEmail: req.body.email });
    if (!b) throw new ApiError(404, "We couldn't find that booking");
    if (b.status !== "checked_out") throw new ApiError(400, "You can review your stay once you've checked out");
    if (await Review.exists({ bookingId: b._id })) throw new ApiError(409, "You've already reviewed this stay. Thank you!");
    await Review.create({ bookingId: b._id, name: b.guestName, location: req.body.location, rating: req.body.rating, title: req.body.title, comment: req.body.comment });
    res.status(201).json({ message: "Thank you! Your review will appear after a quick check by our team." });
  })
);

reviewRouter.get("/admin", authenticate, isStaff, asyncHandler(async (_req, res) => res.json(await Review.find().sort({ createdAt: -1 }))));
reviewRouter.patch("/:id", authenticate, isManager, validate(z.object({ status: z.enum(["pending", "approved", "hidden"]).optional(), featured: z.boolean().optional() })),
  asyncHandler(async (req, res) => {
    const r = await Review.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!r) throw new ApiError(404, "Review not found");
    res.json(r);
  }));
reviewRouter.delete("/:id", authenticate, isAdmin, asyncHandler(async (req, res) => { await Review.findByIdAndDelete(req.params.id); res.json({ message: "Deleted" }); }));

/* =========================== PROMOTIONS =========================== */
export const promoRouter = Router();

promoRouter.get("/", asyncHandler(async (_req, res) => {
  const now = new Date();
  res.json(await Promotion.find({ isActive: true, showOnSite: true, validFrom: { $lte: now }, validTo: { $gte: now } })
    .select("-usedCount -maxUses -createdBy").sort({ createdAt: -1 }));
}));

promoRouter.post(
  "/validate",
  validate(z.object({ code: z.string().min(2), nights: z.coerce.number().min(1), amount: z.coerce.number().min(0), roomType: z.string().default("") })),
  asyncHandler(async (req, res) => {
    const r = await findValidPromo(req.body.code, { nights: req.body.nights, amount: req.body.amount, roomType: req.body.roomType });
    if (!r.promo) return res.json({ valid: false, message: r.message });
    res.json({ valid: true, message: r.message, code: r.promo.code, name: r.promo.name, discountAmount: r.discount });
  })
);

promoRouter.get("/admin", authenticate, isManager, asyncHandler(async (_req, res) => res.json(await Promotion.find().sort({ createdAt: -1 }))));

const promoBody = z.object({
  code: z.string().trim().min(3).max(20), name: z.string().min(2), description: z.string().optional(),
  discountType: z.enum(["percentage", "fixed"]), discountValue: z.coerce.number().min(0),
  minNights: z.coerce.number().min(1).default(1), minAmount: z.coerce.number().min(0).default(0),
  maxDiscountAmount: z.coerce.number().optional(), applicableRoomTypes: z.array(z.string()).default([]),
  maxUses: z.coerce.number().default(1000), validFrom: z.coerce.date(), validTo: z.coerce.date(),
  isActive: z.boolean().default(true), showOnSite: z.boolean().default(true),
});
promoRouter.post("/", authenticate, isManager, validate(promoBody), asyncHandler(async (req: AuthRequest, res) =>
  res.status(201).json(await Promotion.create({ ...req.body, createdBy: req.user!.id }))));
promoRouter.put("/:id", authenticate, isManager, validate(promoBody.partial()), asyncHandler(async (req, res) => {
  const p = await Promotion.findByIdAndUpdate(req.params.id, req.body, { new: true });
  if (!p) throw new ApiError(404, "Promotion not found");
  res.json(p);
}));
promoRouter.delete("/:id", authenticate, isManager, asyncHandler(async (req, res) => { await Promotion.findByIdAndDelete(req.params.id); res.json({ message: "Deleted" }); }));

void objectId;
