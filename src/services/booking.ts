import mongoose from "mongoose";
import Booking, { IBooking } from "../models/Booking";
import Room, { IRoom } from "../models/Room";
import RoomNight from "../models/RoomNight";
import { Promotion } from "../models/Misc";
import { buildQuote } from "./pricing";
import { eachNight, todayIST } from "../utils/dates";
import { ApiError } from "../utils/http";
import { getSettings } from "./settings";

export interface CreateBookingInput {
  room: IRoom;
  checkIn: Date;
  checkOut: Date;
  adults: number;
  children: number;
  mealPlan: string;
  promoCode?: string;
  specialRequests?: string;
  guest: { name: string; email: string; phone: string; userId?: string };
  source: IBooking["source"];
  createdBy?: string;
  allowPast?: boolean;
}

export async function createBooking(input: CreateBookingInput): Promise<IBooking> {
  const { room, checkIn, checkOut } = input;
  const settings = await getSettings();
  if (!room.isActive) throw new ApiError(400, "This room is not available for booking");
  if (input.source !== "walk_in" && input.source !== "phone" && !settings.bookingsOpen) {
    throw new ApiError(503, "Online bookings are temporarily paused. Please call us to reserve.");
  }
  if (!input.allowPast && checkIn < todayIST()) throw new ApiError(400, "Check-in date cannot be in the past");
  if (input.adults > room.maxAdults) throw new ApiError(400, `This room hosts up to ${room.maxAdults} adults`);
  if (input.children > room.maxChildren) throw new ApiError(400, `This room hosts up to ${room.maxChildren} children`);

  const quote = await buildQuote(room, checkIn, checkOut, input.adults, input.children, input.mealPlan, input.promoCode);

  const bookingId = new mongoose.Types.ObjectId();
  const nights = eachNight(checkIn, checkOut).map((night) => ({ roomId: room._id, night, bookingId }));

  // Reserve inventory first: the unique (roomId, night) index rejects double-bookings atomically.
  try {
    await RoomNight.insertMany(nights, { ordered: true });
  } catch (err: any) {
    await RoomNight.deleteMany({ bookingId }).catch(() => undefined);
    if (err?.code === 11000 || err?.writeErrors) throw new ApiError(409, "Sorry, this room was just booked for some of those dates. Please pick different dates.");
    throw err;
  }

  try {
    const booking = new Booking({
      _id: bookingId,
      roomId: room._id,
      roomNumber: room.roomNumber,
      roomName: room.name,
      roomType: room.type,
      guestId: input.guest.userId,
      guestName: input.guest.name,
      guestEmail: input.guest.email,
      guestPhone: input.guest.phone,
      checkIn,
      checkOut,
      nights: quote.nights,
      adults: input.adults,
      children: input.children,
      mealPlan: input.mealPlan,
      specialRequests: input.specialRequests,
      pricePerNight: room.pricePerNight,
      roomAmount: quote.roomAmount,
      mealAmount: quote.mealAmount,
      discountAmount: quote.discountAmount,
      promoCode: quote.promoCode,
      gstRate: quote.gstRate,
      totalAmount: quote.total,
      source: input.source,
      createdBy: input.createdBy,
    });
    booking.recalc();
    await booking.save();
    if (quote.promoCode) await Promotion.updateOne({ code: quote.promoCode }, { $inc: { usedCount: 1 } });
    return booking;
  } catch (err) {
    await RoomNight.deleteMany({ bookingId }).catch(() => undefined);
    throw err;
  }
}

export async function releaseInventory(bookingId: mongoose.Types.ObjectId | string, fromDay?: Date) {
  const q: any = { bookingId };
  if (fromDay) q.night = { $gte: fromDay };
  await RoomNight.deleteMany(q);
}

export async function availableRoomIds(checkIn: Date, checkOut: Date): Promise<Set<string>> {
  const rooms = await Room.find({ isActive: true }).select("_id");
  const held = await RoomNight.distinct("roomId", { night: { $gte: checkIn, $lt: checkOut } });
  const heldSet = new Set(held.map(String));
  return new Set(rooms.map((r) => String(r._id)).filter((id) => !heldSet.has(id)));
}
