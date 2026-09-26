import mongoose, { Schema, Document } from "mongoose";

/* ------------------------------ Promotion ------------------------------ */
export interface IPromotion extends Document {
  code: string; name: string; description?: string;
  discountType: "percentage" | "fixed"; discountValue: number;
  minNights: number; minAmount: number; maxDiscountAmount?: number;
  applicableRoomTypes: string[]; maxUses: number; usedCount: number;
  validFrom: Date; validTo: Date; isActive: boolean; showOnSite: boolean;
  createdBy?: mongoose.Types.ObjectId;
}
const promotionSchema = new Schema<IPromotion>({
  code: { type: String, required: true, unique: true, uppercase: true, trim: true },
  name: { type: String, required: true },
  description: String,
  discountType: { type: String, enum: ["percentage", "fixed"], required: true },
  discountValue: { type: Number, required: true, min: 0 },
  minNights: { type: Number, default: 1 },
  minAmount: { type: Number, default: 0 },
  maxDiscountAmount: Number,
  applicableRoomTypes: { type: [String], default: [] },
  maxUses: { type: Number, default: 1000 },
  usedCount: { type: Number, default: 0 },
  validFrom: { type: Date, required: true },
  validTo: { type: Date, required: true },
  isActive: { type: Boolean, default: true },
  showOnSite: { type: Boolean, default: true },
  createdBy: { type: Schema.Types.ObjectId, ref: "User" },
}, { timestamps: true });
promotionSchema.index({ isActive: 1, validTo: 1 });
export const Promotion = mongoose.model<IPromotion>("Promotion", promotionSchema);

/* ------------------------------ Expense ------------------------------ */
export const EXPENSE_CATEGORIES = ["salary", "electricity", "water", "gas", "supplies", "maintenance", "marketing", "food_purchase", "laundry", "taxes", "other"] as const;
export interface IExpense extends Document {
  date: Date; category: string; description: string; amount: number;
  paymentMethod: string; vendor?: string; receiptUrl?: string; addedBy: mongoose.Types.ObjectId;
}
const expenseSchema = new Schema<IExpense>({
  date: { type: Date, required: true, default: Date.now },
  category: { type: String, enum: EXPENSE_CATEGORIES, required: true },
  description: { type: String, required: true },
  amount: { type: Number, required: true, min: 0 },
  paymentMethod: { type: String, enum: ["cash", "upi", "bank_transfer", "card"], default: "cash" },
  vendor: String,
  receiptUrl: String,
  addedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
}, { timestamps: true });
expenseSchema.index({ date: -1 });
expenseSchema.index({ category: 1, date: -1 });
export const Expense = mongoose.model<IExpense>("Expense", expenseSchema);

/* ------------------------------ FoodOrder (restaurant / POS log) ------------------------------ */
export interface IFoodOrder extends Document {
  date: Date; shift: string; description?: string; coverCount: number; amount: number;
  paymentMethod: string; bookingRef?: string; tableNumber?: string; addedBy: mongoose.Types.ObjectId;
}
const foodOrderSchema = new Schema<IFoodOrder>({
  date: { type: Date, required: true, default: Date.now },
  shift: { type: String, enum: ["breakfast", "lunch", "dinner", "snacks", "bar", "room_service", "banquet"], required: true },
  description: String,
  coverCount: { type: Number, default: 1 },
  amount: { type: Number, required: true, min: 0 },
  paymentMethod: { type: String, enum: ["cash", "upi", "card", "room_charge"], default: "cash" },
  bookingRef: String,
  tableNumber: String,
  addedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
}, { timestamps: true });
foodOrderSchema.index({ date: -1 });
export const FoodOrder = mongoose.model<IFoodOrder>("FoodOrder", foodOrderSchema);

/* ------------------------------ Housekeeping ------------------------------ */
export interface IHousekeeping extends Document {
  roomId: mongoose.Types.ObjectId; roomNumber: string;
  taskType: "checkout_clean" | "daily_clean" | "deep_clean" | "turndown" | "maintenance";
  status: "pending" | "in_progress" | "completed" | "skipped";
  priority: "low" | "normal" | "high" | "urgent";
  assignedTo?: mongoose.Types.ObjectId; notes?: string; scheduledFor: Date;
  startedAt?: Date; completedAt?: Date;
  checklistItems: { item: string; checked: boolean }[];
  createdBy?: mongoose.Types.ObjectId;
}
const housekeepingSchema = new Schema<IHousekeeping>({
  roomId: { type: Schema.Types.ObjectId, ref: "Room", required: true },
  roomNumber: { type: String, required: true },
  taskType: { type: String, enum: ["checkout_clean", "daily_clean", "deep_clean", "turndown", "maintenance"], required: true },
  status: { type: String, enum: ["pending", "in_progress", "completed", "skipped"], default: "pending" },
  priority: { type: String, enum: ["low", "normal", "high", "urgent"], default: "normal" },
  assignedTo: { type: Schema.Types.ObjectId, ref: "User" },
  notes: String,
  scheduledFor: { type: Date, required: true, default: Date.now },
  startedAt: Date,
  completedAt: Date,
  checklistItems: { type: [{ item: String, checked: { type: Boolean, default: false } }], default: [] },
  createdBy: { type: Schema.Types.ObjectId, ref: "User" },
}, { timestamps: true });
housekeepingSchema.index({ status: 1, scheduledFor: -1 });
export const Housekeeping = mongoose.model<IHousekeeping>("Housekeeping", housekeepingSchema);

/* ------------------------------ RoomService request ------------------------------ */
export interface IRoomService extends Document {
  bookingId: mongoose.Types.ObjectId; guestId?: mongoose.Types.ObjectId;
  roomNumber: string; guestName: string;
  category: "food" | "laundry" | "amenities" | "maintenance" | "transport" | "other";
  title: string;
  items: { menuItemId?: mongoose.Types.ObjectId; name: string; qty: number; price: number }[];
  guestNotes?: string; staffNotes?: string;
  status: "pending" | "accepted" | "in_progress" | "delivered" | "cancelled";
  priority: "low" | "normal" | "high" | "urgent";
  totalAmount: number; billed: boolean; estimatedMinutes?: number;
  assignedTo?: mongoose.Types.ObjectId;
  createdAt: Date;
}
const roomServiceSchema = new Schema<IRoomService>({
  bookingId: { type: Schema.Types.ObjectId, ref: "Booking", required: true },
  guestId: { type: Schema.Types.ObjectId, ref: "User" },
  roomNumber: { type: String, required: true },
  guestName: { type: String, required: true },
  category: { type: String, enum: ["food", "laundry", "amenities", "maintenance", "transport", "other"], required: true },
  title: { type: String, required: true, maxlength: 200 },
  items: { type: [{ menuItemId: Schema.Types.ObjectId, name: String, qty: Number, price: Number }], default: [] },
  guestNotes: { type: String, maxlength: 1000 },
  staffNotes: { type: String, maxlength: 1000 },
  status: { type: String, enum: ["pending", "accepted", "in_progress", "delivered", "cancelled"], default: "pending" },
  priority: { type: String, enum: ["low", "normal", "high", "urgent"], default: "normal" },
  totalAmount: { type: Number, default: 0 },
  billed: { type: Boolean, default: false },
  estimatedMinutes: Number,
  assignedTo: { type: Schema.Types.ObjectId, ref: "User" },
}, { timestamps: true });
roomServiceSchema.index({ status: 1, createdAt: -1 });
roomServiceSchema.index({ bookingId: 1 });
roomServiceSchema.index({ guestId: 1 });
export const RoomService = mongoose.model<IRoomService>("RoomService", roomServiceSchema);

/* ------------------------------ MenuItem ------------------------------ */
export interface IMenuItem extends Document {
  name: string; description?: string; category: string; price: number;
  isVeg: boolean; imageUrl?: string; isAvailable: boolean; isSignature: boolean; sortOrder: number;
}
const menuItemSchema = new Schema<IMenuItem>({
  name: { type: String, required: true, trim: true },
  description: String,
  category: { type: String, required: true, trim: true },
  price: { type: Number, required: true, min: 0 },
  isVeg: { type: Boolean, default: true },
  imageUrl: String,
  isAvailable: { type: Boolean, default: true },
  isSignature: { type: Boolean, default: false },
  sortOrder: { type: Number, default: 0 },
}, { timestamps: true });
menuItemSchema.index({ category: 1, sortOrder: 1 });
export const MenuItem = mongoose.model<IMenuItem>("MenuItem", menuItemSchema);

/* ------------------------------ Review ------------------------------ */
export interface IReview extends Document {
  bookingId: mongoose.Types.ObjectId; name: string; location?: string; rating: number;
  title?: string; comment: string; status: "pending" | "approved" | "hidden"; featured: boolean;
}
const reviewSchema = new Schema<IReview>({
  bookingId: { type: Schema.Types.ObjectId, ref: "Booking", required: true, unique: true },
  name: { type: String, required: true },
  location: String,
  rating: { type: Number, required: true, min: 1, max: 5 },
  title: String,
  comment: { type: String, required: true, maxlength: 2000 },
  status: { type: String, enum: ["pending", "approved", "hidden"], default: "pending" },
  featured: { type: Boolean, default: false },
}, { timestamps: true });
export const Review = mongoose.model<IReview>("Review", reviewSchema);

/* ------------------------------ Settings (singleton) ------------------------------ */
export interface ISettings extends Document {
  key: string;
  resortName: string;
tagline: string;
phone: string;
phoneSecondary: string;
whatsapp: string;
email: string;
  address: string; mapsUrl: string; mapsEmbedUrl: string; latitude?: number; longitude?: number;
  checkInTime: string; checkOutTime: string; cancellationHours: number;
  gstNumber: string; mealPlans: { code: string; label: string; adultPrice: number; childPrice: number; description: string }[];
  social: { instagram: string; facebook: string; youtube: string };
  bookingsOpen: boolean; announcement: string;
}
const settingsSchema = new Schema<ISettings>({
  key: { type: String, default: "main", unique: true },
  resortName: String,
tagline: String,
phone: String,
phoneSecondary: { type: String, default: "" },
whatsapp: String,
email: String,
  address: String, mapsUrl: String, mapsEmbedUrl: String, latitude: Number, longitude: Number,
  checkInTime: { type: String, default: "14:00" },
  checkOutTime: { type: String, default: "11:00" },
  cancellationHours: { type: Number, default: 48 },
  gstNumber: { type: String, default: "" },
  mealPlans: { type: [{ code: String, label: String, adultPrice: Number, childPrice: Number, description: String }], default: [] },
  social: { instagram: { type: String, default: "" }, facebook: { type: String, default: "" }, youtube: { type: String, default: "" } },
  bookingsOpen: { type: Boolean, default: true },
  announcement: { type: String, default: "" },
}, { timestamps: true });
export const Settings = mongoose.model<ISettings>("Settings", settingsSchema);

/* ------------------------------ Audit log ------------------------------ */
export interface IAudit extends Document {
  userId?: mongoose.Types.ObjectId; userEmail?: string; action: string; entity: string; entityId?: string; meta?: any; ip?: string;
}
const auditSchema = new Schema<IAudit>({
  userId: { type: Schema.Types.ObjectId, ref: "User" },
  userEmail: String,
  action: { type: String, required: true },
  entity: { type: String, required: true },
  entityId: String,
  meta: Schema.Types.Mixed,
  ip: String,
}, { timestamps: { createdAt: true, updatedAt: false } });
auditSchema.index({ createdAt: -1 });
export const AuditLog = mongoose.model<IAudit>("AuditLog", auditSchema);
