import { E164_REGEX } from '@diary/shared';

/* Phone numbers arrive from device contacts in every shape a human ever typed: "600 12 34 56",
   "+34-600-123456", "(0034) 600 123 456". We normalize the formatting but deliberately never
   *guess* a country code — inventing one would silently point a WhatsApp chat at a stranger.
   A number without a country code stays as-is and the UI flags it as incomplete. */

/** Strip formatting. A leading `00` (international access code) becomes `+`. */
export function normalizePhone(raw: string): string {
  const compact = raw.replace(/[^\d+]/g, '');
  const digits = compact.replace(/\+/g, '');
  if (compact.startsWith('00')) return `+${digits.slice(2)}`;
  return compact.startsWith('+') ? `+${digits}` : digits;
}

/** The number as a full international one, or `null` when it isn't (or can't be known to be) one. */
export function toE164(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const normalized = normalizePhone(phone);
  return E164_REGEX.test(normalized) ? normalized : null;
}

/** True when a phone is present but we can't turn it into a full international number. */
export const isIncompletePhone = (phone: string | null | undefined): boolean =>
  !!phone?.trim() && toE164(phone) === null;

/** wa.me expects the digits only, no `+`. Null when the number isn't international. */
export function whatsappLink(phone: string | null | undefined): string | null {
  const e164 = toE164(phone);
  return e164 ? `https://wa.me/${e164.slice(1)}` : null;
}

/** Calling works with whatever the contact holds — the dialer copes with local numbers. */
export const telLink = (phone: string): string => `tel:${normalizePhone(phone)}`;

export const mailtoLink = (email: string): string => `mailto:${email.trim()}`;

/*
 * WeChat has no public deep link that opens a chat with a given person.
 *
 * `weixin://dl/...` only exposes a handful of fixed destinations (the app itself, the scanner,
 * Moments…) — there is no documented `chat?id=` form, and passing one lands on WeChat's own
 * "Sorry, this page is not available." A person's real WeChat QR encodes an opaque server-issued
 * token (`http://weixin.qq.com/r/…`), which cannot be derived from their WeChat ID.
 *
 * So the honest best is: open the app and put the ID on the clipboard, ready to paste into
 * WeChat's search. That's the same workaround every third-party app lands on.
 */

/** Opens the WeChat app (or desktop client) — no chat can be targeted. */
export const WECHAT_APP_URL = 'weixin://';
