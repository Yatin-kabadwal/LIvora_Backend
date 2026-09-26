import mongoose, { Document, Schema } from "mongoose";

export type RoomStatus = "available" | "occupied" | "housekeeping" | "maintenance";

export interface IRoom extends Document {
  roomNumber: string;
  name: string;
  slug: string;
  type: string; // deluxe | premium | suite | family | villa (free text friendly)
  floor: number;
  status: RoomStatus;
  pricePerNight: number;
  maxAdults: number;
  maxChildren: number;
  bedType: string;
  view: string;
  size?: number;
  amenities: string[];
  highlights: string[];
  imageUrls: string[];
  description?: string;
  isActive: boolean;
  sortOrder: number;
}

const roomSchema = new Schema<IRoom>(
  {
    roomNumber: { type: String, required: true, unique: true, trim: true },
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    type: { type: String, required: true, lowercase: true, trim: true },
    floor: { type: Number, default: 0 },
    status: { type: String, enum: ["available", "occupied", "housekeeping", "maintenance"], default: "available" },
    pricePerNight: { type: Number, required: true, min: 0 },
    maxAdults: { type: Number, default: 2, min: 1 },
    maxChildren: { type: Number, default: 1, min: 0 },
    bedType: { type: String, default: "King" },
    view: { type: String, default: "Forest" },
    size: { type: Number },
    amenities: { type: [String], default: [] },
    highlights: { type: [String], default: [] },
    imageUrls: { type: [String], default: [] },
    description: { type: String },
    isActive: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true }
);

roomSchema.index({ isActive: 1, sortOrder: 1 });

export default mongoose.model<IRoom>("Room", roomSchema);
