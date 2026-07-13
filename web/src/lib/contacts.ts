import {
  Contacts,
  PhoneType,
  type ContactPayload,
  type PhonePayload,
} from '@capacitor-community/contacts';
import { formatBirthdayValue } from './birthday';
import type { ContactCandidate } from './conflicts';
import { isNative } from './native';
import { normalizePhone } from './phone';

/* Device address book -> ContactCandidate. Android-only (the plugin has no meaningful web
   backend), so every entry point is guarded by `isNative`, mirroring lib/notifications.ts.
   Practically every field on ContactPayload is optional *and* nullable, hence the defensiveness. */

/** Contacts are only readable in the native app. */
export const canImportContacts = (): boolean => isNative;

export async function checkContactsPermission(): Promise<boolean> {
  if (!isNative) return false;
  const status = await Contacts.checkPermissions();
  return status.contacts === 'granted' || status.contacts === 'limited';
}

export async function requestContactsPermission(): Promise<boolean> {
  if (!isNative) return false;
  const status = await Contacts.requestPermissions();
  return status.contacts === 'granted' || status.contacts === 'limited';
}

/** Primary number wins, then an explicitly mobile one, then whatever came first. */
function pickPhone(phones: PhonePayload[] | undefined): string | null {
  const usable = (phones ?? []).filter((phone) => phone.number?.trim());
  if (!usable.length) return null;
  const best =
    usable.find((phone) => phone.isPrimary) ??
    usable.find((phone) => phone.type === PhoneType.Mobile) ??
    usable[0];
  return normalizePhone(best.number!);
}

function pickEmail(contact: ContactPayload): string | null {
  const usable = (contact.emails ?? []).filter((email) => email.address?.trim());
  if (!usable.length) return null;
  const best = usable.find((email) => email.isPrimary) ?? usable[0];
  return best.address!.trim();
}

/** A day and month are the minimum; the year is very often absent and stays optional. */
function pickBirthday(contact: ContactPayload): string | null {
  const birthday = contact.birthday;
  if (!birthday?.day || !birthday.month) return null;
  return formatBirthdayValue(birthday.year ?? null, birthday.month, birthday.day);
}

function pickName(contact: ContactPayload): string {
  const name = contact.name;
  const display = name?.display?.trim();
  if (display) return display;
  return [name?.given, name?.middle, name?.family]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(' ');
}

export function toCandidate(contact: ContactPayload): ContactCandidate | null {
  const name = pickName(contact);
  if (!name) return null; // a nameless contact can't become a person
  return {
    contactId: contact.contactId,
    name,
    // Deliberately empty: Android exposes no nickname field here, and deriving one from the
    // name (e.g. "Irene" from "Irene González") would manufacture the exact ambiguity the
    // conflict screen exists to prevent. Aliases are added by hand, or by merging a contact
    // into an existing person (which records the contact's own name — "Mum" -> Carmen).
    aliases: [],
    phone: pickPhone(contact.phones),
    email: pickEmail(contact),
    birthday: pickBirthday(contact),
    company: contact.organization?.company?.trim() || null,
    jobTitle: contact.organization?.jobTitle?.trim() || null,
  };
}

/** Every readable contact, sorted by name. Assumes permission has been granted. */
export async function readContacts(): Promise<ContactCandidate[]> {
  if (!isNative) return [];
  const { contacts } = await Contacts.getContacts({
    projection: {
      name: true,
      phones: true,
      emails: true,
      birthday: true,
      organization: true,
      // `image: true` is left off on purpose — the plugin warns it slows the query badly, and
      // base64 photos would ride along in every /sync payload forever after.
    },
  });

  const candidates: ContactCandidate[] = [];
  for (const contact of contacts) {
    try {
      const candidate = toCandidate(contact);
      if (candidate) candidates.push(candidate);
    } catch (err) {
      // One malformed row out of an address book of hundreds must not sink the whole import.
      console.warn('contacts: skipping unreadable contact', contact?.contactId, err);
    }
  }
  console.log(`contacts: read ${contacts.length}, usable ${candidates.length}`);
  return candidates.sort((a, b) => a.name.localeCompare(b.name));
}
