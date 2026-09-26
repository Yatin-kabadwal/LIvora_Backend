import { Router } from "express";
import { z } from "zod";
import MessageThread from "../models/Message";
import { authenticate, optionalAuth, isStaff, isAdmin, AuthRequest } from "../middleware/auth";
import { publicFormLimiter } from "../middleware/security";
import { ApiError, asyncHandler, escapeRegex, objectId, paginate, validate } from "../utils/http";
import { randomToken } from "../utils/id";
import { emailGuestReply, emailStaffNewMessage, emailThreadAck } from "../services/email";
import { emit } from "../socket";
import User from "../models/User";
import mongoose from "mongoose";

const router = Router();

async function nextRef() {
  const c: any = await mongoose.connection.collection("counters").findOneAndUpdate({ _id: "message" as any }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: "after" });
  const seq = c?.seq ?? c?.value?.seq ?? Date.now() % 100000;
  return `MSG-${String(seq).padStart(5, "0")}`;
}

const summary = (t: any) => ({
  _id: t._id, ref: t.ref, name: t.name, email: t.email, phone: t.phone, subject: t.subject, topic: t.topic, status: t.status,
  unreadByStaff: t.unreadByStaff, unreadByGuest: t.unreadByGuest, lastMessageAt: t.lastMessageAt, source: t.source, userId: t.userId,
  preview: t.messages?.[t.messages.length - 1]?.body?.slice(0, 140) || "", count: t.messages?.length || 0,
});

const guestView = (t: any) => ({
  ref: t.ref, name: t.name, subject: t.subject, topic: t.topic, status: t.status, lastMessageAt: t.lastMessageAt,
  messages: t.messages.map((m: any) => ({ _id: m._id, sender: m.sender, body: m.body, at: m.at, staffName: m.sender === "staff" ? m.staffName || "Our team" : undefined })),
});

/* ------------------------- public: send a message ------------------------- */
router.post(
  "/",
  publicFormLimiter,
  optionalAuth,
  validate(
    z.object({
      name: z.string().trim().min(2).max(120),
      email: z.string().email().toLowerCase(),
      phone: z.string().trim().max(20).optional(),
      subject: z.string().trim().min(2).max(200).optional(),
      topic: z.enum(["general", "booking", "event", "feedback", "complaint", "other"]).default("general"),
      message: z.string().trim().min(5, "Please write a little more").max(4000),
      source: z.enum(["website", "app"]).default("website"),
      website: z.string().max(0).optional(), // honeypot: real users leave this empty
    })
  ),
  asyncHandler(async (req: AuthRequest, res) => {
    const b = req.body;
    const thread = await MessageThread.create({
      ref: await nextRef(),
      name: b.name, email: b.email, phone: b.phone,
      subject: b.subject || (b.topic === "event" ? "Event / wedding enquiry" : b.topic === "booking" ? "Booking enquiry" : "New enquiry"),
      topic: b.topic, source: b.source,
      userId: req.user?.role === "guest" ? req.user.id : undefined,
      publicToken: randomToken(20),
      unreadByStaff: 1,
      messages: [{ sender: "guest", body: b.message, at: new Date() }],
    });
    emit.messageNew(summary(thread));
    emailThreadAck(thread).catch(() => undefined);
    emailStaffNewMessage(thread).catch(() => undefined);
    res.status(201).json({ ref: thread.ref, token: thread.publicToken, message: "Message sent. We'll get back to you shortly." });
  })
);

/* ------------------------- public: thread by secret token ------------------------- */
router.get(
  "/thread/:token",
  asyncHandler(async (req, res) => {
    const t = await MessageThread.findOne({ publicToken: req.params.token });
    if (!t) throw new ApiError(404, "Conversation not found");
    if (t.unreadByGuest) { t.unreadByGuest = 0; await t.save(); }
    res.json(guestView(t));
  })
);

router.post(
  "/thread/:token/reply",
  publicFormLimiter,
  validate(z.object({ message: z.string().trim().min(1).max(4000) })),
  asyncHandler(async (req, res) => {
    const t = await MessageThread.findOne({ publicToken: req.params.token });
    if (!t) throw new ApiError(404, "Conversation not found");
    t.messages.push({ sender: "guest", body: req.body.message, at: new Date() } as any);
    t.status = "open";
    t.unreadByStaff += 1;
    t.lastMessageAt = new Date();
    await t.save();
    emit.messageUpdate(summary(t));
    emailStaffNewMessage(t).catch(() => undefined);
    res.json(guestView(t));
  })
);

/* ------------------------- guest: my conversations (logged in) ------------------------- */
router.get(
  "/mine",
  authenticate,
  asyncHandler(async (req: AuthRequest, res) => {
    const list = await MessageThread.find({ $or: [{ userId: req.user!.id }, { email: req.user!.email }] }).sort({ lastMessageAt: -1 });
    res.json(list.map((t) => ({ ...guestView(t), token: t.publicToken, unreadByGuest: t.unreadByGuest })));
  })
);

/* ------------------------- staff inbox ------------------------- */
router.get(
  "/",
  authenticate,
  isStaff,
  asyncHandler(async (req, res) => {
    const { status, search, topic } = req.query as Record<string, string>;
    const { page, limit, skip } = paginate(req.query);
    const q: any = {};
    if (status && status !== "all") q.status = status;
    if (topic) q.topic = topic;
    if (search) {
      const rx = new RegExp(escapeRegex(search), "i");
      q.$or = [{ name: rx }, { email: rx }, { subject: rx }, { ref: rx }, { phone: rx }];
    }
    const [threads, total, unread] = await Promise.all([
      MessageThread.find(q).sort({ lastMessageAt: -1 }).skip(skip).limit(limit),
      MessageThread.countDocuments(q),
      MessageThread.countDocuments({ unreadByStaff: { $gt: 0 } }),
    ]);
    res.json({ threads: threads.map(summary), total, unread, page, pages: Math.ceil(total / limit) });
  })
);

router.get("/unread-count", authenticate, isStaff, asyncHandler(async (_req, res) => {
  res.json({ unread: await MessageThread.countDocuments({ unreadByStaff: { $gt: 0 } }) });
}));

router.get(
  "/:id",
  authenticate,
  isStaff,
  validate(z.object({}).passthrough(), "query"),
  asyncHandler(async (req, res) => {
    const t = await MessageThread.findById(req.params.id);
    if (!t) throw new ApiError(404, "Message not found");
    if (t.unreadByStaff || t.status === "new") {
      t.unreadByStaff = 0;
      if (t.status === "new") t.status = "open";
      await t.save();
      emit.messageUpdate(summary(t));
    }
    res.json(t);
  })
);

router.post(
  "/:id/reply",
  authenticate,
  isStaff,
  validate(z.object({ message: z.string().trim().min(1).max(4000) })),
  asyncHandler(async (req: AuthRequest, res) => {
    const t = await MessageThread.findById(req.params.id);
    if (!t) throw new ApiError(404, "Message not found");
    const me = await User.findById(req.user!.id);
    const staffName = me ? me.firstName : "Our team";
    t.messages.push({ sender: "staff", body: req.body.message, staffId: req.user!.id as any, staffName, at: new Date() } as any);
    t.status = "open";
    t.unreadByStaff = 0;
    t.unreadByGuest += 1;
    t.lastMessageAt = new Date();
    await t.save();
    emit.messageUpdate(summary(t));
    emailGuestReply(t, req.body.message, staffName).catch(() => undefined);
    res.json(t);
  })
);

router.patch(
  "/:id/status",
  authenticate,
  isStaff,
  validate(z.object({ status: z.enum(["new", "open", "resolved"]) })),
  asyncHandler(async (req, res) => {
    const t = await MessageThread.findByIdAndUpdate(req.params.id, { status: req.body.status }, { new: true });
    if (!t) throw new ApiError(404, "Message not found");
    emit.messageUpdate(summary(t));
    res.json(summary(t));
  })
);

router.delete("/:id", authenticate, isAdmin, asyncHandler(async (req, res) => {
  await MessageThread.findByIdAndDelete(req.params.id);
  res.json({ message: "Deleted" });
}));

export default router;
