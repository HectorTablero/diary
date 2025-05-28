import { Types } from 'mongoose';
import { Tag } from '../models';

export class TagService {
    
    /**
     * Get all tags for a user
     */
    static async getUserTags(userId: Types.ObjectId): Promise<any[]> {
        return await Tag.find({ user: userId }).sort({ name: 1 });
    }

    /**
     * Create a new tag
     */
    static async createTag(data: {
        userId: Types.ObjectId;
        name: string;
        color?: string;
    }): Promise<any> {
        // Check if tag name already exists for this user
        const existingTag = await Tag.findOne({ 
            user: data.userId, 
            name: data.name 
        });
        
        if (existingTag) {
            throw new Error('Tag with this name already exists');
        }

        // If no color provided, use a default color
        let color = data.color;
        if (!color) {
            const userTags = await this.getUserTags(data.userId);
            const defaultColors = Tag.getDefaultColors();
            const usedColors = userTags.map(tag => tag.color);
            
            // Find first unused default color, or use first default if all are used
            color = defaultColors.find(c => !usedColors.includes(c)) || defaultColors[0];
        }

        const tag = new Tag({
            user: data.userId,
            name: data.name,
            color: color
        });

        return await tag.save();
    }

    /**
     * Update a tag
     */
    static async updateTag(
        userId: Types.ObjectId,
        tagId: Types.ObjectId,
        updates: { name?: string; color?: string }
    ): Promise<any> {
        // If updating name, check for uniqueness
        if (updates.name) {
            const existingTag = await Tag.findOne({ 
                user: userId, 
                name: updates.name,
                _id: { $ne: tagId }
            });
            
            if (existingTag) {
                throw new Error('Tag with this name already exists');
            }
        }

        return await Tag.findOneAndUpdate(
            { _id: tagId, user: userId },
            updates,
            { new: true }
        );
    }

    /**
     * Delete a tag
     */
    static async deleteTag(userId: Types.ObjectId, tagId: Types.ObjectId): Promise<void> {
        const tag = await Tag.findOne({ _id: tagId, user: userId });
        if (!tag) {
            throw new Error('Tag not found');
        }

        // Note: In a production app, you might want to:
        // 1. Remove this tag from all diary entries
        // 2. Remove this tag from all friends
        // For now, we'll just delete the tag
        await Tag.findByIdAndDelete(tagId);
    }

    /**
     * Get tag usage statistics
     */
    static async getTagUsageStats(userId: Types.ObjectId): Promise<any[]> {
        const tags = await Tag.find({ user: userId });
        
        const statsPromises = tags.map(async (tag) => {
            const entryCount = await tag.getEntries().countDocuments();
            const friendCount = await tag.getFriends().countDocuments();
            
            return {
                tag: tag,
                entryCount,
                friendCount,
                totalUsage: entryCount + friendCount
            };
        });

        const stats = await Promise.all(statsPromises);
        return stats.sort((a, b) => b.totalUsage - a.totalUsage);
    }

    /**
     * Get suggested tags based on entry content (simple keyword matching)
     */
    static async getSuggestedTags(userId: Types.ObjectId, content: string): Promise<any[]> {
        const userTags = await this.getUserTags(userId);
        const contentLower = content.toLowerCase();
        
        return userTags.filter(tag => 
            contentLower.includes(tag.name.toLowerCase())
        );
    }
}
