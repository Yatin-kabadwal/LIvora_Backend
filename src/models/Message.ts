import mongoose, { Document, Schema } from "mongoose";

export interface IThreadMessage {
  _id?: mongoose.Types.ObjectId;
  sender: "guest" | "staff";
  body: string;
  staffId?: mongoose.Types.ObjectId;
  staffName?: string;
  at: Date;
}

export interface IMessageThread extends Document {
  ref: string;
  name: string;
  email: string;
  phone?: string;
  subject: string;
  topic: "general" | "booking" | "event" | "feedback" | "complaint" | "other";
  userId?: mongoose.Types.ObjectId;
  publicToken: string;
  status: "new" | "open" | "resolved";
  unreadByStaff: number;
  unreadByGuest: number;
  assignedTo?: mongoose.Types.ObjectId;
  messages: IThreadMessage[];
  lastMessageAt: Date;
  source: "website" | "app";
  createdAt: Date;
}

const messageSchema = new Schema<IMessageThread>(
  {
    ref: { type: String, unique: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    email: { type: String, required: true, lowercase: true, trim: true },
    phone: { type: String, trim: true },
    subject: { type: String, required: true, trim: true, maxlength: 200 },
    topic: { type: String, enum: ["general", "booking", "event", "feedback", "complaint", "other"], default: "general" },
    userId: { type: Schema.Types.ObjectId, ref: "User" },
    publicToken: { type: String, required: true, unique: true },
    status: { type: String, enum: ["new", "open", "resolved"], default: "new" },
    unreadByStaff: { type: Number, default: 0 },
    unreadByGuest: { type: Number, default: 0 },
    assignedTo: { type: Schema.Types.ObjectId, ref: "User" },
    messages: {
      type: [
        {
          sender: { type: String, enum: ["guest", "staff"], required: true },
          body: { type: String, required: true, maxlength: 4000 },
          staffId: { type: Schema.Types.ObjectId, ref: "User" },
          staffName: String,
          at: { type: Date, default: Date.now },
        },
      ],
      default: [],
    },
    lastMessageAt: { type: Date, default: Date.now },
    source: { type: String, enum: ["website", "app"], default: "website" },
  },
  { timestamps: true }
);

messageSchema.index({ status: 1, lastMessageAt: -1 });
messageSchema.index({ userId: 1, lastMessageAt: -1 });
messageSchema.index({ email: 1 });

export default mongoose.model<IMessageThread>("MessageThread", messageSchema);
