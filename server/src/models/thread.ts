import { MAX_THREAD_NAME_LENGTH } from '@diary/shared';
import { model, Schema } from 'mongoose';

/* An ongoing topic that entries from many different days belong to. Its own collection rather
   than an embedded document (the cheaper option taken for person events) because entries
   reference it many-to-many and it has to be renameable in one place. */
const threadSchema = new Schema(
  {
    userId: { type: String, required: true },
    name: { type: String, required: true, trim: true, maxlength: MAX_THREAD_NAME_LENGTH },
  },
  { timestamps: true },
);

threadSchema.index({ userId: 1, name: 1 }, { unique: true });

export const Thread = model('Thread', threadSchema);
