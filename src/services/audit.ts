import { Request } from "express";
import { AuditLog } from "../models/Misc";

export function audit(req: Request & { user?: any }, action: string, entity: string, entityId?: string, meta?: any) {
  AuditLog.create({
    userId: req.user?.id,
    userEmail: req.user?.email,
    action,
    entity,
    entityId,
    meta,
    ip: req.ip,
  }).catch(() => undefined);
}
