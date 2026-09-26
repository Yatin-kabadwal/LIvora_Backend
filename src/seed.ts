/**
 * Idempotent seed: safe to run many times. It only creates what is missing.
 *   npm run seed            (local)
 *   npm run build && npm run seed:prod   (production, e.g. from the Render Shell)
 * Set SEED_FORCE_PASSWORDS=1 to reset the admin/staff passwords to the values in the env.
 */
import mongoose from "mongoose";
import { env } from "./config/env";
import User from "./models/User";
import Room from "./models/Room";
import { MenuItem, Promotion, Settings } from "./models/Misc";
import { DEFAULT_SETTINGS } from "./services/settings";

const rooms = [
  // ---- Sal Forest Deluxe (4) ----
  ...[["101", 1], ["102", 1], ["103", 2], ["104", 2]].map(([n, f], i) => ({
    roomNumber: n as string, floor: f as number, name: `Sal Forest Deluxe ${i + 1}`, slug: `sal-forest-deluxe-${i + 1}`, type: "deluxe",
    pricePerNight: 4500, maxAdults: 2, maxChildren: 1, bedType: "King", view: "Sal forest", size: 320, sortOrder: 10 + i,
    amenities: ["Air conditioning", "High-speed WiFi", "Smart TV", "Private balcony", "Rain shower", "Tea & coffee station", "Room heater", "24h hot water"],
    highlights: ["Wake up to birdsong", "Private balcony facing the Sal forest", "Handcrafted teak furniture"],
    imageUrls: ["/photos/rooms/deluxe-1.jpg", "/photos/rooms/deluxe-2.jpg", "/photos/rooms/deluxe-3.jpg"],
    description: "A calm, warm room dressed in earthy tones with a private balcony that opens straight onto the Sal forest. Perfect for couples who want to unplug.",
  })),
  // ---- Kosi Riverside Premium (2) ----
  ...[["201", 2], ["202", 2]].map(([n, f], i) => ({
    roomNumber: n as string, floor: f as number, name: `Kosi Riverside Premium ${i + 1}`, slug: `kosi-riverside-premium-${i + 1}`, type: "premium",
    pricePerNight: 6500, maxAdults: 3, maxChildren: 1, bedType: "King + Sofa bed", view: "River & hills", size: 400, sortOrder: 20 + i,
    amenities: ["Air conditioning", "High-speed WiFi", "55\" Smart TV", "Large balcony", "Bathtub", "Minibar", "Espresso machine", "Room heater", "Bathrobes"],
    highlights: ["Sweeping view of the river and hills", "Freestanding soaking tub", "Sunrise-facing balcony"],
    imageUrls: ["/photos/rooms/premium-1.jpg", "/photos/rooms/premium-2.jpg", "/photos/rooms/premium-3.jpg"],
    description: "Generous, light-filled rooms that look over the river valley. A deep soaking tub and a wide balcony make slow mornings the whole point.",
  })),
  // ---- Jungle Canopy Suites (2) ----
  ...[["301", 3], ["302", 3]].map(([n, f], i) => ({
    roomNumber: n as string, floor: f as number, name: `Jungle Canopy Suite ${i + 1}`, slug: `jungle-canopy-suite-${i + 1}`, type: "suite",
    pricePerNight: 9500, maxAdults: 3, maxChildren: 2, bedType: "King", view: "Forest canopy", size: 560, sortOrder: 30 + i,
    amenities: ["Air conditioning", "High-speed WiFi", "65\" Smart TV", "Separate living room", "Jacuzzi", "Wraparound balcony", "Minibar", "Espresso machine", "Bathrobes", "Butler on call"],
    highlights: ["Eye-level with the forest canopy", "In-suite jacuzzi", "Separate lounge and dining nook"],
    imageUrls: ["/photos/rooms/suite-1.jpg", "/photos/rooms/suite-2.jpg", "/photos/rooms/suite-3.jpg"],
    description: "Our top-floor suites sit level with the treetops. A private lounge, jacuzzi and a wraparound balcony turn every hour into an occasion.",
  })),
  // ---- Family Cottage (1) ----
  {
    roomNumber: "F01", floor: 0, name: "Vedant Family Cottage", slug: "vedant-family-cottage", type: "family",
    pricePerNight: 8500, maxAdults: 4, maxChildren: 3, bedType: "King + 2 Twin", view: "Garden", size: 620, sortOrder: 40,
    amenities: ["Air conditioning", "High-speed WiFi", "Smart TV", "Two bedrooms", "Private garden sit-out", "Kitchenette", "Room heater", "Board games"],
    highlights: ["Two bedrooms and a lounge", "Private garden sit-out", "Made for families and small groups"],
    imageUrls: ["/photos/rooms/family-1.jpg", "/photos/rooms/family-2.jpg", "/photos/rooms/family-3.jpg"],
    description: "A standalone cottage with two bedrooms, a lounge and its own garden. Space for everyone to spread out, close enough to be together.",
  },
  // ---- Signature Villa (1) ----
  {
    roomNumber: "V01", floor: 0, name: "The Vedant Signature Villa", slug: "vedant-signature-villa", type: "villa",
    pricePerNight: 14500, maxAdults: 4, maxChildren: 2, bedType: "2 King", view: "Private forest lawn", size: 980, sortOrder: 50,
    amenities: ["Air conditioning", "High-speed WiFi", "Private plunge pool", "Private lawn & fire pit", "Two bedrooms", "Living & dining", "Butler service", "Minibar", "Espresso machine", "Bathrobes"],
    highlights: ["Private plunge pool", "Fire pit on your own forest lawn", "Dedicated butler"],
    imageUrls: ["/photos/rooms/villa-1.jpg", "/photos/rooms/villa-2.jpg", "/photos/rooms/villa-3.jpg"],
    description: "Our one-of-a-kind villa: two king bedrooms, a private plunge pool and a fire-pit lawn that meets the forest edge. The most private stay in Corbett.",
  },
];

const menu = [
  // Breakfast
  ["Breakfast", "Aloo Paratha Platter", "Two stuffed parathas, white butter, curd and pickle.", 260, true, true],
  ["Breakfast", "Masala Omelette", "Farm eggs, green chilli, onion and coriander with toast.", 220, false, false],
  ["Breakfast", "Poha & Jalebi", "Light Indori-style poha with hot jalebi.", 200, true, false],
  // Mains
  ["Mains", "Kumaoni Bhatt Ki Churkani", "Slow-cooked black soybean curry, a Kumaoni classic, with rice.", 380, true, true],
  ["Mains", "Butter Chicken", "Charcoal-grilled chicken in tomato butter gravy.", 520, false, false],
  ["Mains", "Paneer Lababdar", "Cottage cheese in a rich tomato-onion gravy.", 440, true, false],
  ["Mains", "Dal Makhani", "Overnight-simmered black lentils finished with cream.", 360, true, false],
  ["Mains", "Mahseer-style Tandoori Fish", "River-style spiced fish from the tandoor.", 620, false, true],
  // Snacks
  ["Snacks", "Mandua Momos", "Finger millet momos, Kumaoni bhang chutney.", 280, true, true],
  ["Snacks", "Crispy Corn Chaat", "Crispy sweet corn, chaat masala and lime.", 240, true, false],
  ["Snacks", "Chicken Tikka", "Yoghurt-marinated chicken, char-grilled.", 420, false, false],
  ["Snacks", "Masala Fries", "Hand-cut fries with peri-peri spice.", 200, true, false],
  // Beverages
  ["Beverages", "Masala Chai", "Kettle chai with ginger and cardamom.", 90, true, false],
  ["Beverages", "Fresh Lime Soda", "Sweet, salted or mixed.", 120, true, false],
  ["Beverages", "Cold Coffee", "Chilled coffee with vanilla ice cream.", 180, true, false],
  // Desserts
  ["Desserts", "Gulab Jamun (2 pc)", "Warm, with saffron syrup.", 150, true, false],
  ["Desserts", "Bal Mithai", "Kumaon's famous fudge coated in sugar balls.", 180, true, true],
  ["Desserts", "Chocolate Brownie", "Warm brownie with vanilla ice cream.", 240, true, false],
] as const;

export async function seedDatabase(force = process.env.SEED_FORCE_PASSWORDS === "1") {

  for (const [email, password, first, last, role, dept, emp] of [
    [env.SEED_ADMIN_EMAIL, env.SEED_ADMIN_PASSWORD, "Livora", "Admin", "admin", "Management", "EMP001"],
    [env.SEED_STAFF_EMAIL, env.SEED_STAFF_PASSWORD, "Front", "Desk", "staff", "Front Desk", "EMP002"],
  ] as const) {
    const existing = await User.findOne({ email: email.toLowerCase() }).select("+password");
    if (!existing) {
      await User.create({ firstName: first, lastName: last, email: email.toLowerCase(), password, role, department: dept, employeeId: emp, phone: "9528827446" });
      console.log(`✅ Created ${role}: ${email}`);
    } else if (force) {
      existing.password = password;
      existing.role = role as any;
      existing.isActive = true;
      await existing.save();
      console.log(`🔑 Reset password for ${email}`);
    } else {
      console.log(`ℹ️  ${role} exists: ${email}`);
    }
  }

  let created = 0;
  for (const r of rooms) {
    if (!(await Room.exists({ roomNumber: r.roomNumber }))) { await Room.create(r); created++; }
  }
  console.log(`✅ Rooms: ${created} created, ${rooms.length - created} already present (total ${await Room.countDocuments()})`);

  if ((await MenuItem.countDocuments()) === 0) {
    await MenuItem.insertMany(menu.map(([category, name, description, price, isVeg, isSignature], i) => ({ category, name, description, price, isVeg, isSignature, sortOrder: i })));
    console.log(`✅ Menu: ${menu.length} items`);
  }

  if (!(await Settings.exists({ key: "main" }))) {
    await Settings.create(DEFAULT_SETTINGS);
    console.log("✅ Resort settings created");
  }

  if (!(await Promotion.exists({ code: "WELCOME10" }))) {
    const now = new Date();
    await Promotion.create({
      code: "WELCOME10", name: "Welcome Offer", description: "10% off your first stay when you book 2 nights or more.",
      discountType: "percentage", discountValue: 10, minNights: 2, maxDiscountAmount: 3000, validFrom: now,
      validTo: new Date(now.getFullYear() + 1, now.getMonth(), now.getDate()), maxUses: 500,
    });
    console.log("✅ Promo WELCOME10 created");
  }

  console.log("\n🌿 Seed complete.");
}

// `npm run seed` / `npm run seed:prod` — connect, seed, disconnect.
if (require.main === module) {
  (async () => {
    await mongoose.connect(env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 });
    console.log("Connected to MongoDB");
    await mongoose.syncIndexes();
    await seedDatabase();
    await mongoose.disconnect();
  })().catch((e) => { console.error("Seed failed:", e); process.exit(1); });
}
