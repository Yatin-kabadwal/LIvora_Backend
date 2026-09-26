import { Resend } from "resend";
import { env, primaryGuestUrl, primaryAdminUrl } from "../config/env";
import { getSettings } from "./settings";
import { IBooking } from "../models/Booking";
import { IMessageThread } from "../models/Message";

const resend = env.RESEND_API_KEY ? new Resend(env.RESEND_API_KEY) : null;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");
const fmt = (d: Date) => d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });

function shell(title: string, body: string, resortName: string) {
  return `<!doctype html><html><body style="margin:0;background:#0b1410;padding:24px;font-family:Segoe UI,Helvetica,Arial,sans-serif;">
  <div style="max-width:560px;margin:0 auto;background:#111d17;border:1px solid #23392d;border-radius:18px;overflow:hidden;">
    <div style="padding:28px 32px;background:linear-gradient(135deg,#1c3a2b,#0f1f17);border-bottom:1px solid #23392d;">
      <div style="font-size:11px;letter-spacing:.32em;color:#d9b76a;text-transform:uppercase;">${esc(resortName)}</div>
      <div style="font-size:24px;color:#f4efe2;margin-top:8px;font-family:Georgia,serif;">${esc(title)}</div>
    </div>
    <div style="padding:28px 32px;color:#cfd9d1;font-size:15px;line-height:1.65;">${body}</div>
    <div style="padding:18px 32px;border-top:1px solid #23392d;color:#7d9084;font-size:12px;">
      Sent with care by ${esc(resortName)}. Reply to this email or call us any time.
    </div>
  </div></body></html>`;
}

const btn = (href: string, label: string) =>
  `<p style="margin:24px 0 0"><a href="${href}" style="display:inline-block;background:#d9b76a;color:#10231a;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:999px;">${esc(label)}</a></p>`;

export async function sendMail(to: string | string[], subject: string, html: string, replyTo?: string) {
  if (!resend) {
    console.log(`[email:disabled] to=${Array.isArray(to) ? to.join(",") : to} subject="${subject}"`);
    return false;
  }
  try {
    const { error } = await resend.emails.send({ from: env.EMAIL_FROM, to, subject, html, ...(replyTo ? { replyTo } : {}) });
    if (error) {
      console.error("[email] Resend error:", error.message || error);
      return false;
    }
    return true;
  } catch (err: any) {
    console.error("[email] send failed:", err?.message || err);
    return false;
  }
}

export async function emailBookingConfirmation(b: IBooking) {
  const s = await getSettings();
  const body = `
    <p>Dear ${esc(b.guestName)},</p>
    <p>Your stay is confirmed. We can't wait to welcome you to the forest.</p>
    <table style="width:100%;border-collapse:collapse;margin:18px 0;color:#f4efe2;font-size:14px;">
      <tr><td style="padding:8px 0;color:#7d9084;">Booking ref</td><td style="text-align:right;font-weight:600;">${esc(b.bookingRef)}</td></tr>
      <tr><td style="padding:8px 0;color:#7d9084;">Room</td><td style="text-align:right;">${esc(b.roomName || b.roomType)}</td></tr>
      <tr><td style="padding:8px 0;color:#7d9084;">Check-in</td><td style="text-align:right;">${fmt(b.checkIn)} from ${esc(s.checkInTime)}</td></tr>
      <tr><td style="padding:8px 0;color:#7d9084;">Check-out</td><td style="text-align:right;">${fmt(b.checkOut)} by ${esc(s.checkOutTime)}</td></tr>
      <tr><td style="padding:8px 0;color:#7d9084;">Guests</td><td style="text-align:right;">${b.adults} adult(s), ${b.children} child(ren)</td></tr>
      <tr><td style="padding:8px 0;color:#7d9084;">Total (incl. GST)</td><td style="text-align:right;font-weight:600;">${inr(b.totalAmount)}</td></tr>
    </table>
    <p>Payment is collected at the property. Free cancellation up to ${s.cancellationHours} hours before check-in.</p>
    ${btn(`${primaryGuestUrl}/booking/manage?ref=${encodeURIComponent(b.bookingRef)}&email=${encodeURIComponent(b.guestEmail)}`, "View or manage booking")}
    <p style="margin-top:22px;">Questions? Call <b>${esc(s.phone)}</b>.</p>`;
  return sendMail(b.guestEmail, `Booking confirmed · ${b.bookingRef}`, shell("Your stay is confirmed", body, s.resortName), s.email);
}

export async function emailStaffNewBooking(b: IBooking) {
  const s = await getSettings();
  const body = `<p><b>${esc(b.guestName)}</b> (${esc(b.guestPhone)}) booked <b>${esc(b.roomName || b.roomType)}</b>.</p>
  <p>${fmt(b.checkIn)} → ${fmt(b.checkOut)} · ${b.nights} night(s) · ${inr(b.totalAmount)}<br/>Ref: ${esc(b.bookingRef)} · Source: ${esc(b.source)}</p>
  ${btn(`${primaryAdminUrl}/bookings`, "Open in admin")}`;
  return sendMail(env.NOTIFY_EMAIL, `New booking ${b.bookingRef}`, shell("New booking received", body, s.resortName));
}

export async function emailBookingCancelled(b: IBooking) {
  const s = await getSettings();
  const body = `<p>Dear ${esc(b.guestName)},</p><p>Your booking <b>${esc(b.bookingRef)}</b> (${fmt(b.checkIn)} → ${fmt(b.checkOut)}) has been cancelled.</p>
  <p>If this wasn't you or you'd like to rebook, just reply to this email.</p>`;
  return sendMail(b.guestEmail, `Booking cancelled · ${b.bookingRef}`, shell("Booking cancelled", body, s.resortName), s.email);
}

export async function emailThreadAck(t: IMessageThread) {
  const s = await getSettings();
  const link = `${primaryGuestUrl}/messages/${t.publicToken}`;
  const body = `<p>Hi ${esc(t.name)},</p><p>Thank you for writing to us. We received your message and a member of our team will reply shortly, usually within a few hours.</p>
  <p style="padding:14px 16px;border-left:3px solid #d9b76a;background:#0d1712;color:#f4efe2;">${esc(t.messages[0]?.body || "").replace(/\n/g, "<br/>")}</p>
  ${btn(link, "View conversation")}
  <p style="margin-top:20px;">For anything urgent, call <b>${esc(s.phone)}</b>.</p>`;
  return sendMail(t.email, `We received your message · ${t.ref}`, shell("Message received", body, s.resortName), s.email);
}

export async function emailStaffNewMessage(t: IMessageThread) {
  const s = await getSettings();
  const body = `<p><b>${esc(t.name)}</b> &lt;${esc(t.email)}&gt; ${t.phone ? "· " + esc(t.phone) : ""}<br/>Topic: ${esc(t.topic)}</p>
  <p style="padding:14px 16px;border-left:3px solid #d9b76a;background:#0d1712;color:#f4efe2;">${esc(t.messages[t.messages.length - 1]?.body || "").replace(/\n/g, "<br/>")}</p>
  ${btn(`${primaryAdminUrl}/messages?open=${t._id}`, "Reply in admin")}`;
  return sendMail(env.NOTIFY_EMAIL, `New message: ${t.subject}`, shell("New guest message", body, s.resortName), t.email);
}

export async function emailGuestReply(t: IMessageThread, body: string, staffName: string) {
  const s = await getSettings();
  const link = `${primaryGuestUrl}/messages/${t.publicToken}`;
  const html = `<p>Hi ${esc(t.name)},</p>
  <p style="padding:14px 16px;border-left:3px solid #d9b76a;background:#0d1712;color:#f4efe2;">${esc(body).replace(/\n/g, "<br/>")}</p>
  <p style="color:#7d9084;">— ${esc(staffName)}, ${esc(s.resortName)}</p>
  ${btn(link, "Reply online")}`;
  return sendMail(t.email, `Re: ${t.subject}`, shell("A reply from our team", html, s.resortName), s.email);
}

export async function emailPasswordReset(to: string, name: string, token: string, area: "guest" | "admin") {
  const s = await getSettings();
  const base = area === "admin" ? primaryAdminUrl : primaryGuestUrl;
  const link = `${base}/auth/reset-password?token=${token}`;
  const body = `<p>Hi ${esc(name)},</p><p>We received a request to reset your password. This link works for 30 minutes.</p>${btn(link, "Reset password")}
  <p style="margin-top:20px;color:#7d9084;">If you didn't ask for this, you can safely ignore this email.</p>`;
  return sendMail(to, "Reset your password", shell("Password reset", body, s.resortName));
}

export async function emailWelcome(to: string, name: string) {
  const s = await getSettings();
  const body = `<p>Welcome, ${esc(name)}.</p><p>Your guest account is ready. Book faster, track your stays and message our team anytime.</p>${btn(primaryGuestUrl + "/rooms", "Explore rooms")}`;
  return sendMail(to, `Welcome to ${s.resortName}`, shell("Welcome", body, s.resortName));
}
