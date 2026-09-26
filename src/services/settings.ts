import { Settings, ISettings } from "../models/Misc";
import { env } from "../config/env";

export const DEFAULT_SETTINGS = {
  key: "main",
  resortName: env.RESORT_NAME,
  tagline: "A forest sanctuary at the edge of Jim Corbett",
  phone: "+91 95288 27446",
  whatsapp: "919528827446",
  email: "Livorahospitality06@gmail.com",
  address: "Corbett The Vedant By Livora, Jim Corbett National Park belt, Uttarakhand, India",
  mapsUrl: "https://maps.app.goo.gl/cEp1Z3fmkQMXzEau8",
  mapsEmbedUrl: "",
  checkInTime: "14:00",
  checkOutTime: "11:00",
  cancellationHours: 48,
  gstNumber: env.RESORT_GST_NUMBER,
  mealPlans: [
    { code: "ep", label: "Room Only", adultPrice: 0, childPrice: 0, description: "Stay only. Dine à la carte at Vedant Kitchen." },
    { code: "cp", label: "Breakfast Included", adultPrice: 600, childPrice: 300, description: "Daily breakfast for every guest." },
    { code: "map", label: "Breakfast + Dinner", adultPrice: 1400, childPrice: 700, description: "Breakfast and dinner, fixed menu." },
    { code: "ap", label: "All Meals", adultPrice: 2000, childPrice: 1000, description: "Breakfast, lunch and dinner." },
  ],
  social: { instagram: "", facebook: "", youtube: "" },
  bookingsOpen: true,
  announcement: "",
};

let cache: { at: number; doc: any } | null = null;

export async function getSettings(): Promise<ISettings> {
  if (cache && Date.now() - cache.at < 30_000) return cache.doc;
  let doc = await Settings.findOne({ key: "main" });
  if (!doc) doc = await Settings.create(DEFAULT_SETTINGS);
  cache = { at: Date.now(), doc };
  return doc;
}

export function clearSettingsCache() {
  cache = null;
}
