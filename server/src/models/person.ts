import { MAX_NOTES_LENGTH } from '@diary/shared';
import { model, Schema } from 'mongoose';

const personSchema = new Schema(
  {
    userId: { type: String, required: true },
    name: { type: String, required: true, trim: true, maxlength: 100 },
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
