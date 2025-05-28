// Friends Management JavaScript

class FriendsApp {
    constructor() {
        this.friends = [];
        this.tags = [];
        this.editingFriendId = null;
        
        this.init();
    }    async init() {
        this.showLoading();
        
        try {
            await this.loadTags();
            await this.loadFriends();
            this.setupEventListeners();
            this.hideLoading();
        } catch (error) {
            console.error('Error initializing friends:', error);
            showToast('Failed to load friends data', 'error');
            this.hideLoading();
        }
    }setupEventListeners() {
        // Add friend modal form submission  
        const modalForm = document.getElementById('add-friend-modal-form');
        if (modalForm) {
            modalForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.addFriendFromModal();
            });
        }

        // Edit friend form submission
        const editFriendForm = document.getElementById('edit-friend-form');
        if (editFriendForm) {
            editFriendForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.updateFriend();
            });
        }
    }    async loadTags() {
        try {
            const response = await fetch('/api/tags');
            const result = await response.json();
            
            if (result.success) {
                this.tags = result.data;
                this.renderTagSelection('modal-friend-tag-selection');
                this.renderTagSelection('edit-friend-tag-selection');
            }
        } catch (error) {
            console.error('Error loading tags:', error);
        }
    }

    async loadFriends() {
        this.showLoading();
        
        try {
            const response = await fetch('/api/friends');
            const result = await response.json();
            
            if (result.success) {
                this.friends = result.data;
                this.renderFriends();
            }
        } catch (error) {
            console.error('Error loading friends:', error);
        } finally {
            this.hideLoading();
        }
    }

    renderTagSelection(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;
        
        container.innerHTML = '';

        this.tags.forEach(tag => {
            const tagElement = document.createElement('button');
            tagElement.type = 'button';
            tagElement.className = 'tag-button px-3 py-1 rounded-full text-sm font-medium border-2 transition-colors';
            tagElement.style.borderColor = tag.color;
            tagElement.style.color = tag.color;
            tagElement.textContent = tag.name;
            tagElement.dataset.tagId = tag._id;
            tagElement.dataset.container = containerId;

            tagElement.addEventListener('click', () => {
                this.toggleTagSelection(tagElement, tag);
            });

            container.appendChild(tagElement);
        });
    }

    toggleTagSelection(element, tag) {
        element.classList.toggle('selected');
        if (element.classList.contains('selected')) {
            element.style.backgroundColor = tag.color;
            element.style.color = 'white';
        } else {
            element.style.backgroundColor = 'transparent';
            element.style.color = tag.color;
        }
    }

    renderFriends() {
        const container = document.getElementById('friends-list');
        const emptyState = document.getElementById('empty-state');

        if (this.friends.length === 0) {
            container.innerHTML = '';
            emptyState.classList.remove('hidden');
            return;
        }

        emptyState.classList.add('hidden');
        container.innerHTML = '';

        this.friends.forEach(friend => {
            const friendElement = this.createFriendElement(friend);
            container.appendChild(friendElement);
        });
    }

    createFriendElement(friend) {
        const friendDiv = document.createElement('div');
        friendDiv.className = 'friend-item bg-white dark:bg-gray-800 rounded-lg shadow-md p-6';

        friendDiv.innerHTML = `
            <div class="flex items-start justify-between mb-4">
                <div>
                    <h3 class="text-xl font-semibold text-gray-800 dark:text-white mb-2">
                        ${this.escapeHtml(friend.name)}
                    </h3>
                    <p class="text-sm text-gray-600 dark:text-gray-300">
                        ${friend.tags.length} tag${friend.tags.length !== 1 ? 's' : ''} • 
                        ${friend.hiddenEntries.length} hidden entr${friend.hiddenEntries.length !== 1 ? 'ies' : 'y'}
                    </p>
                </div>
                <div class="flex items-center gap-2">
                    <button class="edit-friend-btn text-gray-400 hover:text-blue-600 p-2" data-friend-id="${friend._id}">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path>
                        </svg>
                    </button>
                    <button class="delete-friend-btn text-gray-400 hover:text-red-600 p-2" data-friend-id="${friend._id}">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
                        </svg>
                    </button>
                </div>
            </div>
            
            ${friend.tags && friend.tags.length > 0 ? `
                <div class="friend-tags flex flex-wrap gap-2 mb-4">
                    ${friend.tags.map(tag => `
                        <span class="px-3 py-1 rounded-full text-sm font-medium" style="background-color: ${tag.color}20; color: ${tag.color}; border: 1px solid ${tag.color}">
                            ${tag.name}
                        </span>
                    `).join('')}
                </div>
            ` : `
                <div class="text-gray-500 dark:text-gray-400 text-sm mb-4">
                    No tags assigned - this friend won't see any entries
                </div>
            `}
            
            <div class="flex items-center justify-between">
                <a href="/diary?friend=${friend._id}" class="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 font-medium text-sm">
                    View entries for ${this.escapeHtml(friend.name)} →
                </a>
                <button class="view-stats-btn text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 text-sm" data-friend-id="${friend._id}">
                    View Stats
                </button>
            </div>
        `;

        // Add event listeners
        friendDiv.querySelector('.edit-friend-btn').addEventListener('click', () => {
            this.editFriend(friend._id);
        });

        friendDiv.querySelector('.delete-friend-btn').addEventListener('click', () => {
            this.deleteFriend(friend._id, friend.name);
        });

        friendDiv.querySelector('.view-stats-btn').addEventListener('click', () => {
            this.viewFriendStats(friend._id);
        });

        return friendDiv;
    }    addFriendFromModal() {
        const nameInput = document.getElementById('modal-friend-name');
        if (!nameInput) return;
        
        const name = nameInput.value.trim();
        const selectedTags = this.getSelectedTags('modal-friend-tag-selection');

        if (!name) {
            showToast('Please enter a friend name', 'error');
            return;
        }

        this.saveFriend(name, selectedTags, 'add-friend-modal');
    }

    getSelectedTags(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return [];
        
        return Array.from(container.querySelectorAll('.tag-button.selected'))
            .map(btn => btn.dataset.tagId);
    }

    async saveFriend(name, selectedTags, modalToClose = null) {
        try {
            const response = await fetch('/api/friends', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    name: name,
                    tagIds: selectedTags
                })
            });

            const result = await response.json();
            
            if (result.success) {
                showToast('Friend added successfully!', 'success');
                await this.loadFriends();
                
                // Reset form
                if (modalToClose) {
                    closeModal(modalToClose);
                } else {
                    const form = document.getElementById('add-friend-form');
                    if (form) form.reset();
                }                this.clearTagSelection('modal-friend-tag-selection');
            } else {
                showToast(result.message || 'Failed to add friend', 'error');
            }
        } catch (error) {
            console.error('Error adding friend:', error);
            showToast('Failed to add friend', 'error');
        }
    }

    clearTagSelection(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;
        
        container.querySelectorAll('.tag-button.selected').forEach(btn => {
            const tag = this.tags.find(t => t._id === btn.dataset.tagId);
            if (tag) {
                this.toggleTagSelection(btn, tag);
            }
        });
    }

    async editFriend(friendId) {
        const friend = this.friends.find(f => f._id === friendId);
        if (!friend) return;

        this.editingFriendId = friendId;
        
        // Populate form
        const editIdInput = document.getElementById('edit-friend-id');
        const editNameInput = document.getElementById('edit-friend-name');
        
        if (editIdInput) editIdInput.value = friendId;
        if (editNameInput) editNameInput.value = friend.name;

        // Clear and set tag selection
        this.clearTagSelection('edit-friend-tag-selection');
        
        // Set selected tags
        friend.tags.forEach(friendTag => {
            const tagButton = document.querySelector(`#edit-friend-tag-selection .tag-button[data-tag-id="${friendTag._id}"]`);
            if (tagButton) {
                const tag = this.tags.find(t => t._id === friendTag._id);
                if (tag) {
                    this.toggleTagSelection(tagButton, tag);
                }
            }
        });

        this.showEditModal();
    }

    async updateFriend() {
        const friendId = this.editingFriendId;
        const nameInput = document.getElementById('edit-friend-name');
        
        if (!nameInput || !friendId) return;
        
        const name = nameInput.value.trim();
        const selectedTags = this.getSelectedTags('edit-friend-tag-selection');
        
        if (!name) {
            showToast('Please enter a friend name', 'error');
            return;
        }

        try {
            const response = await fetch(`/api/friends/${friendId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    name,
                    tagIds: selectedTags
                })
            });

            const result = await response.json();
            
            if (result.success) {
                showToast('Friend updated successfully!', 'success');
                this.hideEditModal();
                await this.loadFriends();
            } else {
                showToast(result.message || 'Failed to update friend', 'error');
            }
        } catch (error) {
            console.error('Error updating friend:', error);
            showToast('Failed to update friend', 'error');
        }
    }

    async deleteFriend(friendId, friendName) {
        if (!confirm(`Are you sure you want to delete "${friendName}"? This action cannot be undone.`)) {
            return;
        }

        try {
            const response = await fetch(`/api/friends/${friendId}`, {
                method: 'DELETE'
            });

            const result = await response.json();
            
            if (result.success) {
                showToast('Friend deleted successfully!', 'success');
                await this.loadFriends();
            } else {
                showToast(result.message || 'Failed to delete friend', 'error');
            }
        } catch (error) {
            console.error('Error deleting friend:', error);
            showToast('Failed to delete friend', 'error');
        }
    }

    async viewFriendStats(friendId) {
        try {
            const response = await fetch(`/api/friends/${friendId}`);
            const result = await response.json();
            
            if (result.success) {
                const stats = result.data;
                showToast(`Friend Stats for ${stats.friend.name}:\n\n` +
                         `Tags: ${stats.tagCount}\n` +
                         `Matching Entries: ${stats.matchingEntryCount}\n` +
                         `Hidden Entries: ${stats.hiddenEntryCount}`, 'info');
            }
        } catch (error) {
            console.error('Error fetching friend stats:', error);
            showToast('Error fetching friend stats', 'error');
        }
    }

    showEditModal() {
        const modal = document.getElementById('edit-friend-modal');
        if (modal) {
            modal.classList.remove('hidden');
        }
    }

    hideEditModal() {
        const modal = document.getElementById('edit-friend-modal');
        if (modal) {
            modal.classList.add('hidden');
        }
        this.editingFriendId = null;
    }

    showLoading() {
        const loading = document.getElementById('loading');
        const friendsList = document.getElementById('friends-list');
        
        if (loading) loading.classList.remove('hidden');
        if (friendsList) friendsList.style.opacity = '0.5';
    }

    hideLoading() {
        const loading = document.getElementById('loading');
        const friendsList = document.getElementById('friends-list');
        
        if (loading) loading.classList.add('hidden');
        if (friendsList) friendsList.style.opacity = '1';
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Initialize the friends app when the page loads
document.addEventListener('DOMContentLoaded', () => {
    new FriendsApp();
});
