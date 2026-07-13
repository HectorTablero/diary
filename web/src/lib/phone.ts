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

/** Opens a WeChat chat in the installed app. */
export const wechatLink = (wechatId: string): string =>
  `weixin://dl/chat?${encodeURIComponent(wechatId.trim())}`;
