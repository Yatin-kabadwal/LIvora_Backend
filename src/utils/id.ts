import crypto from "crypto";

export const randomToken = (bytes = 24) => crypto.randomBytes(bytes).toString("hex");
export const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
