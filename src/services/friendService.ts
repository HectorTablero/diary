import { Types } from 'mongoose';
import { Friend, Tag } from '../models';

export class FriendService {
    
    /**
     * Get all friends for a user
     */
    static async getUserFriends(userId: Types.ObjectId): Promise<any[]> {
        return await Friend.find({ user: userId })
            .populate('tags')
            .sort({ name: 1 });
    }

    /**
     * Create a new friend
     */
    static async createFriend(data: {
        userId: Types.ObjectId;
        name: string;
        tagIds?: Types.ObjectId[];
    }): Promise<any> {
        // Check if friend name already exists for this user
        const existingFriend = await Friend.findOne({ 
            user: data.userId, 
            name: data.name 
        });
        
        if (existingFriend) {
            throw new Error('Friend with this name already exists');
        }

        // Validate that all provided tags belong to the user
        if (data.tagIds && data.tagIds.length > 0) {
            const validTags = await Tag.find({
                _id: { $in: data.tagIds },
                user: data.userId
            });
            
            if (validTags.length !== data.tagIds.length) {
                throw new Error('One or more tags do not belong to this user');
            }
        }

        const friend = new Friend({
            user: data.userId,
            name: data.name,
            tags: data.tagIds || [],
            hiddenEntries: []
        });

        return await friend.save();
    }

    /**
     * Update a friend
     */
    static async updateFriend(
        userId: Types.ObjectId,
        friendId: Types.ObjectId,
        updates: { name?: string; tagIds?: Types.ObjectId[] }
    ): Promise<any> {
        // If updating name, check for uniqueness
        if (updates.name) {
            const existingFriend = await Friend.findOne({ 
                user: userId, 
                name: updates.name,
                _id: { $ne: friendId }
            });
            
            if (existingFriend) {
                throw new Error('Friend with this name already exists');
            }
        }

        // If updating tags, validate they belong to the user
        if (updates.tagIds) {
            const validTags = await Tag.find({
                _id: { $in: updates.tagIds },
                user: userId
            });
            
            if (validTags.length !== updates.tagIds.length) {
                throw new Error('One or more tags do not belong to this user');
            }
        }

        const updateData: any = {};
        if (updates.name) updateData.name = updates.name;
        if (updates.tagIds) updateData.tags = updates.tagIds;

        return await Friend.findOneAndUpdate(
            { _id: friendId, user: userId },
            updateData,
            { new: true }
        ).populate('tags');
    }

    /**
     * Delete a friend
     */
    static async deleteFriend(userId: Types.ObjectId, friendId: Types.ObjectId): Promise<void> {
        const friend = await Friend.findOne({ _id: friendId, user: userId });
        if (!friend) {
            throw new Error('Friend not found');
        }

        await Friend.findByIdAndDelete(friendId);
    }

    /**
     * Hide an entry for a specific friend
     */
    static async hideEntryForFriend(
        userId: Types.ObjectId,
        friendId: Types.ObjectId,
        entryId: Types.ObjectId
    ): Promise<any> {
        const friend = await Friend.findOne({ _id: friendId, user: userId });
        if (!friend) {
            throw new Error('Friend not found');
        }

        return await friend.hideEntry(entryId);
    }

    /**
     * Unhide an entry for a specific friend
     */
    static async unhideEntryForFriend(
        userId: Types.ObjectId,
        friendId: Types.ObjectId,
        entryId: Types.ObjectId
    ): Promise<any> {
        const friend = await Friend.findOne({ _id: friendId, user: userId });
        if (!friend) {
            throw new Error('Friend not found');
        }

        return await friend.unhideEntry(entryId);
    }

    /**
     * Get friend statistics
     */
    static async getFriendStats(userId: Types.ObjectId, friendId: Types.ObjectId): Promise<any> {
        const friend = await Friend.findOne({ _id: friendId, user: userId }).populate('tags');
        if (!friend) {
            throw new Error('Friend not found');
        }

        // Count matching entries (this would need the DiaryService)
        const { DiaryService } = await import('./diaryService');
        const matchingEntries = await DiaryService.getEntriesForFriend(userId, friendId);
        
        return {
            friend: friend,
            tagCount: friend.tags.length,
            matchingEntryCount: matchingEntries.length,
            hiddenEntryCount: friend.hiddenEntries.length
        };
    }

    /**
     * Get all friends that would match a specific entry
     */
    static async getFriendsForEntry(userId: Types.ObjectId, entryTagIds: Types.ObjectId[]): Promise<any[]> {
        const friends = await this.getUserFriends(userId);
        
        return friends.filter(friend => {
            const friendTagIds = friend.tags.map((tag: any) => tag._id.toString());
            const entryTagIdsStr = entryTagIds.map(id => id.toString());
            
            // Check if friend has any tags in common with the entry
            return friendTagIds.some(tagId => entryTagIdsStr.includes(tagId));
        });
    }
}
