import mongoose, { Document, Schema } from "mongoose";

export type BookingStatus = "confirmed" | "checked_in" | "checked_out" | "cancelled" | "no_show";
export type PayMethod = "cash" | "upi" | "card" | "bank_transfer";

export interface IPayment {
  _id?: mongoose.Types.ObjectId;
  amount: number; // negative = refund
  method: PayMethod;
  reference?: string;
  note?: string;
  receivedBy?: mongoose.Types.ObjectId;
  at: Date;
}

export interface IBooking extends Document {
  bookingRef: string;
  roomId: mongoose.Types.ObjectId;
  roomNumber: string;
  roomName: string;
  roomType: string;
  guestId?: mongoose.Types.ObjectId;
  guestName: string;
  guestEmail: string;
  guestPhone: string;
  checkIn: Date;
  checkOut: Date;
  nights: number;
  adults: number;
  children: number;
  mealPlan: "ep" | "cp" | "map" | "ap";
  specialRequests?: string;
  staffNotes?: string;
  status: BookingStatus;
  paymentStatus: "pending" | "partial" | "paid";
  pricePerNight: number;
  roomAmount: number;
  mealAmount: number;
  discountAmount: number;
  promoCode?: string;
  extras: { _id?: mongoose.Types.ObjectId; description: string; amount: number; addedAt: Date; source?: string }[];
  extrasTotal: number;
  gstRate: number;
  baseAmount: number;
  gstAmount: number;
  totalAmount: number;
  payments: IPayment[];
  paidAmount: number;
  balanceDue: number;
  source: "website" | "app" | "walk_in" | "phone" | "ota" | "block";
  isBlock: boolean;
  actualCheckIn?: Date;
  actualCheckOut?: Date;
  cancelledAt?: Date;
  cancelReason?: string;
  createdBy?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
  recalc(): void;
}

const bookingSchema = new Schema<IBooking>(
  {
    bookingRef: { type: String, unique: true, index: true },
    roomId: { type: Schema.Types.ObjectId, ref: "Room", required: true },
    roomNumber: { type: String, required: true },
    roomName: { type: String, default: "" },
    roomType: { type: String, required: true },
    guestId: { type: Schema.Types.ObjectId, ref: "User" },
    guestName: { type: String, required: true },
    guestEmail: { type: String, required: true, lowercase: true, trim: true },
    guestPhone: { type: String, default: "" },
    checkIn: { type: Date, required: true },
    checkOut: { type: Date, required: true },
    nights: { type: Number, required: true },
    adults: { type: Number, default: 1 },
    children: { type: Number, default: 0 },
    mealPlan: { type: String, enum: ["ep", "cp", "map", "ap"], default: "ep" },
    specialRequests: { type: String, maxlength: 1000 },
    staffNotes: { type: String, maxlength: 2000 },
    status: { type: String, enum: ["confirmed", "checked_in", "checked_out", "cancelled", "no_show"], default: "confirmed" },
    paymentStatus: { type: String, enum: ["pending", "partial", "paid"], default: "pending" },
    pricePerNight: { type: Number, required: true },
    roomAmount: { type: Number, required: true },
    mealAmount: { type: Number, default: 0 },
    discountAmount: { type: Number, default: 0 },
    promoCode: { type: String },
    extras: {
      type: [{ description: String, amount: Number, addedAt: { type: Date, default: Date.now }, source: String }],
      default: [],
    },
    extrasTotal: { type: Number, default: 0 },
    gstRate: { type: Number, required: true },
    baseAmount: { type: Number, default: 0 },
    gstAmount: { type: Number, default: 0 },
    totalAmount: { type: Number, required: true },
    payments: {
      type: [
        {
          amount: Number,
          method: { type: String, enum: ["cash", "upi", "card", "bank_transfer"] },
          reference: String,
          note: String,
          receivedBy: { type: Schema.Types.ObjectId, ref: "User" },
          at: { type: Date, default: Date.now },
        },
      ],
      default: [],
    },
    paidAmount: { type: Number, default: 0 },
    balanceDue: { type: Number, default: 0 },
    source: { type: String, enum: ["website", "app", "walk_in", "phone", "ota", "block"], default: "website" },
    isBlock: { type: Boolean, default: false },
    actualCheckIn: Date,
    actualCheckOut: Date,
    cancelledAt: Date,
    cancelReason: String,
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

/** Recompute all money fields from the source-of-truth arrays. */
bookingSchema.methods.recalc = function (this: IBooking) {
  this.extrasTotal = (this.extras || []).reduce((s, e) => s + (e.amount || 0), 0);
  const total = Math.max(0, this.roomAmount + this.mealAmount - this.discountAmount + this.extrasTotal);
  this.totalAmount = Math.round(total);
  this.baseAmount = Math.round(this.totalAmount / (1 + this.gstRate));
  this.gstAmount = this.totalAmount - this.baseAmount;
  this.paidAmount = Math.round((this.payments || []).reduce((s, p) => s + (p.amount || 0), 0));
  this.balanceDue = Math.max(0, this.totalAmount - this.paidAmount);
  this.paymentStatus = this.paidAmount <= 0 ? "pending" : this.balanceDue <= 0 ? "paid" : "partial";
};

bookingSchema.pre("validate", async function (next) {
  if (!this.bookingRef) {
    const year = new Date().getFullYear();
    const counter = await mongoose.connection
      .collection("counters")
      .findOneAndUpdate({ _id: `booking-${year}` as any }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: "after" });
    const seq = (counter as any)?.seq ?? (counter as any)?.value?.seq ?? Date.now() % 100000;
    this.bookingRef = `CVL-${year}-${String(seq).padStart(5, "0")}`;
  }
  next();
});

bookingSchema.index({ checkIn: 1, checkOut: 1, status: 1 });
bookingSchema.index({ guestId: 1, createdAt: -1 });
bookingSchema.index({ guestEmail: 1 });
bookingSchema.index({ roomId: 1, status: 1 });
bookingSchema.index({ "payments.at": 1 });

export default mongoose.model<IBooking>("Booking", bookingSchema);
