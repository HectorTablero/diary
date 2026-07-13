import {
  MAX_ALIAS_LENGTH,
  MAX_EMAIL_LENGTH,
  MAX_NOTES_LENGTH,
  MAX_ORGANIZATION_LENGTH,
  MAX_PHONE_LENGTH,
  MAX_WECHAT_ID_LENGTH,
} from '@diary/shared';
import { model, Schema } from 'mongoose';

const personSchema = new Schema(
  {
    userId: { type: String, required: true },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    /** Nicknames and name variants; unlike `name` these are not uniqueness-constrained. */
    aliases: { type: [{ type: String, trim: true, maxlength: MAX_ALIAS_LENGTH }], default: [] },
    /** E.164 where we could normalize it, raw otherwise — the client flags incomplete numbers. */
    phone: { type: String, default: null, maxlength: MAX_PHONE_LENGTH },
    email: { type: String, default: null, maxlength: MAX_EMAIL_LENGTH },
    /** WeChat ID, deep-linked as `weixin://dl/chat?<id>`. */
    wechatId: { type: String, default: null, maxlength: MAX_WECHAT_ID_LENGTH },
    /** `YYYY-MM-DD`, or `--MM-DD` when the year is unknown. */
    birthday: { type: String, default: null },
    company: { type: String, default: null, maxlength: MAX_ORGANIZATION_LENGTH },
    jobTitle: { type: String, default: null, maxlength: MAX_ORGANIZATION_LENGTH },
    /** Source device contact, so a re-import updates this person instead of duplicating them. */
    contactId: { type: String, default: null },
    tags: [{ type: Schema.Types.ObjectId, ref: 'Tag' }],
    notes: { type: String, default: '', maxlength: MAX_NOTES_LENGTH },
    /** `null` disables checkup reminders for this person. */
    checkupIntervalDays: { type: Number, default: null },
    lastCheckupAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

personSchema.index({ userId: 1, name: 1 }, { unique: true });

export const Person = model('Person', personSchema);
