// Tags Management JavaScript
class TagsManager {
    constructor() {
        this.tags = [];
        this.filteredTags = [];
        this.editingTagId = null;
        this.init();
    }    async init() {
        this.showLoading();
        
        try {
            this.bindEvents();
            await this.loadTags();
            this.syncColorInputs();
            this.hideLoading();
        } catch (error) {
            console.error('Error initializing tags:', error);
            showToast('Failed to load tags', 'error');
            this.hideLoading();
        }
    }

    bindEvents() {
        // Add tag form
        const addForm = document.getElementById('add-tag-form');
        if (addForm) {
            addForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.handleAddTag();
            });
        }

        // Search functionality
        const searchInput = document.getElementById('search-tags');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                this.handleSearch(e.target.value);
            });
        }

        // Color input sync
        this.syncColorInputs();

        // Show stats button
        const statsBtn = document.getElementById('show-stats-btn');
        if (statsBtn) {
            statsBtn.addEventListener('click', () => {
                this.showUsageStats();
            });
        }

        // Edit tag form
        const editForm = document.getElementById('edit-tag-form');
        if (editForm) {
            editForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.handleUpdateTag();
            });
        }        // Close modals on outside click
        const statsModal = document.getElementById('stats-modal');
        if (statsModal) {
            statsModal.addEventListener('click', (e) => {
                if (e.target.id === 'stats-modal') {
                    closeModal('stats-modal');
                }
            });
        }

        const addModal = document.getElementById('add-tag-modal');
        if (addModal) {
            addModal.addEventListener('click', (e) => {
                if (e.target.id === 'add-tag-modal') {
                    closeModal('add-tag-modal');
                }
            });
        }

        const editModal = document.getElementById('edit-tag-modal');
        if (editModal) {
            editModal.addEventListener('click', (e) => {
                if (e.target.id === 'edit-tag-modal') {
                    closeModal('edit-tag-modal');
                }
            });
        }
    }    syncColorInputs() {
        // Sync add form color inputs
        const colorPicker = document.getElementById('tag-color');
        const colorHex = document.getElementById('tag-color-hex');

        if (colorPicker && colorHex) {
            colorPicker.addEventListener('change', () => {
                colorHex.value = colorPicker.value;
            });

            colorHex.addEventListener('input', () => {
                if (this.isValidColor(colorHex.value)) {
                    colorPicker.value = colorHex.value;
                }
            });
        }

        // Sync edit form color inputs
        const editColorPicker = document.getElementById('edit-tag-color');
        const editColorText = document.getElementById('edit-tag-color-text');

        if (editColorPicker && editColorText) {
            editColorPicker.addEventListener('change', () => {
                editColorText.value = editColorPicker.value;
            });

            editColorText.addEventListener('input', () => {
                if (this.isValidColor(editColorText.value)) {
                    editColorPicker.value = editColorText.value;
                }
            });
        }
    }

    isValidColor(color) {
        return /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/.test(color);
    }    async loadTags() {
        try {
            this.showLoading();
            
            const response = await fetch('/api/tags');
            const result = await response.json();
            
            if (!result.success) {
                throw new Error(result.error || 'Failed to load tags');
            }
            
            this.tags = result.data;
            this.filteredTags = [...this.tags];
            this.renderTags();
            this.hideLoading();
            
        } catch (error) {
            console.error('Error loading tags:', error);
            showToast('Failed to load tags. Please try again.', 'error');
            this.hideLoading();
        }
    }async handleAddTag() {
        try {            const name = document.getElementById('tag-name').value.trim();
            const color = document.getElementById('tag-color').value;

            if (!name) {
                showToast('Please enter a tag name', 'error');
                return;
            }

            this.showLoading();

            const response = await fetch('/api/tags', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ name, color }),
            });

            const result = await response.json();

            if (!result.success) {
                throw new Error(result.error || 'Failed to create tag');
            }

            // Add new tag to the list
            this.tags.push(result.data);
            this.filteredTags = [...this.tags];
            this.renderTags();            // Reset form
            document.getElementById('add-tag-form').reset();            document.getElementById('tag-color').value = '#3b82f6';
            document.getElementById('tag-color-hex').value = '#3b82f6';

            this.hideLoading();
            closeModal('add-tag-modal');
            showToast('Tag created successfully', 'success');        } catch (error) {
            console.error('Error creating tag:', error);
            this.hideLoading();
            showToast(error.message || 'Failed to create tag', 'error');
        }
    }    async handleUpdateTag() {
        try {
            const tagId = document.getElementById('edit-tag-id').value;
            const name = document.getElementById('edit-tag-name').value.trim();
            const color = document.getElementById('edit-tag-color').value;            if (!name) {
                showToast('Please enter a tag name', 'error');
                return;
            }

            this.showLoading();

            const response = await fetch(`/api/tags/${tagId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ name, color }),
            });

            const result = await response.json();

            if (!result.success) {
                throw new Error(result.error || 'Failed to update tag');
            }

            // Update tag in the list
            const index = this.tags.findIndex(tag => tag._id === tagId);
            if (index !== -1) {
                this.tags[index] = result.data;
                this.filteredTags = [...this.tags];
                this.renderTags();            }

            this.hideLoading();
            closeModal('edit-tag-modal');
            showToast('Tag updated successfully', 'success');

        } catch (error) {
            console.error('Error updating tag:', error);
            this.hideLoading();
            showToast(error.message || 'Failed to update tag', 'error');
        }
    }    async handleDeleteTag(tagId) {
        if (!confirm('Are you sure you want to delete this tag? This action cannot be undone.')) {
            return;
        }        try {
            this.showLoading();

            const response = await fetch(`/api/tags/${tagId}`, {
                method: 'DELETE',
            });

            const result = await response.json();

            if (!result.success) {
                throw new Error(result.error || 'Failed to delete tag');
            }

            // Remove tag from the list
            this.tags = this.tags.filter(tag => tag._id !== tagId);            this.filteredTags = [...this.tags];
            this.renderTags();

            this.hideLoading();
            showToast('Tag deleted successfully', 'success');

        } catch (error) {
            console.error('Error deleting tag:', error);
            this.hideLoading();
            showToast(error.message || 'Failed to delete tag', 'error');
        }
    }

    handleSearch(query) {
        const searchTerm = query.toLowerCase().trim();
        
        if (!searchTerm) {
            this.filteredTags = [...this.tags];
        } else {
            this.filteredTags = this.tags.filter(tag =>
                tag.name.toLowerCase().includes(searchTerm)
            );
        }
          this.renderTags();
    }

    async showUsageStats() {
        try {
            this.showLoading();

            const response = await fetch('/api/tags/stats');
            const result = await response.json();

            if (!result.success) {
                throw new Error(result.error || 'Failed to load stats');
            }

            this.hideLoading();
            this.renderStats(result.data);
            openModal('stats-modal');

        } catch (error) {
            console.error('Error loading stats:', error);
            this.hideLoading();
            showToast('Failed to load usage statistics', 'error');
        }
    }

    openEditModal(tag) {
        document.getElementById('edit-tag-id').value = tag._id;
        document.getElementById('edit-tag-name').value = tag.name;
        document.getElementById('edit-tag-color').value = tag.color || '#3b82f6';
        document.getElementById('edit-tag-color-text').value = tag.color || '#3b82f6';        openModal('edit-tag-modal');
    }

    renderTags() {
        const loadingEl = document.getElementById('tags-loading');
        const emptyEl = document.getElementById('tags-empty');
        const gridEl = document.getElementById('tags-grid');

        if (loadingEl) loadingEl.classList.add('hidden');

        if (this.filteredTags.length === 0) {
            if (gridEl) gridEl.classList.add('hidden');
            if (emptyEl) emptyEl.classList.remove('hidden');
            return;
        }

        if (emptyEl) emptyEl.classList.add('hidden');
        if (gridEl) gridEl.classList.remove('hidden');

        const gridContainer = gridEl?.querySelector('.grid');
        if (gridContainer) {
            gridContainer.innerHTML = this.filteredTags.map(tag => this.createTagCard(tag)).join('');

            // Bind edit and delete events
            this.filteredTags.forEach(tag => {
                const editBtn = document.getElementById(`edit-${tag._id}`);
                const deleteBtn = document.getElementById(`delete-${tag._id}`);
                
                if (editBtn) {
                    editBtn.addEventListener('click', () => {
                        this.openEditModal(tag);
                    });
                }

                if (deleteBtn) {
                    deleteBtn.addEventListener('click', () => {
                        this.handleDeleteTag(tag._id);
                    });
                }
            });
        }
    }

    createTagCard(tag) {
        const tagColor = tag.color || '#3b82f6';
        
        return `
            <div class="bg-gray-50 dark:bg-gray-700 rounded-lg p-4 border border-gray-200 dark:border-gray-600">
                <div class="flex items-center justify-between mb-2">
                    <div class="flex items-center space-x-2">
                        <div class="w-4 h-4 rounded-full" style="background-color: ${tagColor}"></div>
                        <h3 class="font-medium text-gray-800 dark:text-white">${this.escapeHtml(tag.name)}</h3>
                    </div>
                    <div class="flex items-center space-x-1">
                        <button
                            id="edit-${tag._id}"
                            class="p-1 text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                            title="Edit tag"
                        >
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path>
                            </svg>
                        </button>
                        <button
                            id="delete-${tag._id}"
                            class="p-1 text-gray-400 hover:text-red-600 dark:hover:text-red-400 transition-colors"
                            title="Delete tag"
                        >
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
                            </svg>
                        </button>
                    </div>
                </div>
                <div class="text-sm text-gray-600 dark:text-gray-400">
                    <p class="text-xs mt-1">Created: ${this.formatDate(tag.createdAt)}</p>
                </div>
            </div>
        `;
    }    renderStats(stats) {
        const statsContent = document.getElementById('stats-content');
        
        if (stats.length === 0) {
            statsContent.innerHTML = `
                <p class="text-gray-600 dark:text-gray-400 text-center">
                    No usage statistics available yet.
                </p>
            `;
            return;
        }

        // Calculate max count for percentage calculation
        const maxCount = Math.max(...stats.map(stat => stat.totalUsage || 0));

        statsContent.innerHTML = stats.map(stat => {
            const tag = stat.tag;
            const totalCount = stat.totalUsage || 0;
            const percentage = maxCount > 0 ? (totalCount / maxCount) * 100 : 0;
            
            return `
                <div class="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                    <div class="flex items-center space-x-3">
                        <div class="w-4 h-4 rounded-full" style="background-color: ${tag.color || '#3b82f6'}"></div>
                        <div class="flex flex-col">
                            <span class="text-sm font-medium text-gray-800 dark:text-white">${this.escapeHtml(tag.name)}</span>
                            <span class="text-xs text-gray-500 dark:text-gray-400">
                                ${stat.entryCount} entries, ${stat.friendCount} friends
                            </span>
                        </div>
                    </div>
                    <div class="flex items-center space-x-3">
                        <div class="w-20 bg-gray-200 dark:bg-gray-600 rounded-full h-2">
                            <div class="bg-blue-600 h-2 rounded-full" style="width: ${percentage}%"></div>
                        </div>
                        <span class="text-sm font-semibold text-gray-600 dark:text-gray-400 w-8 text-right">${totalCount}</span>
                    </div>
                </div>
            `;
        }).join('');
    }showLoading() {
        const loading = document.getElementById('tags-loading');
        const tagsGrid = document.getElementById('tags-grid');
        const emptyState = document.getElementById('tags-empty');
        
        if (loading) loading.classList.remove('hidden');
        if (tagsGrid) {
            tagsGrid.classList.add('hidden');
            tagsGrid.style.opacity = '0.5';
        }
        if (emptyState) emptyState.classList.add('hidden');
    }

    hideLoading() {
        const loading = document.getElementById('tags-loading');
        const tagsGrid = document.getElementById('tags-grid');
        
        if (loading) loading.classList.add('hidden');
        if (tagsGrid) tagsGrid.style.opacity = '1';
    }

    formatDate(dateString) {
        const date = new Date(dateString);
        return date.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Initialize the tags manager when the page loads
document.addEventListener('DOMContentLoaded', () => {
    new TagsManager();
});
