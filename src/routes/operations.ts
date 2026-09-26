import { Router } from "express";
import { z } from "zod";
import mongoose from "mongoose";
import { Housekeeping, RoomService, FoodOrder, Expense, EXPENSE_CATEGORIES, MenuItem } from "../models/Misc";
import Room from "../models/Room";
import Booking from "../models/Booking";
import { authenticate, isStaff, isManager, AuthRequest } from "../middleware/auth";
import { ApiError, asyncHandler, objectId, paginate, validate } from "../utils/http";
import { emit } from "../socket";
import { audit } from "../services/audit";
import { dayRangeIST, parseDay } from "../utils/dates";

/* =========================== HOUSEKEEPING =========================== */
export const housekeepingRouter = Router();
housekeepingRouter.use(authenticate, isStaff);

const DEFAULT_CHECKLIST: Record<string, string[]> = {
  checkout_clean: ["Strip and change linen", "Clean bathroom & restock toiletries", "Dust and vacuum", "Restock minibar & water", "Check AC, lights & TV", "Final inspection"],
  daily_clean: ["Make bed", "Empty bins", "Refresh towels", "Vacuum", "Restock water"],
  deep_clean: ["Move furniture & clean underneath", "Wash curtains", "Scrub bathroom grout", "Sanitise all surfaces", "Inspect for pests"],
  turndown: ["Turn down bed", "Place chocolates & water", "Close curtains", "Set ambient lights"],
  maintenance: ["Inspect issue", "Repair or escalate", "Test after repair"],
};

housekeepingRouter.get("/", asyncHandler(async (req, res) => {
  const { status, roomNumber } = req.query as Record<string, string>;
  const q: any = {};
  if (status) q.status = { $in: status.split(",") };
  if (roomNumber) q.roomNumber = roomNumber;
  const tasks = await Housekeeping.find(q).populate("assignedTo", "firstName lastName").sort({ status: 1, priority: -1, scheduledFor: -1 }).limit(200);
  res.json(tasks);
}));

housekeepingRouter.post("/",
  validate(z.object({
    roomId: objectId, taskType: z.enum(["checkout_clean", "daily_clean", "deep_clean", "turndown", "maintenance"]),
    priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"), notes: z.string().max(500).optional(),
    assignedTo: objectId.optional(), scheduledFor: z.coerce.date().optional(),
  })),
  asyncHandler(async (req: AuthRequest, res) => {
    const room = await Room.findById(req.body.roomId);
    if (!room) throw new ApiError(404, "Room not found");
    const task = await Housekeeping.create({
      ...req.body, roomNumber: room.roomNumber, scheduledFor: req.body.scheduledFor || new Date(),
      checklistItems: DEFAULT_CHECKLIST[req.body.taskType].map((item) => ({ item, checked: false })), createdBy: req.user!.id,
    });
    emit.housekeepingUpdate(task);
    res.status(201).json(task);
  }));

housekeepingRouter.patch("/:id",
  validate(z.object({
    status: z.enum(["pending", "in_progress", "completed", "skipped"]).optional(), assignedTo: objectId.nullable().optional(),
    notes: z.string().max(500).optional(), priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
    checklistItems: z.array(z.object({ item: z.string(), checked: z.boolean() })).optional(),
  })),
  asyncHandler(async (req: AuthRequest, res) => {
    const task = await Housekeeping.findById(req.params.id);
    if (!task) throw new ApiError(404, "Task not found");
    const b = req.body;
    if (b.notes !== undefined) task.notes = b.notes;
    if (b.priority) task.priority = b.priority;
    if (b.assignedTo !== undefined) task.assignedTo = b.assignedTo as any;
    if (b.checklistItems) task.checklistItems = b.checklistItems as any;
    if (b.status && b.status !== task.status) {
      task.status = b.status;
      if (b.status === "in_progress") { task.startedAt = new Date(); if (!task.assignedTo) task.assignedTo = req.user!.id as any; }
      if (b.status === "completed") {
        task.completedAt = new Date();
        task.checklistItems.forEach((c) => (c.checked = true));
        const pending = await Housekeeping.countDocuments({ roomId: task.roomId, status: { $in: ["pending", "in_progress"] }, _id: { $ne: task._id } });
        const inHouse = await Booking.exists({ roomId: task.roomId, status: "checked_in" });
        if (!pending && !inHouse) await Room.findByIdAndUpdate(task.roomId, { status: "available" });
      }
    }
    await task.save();
    emit.housekeepingUpdate(task);
    res.json(task);
  }));

housekeepingRouter.delete("/:id", isManager, asyncHandler(async (req, res) => { await Housekeeping.findByIdAndDelete(req.params.id); res.json({ message: "Deleted" }); }));

/* =========================== ROOM SERVICE =========================== */
export const roomServiceRouter = Router();
roomServiceRouter.use(authenticate);

roomServiceRouter.get("/", asyncHandler(async (req: AuthRequest, res) => {
  const { status } = req.query as Record<string, string>;
  const { page, limit, skip } = paginate(req.query, 30);
  const q: any = {};
  if (req.user!.role === "guest") q.guestId = req.user!.id;
  if (status) q.status = { $in: status.split(",") };
  const [requests, total] = await Promise.all([
    RoomService.find(q).populate("assignedTo", "firstName lastName").sort({ createdAt: -1 }).skip(skip).limit(limit),
    RoomService.countDocuments(q),
  ]);
  res.json({ requests, total, page, pages: Math.ceil(total / limit) });
}));

roomServiceRouter.post("/",
  validate(z.object({
    bookingId: objectId, category: z.enum(["food", "laundry", "amenities", "maintenance", "transport", "other"]),
    title: z.string().trim().min(2).max(200), guestNotes: z.string().max(1000).optional(),
    priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
    items: z.array(z.object({ menuItemId: objectId, qty: z.coerce.number().int().min(1).max(20) })).default([]),
  })),
  asyncHandler(async (req: AuthRequest, res) => {
    const booking = await Booking.findById(req.body.bookingId);
    if (!booking) throw new ApiError(404, "Booking not found");
    const isStaffUser = ["staff", "manager", "admin"].includes(req.user!.role);
    if (!isStaffUser && (String(booking.guestId) !== req.user!.id && booking.guestEmail !== req.user!.email)) throw new ApiError(403, "Not your booking");
    if (booking.status !== "checked_in") throw new ApiError(400, "Room service is available once you've checked in");

    let items: any[] = [];
    if (req.body.items.length) {
      const menu = await MenuItem.find({ _id: { $in: req.body.items.map((i: any) => i.menuItemId) }, isAvailable: true });
      items = req.body.items.map((i: any) => {
        const m = menu.find((x) => String(x._id) === i.menuItemId);
        if (!m) throw new ApiError(400, "One of the items is no longer available");
        return { menuItemId: m._id, name: m.name, qty: i.qty, price: m.price };
      });
    }
    const totalAmount = items.reduce((s, i) => s + i.price * i.qty, 0);
    const sr = await RoomService.create({
      bookingId: booking._id, guestId: booking.guestId, roomNumber: booking.roomNumber, guestName: booking.guestName,
      category: req.body.category, title: req.body.title, guestNotes: req.body.guestNotes, priority: req.body.priority, items, totalAmount,
    });
    emit.roomServiceNew(sr);
    res.status(201).json(sr);
  }));

roomServiceRouter.patch("/:id/status", isStaff,
  validate(z.object({
    status: z.enum(["pending", "accepted", "in_progress", "delivered", "cancelled"]),
    staffNotes: z.string().max(1000).optional(), estimatedMinutes: z.coerce.number().min(0).optional(),
    assignedTo: objectId.nullable().optional(), totalAmount: z.coerce.number().min(0).optional(),
  })),
  asyncHandler(async (req: AuthRequest, res) => {
    const sr = await RoomService.findById(req.params.id);
    if (!sr) throw new ApiError(404, "Request not found");
    const b = req.body;
    sr.status = b.status;
    if (b.staffNotes !== undefined) sr.staffNotes = b.staffNotes;
    if (b.estimatedMinutes !== undefined) sr.estimatedMinutes = b.estimatedMinutes;
    if (b.assignedTo !== undefined) sr.assignedTo = b.assignedTo as any;
    if (b.totalAmount !== undefined) sr.totalAmount = b.totalAmount;
    // Bill delivered orders to the guest's folio exactly once.
    if (sr.status === "delivered" && sr.totalAmount > 0 && !sr.billed) {
      const booking = await Booking.findById(sr.bookingId);
      if (booking && !["cancelled", "no_show"].includes(booking.status)) {
        booking.extras.push({ description: `Room service: ${sr.title}`, amount: sr.totalAmount, addedAt: new Date(), source: "roomservice" });
        booking.recalc();
        await booking.save();
        sr.billed = true;
        emit.bookingUpdate(booking.toObject());
      }
    }
    await sr.save();
    emit.roomServiceUpdate(sr);
    res.json(sr);
  }));

roomServiceRouter.post("/:id/cancel", asyncHandler(async (req: AuthRequest, res) => {
  const sr = await RoomService.findById(req.params.id);
  if (!sr) throw new ApiError(404, "Request not found");
  if (req.user!.role === "guest" && String(sr.guestId) !== req.user!.id) throw new ApiError(403, "Forbidden");
  if (sr.status !== "pending") throw new ApiError(400, "This request is already being handled. Please call reception.");
  sr.status = "cancelled";
  await sr.save();
  emit.roomServiceUpdate(sr);
  res.json(sr);
}));

/* =========================== FOOD ORDERS (restaurant log) =========================== */
export const foodRouter = Router();
foodRouter.use(authenticate, isStaff);

foodRouter.get("/", asyncHandler(async (req, res) => {
  const { from, to, shift } = req.query as Record<string, string>;
  const { page, limit, skip } = paginate(req.query, 30);
  const q: any = {};
  if (shift) q.shift = shift;
  if (from || to) {
    q.date = {};
    if (from) q.date.$gte = dayRangeIST(from).start;
    if (to) q.date.$lt = dayRangeIST(to).end;
  }
  const [orders, total, agg] = await Promise.all([
    FoodOrder.find(q).sort({ date: -1 }).skip(skip).limit(limit),
    FoodOrder.countDocuments(q),
    FoodOrder.aggregate([{ $match: q }, { $group: { _id: null, amount: { $sum: "$amount" }, covers: { $sum: "$coverCount" } } }]),
  ]);
  res.json({ orders, total, page, pages: Math.ceil(total / limit), totals: agg[0] || { amount: 0, covers: 0 } });
}));

foodRouter.post("/",
  validate(z.object({
    date: z.coerce.date().optional(), shift: z.enum(["breakfast", "lunch", "dinner", "snacks", "bar", "room_service", "banquet"]),
    description: z.string().max(300).optional(), coverCount: z.coerce.number().int().min(1).default(1), amount: z.coerce.number().min(0),
    paymentMethod: z.enum(["cash", "upi", "card", "room_charge"]).default("cash"), bookingRef: z.string().optional(), tableNumber: z.string().optional(),
  })),
  asyncHandler(async (req: AuthRequest, res) => {
    const b = req.body;
    if (b.paymentMethod === "room_charge") {
      if (!b.bookingRef) throw new ApiError(400, "Enter the booking reference to charge to a room");
      const booking = await Booking.findOne({ bookingRef: String(b.bookingRef).toUpperCase(), status: "checked_in" });
      if (!booking) throw new ApiError(404, "No in-house booking found with that reference");
      booking.extras.push({ description: `Restaurant (${b.shift})${b.description ? ": " + b.description : ""}`, amount: b.amount, addedAt: new Date(), source: "restaurant" });
      booking.recalc();
      await booking.save();
      emit.bookingUpdate(booking.toObject());
    }
    const order = await FoodOrder.create({ ...b, date: b.date || new Date(), addedBy: req.user!.id });
    res.status(201).json(order);
  }));

foodRouter.delete("/:id", isManager, asyncHandler(async (req: AuthRequest, res) => {
  await FoodOrder.findByIdAndDelete(req.params.id);
  audit(req, "food.delete", "foodorder", req.params.id);
  res.json({ message: "Deleted" });
}));

/* =========================== EXPENSES =========================== */
export const expenseRouter = Router();
expenseRouter.use(authenticate, isStaff);

expenseRouter.get("/", asyncHandler(async (req, res) => {
  const { from, to, category } = req.query as Record<string, string>;
  const { page, limit, skip } = paginate(req.query, 30);
  const q: any = {};
  if (category) q.category = category;
  if (from || to) {
    q.date = {};
    if (from) q.date.$gte = dayRangeIST(from).start;
    if (to) q.date.$lt = dayRangeIST(to).end;
  }
  const [expenses, total, byCat] = await Promise.all([
    Expense.find(q).sort({ date: -1 }).skip(skip).limit(limit),
    Expense.countDocuments(q),
    Expense.aggregate([{ $match: q }, { $group: { _id: "$category", total: { $sum: "$amount" } } }, { $sort: { total: -1 } }]),
  ]);
  res.json({ expenses, total, page, pages: Math.ceil(total / limit), byCategory: byCat, sum: byCat.reduce((s, c) => s + c.total, 0) });
}));

expenseRouter.post("/",
  validate(z.object({
    date: z.coerce.date().optional(), category: z.enum(EXPENSE_CATEGORIES), description: z.string().trim().min(2).max(300),
    amount: z.coerce.number().min(1), paymentMethod: z.enum(["cash", "upi", "bank_transfer", "card"]).default("cash"),
    vendor: z.string().max(120).optional(), receiptUrl: z.string().optional(),
  })),
  asyncHandler(async (req: AuthRequest, res) => {
    const e = await Expense.create({ ...req.body, date: req.body.date || new Date(), addedBy: req.user!.id });
    res.status(201).json(e);
  }));

expenseRouter.delete("/:id", isManager, asyncHandler(async (req: AuthRequest, res) => {
  await Expense.findByIdAndDelete(req.params.id);
  audit(req, "expense.delete", "expense", req.params.id);
  res.json({ message: "Deleted" });
}));

void mongoose; void parseDay;
