import { HEX_COLOR_REGEX } from '@diary/shared';
import { model, Schema } from 'mongoose';

const tagSchema = new Schema(
  {
    userId: { type: String, required: true },
    name: { type: String, required: true, trim: true, maxlength: 50 },
    color: { type: String, required: true, match: HEX_COLOR_REGEX },
  },
  { timestamps: true },
);

tagSchema.index({ userId: 1, name: 1 }, { unique: true });

export const Tag = model('Tag', tagSchema);
