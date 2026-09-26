import { Router } from "express";
import { z } from "zod";
import Room from "../models/Room";
import Booking from "../models/Booking";
import { authenticate, isManager, isStaff, AuthRequest } from "../middleware/auth";
import { ApiError, asyncHandler, validate } from "../utils/http";
import { availableRoomIds } from "../services/booking";
import { parseDay, todayIST } from "../utils/dates";
import { audit } from "../services/audit";

const router = Router();

const roomBody = z.object({
  roomNumber: z.string().trim().min(1),
  name: z.string().trim().min(2),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9-]+$/).optional(),
  type: z.string().trim().toLowerCase().min(2),
  floor: z.coerce.number().int().default(0),
  status: z.enum(["available", "occupied", "housekeeping", "maintenance"]).optional(),
  pricePerNight: z.coerce.number().min(0),
  maxAdults: z.coerce.number().int().min(1).default(2),
  maxChildren: z.coerce.number().int().min(0).default(1),
  bedType: z.string().default("King"),
  view: z.string().default("Forest"),
  size: z.coerce.number().optional(),
  amenities: z.array(z.string()).default([]),
  highlights: z.array(z.string()).default([]),
  imageUrls: z.array(z.string()).default([]),
  description: z.string().optional(),
  isActive: z.boolean().default(true),
  sortOrder: z.coerce.number().default(0),
});

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

/** Public listing. Pass checkIn & checkOut to get an `available` flag per room. */
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { type, checkIn, checkOut, adults, children, all } = req.query as Record<string, string>;
    const filter: any = all === "1" ? {} : { isActive: true };
    if (type) filter.type = type.toLowerCase();
    if (adults) filter.maxAdults = { $gte: parseInt(adults) || 1 };
    if (children) filter.maxChildren = { $gte: parseInt(children) || 0 };
    const rooms = await Room.find(filter).sort({ sortOrder: 1, pricePerNight: 1 }).lean();

    if (checkIn && checkOut) {
      let cin: Date, cout: Date;
      try { cin = parseDay(checkIn); cout = parseDay(checkOut); } catch { throw new ApiError(400, "Invalid dates"); }
      if (cout <= cin) throw new ApiError(400, "Check-out must be after check-in");
      const free = await availableRoomIds(cin, cout);
      return res.json(rooms.map((r) => ({ ...r, available: free.has(String(r._id)) })));
    }
    res.json(rooms.map((r) => ({ ...r, available: r.isActive })));
  })
);

/** Staff: live status board for today (who is in each room, arrivals, departures). */
router.get(
  "/board",
  authenticate,
  isStaff,
  asyncHandler(async (_req, res) => {
    const today = todayIST();
    const rooms = await Room.find().sort({ sortOrder: 1, roomNumber: 1 }).lean();
    const active = await Booking.find({
      status: { $in: ["confirmed", "checked_in"] },
      checkIn: { $lte: today },
      checkOut: { $gt: today },
    }).select("bookingRef roomId guestName status checkIn checkOut");
    const arrivals = await Booking.find({ status: "confirmed", checkIn: today }).select("roomId bookingRef guestName");
    const departures = await Booking.find({ status: "checked_in", checkOut: today }).select("roomId bookingRef guestName");
    const byRoom = new Map(active.map((b) => [String(b.roomId), b]));
    const arr = new Map(arrivals.map((b) => [String(b.roomId), b]));
    const dep = new Map(departures.map((b) => [String(b.roomId), b]));
    res.json(
      rooms.map((r) => ({
        ...r,
        current: byRoom.get(String(r._id)) || null,
        arrivingToday: arr.get(String(r._id)) || null,
        departingToday: dep.get(String(r._id)) || null,
      }))
    );
  })
);

router.get(
  "/:idOrSlug",
  asyncHandler(async (req, res) => {
    const { idOrSlug } = req.params;
    const room = /^[a-f\d]{24}$/i.test(idOrSlug) ? await Room.findById(idOrSlug) : await Room.findOne({ slug: idOrSlug.toLowerCase() });
    if (!room) throw new ApiError(404, "Room not found");
    res.json(room);
  })
);

router.post(
  "/",
  authenticate,
  isManager,
  validate(roomBody),
  asyncHandler(async (req: AuthRequest, res) => {
    const room = await Room.create({ ...req.body, slug: req.body.slug || slugify(req.body.name) });
    audit(req, "room.create", "room", room.id);
    res.status(201).json(room);
  })
);

router.put(
  "/:id",
  authenticate,
  isManager,
  validate(roomBody.partial()),
  asyncHandler(async (req: AuthRequest, res) => {
    const room = await Room.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!room) throw new ApiError(404, "Room not found");
    audit(req, "room.update", "room", room.id, Object.keys(req.body));
    res.json(room);
  })
);

router.patch(
  "/:id/status",
  authenticate,
  isStaff,
  validate(z.object({ status: z.enum(["available", "occupied", "housekeeping", "maintenance"]) })),
  asyncHandler(async (req: AuthRequest, res) => {
    const room = await Room.findByIdAndUpdate(req.params.id, { status: req.body.status }, { new: true });
    if (!room) throw new ApiError(404, "Room not found");
    res.json(room);
  })
);

router.delete(
  "/:id",
  authenticate,
  isManager,
  asyncHandler(async (req: AuthRequest, res) => {
    const future = await Booking.exists({ roomId: req.params.id, status: { $in: ["confirmed", "checked_in"] } });
    if (future) throw new ApiError(400, "This room has active bookings. Deactivate it instead of deleting.");
    const room = await Room.findByIdAndDelete(req.params.id);
    if (!room) throw new ApiError(404, "Room not found");
    audit(req, "room.delete", "room", req.params.id);
    res.json({ message: "Room deleted" });
  })
);

export default router;
