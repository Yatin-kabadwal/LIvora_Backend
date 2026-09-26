import mongoose, { Document, Schema } from "mongoose";

/**
 * One document per (room, night) that is held by a booking.
 * The unique index makes double-booking impossible even under concurrent requests.
 */
export interface IRoomNight extends Document {
  roomId: mongoose.Types.ObjectId;
  night: Date;
  bookingId: mongoose.Types.ObjectId;
}

const schema = new Schema<IRoomNight>({
  roomId: { type: Schema.Types.ObjectId, ref: "Room", required: true },
  night: { type: Date, required: true },
  bookingId: { type: Schema.Types.ObjectId, ref: "Booking", required: true },
});

schema.index({ roomId: 1, night: 1 }, { unique: true });
schema.index({ bookingId: 1 });
schema.index({ night: 1 });

export default mongoose.model<IRoomNight>("RoomNight", schema);
