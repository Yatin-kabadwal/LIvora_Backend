import { IRoom } from "../models/Room";
import { IPromotion, Promotion } from "../models/Misc";
import { getSettings } from "./settings";
import { diffDays } from "../utils/dates";
import { ApiError } from "../utils/http";

/** GST slab for accommodation in India: tariff up to ₹7,500/night = 12%, above = 18%. Prices are GST-inclusive. */
export const gstRateFor = (pricePerNight: number) => (pricePerNight > 7500 ? 0.18 : 0.12);

export interface Quote {
  nights: number;
  pricePerNight: number;
  roomAmount: number;
  mealAmount: number;
  discountAmount: number;
  promoCode?: string;
  promoMessage?: string;
  total: number;
  baseAmount: number;
  gstRate: number;
  gstAmount: number;
}

export async function findValidPromo(
  code: string,
  ctx: { nights: number; amount: number; roomType: string }
): Promise<{ promo?: IPromotion; discount: number; message?: string }> {
  const now = new Date();
  const promo = await Promotion.findOne({ code: code.trim().toUpperCase(), isActive: true, validFrom: { $lte: now }, validTo: { $gte: now } });
  if (!promo) return { discount: 0, message: "Invalid or expired promo code" };
  if (promo.usedCount >= promo.maxUses) return { discount: 0, message: "This offer has reached its usage limit" };
  if (promo.minNights && ctx.nights < promo.minNights) return { discount: 0, message: `Minimum ${promo.minNights} nights required` };
  if (promo.minAmount && ctx.amount < promo.minAmount) return { discount: 0, message: `Minimum booking of ₹${promo.minAmount} required` };
  if (promo.applicableRoomTypes?.length && !promo.applicableRoomTypes.includes(ctx.roomType)) {
    return { discount: 0, message: "This offer is not valid for the selected room" };
  }
  let discount = promo.discountType === "percentage" ? (ctx.amount * promo.discountValue) / 100 : promo.discountValue;
  if (promo.maxDiscountAmount) discount = Math.min(discount, promo.maxDiscountAmount);
  discount = Math.round(Math.min(discount, ctx.amount));
  return { promo, discount, message: `${promo.name} applied` };
}

export async function buildQuote(
  room: IRoom,
  checkIn: Date,
  checkOut: Date,
  adults: number,
  children: number,
  mealPlan: string,
  promoCode?: string
): Promise<Quote> {
  const nights = diffDays(checkIn, checkOut);
  if (nights <= 0) throw new ApiError(400, "Check-out must be after check-in");
  if (nights > 30) throw new ApiError(400, "Maximum stay is 30 nights. Please contact us for longer stays.");

  const settings = await getSettings();
  const plan = settings.mealPlans.find((m) => m.code === mealPlan);
  if (!plan) throw new ApiError(400, "Invalid meal plan");

  const roomAmount = room.pricePerNight * nights;
  const mealAmount = (plan.adultPrice * adults + plan.childPrice * children) * nights;
  const gross = roomAmount + mealAmount;

  let discountAmount = 0;
  let appliedCode: string | undefined;
  let promoMessage: string | undefined;
  if (promoCode) {
    const r = await findValidPromo(promoCode, { nights, amount: gross, roomType: room.type });
    promoMessage = r.message;
    if (r.promo) {
      discountAmount = r.discount;
      appliedCode = r.promo.code;
    }
  }

  const total = Math.max(0, gross - discountAmount);
  const gstRate = gstRateFor(room.pricePerNight);
  const baseAmount = Math.round(total / (1 + gstRate));
  return {
    nights,
    pricePerNight: room.pricePerNight,
    roomAmount,
    mealAmount,
    discountAmount,
    promoCode: appliedCode,
    promoMessage,
    total,
    baseAmount,
    gstRate,
    gstAmount: total - baseAmount,
  };
}
