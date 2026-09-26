import { Router } from "express";
import { z } from "zod";
import Booking, { IBooking } from "../models/Booking";
import Room from "../models/Room";
import User from "../models/User";
import { Housekeeping } from "../models/Misc";
import { authenticate, optionalAuth, isStaff, isManager, AuthRequest } from "../middleware/auth";
import { bookingLimiter } from "../middleware/security";
import { ApiError, asyncHandler, escapeRegex, objectId, paginate, validate } from "../utils/http";
import { createBooking, releaseInventory } from "../services/booking";
import { buildQuote } from "../services/pricing";
import { getSettings } from "../services/settings";
import { buildInvoice } from "../services/pdf";
import { emailBookingCancelled, emailBookingConfirmation, emailStaffNewBooking } from "../services/email";
import { emit } from "../socket";
import { audit } from "../services/audit";
import { addDays, parseDay, todayIST } from "../utils/dates";

const router = Router();

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const mealPlan = z.enum(["ep", "cp", "map", "ap"]).default("ep");

/* ---------- helpers ---------- */
const canSee = (b: IBooking, user?: AuthRequest["user"]) =>
  !!user && (["staff", "manager", "admin"].includes(user.role) || (b.guestId && String(b.guestId) === user.id));

const HK_CHECKLIST = ["Strip and change linen", "Clean bathroom & restock toiletries", "Dust and vacuum", "Restock minibar & water", "Check AC, lights & TV", "Final inspection"];

async function afterCancel(b: IBooking) {
  await releaseInventory(b._id);
  emit.bookingUpdate(b.toObject());
  emailBookingCancelled(b).catch(() => undefined);
}

/* ---------- public: quote ---------- */
router.get(
  "/quote",
  validate(
    z.object({
      roomId: objectId, checkIn: day, checkOut: day,
      adults: z.coerce.number().int().min(1).default(2),
      children: z.coerce.number().int().min(0).default(0),
      mealPlan, promoCode: z.string().optional(),
    }),
    "query"
  ),
  asyncHandler(async (req, res) => {
    const q = req.query as any;
    const room = await Room.findById(q.roomId);
    if (!room) throw new ApiError(404, "Room not found");
    const quote = await buildQuote(room, parseDay(q.checkIn), parseDay(q.checkOut), q.adults, q.children, q.mealPlan, q.promoCode);
    res.json(quote);
  })
);

/* ---------- public: create booking (guest checkout or logged in; staff walk-in) ---------- */
router.post(
  "/",
  bookingLimiter,
  optionalAuth,
  validate(
    z.object({
      roomId: objectId, checkIn: day, checkOut: day,
      adults: z.coerce.number().int().min(1).max(12).default(2),
      children: z.coerce.number().int().min(0).max(12).default(0),
      mealPlan,
      promoCode: z.string().max(30).optional(),
      specialRequests: z.string().max(1000).optional(),
      guest: z.object({
        name: z.string().trim().min(2).max(120),
        email: z.string().email().toLowerCase(),
        phone: z.string().trim().min(7).max(20),
      }).optional(),
      source: z.enum(["website", "app", "walk_in", "phone", "ota"]).optional(),
    })
  ),
  asyncHandler(async (req: AuthRequest, res) => {
    const b = req.body;
    const user = req.user;
    const isStaffUser = !!user && ["staff", "manager", "admin"].includes(user.role);
    const room = await Room.findById(b.roomId);
    if (!room) throw new ApiError(404, "Room not found");

    let guest = b.guest as { name: string; email: string; phone: string } | undefined;
    let userId: string | undefined;
    if (!isStaffUser && user) {
      const u = await User.findById(user.id);
      userId = user.id;
      guest = guest || (u ? { name: `${u.firstName} ${u.lastName}`.trim(), email: u.email, phone: u.phone } : undefined);
    }
    if (!guest) throw new ApiError(400, "Guest name, email and phone are required");
    if (!isStaffUser && !userId) {
      const existing = await User.findOne({ email: guest.email }).select("_id role");
      if (existing && existing.role === "guest") userId = existing.id; // link to account silently
    }

    const booking = await createBooking({
      room,
      checkIn: parseDay(b.checkIn),
      checkOut: parseDay(b.checkOut),
      adults: b.adults, children: b.children, mealPlan: b.mealPlan,
      promoCode: b.promoCode, specialRequests: b.specialRequests,
      guest: { ...guest, userId },
      source: isStaffUser ? b.source || "walk_in" : b.source === "app" ? "app" : "website",
      createdBy: isStaffUser ? user!.id : undefined,
      allowPast: isStaffUser,
    });

    emit.bookingNew(booking.toObject());
    emailBookingConfirmation(booking).catch(() => undefined);
    emailStaffNewBooking(booking).catch(() => undefined);
    if (isStaffUser) audit(req, "booking.create", "booking", booking.id);
    res.status(201).json(booking);
  })
);

/* ---------- public lookup (booking ref + email) ---------- */
router.get(
  "/lookup",
  bookingLimiter,
  validate(z.object({ ref: z.string().min(5), email: z.string().email().toLowerCase() }), "query"),
  asyncHandler(async (req, res) => {
    const { ref, email } = req.query as any;
    const b = await Booking.findOne({ bookingRef: ref.trim().toUpperCase(), guestEmail: email });
    if (!b) throw new ApiError(404, "We couldn't find a booking with those details");
    const s = await getSettings();
    res.json({ booking: b, cancellationHours: s.cancellationHours });
  })
);

router.post(
  "/lookup/cancel",
  bookingLimiter,
  validate(z.object({ ref: z.string(), email: z.string().email().toLowerCase(), reason: z.string().max(300).optional() })),
  asyncHandler(async (req, res) => {
    const b = await Booking.findOne({ bookingRef: req.body.ref.trim().toUpperCase(), guestEmail: req.body.email });
    if (!b) throw new ApiError(404, "Booking not found");
    await guestCancel(b, req.body.reason);
    res.json(b);
  })
);

async function guestCancel(b: IBooking, reason?: string) {
  if (b.status !== "confirmed") throw new ApiError(400, "Only upcoming confirmed bookings can be cancelled online");
  const s = await getSettings();
  const cutoff = addDays(b.checkIn, 0).getTime() + 14 * 3600_000 - 5.5 * 3600_000 - s.cancellationHours * 3600_000;
  if (Date.now() > cutoff) {
    throw new ApiError(400, `Free cancellation closes ${s.cancellationHours} hours before check-in. Please call us and we'll help.`);
  }
  b.status = "cancelled";
  b.cancelledAt = new Date();
  b.cancelReason = reason || "Cancelled by guest";
  await b.save();
  await afterCancel(b);
}

/* ---------- guest: my bookings ---------- */
router.get(
  "/mine",
  authenticate,
  asyncHandler(async (req: AuthRequest, res) => {
    const list = await Booking.find({ $or: [{ guestId: req.user!.id }, { guestEmail: req.user!.email }], isBlock: false })
      .sort({ checkIn: -1 })
      .populate("roomId", "imageUrls slug name");
    res.json(list);
  })
);

/* ---------- staff: list ---------- */
router.get(
  "/",
  authenticate,
  isStaff,
  asyncHandler(async (req: AuthRequest, res) => {
    const { status, paymentStatus, search, from, to, view, roomId, source } = req.query as Record<string, string>;
    const { page, limit, skip } = paginate(req.query);
    const q: any = {};
    if (status) q.status = { $in: status.split(",") };
    if (paymentStatus) q.paymentStatus = paymentStatus;
    if (roomId) q.roomId = roomId;
    if (source) q.source = source;
    if (search) {
      const rx = new RegExp(escapeRegex(search), "i");
      q.$or = [{ guestName: rx }, { guestEmail: rx }, { guestPhone: rx }, { bookingRef: rx }, { roomNumber: rx }];
    }
    const today = todayIST();
    if (view === "arrivals") { q.checkIn = today; q.status = "confirmed"; }
    if (view === "departures") { q.checkOut = today; q.status = "checked_in"; }
    if (view === "inhouse") q.status = "checked_in";
    if (view === "upcoming") { q.checkIn = { $gt: today }; q.status = "confirmed"; }
    if (from || to) {
      q.checkIn = { ...(q.checkIn && typeof q.checkIn === "object" ? q.checkIn : {}) };
      if (from) q.checkIn.$gte = parseDay(from);
      if (to) q.checkIn.$lte = parseDay(to);
    }
    const [bookings, total] = await Promise.all([
      Booking.find(q).sort(view === "arrivals" || view === "upcoming" ? { checkIn: 1 } : { createdAt: -1 }).skip(skip).limit(limit),
      Booking.countDocuments(q),
    ]);
    res.json({ bookings, total, page, pages: Math.ceil(total / limit) });
  })
);

/* ---------- staff: block dates ---------- */
router.post(
  "/block",
  authenticate,
  isManager,
  validate(z.object({ roomId: objectId, from: day, to: day, reason: z.string().max(200).default("Blocked") })),
  asyncHandler(async (req: AuthRequest, res) => {
    const room = await Room.findById(req.body.roomId);
    if (!room) throw new ApiError(404, "Room not found");
    const booking = await createBooking({
      room, checkIn: parseDay(req.body.from), checkOut: parseDay(req.body.to),
      adults: 1, children: 0, mealPlan: "ep",
      guest: { name: `BLOCKED: ${req.body.reason}`, email: "block@internal.local", phone: "-" },
      source: "block", createdBy: req.user!.id, allowPast: true,
    });
    booking.isBlock = true;
    booking.roomAmount = 0; booking.mealAmount = 0; booking.discountAmount = 0; booking.pricePerNight = 0;
    booking.recalc();
    await booking.save();
    audit(req, "room.block", "booking", booking.id, req.body);
    res.status(201).json(booking);
  })
);

/* ---------- single booking ---------- */
router.get(
  "/:id",
  authenticate,
  asyncHandler(async (req: AuthRequest, res) => {
    const b = await Booking.findById(req.params.id).populate("roomId", "imageUrls slug name").populate("guestId", "firstName lastName email phone");
    if (!b) throw new ApiError(404, "Booking not found");
    if (!canSee(b, req.user) && b.guestEmail !== req.user!.email) throw new ApiError(403, "You don't have access to this booking");
    res.json(b);
  })
);

router.get(
  "/:id/invoice",
  authenticate,
  asyncHandler(async (req: AuthRequest, res) => {
    const b = await Booking.findById(req.params.id);
    if (!b) throw new ApiError(404, "Booking not found");
    if (!canSee(b, req.user) && b.guestEmail !== req.user!.email) throw new ApiError(403, "Forbidden");
    const doc = await buildInvoice(b);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="invoice-${b.bookingRef}.pdf"`);
    doc.pipe(res);
    doc.end();
  })
);

/* ---------- cancel (guest owner or staff) ---------- */
router.post(
  "/:id/cancel",
  authenticate,
  validate(z.object({ reason: z.string().max(300).optional() })),
  asyncHandler(async (req: AuthRequest, res) => {
    const b = await Booking.findById(req.params.id);
    if (!b) throw new ApiError(404, "Booking not found");
    const staff = ["staff", "manager", "admin"].includes(req.user!.role);
    if (!staff) {
      if (!canSee(b, req.user) && b.guestEmail !== req.user!.email) throw new ApiError(403, "Forbidden");
      await guestCancel(b, req.body.reason);
    } else {
      if (["checked_out", "cancelled"].includes(b.status)) throw new ApiError(400, `Booking is already ${b.status.replace("_", " ")}`);
      b.status = "cancelled";
      b.cancelledAt = new Date();
      b.cancelReason = req.body.reason || "Cancelled by staff";
      await b.save();
      await afterCancel(b);
      audit(req, "booking.cancel", "booking", b.id);
    }
    res.json(b);
  })
);

/* ---------- staff: status transitions ---------- */
const ALLOWED: Record<string, string[]> = {
  confirmed: ["checked_in", "cancelled", "no_show"],
  checked_in: ["checked_out"],
  checked_out: [],
  cancelled: [],
  no_show: [],
};

router.patch(
  "/:id/status",
  authenticate,
  isStaff,
  validate(z.object({ status: z.enum(["confirmed", "checked_in", "checked_out", "cancelled", "no_show"]), staffNotes: z.string().max(2000).optional() })),
  asyncHandler(async (req: AuthRequest, res) => {
    const b = await Booking.findById(req.params.id);
    if (!b) throw new ApiError(404, "Booking not found");
    const next = req.body.status as IBooking["status"];
    if (!ALLOWED[b.status]?.includes(next)) throw new ApiError(400, `Cannot move a ${b.status.replace("_", " ")} booking to ${next.replace("_", " ")}`);
    if (b.isBlock && next !== "cancelled") throw new ApiError(400, "Blocks can only be released");
    if (req.body.staffNotes) b.staffNotes = req.body.staffNotes;

    if (next === "checked_in") {
      if (b.checkIn > todayIST()) throw new ApiError(400, "This guest isn't due to arrive today yet");
      b.actualCheckIn = new Date();
      await Room.findByIdAndUpdate(b.roomId, { status: "occupied" });
    }
    if (next === "checked_out") {
      b.actualCheckOut = new Date();
      await Room.findByIdAndUpdate(b.roomId, { status: "housekeeping" });
      await releaseInventory(b._id, todayIST() > b.checkIn ? todayIST() : undefined).catch(() => undefined);
      // Early departure frees the remaining nights; a normal checkout keeps history intact.
      await Housekeeping.create({
        roomId: b.roomId, roomNumber: b.roomNumber, taskType: "checkout_clean", priority: "high", scheduledFor: new Date(),
        checklistItems: HK_CHECKLIST.map((item) => ({ item, checked: false })), createdBy: req.user!.id,
      });
    }
    if (next === "cancelled" || next === "no_show") {
      b.cancelledAt = new Date();
      b.cancelReason = next === "no_show" ? "No show" : "Cancelled by staff";
      await releaseInventory(b._id);
    }
    b.status = next;
    await b.save();
    emit.bookingUpdate(b.toObject());
    audit(req, `booking.${next}`, "booking", b.id);
    res.json(b);
  })
);

/* ---------- staff: notes / payments / extras ---------- */
router.patch(
  "/:id",
  authenticate,
  isStaff,
  validate(z.object({ staffNotes: z.string().max(2000).optional(), specialRequests: z.string().max(1000).optional(), guestPhone: z.string().max(20).optional() })),
  asyncHandler(async (req: AuthRequest, res) => {
    const b = await Booking.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!b) throw new ApiError(404, "Booking not found");
    res.json(b);
  })
);

router.post(
  "/:id/payments",
  authenticate,
  isStaff,
  validate(z.object({
    amount: z.coerce.number().refine((n) => n !== 0, "Amount cannot be zero"),
    method: z.enum(["cash", "upi", "card", "bank_transfer"]),
    reference: z.string().max(80).optional(),
    note: z.string().max(200).optional(),
  })),
  asyncHandler(async (req: AuthRequest, res) => {
    const b = await Booking.findById(req.params.id);
    if (!b) throw new ApiError(404, "Booking not found");
    if (b.status === "cancelled" && req.body.amount > 0) throw new ApiError(400, "Cannot take payment on a cancelled booking");
    if (req.body.amount < 0 && !["manager", "admin"].includes(req.user!.role)) throw new ApiError(403, "Only a manager can record a refund");
    if (req.body.amount < 0 && b.paidAmount + req.body.amount < 0) throw new ApiError(400, "Refund exceeds amount paid");
    if (req.body.amount > 0 && req.body.amount > b.balanceDue + 0.5) throw new ApiError(400, `Amount exceeds balance due (₹${b.balanceDue})`);
    b.payments.push({ ...req.body, receivedBy: req.user!.id as any, at: new Date() });
    b.recalc();
    await b.save();
    emit.bookingUpdate(b.toObject());
    audit(req, req.body.amount > 0 ? "payment.record" : "payment.refund", "booking", b.id, req.body);
    res.json(b);
  })
);

router.post(
  "/:id/extras",
  authenticate,
  isStaff,
  validate(z.object({ description: z.string().trim().min(2).max(120), amount: z.coerce.number().min(1) })),
  asyncHandler(async (req: AuthRequest, res) => {
    const b = await Booking.findById(req.params.id);
    if (!b) throw new ApiError(404, "Booking not found");
    if (["cancelled", "no_show"].includes(b.status)) throw new ApiError(400, "Cannot add charges to this booking");
    b.extras.push({ ...req.body, addedAt: new Date(), source: "staff" });
    b.recalc();
    await b.save();
    emit.bookingUpdate(b.toObject());
    res.json(b);
  })
);

router.delete(
  "/:id/extras/:extraId",
  authenticate,
  isManager,
  asyncHandler(async (req: AuthRequest, res) => {
    const b = await Booking.findById(req.params.id);
    if (!b) throw new ApiError(404, "Booking not found");
    b.extras = b.extras.filter((e) => String(e._id) !== req.params.extraId) as any;
    b.recalc();
    await b.save();
    audit(req, "extra.remove", "booking", b.id);
    res.json(b);
  })
);

export default router;
