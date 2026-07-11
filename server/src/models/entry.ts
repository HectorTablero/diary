import { DATE_KEY_REGEX, MAX_CONTENT_LENGTH } from '@diary/shared';
import { model, Schema } from 'mongoose';

const saidToSchema = new Schema(
  {
    person: { type: Schema.Types.ObjectId, ref: 'Person', required: true },
    at: { type: Date, required: true, default: Date.now },
  },
  { _id: false },
);

const entrySchema = new Schema(
  {
    userId: { type: String, required: true },
    content: { type: String, required: true, trim: true, maxlength: MAX_CONTENT_LENGTH },
    // Day as a YYYY-MM-DD string: timezone-proof and sorts lexicographically.
    dateKey: { type: String, required: true, match: DATE_KEY_REGEX },
    // 1 = highest importance, 5 = lowest (matches the original app).
    importance: { type: Number, required: true, min: 1, max: 5, default: 3 },
    tags: [{ type: Schema.Types.ObjectId, ref: 'Tag' }],
    /** Direct mentions. */
    people: [{ type: Schema.Types.ObjectId, ref: 'Person' }],
    /** People this entry has been told to (auto-filled from mentions on create), with the date. */
    saidTo: [saidToSchema],
    /** People this entry must never be suggested to. */
    hiddenFor: [{ type: Schema.Types.ObjectId, ref: 'Person' }],
    parentId: { type: Schema.Types.ObjectId, ref: 'Entry', default: null },
  },
  { timestamps: true },
);

entrySchema.index({ userId: 1, dateKey: -1 });
entrySchema.index({ userId: 1, parentId: 1 });
entrySchema.index({ userId: 1, people: 1 });
entrySchema.index({ userId: 1, tags: 1 });
// No stemming ("none"): entries mix Spanish and English.
entrySchema.index({ content: 'text' }, { default_language: 'none' });

export const Entry = model('Entry', entrySchema);
