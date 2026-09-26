import { Router } from "express";
import Booking from "../models/Booking";
import Room from "../models/Room";
import RoomNight from "../models/RoomNight";
import MessageThread from "../models/Message";
import { Expense, FoodOrder, Housekeeping, RoomService } from "../models/Misc";
import { authenticate, isManager, isStaff } from "../middleware/auth";
import { asyncHandler } from "../utils/http";
import { addDays, dayRangeIST, fmtDay, monthRangeIST, todayIST } from "../utils/dates";

const router = Router();
router.use(authenticate, isStaff);

const TZ = "Asia/Kolkata";

async function collections(start: Date, end: Date) {
  const [byMethod, fb, exp] = await Promise.all([
    Booking.aggregate([
      { $unwind: "$payments" },
      { $match: { "payments.at": { $gte: start, $lt: end } } },
      { $group: { _id: "$payments.method", total: { $sum: "$payments.amount" } } },
    ]),
    FoodOrder.aggregate([
      { $match: { date: { $gte: start, $lt: end }, paymentMethod: { $ne: "room_charge" } } },
      { $group: { _id: "$paymentMethod", total: { $sum: "$amount" } } },
    ]),
    Expense.aggregate([
      { $match: { date: { $gte: start, $lt: end } } },
      { $group: { _id: "$category", total: { $sum: "$amount" } } },
    ]),
  ]);
  const method: Record<string, number> = { cash: 0, upi: 0, card: 0, bank_transfer: 0 };
  byMethod.forEach((m) => (method[m._id] = (method[m._id] || 0) + m.total));
  let fbTotal = 0;
  fb.forEach((m) => { fbTotal += m.total; if (method[m._id] !== undefined) method[m._id] += m.total; });
  const roomRevenue = byMethod.reduce((s, m) => s + m.total, 0);
  const expenseTotal = exp.reduce((s, e) => s + e.total, 0);
  const expenseBreakdown: Record<string, number> = {};
  exp.forEach((e) => (expenseBreakdown[e._id] = e.total));
  return { roomRevenue, fbRevenue: fbTotal, totalRevenue: roomRevenue + fbTotal, byMethod: method, expenseTotal, expenseBreakdown, netProfit: roomRevenue + fbTotal - expenseTotal };
}

router.get("/dashboard", asyncHandler(async (req, res) => {
  const { date } = req.query as Record<string, string>;
  const { day, start, end } = dayRangeIST(date);
  const month = monthRangeIST(date ? date.slice(0, 7) : undefined);
  const activeRooms = await Room.countDocuments({ isActive: true });

  const [today, mtd, occupiedTonight, arrivals, departures, inHouse, pending, unreadMessages, pendingService, pendingHk, newBookings24h, upcoming, roomsByStatus] = await Promise.all([
    collections(start, end),
    collections(month.start, month.end),
    RoomNight.countDocuments({ night: day }),
    Booking.find({ status: "confirmed", checkIn: day, isBlock: false }).select("bookingRef guestName roomNumber roomName adults children balanceDue guestPhone").limit(20),
    Booking.find({ status: "checked_in", checkOut: day }).select("bookingRef guestName roomNumber roomName balanceDue").limit(20),
    Booking.countDocuments({ status: "checked_in" }),
    Booking.aggregate([
      { $match: { status: { $in: ["confirmed", "checked_in", "checked_out"] }, balanceDue: { $gt: 0 }, isBlock: false } },
      { $group: { _id: null, total: { $sum: "$balanceDue" }, count: { $sum: 1 } } },
    ]),
    MessageThread.countDocuments({ unreadByStaff: { $gt: 0 } }),
    RoomService.countDocuments({ status: { $in: ["pending", "accepted", "in_progress"] } }),
    Housekeeping.countDocuments({ status: { $in: ["pending", "in_progress"] } }),
    Booking.countDocuments({ createdAt: { $gte: new Date(Date.now() - 86400000) }, isBlock: false }),
    Booking.find({ status: "confirmed", checkIn: { $gt: day }, isBlock: false }).sort({ checkIn: 1 }).limit(6).select("bookingRef guestName roomName checkIn checkOut totalAmount"),
    Room.aggregate([{ $match: { isActive: true } }, { $group: { _id: "$status", count: { $sum: 1 } } }]),
  ]);

  res.json({
    date: fmtDay(day),
    today,
    monthToDate: mtd,
    occupancy: { total: activeRooms, occupiedTonight, rate: activeRooms ? Math.round((occupiedTonight / activeRooms) * 100) : 0, inHouse },
    arrivals, departures, upcoming,
    pendingPayments: { total: pending[0]?.total || 0, count: pending[0]?.count || 0 },
    counters: { unreadMessages, pendingService, pendingHousekeeping: pendingHk, newBookings24h },
    roomsByStatus: Object.fromEntries(roomsByStatus.map((r) => [r._id, r.count])),
  });
}));

router.get("/trends", isManager, asyncHandler(async (req, res) => {
  const days = Math.min(90, Math.max(7, parseInt(String(req.query.days)) || 30));
  const today = todayIST();
  const startDay = addDays(today, -(days - 1));
  const { start } = dayRangeIST(fmtDay(startDay));
  const activeRooms = await Room.countDocuments({ isActive: true });

  const [pay, fb, exp, occ, sources] = await Promise.all([
    Booking.aggregate([
      { $unwind: "$payments" }, { $match: { "payments.at": { $gte: start } } },
      { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$payments.at", timezone: TZ } }, v: { $sum: "$payments.amount" } } },
    ]),
    FoodOrder.aggregate([
      { $match: { date: { $gte: start }, paymentMethod: { $ne: "room_charge" } } },
      { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$date", timezone: TZ } }, v: { $sum: "$amount" } } },
    ]),
    Expense.aggregate([
      { $match: { date: { $gte: start } } },
      { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$date", timezone: TZ } }, v: { $sum: "$amount" } } },
    ]),
    RoomNight.aggregate([
      { $match: { night: { $gte: startDay, $lte: today } } },
      { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$night" } }, v: { $sum: 1 } } },
    ]),
    Booking.aggregate([
      { $match: { createdAt: { $gte: start }, isBlock: false, status: { $ne: "cancelled" } } },
      { $group: { _id: "$source", count: { $sum: 1 }, value: { $sum: "$totalAmount" } } },
    ]),
  ]);
  const idx = (arr: any[]) => new Map(arr.map((x) => [x._id, x.v]));
  const P = idx(pay), F = idx(fb), E = idx(exp), O = idx(occ);
  const series = Array.from({ length: days }, (_, i) => {
    const d = fmtDay(addDays(startDay, i));
    const room = P.get(d) || 0, food = F.get(d) || 0, expense = E.get(d) || 0;
    return { date: d, roomRevenue: room, fbRevenue: food, revenue: room + food, expenses: expense, profit: room + food - expense,
      occupancy: activeRooms ? Math.round(((O.get(d) || 0) / activeRooms) * 100) : 0 };
  });
  res.json({ days, series, sources: sources.map((s) => ({ source: s._id, count: s.count, value: s.value })) });
}));

router.get("/monthly", isManager, asyncHandler(async (req, res) => {
  const { month } = req.query as Record<string, string>;
  const r = monthRangeIST(month);
  const c = await collections(r.start, r.end);
  const [bookings, nightsSold, gst] = await Promise.all([
    Booking.countDocuments({ checkIn: { $gte: r.startDay, $lt: r.endDay }, isBlock: false, status: { $nin: ["cancelled"] } }),
    RoomNight.countDocuments({ night: { $gte: r.startDay, $lt: r.endDay } }),
    Booking.aggregate([
      { $match: { status: "checked_out", actualCheckOut: { $gte: r.start, $lt: r.end }, isBlock: false } },
      { $group: { _id: "$gstRate", base: { $sum: "$baseAmount" }, gst: { $sum: "$gstAmount" }, total: { $sum: "$totalAmount" }, count: { $sum: 1 } } },
    ]),
  ]);
  const activeRooms = await Room.countDocuments({ isActive: true });
  const days = Math.round((r.endDay.getTime() - r.startDay.getTime()) / 86400000);
  res.json({
    month: fmtDay(r.startDay).slice(0, 7), ...c, bookings, nightsSold,
    occupancy: activeRooms ? Math.round((nightsSold / (activeRooms * days)) * 100) : 0,
    adr: nightsSold ? Math.round(c.roomRevenue / nightsSold) : 0,
    gst: gst.map((g) => ({ rate: g._id, base: g.base, gst: g.gst, total: g.total, count: g.count })),
  });
}));

const csv = (rows: any[][]) => rows.map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");

router.get("/export/bookings.csv", isManager, asyncHandler(async (req, res) => {
  const { from, to } = req.query as Record<string, string>;
  const q: any = { isBlock: false };
  if (from || to) { q.checkIn = {}; if (from) q.checkIn.$gte = new Date(from); if (to) q.checkIn.$lte = new Date(to); }
  const list = await Booking.find(q).sort({ checkIn: -1 }).limit(5000);
  const rows = [["Ref", "Guest", "Email", "Phone", "Room", "Check-in", "Check-out", "Nights", "Status", "Source", "Total", "Paid", "Balance", "GST"],
    ...list.map((b) => [b.bookingRef, b.guestName, b.guestEmail, b.guestPhone, `${b.roomNumber} ${b.roomName}`, fmtDay(b.checkIn), fmtDay(b.checkOut), b.nights, b.status, b.source, b.totalAmount, b.paidAmount, b.balanceDue, b.gstAmount])];
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", 'attachment; filename="bookings.csv"');
  res.send(csv(rows));
}));

router.get("/export/expenses.csv", isManager, asyncHandler(async (req, res) => {
  const list = await Expense.find().sort({ date: -1 }).limit(5000);
  const rows = [["Date", "Category", "Description", "Vendor", "Method", "Amount"], ...list.map((e) => [fmtDay(e.date), e.category, e.description, e.vendor || "", e.paymentMethod, e.amount])];
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", 'attachment; filename="expenses.csv"');
  res.send(csv(rows));
}));

export default router;
