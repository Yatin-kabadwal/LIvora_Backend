import { Server as HttpServer } from "http";
import { Server as SocketServer, Socket } from "socket.io";
import jwt from "jsonwebtoken";
import { env, allowedOrigins } from "./config/env";

let io: SocketServer | undefined;

export function initSocket(httpServer: HttpServer) {
  io = new SocketServer(httpServer, {
    cors: { origin: allowedOrigins, credentials: true },
    pingTimeout: 30000,
  });

  io.use((socket: Socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) return next(new Error("Authentication required"));
    try {
      const decoded = jwt.verify(token, env.JWT_SECRET) as any;
      (socket as any).user = decoded;
      next();
    } catch {
      next(new Error("Invalid token"));
    }
  });

  io.on("connection", (socket: Socket) => {
    const user = (socket as any).user;
    socket.join(`user:${user.id}`);
    if (["staff", "manager", "admin"].includes(user.role)) socket.join("staff");
  });
  return io;
}

const toStaff = (event: string, data: unknown) => io?.to("staff").emit(event, data);
const toUser = (id: unknown, event: string, data: unknown) => id && io?.to(`user:${String(id)}`).emit(event, data);

export const emit = {
  bookingNew: (b: any) => toStaff("booking:new", b),
  bookingUpdate: (b: any) => { toStaff("booking:update", b); toUser(b.guestId, "booking:update", b); },
  messageNew: (t: any) => toStaff("message:new", t),
  messageUpdate: (t: any) => { toStaff("message:update", t); toUser(t.userId, "message:update", t); },
  roomServiceNew: (r: any) => toStaff("roomservice:new", r),
  roomServiceUpdate: (r: any) => { toStaff("roomservice:update", r); toUser(r.guestId, "roomservice:update", r); },
  housekeepingUpdate: (h: any) => toStaff("housekeeping:update", h),
};
