import mongoose, { Document, Schema } from "mongoose";
import bcrypt from "bcryptjs";

export type Role = "guest" | "staff" | "manager" | "admin";

export interface IUser extends Document {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  password: string;
  role: Role;
  department?: string;
  employeeId?: string;
  isActive: boolean;
  lastLogin?: Date;
  refreshTokens: { hash: string; expiresAt: Date }[];
  resetTokenHash?: string;
  resetTokenExpires?: Date;
  createdAt: Date;
  updatedAt: Date;
  comparePassword(password: string): Promise<boolean>;
}

const userSchema = new Schema<IUser>(
  {
    firstName: { type: String, required: true, trim: true, maxlength: 60 },
    lastName: { type: String, default: "", trim: true, maxlength: 60 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    phone: { type: String, default: "", trim: true },
    password: { type: String, required: true, minlength: 8, select: false },
    role: { type: String, enum: ["guest", "staff", "manager", "admin"], default: "guest" },
    department: { type: String },
    employeeId: { type: String },
    isActive: { type: Boolean, default: true },
    lastLogin: { type: Date },
    refreshTokens: { type: [{ hash: String, expiresAt: Date }], default: [], select: false },
    resetTokenHash: { type: String, select: false },
    resetTokenExpires: { type: Date, select: false },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (_d, ret: any) => {
        delete ret.password;
        delete ret.refreshTokens;
        delete ret.resetTokenHash;
        delete ret.resetTokenExpires;
        delete ret.__v;
        return ret;
      },
    },
  }
);

userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

userSchema.methods.comparePassword = function (password: string) {
  return bcrypt.compare(password, this.password);
};

userSchema.index({ role: 1, isActive: 1 });

export default mongoose.model<IUser>("User", userSchema);
