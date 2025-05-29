// Diary Management JavaScript
LONG_PRESS_DELAY = 500;

class DiaryApp {
    constructor() {
        this.currentFriendId = null;
        this.currentDate = new Date();
        this.tags = [];
        this.friends = [];
        this.entries = [];
        this.maxSubEntryDepth = 3; // Default value
        this.contextMenu = null;
        this.contextBackdrop = null;
        this.longPressTimer = null;
        this.longPressEntry = null;
        
        this.initFromURL();
        this.init();
    }
    
    initFromURL() {
        const urlParams = new URLSearchParams(window.location.search);
        const dateParam = urlParams.get('date');
        
        if (dateParam) {
            const urlDate = new Date(dateParam);
            if (!isNaN(urlDate.getTime())) {
                this.currentDate = urlDate;
            }
        }
    }    async init() {
        // Show loading state
        this.showLoading();
        
        try {
            await this.loadConfig();
            await this.loadTags();
            await this.loadFriends();
            this.setupEventListeners();
            
            // Only create context menu on mobile devices
            if (this.isMobile()) {
                this.createContextMenu();
            }
            
            // Listen for window resize to handle mobile/desktop switching
            window.addEventListener('resize', () => {
                if (this.isMobile() && !this.contextMenu) {
                    this.createContextMenu();
                } else if (!this.isMobile() && this.contextMenu) {
                    this.removeContextMenu();
                }
            });
            
            this.setCurrentDate();
            await this.loadEntries();
            
            this.hideLoading();
        } catch (error) {
            console.error('Error initializing diary:', error);
            showToast('Failed to load diary data', 'error');
            this.hideLoading();
        }
    }setupEventListeners() {
        // Add entry form submission
        document.getElementById('add-entry-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.addEntry();
        });

        // Edit entry form submission
        document.getElementById('edit-entry-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.saveEditEntry();
        });

        // Add sub-entry form submission
        document.getElementById('add-sub-entry-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.saveSubEntry();
        });

        // Friend filter change
        const friendFilter = document.getElementById('friend-filter');
        if (friendFilter) {
            friendFilter.addEventListener('change', (e) => {
                this.currentFriendId = e.target.value || null;
                this.loadEntries();
            });
        }

        // Date navigation
        document.getElementById('date-selector').addEventListener('change', (e) => {
            this.currentDate = new Date(e.target.value);
            this.updateCurrentDateDisplay();
            this.updateNavigationButtons();
            this.updateURL();
            this.loadEntries();
        });

        document.getElementById('prev-day-btn').addEventListener('click', () => {
            this.navigateDay(-1);
        });

        document.getElementById('next-day-btn').addEventListener('click', () => {
            this.navigateDay(1);
        });

        document.getElementById('today-btn').addEventListener('click', () => {
            this.goToToday();
        });

        // Auto-resize textarea
        const textarea = document.getElementById('entry-content');
        textarea.addEventListener('input', () => {
            this.autoResizeTextarea(textarea);
        });

        // Auto-resize edit textarea
        const editTextarea = document.getElementById('edit-entry-content');
        if (editTextarea) {
            editTextarea.addEventListener('input', () => {
                this.autoResizeTextarea(editTextarea);
            });
        }        // Auto-resize sub-entry textarea
        const subEntryTextarea = document.getElementById('sub-entry-content');
        if (subEntryTextarea) {
            subEntryTextarea.addEventListener('input', () => {
                this.autoResizeTextarea(subEntryTextarea);
            });
        }

        // Hide context menu on window resize (for responsive behavior)
        window.addEventListener('resize', () => {
            this.hideContextMenu();
        });
    }

    openAddEntryModal() {
        this.setCurrentViewedDate();
        openModal('add-entry-modal');
    }

    setCurrentDate() {
        // Don't override if date was set from URL
        if (!this.currentDate || this.currentDate.toDateString() === new Date().toDateString()) {
            this.currentDate = new Date();
        }
        this.updateDateSelector();
        this.updateCurrentDateDisplay();
        this.updateNavigationButtons();
        this.updateURL();
    }
    
    updateURL() {
        const today = new Date();
        const isToday = this.isSameDay(this.currentDate, today);
        
        const url = new URL(window.location);
        
        if (isToday) {
            url.searchParams.delete('date');
        } else {
            url.searchParams.set('date', this.currentDate.toISOString().split('T')[0]);
        }
        
        window.history.replaceState({}, '', url);
    }

    updateDateSelector() {
        const dateSelector = document.getElementById('date-selector');
        dateSelector.value = this.currentDate.toISOString().split('T')[0];
    }

    updateCurrentDateDisplay() {
        const currentDateElement = document.getElementById('current-date');
        const today = new Date();
        const isToday = this.isSameDay(this.currentDate, today);
        
        if (isToday) {
            currentDateElement.textContent = 'Today';
        } else {
            currentDateElement.textContent = this.currentDate.toLocaleDateString('en-US', { 
                weekday: 'long', 
                year: 'numeric', 
                month: 'long', 
                day: 'numeric' 
            });
        }
    }

    updateNavigationButtons() {
        const nextBtn = document.getElementById('next-day-btn');
        const today = new Date();
        const isToday = this.isSameDay(this.currentDate, today);
        
        if (isToday) {
            nextBtn.disabled = true;
            nextBtn.classList.add('opacity-50', 'cursor-not-allowed');
        } else {
            nextBtn.disabled = false;
            nextBtn.classList.remove('opacity-50', 'cursor-not-allowed');
        }
    }

    navigateDay(direction) {
        const newDate = new Date(this.currentDate);
        newDate.setDate(newDate.getDate() + direction);
        
        this.currentDate = newDate;
        this.updateDateSelector();
        this.updateCurrentDateDisplay();
        this.updateNavigationButtons();
        this.updateURL();
        this.loadEntries();
    }

    goToToday() {
        this.currentDate = new Date();
        this.updateDateSelector();
        this.updateCurrentDateDisplay();
        this.updateNavigationButtons();
        this.updateURL();
        this.loadEntries();
    }

    isSameDay(date1, date2) {
        return date1.getFullYear() === date2.getFullYear() &&
               date1.getMonth() === date2.getMonth() &&
               date1.getDate() === date2.getDate();
    }

    setTodayDate() {
        const today = new Date().toISOString().split('T')[0];
        document.getElementById('entry-date').value = today;
    }

    setCurrentViewedDate() {
        const dateString = this.currentDate.toISOString().split('T')[0];
        document.getElementById('entry-date').value = dateString;
    }

    autoResizeTextarea(textarea) {
        textarea.style.height = 'auto';        textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px';
    }

    async loadConfig() {
        try {
            const response = await fetch('/api/config');
            const result = await response.json();
            
            if (result.success) {
                this.maxSubEntryDepth = result.data.maxSubEntryDepth;
            }
        } catch (error) {
            console.error('Error loading config:', error);
            // Keep default value
        }
    }    async loadTags() {
        try {
            const response = await fetch('/api/tags');
            const result = await response.json();
            
            if (result.success) {
                this.tags = result.data;
                this.renderTagSelection();
                this.renderEditTagSelection();
                this.renderSubEntryTagSelection();
            }
        } catch (error) {
            console.error('Error loading tags:', error);
        }
    }    async loadFriends() {
        try {
            const response = await fetch('/api/friends');
            const result = await response.json();
            
            if (result.success) {
                this.friends = result.data;
                this.renderFriendSelection();
                this.renderEditFriendSelection();
                this.renderSubEntryFriendSelection();
            }
        } catch (error) {
            console.error('Error loading friends:', error);
        }
    }

    async loadEntries() {
        this.showLoading();
        
        try {
            let url = '/api/entries';
            const params = new URLSearchParams();
            
            // Add date parameter for filtering entries by current date
            params.append('date', this.currentDate.toISOString().split('T')[0]);
            
            if (this.currentFriendId) {
                url = `/api/friends/${this.currentFriendId}/entries`;
            }
            
            url += '?' + params.toString();

            const response = await fetch(url);
            const result = await response.json();            if (result.success) {
                // The API now returns properly nested hierarchy, no need to build it
                this.entries = result.data;
                this.renderEntries();
            }
        } catch (error) {
            console.error('Error loading entries:', error);
        } finally {
            this.hideLoading();        }
    }

    buildEntriesHierarchy(flatEntries) {
        // Create a map for quick lookup
        const entryMap = new Map();
        const rootEntries = [];

        // First pass: create map and initialize children arrays
        flatEntries.forEach(entry => {
            entry.children = [];
            entryMap.set(entry._id, entry);
        });

        // Second pass: build hierarchy
        flatEntries.forEach(entry => {
            if (entry.parentEntry) {
                // This is a sub-entry, add it to its parent's children
                const parent = entryMap.get(entry.parentEntry);
                if (parent) {
                    parent.children.push(entry);
                }
            } else {
                // This is a root entry
                rootEntries.push(entry);
            }
        });

        return rootEntries;
    }

    renderTagSelection() {
        const container = document.getElementById('tag-selection');
        container.innerHTML = '';

        this.tags.forEach(tag => {
            const tagElement = document.createElement('button');
            tagElement.type = 'button';
            tagElement.className = 'tag-button px-3 py-1 rounded-full text-sm font-medium border-2 transition-colors';
            tagElement.style.borderColor = tag.color;
            tagElement.style.color = tag.color;
            tagElement.textContent = tag.name;
            tagElement.dataset.tagId = tag._id;

            tagElement.addEventListener('click', () => {
                this.toggleTagSelection(tagElement, tag);
            });

            container.appendChild(tagElement);
        });
    }

    renderEditTagSelection() {
        const container = document.getElementById('edit-tag-selection');
        container.innerHTML = '';

        this.tags.forEach(tag => {
            const tagElement = document.createElement('button');
            tagElement.type = 'button';
            tagElement.className = 'edit-tag-button px-3 py-1 rounded-full text-sm font-medium border-2 transition-colors';
            tagElement.style.borderColor = tag.color;
            tagElement.style.color = tag.color;
            tagElement.textContent = tag.name;
            tagElement.dataset.tagId = tag._id;

            tagElement.addEventListener('click', () => {
                this.toggleEditTagSelection(tagElement, tag);
            });

            container.appendChild(tagElement);
        });
    }

    renderSubEntryTagSelection() {
        const container = document.getElementById('sub-entry-tag-selection');
        container.innerHTML = '';

        this.tags.forEach(tag => {
            const tagElement = document.createElement('button');
            tagElement.type = 'button';
            tagElement.className = 'sub-entry-tag-button px-3 py-1 rounded-full text-sm font-medium border-2 transition-colors';
            tagElement.style.borderColor = tag.color;
            tagElement.style.color = tag.color;
            tagElement.textContent = tag.name;
            tagElement.dataset.tagId = tag._id;

            tagElement.addEventListener('click', () => {
                this.toggleSubEntryTagSelection(tagElement, tag);
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

    toggleEditTagSelection(element, tag) {
        element.classList.toggle('selected');
        if (element.classList.contains('selected')) {
            element.style.backgroundColor = tag.color;
            element.style.color = 'white';
        } else {
            element.style.backgroundColor = 'transparent';
            element.style.color = tag.color;
        }
    }

    toggleSubEntryTagSelection(element, tag) {
        element.classList.toggle('selected');
        if (element.classList.contains('selected')) {
            element.style.backgroundColor = tag.color;
            element.style.color = 'white';
        } else {
            element.style.backgroundColor = 'transparent';
            element.style.color = tag.color;
        }
    }

    // Friend Selection Methods
    renderFriendSelection() {
        const container = document.getElementById('friend-selection');
        const searchInput = document.getElementById('friend-search');
        if (!container) return;

        this.renderFriendCheckboxes(container, this.friends);
        this.setupFriendSearch(searchInput, container);
    }

    renderEditFriendSelection() {
        const container = document.getElementById('edit-friend-selection');
        const searchInput = document.getElementById('edit-friend-search');
        if (!container) return;

        this.renderFriendCheckboxes(container, this.friends, 'edit');
        this.setupFriendSearch(searchInput, container, 'edit');
    }

    renderSubEntryFriendSelection() {
        const container = document.getElementById('sub-entry-friend-selection');
        const searchInput = document.getElementById('sub-entry-friend-search');
        if (!container) return;

        this.renderFriendCheckboxes(container, this.friends, 'sub-entry');
        this.setupFriendSearch(searchInput, container, 'sub-entry');
    }    renderFriendCheckboxes(container, friends, prefix = '') {
        container.innerHTML = '';
        
        if (friends.length === 0) {
            container.innerHTML = `
                <div class="text-center text-gray-500 dark:text-gray-400 py-4">
                    <p class="text-sm" data-i18n="diary.noFriendsAvailable">No friends available</p>
                    <a href="/friends" class="text-blue-600 dark:text-blue-400 hover:underline text-xs" data-i18n="diary.createFriendsFirst">
                        Create friends first →
                    </a>
                </div>
            `;
            return;
        }

        friends.forEach(friend => {
            const checkboxWrapper = document.createElement('div');
            checkboxWrapper.className = 'friend-checkbox';
            
            const checkboxId = prefix ? `${prefix}-friend-${friend._id}` : `friend-${friend._id}`;
            
            checkboxWrapper.innerHTML = `
                <input 
                    type="checkbox" 
                    id="${checkboxId}" 
                    value="${friend._id}"
                    data-friend-id="${friend._id}"
                />
                <label for="${checkboxId}">
                    ${this.escapeHtml(friend.name)}
                    ${friend.tags && friend.tags.length > 0 ? 
                        `<span class="text-xs text-gray-500 dark:text-gray-400 ml-1">(${friend.tags.length} tags)</span>` : 
                        '<span class="text-xs text-gray-500 dark:text-gray-400 ml-1" data-i18n="diary.noTags">(no tags)</span>'
                    }
                </label>
            `;
            
            container.appendChild(checkboxWrapper);
        });
    }

    setupFriendSearch(searchInput, container, prefix = '') {
        if (!searchInput) return;

        searchInput.addEventListener('input', (e) => {
            const searchTerm = e.target.value.toLowerCase();
            const filteredFriends = this.friends.filter(friend => 
                friend.name.toLowerCase().includes(searchTerm)
            );
            this.renderFriendCheckboxes(container, filteredFriends, prefix);
        });
    }

    getSelectedFriends(prefix = '') {
        const selector = prefix ? 
            `#${prefix}-friend-selection input[type="checkbox"]:checked` : 
            '#friend-selection input[type="checkbox"]:checked';
        
        return Array.from(document.querySelectorAll(selector))
            .map(checkbox => checkbox.value);
    }

    clearFriendSelection(prefix = '') {
        const selector = prefix ? 
            `#${prefix}-friend-selection input[type="checkbox"]` : 
            '#friend-selection input[type="checkbox"]';
        
        document.querySelectorAll(selector).forEach(checkbox => {
            checkbox.checked = false;
        });
        
        // Clear search input
        const searchInput = prefix ? 
            document.getElementById(`${prefix}-friend-search`) : 
            document.getElementById('friend-search');
        if (searchInput) {
            searchInput.value = '';
        }
    }

    renderEntries() {
        const container = document.getElementById('entries-container');
        const emptyState = document.getElementById('empty-state');
        const entriesDisplay = document.getElementById('entries-display');

        if (this.entries.length === 0) {
            container.innerHTML = '';
            emptyState.classList.remove('hidden');
            // Make background transparent when no entries
            entriesDisplay.classList.remove('bg-white', 'dark:bg-gray-800', 'shadow-sm');
            entriesDisplay.classList.add('bg-transparent');
            return;
        }

        emptyState.classList.add('hidden');
        // Restore background when entries exist
        entriesDisplay.classList.remove('bg-transparent');
        entriesDisplay.classList.add('bg-white', 'dark:bg-gray-800', 'shadow-sm');
        container.innerHTML = '';

        this.entries.forEach(entry => {
            const entryElement = this.createEntryElement(entry);
            container.appendChild(entryElement);
        });
    }    createEntryElement(entry, level = 0) {
        const entryDiv = document.createElement('div');
        entryDiv.className = `entry-item diary-entry ${level > 0 ? 'ml-6 mt-2' : ''}`;
        const priorityColors = {
            1: '#d52a2a',
            2: '#d96826',
            3: '#c2ac4c',
            4: '#17e8b0',
            5: '#18c1e7'
        };

        const priorityColor = priorityColors[entry.priority] || priorityColors[3];
        
        // Check if this entry has children for accordion functionality
        const hasChildren = entry.children && entry.children.length > 0;
        
        // Check if we've reached the maximum depth for sub-entries
        const isAtMaxDepth = level >= this.maxSubEntryDepth - 1;

        entryDiv.innerHTML = `
            <div class="flex items-start gap-4 group"><!-- Expandable indicator / Bullet Point -->
                <div class="flex-shrink-0 mt-1">
                    ${hasChildren ? `
                        <button class="toggle-children-btn w-4 h-4 rounded-full flex items-center justify-center transition-transform duration-200 border-2" 
                                style="border-color: ${priorityColor};" 
                                title="Expand/Collapse sub-entries">
                            <svg class="w-2.5 h-2.5 transform transition-transform duration-200 mt-[0.5px]" fill="${priorityColor}" stroke="${priorityColor}" viewBox="0 0 20 20">
                                <path fill-rule="evenodd" d="M 5.293 8.306 C 5.683 7.916 6.317 7.916 6.707 8.306 L 10 11.599 L 13.293 8.306 C 13.828 7.753 14.761 7.985 14.974 8.725 C 15.075 9.081 14.973 9.463 14.707 9.72 L 10.707 13.72 C 10.317 14.111 9.683 14.111 9.293 13.72 L 5.293 9.72 C 4.903 9.33 4.903 8.697 5.293 8.306 Z" clip-rule="evenodd"></path>
                            </svg>
                        </button>
                    ` : `
                        <div class="w-3 h-3 rounded-full border-2" style="border-color: ${priorityColor};"></div>
                    `}
                </div>
                
                <!-- Content -->
                <div class="flex-1 min-w-0">
                    <div class="entry-content text-gray-800 dark:text-white break-words">
                        ${this.escapeHtml(entry.content)}
                    </div>
                </div>
                  <!-- Tags and Friends -->
                <div class="flex-shrink-0">
                    <div class="flex flex-col items-end gap-1">
                        ${entry.tags && entry.tags.length > 0 ? `
                            <div class="entry-tags flex flex-wrap gap-1 justify-end">
                                ${entry.tags.map(tag => `
                                    <span class="px-2 py-1 rounded-full text-xs font-medium" style="background-color: ${tag.color}20; color: ${tag.color}; border: 1px solid ${tag.color}">
                                        ${tag.name}
                                    </span>
                                `).join('')}
                            </div>
                        ` : ''}
                        ${entry.friends && entry.friends.length > 0 ? `
                            <div class="entry-friends">
                                <span class="friend-count-badge px-2 py-1 rounded-full text-xs font-medium bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300 border border-purple-300 dark:border-purple-700 flex items-center gap-1 cursor-help" 
                                      title="${entry.friends.map(friend => friend.name).join(', ')}">
                                    <svg class="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                                        <path d="M9 6a3 3 0 11-6 0 3 3 0 016 0zM17 6a3 3 0 11-6 0 3 3 0 016 0zM12.93 17c.046-.327.07-.66.07-1a6.97 6.97 0 00-1.5-4.33A5 5 0 0119 16v1h-6.07zM6 11a5 5 0 015 5v1H1v-1a5 5 0 015-5z"></path>
                                    </svg>
                                    ${entry.friends.length}
                                </span>
                            </div>
                        ` : ''}
                    </div>
                </div>
                  <!-- Actions -->
                <div class="entry-actions flex-shrink-0 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button class="add-sub-entry-btn text-gray-400 hover:text-blue-600 p-1 ${isAtMaxDepth ? 'opacity-50 cursor-not-allowed' : ''}" 
                            data-parent-id="${entry._id}" 
                            title="${isAtMaxDepth ? 'Maximum sub-entry depth reached' : 'Add sub-entry'}"
                            ${isAtMaxDepth ? 'disabled' : ''}>
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"></path>
                        </svg>
                    </button>
                    <button class="edit-entry-btn text-gray-400 hover:text-blue-600 p-1" data-entry-id="${entry._id}" title="Edit">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path>
                        </svg>
                    </button>
                    <button class="delete-entry-btn text-gray-400 hover:text-red-600 p-1" data-entry-id="${entry._id}" title="Delete">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
                        </svg>
                    </button>
                </div>
            </div>
        `;        // Add event listeners for entry actions
        entryDiv.querySelector('.edit-entry-btn').addEventListener('click', () => {
            this.editEntry(entry._id);
        });

        entryDiv.querySelector('.delete-entry-btn').addEventListener('click', () => {
            this.deleteEntry(entry._id);
        });

        const addSubEntryBtn = entryDiv.querySelector('.add-sub-entry-btn');
        if (!isAtMaxDepth) {
            addSubEntryBtn.addEventListener('click', () => {
                this.addSubEntry(entry._id);
            });
        }

        // Add mobile long-press event listeners
        const entryContent = entryDiv.querySelector('.flex.items-start.gap-4.group');
        
        // Touch events for mobile
        entryContent.addEventListener('touchstart', (e) => {
            this.handleLongPressStart(entry, entryDiv, e);
        }, { passive: false });

        entryContent.addEventListener('touchend', (e) => {
            this.handleLongPressEnd(entryDiv);
        });

        entryContent.addEventListener('touchmove', (e) => {
            // Cancel long press if user moves finger
            this.handleLongPressEnd(entryDiv);
        });

        // Mouse events for desktop testing (optional)
        entryContent.addEventListener('mousedown', (e) => {
            if (this.isMobile()) {
                this.handleLongPressStart(entry, entryDiv, e);
            }
        });

        entryContent.addEventListener('mouseup', (e) => {
            if (this.isMobile()) {
                this.handleLongPressEnd(entryDiv);
            }
        });

        entryContent.addEventListener('mouseleave', (e) => {
            if (this.isMobile()) {
                this.handleLongPressEnd(entryDiv);
            }
        });

        // Add sub-entries if they exist
        if (hasChildren) {
            const subEntriesContainer = document.createElement('div');
            subEntriesContainer.className = 'sub-entries mt-2 transition-all duration-300 ease-in-out';
            subEntriesContainer.style.maxHeight = 'none'; // Start expanded
            subEntriesContainer.style.overflow = 'visible';
            
            entry.children.forEach(subEntry => {
                const subEntryElement = this.createEntryElement(subEntry, level + 1);
                subEntriesContainer.appendChild(subEntryElement);
            });
            
            entryDiv.appendChild(subEntriesContainer);

            // Add toggle functionality for accordion
            const toggleBtn = entryDiv.querySelector('.toggle-children-btn');
            if (toggleBtn) {
                toggleBtn.addEventListener('click', () => {
                    this.toggleSubEntries(toggleBtn, subEntriesContainer);
                });
            }
        }        // Helper method to add tooltip functionality to friend count badges
        this.addFriendTooltip(entryDiv, entry);

        return entryDiv;
    }    toggleSubEntries(toggleBtn, subEntriesContainer) {
        const icon = toggleBtn.querySelector('svg');
        const isExpanded = !subEntriesContainer.classList.contains('collapsed');
        
        if (isExpanded) {
            // Collapse
            subEntriesContainer.style.maxHeight = '0px';
            subEntriesContainer.style.overflow = 'hidden';
            subEntriesContainer.style.margin = '0';
            subEntriesContainer.classList.add('collapsed');
            icon.style.transform = 'rotate(-90deg)'; // Point right when collapsed
        } else {
            // Expand
            subEntriesContainer.style.maxHeight = 'none';
            subEntriesContainer.style.overflow = 'visible';
            subEntriesContainer.style.margin = '';
            subEntriesContainer.classList.remove('collapsed');
            icon.style.transform = 'rotate(0deg)'; // Point down when expanded
        }
    }    async addEntry() {
        const content = document.getElementById('entry-content').value.trim();
        const priority = parseInt(document.getElementById('entry-priority').value);
        const date = document.getElementById('entry-date').value;
        
        if (!content) return;

        // Get selected tags
        const selectedTags = Array.from(document.querySelectorAll('.tag-button.selected')).map(btn => btn.dataset.tagId);
        
        // Get selected friends
        const selectedFriends = this.getSelectedFriends();

        try {
            const response = await fetch('/api/entries', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    content,
                    priority,
                    date,
                    tagIds: selectedTags,
                    friendIds: selectedFriends
                })
            });

            const result = await response.json();
              if (result.success) {                // Clear form
                document.getElementById('entry-content').value = '';
                document.getElementById('entry-priority').value = '3';
                this.setCurrentViewedDate();
                
                // Clear tag selection
                document.querySelectorAll('.tag-button.selected').forEach(btn => {
                    const tag = this.tags.find(t => t._id === btn.dataset.tagId);
                    this.toggleTagSelection(btn, tag);
                });

                // Clear friend selection
                this.clearFriendSelection();

                // Close modal
                closeModal('add-entry-modal');

                // Reload entries
                await this.loadEntries();
                
                // Show success toast
                showToast('Entry added successfully!', 'success');
            } else {
                showToast('Error adding entry: ' + result.error, 'error');
            }
        } catch (error) {
            console.error('Error adding entry:', error);
            showToast('Error adding entry', 'error');
        }
    }async addSubEntry(parentId) {
        // Store the parent ID
        document.getElementById('sub-entry-parent-id').value = parentId;
          // Set default priority
        document.getElementById('sub-entry-priority').value = '3';
        
        // Clear existing tag selections
        document.querySelectorAll('.sub-entry-tag-button.selected').forEach(btn => {
            const tag = this.tags.find(t => t._id === btn.dataset.tagId);
            this.toggleSubEntryTagSelection(btn, tag);
        });

        // Open the modal
        openModal('add-sub-entry-modal');
    }    async saveSubEntry() {
        const parentId = document.getElementById('sub-entry-parent-id').value;
        const content = document.getElementById('sub-entry-content').value.trim();
        const priority = parseInt(document.getElementById('sub-entry-priority').value);
        
        if (!content) return;

        // Get selected tags
        const selectedTags = Array.from(document.querySelectorAll('.sub-entry-tag-button.selected')).map(btn => btn.dataset.tagId);
        
        // Get selected friends
        const selectedFriends = this.getSelectedFriends('sub-entry');

        try {
            const response = await fetch('/api/entries', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    content,
                    priority,
                    date: this.currentDate.toISOString().split('T')[0],
                    parentEntryId: parentId,
                    tagIds: selectedTags,
                    friendIds: selectedFriends
                })
            });

            const result = await response.json();
              if (result.success) {                // Clear form
                document.getElementById('sub-entry-content').value = '';
                document.getElementById('sub-entry-priority').value = '3';
                
                // Clear tag selection
                document.querySelectorAll('.sub-entry-tag-button.selected').forEach(btn => {
                    const tag = this.tags.find(t => t._id === btn.dataset.tagId);
                    this.toggleSubEntryTagSelection(btn, tag);
                });

                // Clear friend selection
                this.clearFriendSelection('sub-entry');

                // Close modal
                closeModal('add-sub-entry-modal');

                // Reload entries
                await this.loadEntries();
                
                // Show success toast
                showToast('Sub-entry added successfully!', 'success');
            } else {
                showToast('Error adding sub-entry: ' + result.error, 'error');
            }
        } catch (error) {
            console.error('Error adding sub-entry:', error);
            showToast('Error adding sub-entry', 'error');
        }
    }async editEntry(entryId) {
        const findEntryRecursive = (entries) => {
            for (const e of entries) {
                if (e._id === entryId) return e;
                if (e.children && e.children.length > 0) {
                    const found = findEntryRecursive(e.children);
                    if (found) return found;
                }
            }
            return null;
        };

        const entry = findEntryRecursive(this.entries);
        if (!entry) return;

        // Populate the edit form
        document.getElementById('edit-entry-id').value = entry._id;
        document.getElementById('edit-entry-content').value = entry.content;
        document.getElementById('edit-entry-priority').value = entry.priority;
        document.getElementById('edit-entry-date').value = entry.date ? new Date(entry.date).toISOString().split('T')[0] : '';        // Clear existing tag selections
        document.querySelectorAll('.edit-tag-button.selected').forEach(btn => {
            const tag = this.tags.find(t => t._id === btn.dataset.tagId);
            this.toggleEditTagSelection(btn, tag);
        });

        // Clear existing friend selections
        this.clearFriendSelection('edit');

        // Select the entry's tags
        if (entry.tags && entry.tags.length > 0) {
            entry.tags.forEach(entryTag => {
                const tagButton = document.querySelector(`.edit-tag-button[data-tag-id="${entryTag._id}"]`);
                if (tagButton && !tagButton.classList.contains('selected')) {
                    const tag = this.tags.find(t => t._id === entryTag._id);
                    this.toggleEditTagSelection(tagButton, tag);
                }
            });
        }

        // Select the entry's friends
        if (entry.friends && entry.friends.length > 0) {
            entry.friends.forEach(entryFriend => {
                const friendCheckbox = document.querySelector(`#edit-friend-selection input[value="${entryFriend._id}"]`);
                if (friendCheckbox && !friendCheckbox.checked) {
                    friendCheckbox.checked = true;
                }
            });
        }

        // Open the modal
        openModal('edit-entry-modal');
    }    async saveEditEntry() {
        const entryId = document.getElementById('edit-entry-id').value;
        const content = document.getElementById('edit-entry-content').value.trim();
        const priority = parseInt(document.getElementById('edit-entry-priority').value);
        const date = document.getElementById('edit-entry-date').value;
        
        if (!content) return;

        // Get selected tags
        const selectedTags = Array.from(document.querySelectorAll('.edit-tag-button.selected')).map(btn => btn.dataset.tagId);
        
        // Get selected friends
        const selectedFriends = this.getSelectedFriends('edit');

        try {
            const response = await fetch(`/api/entries/${entryId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    content,
                    priority,
                    date,
                    tagIds: selectedTags,
                    friendIds: selectedFriends
                })
            });

            const result = await response.json();
              if (result.success) {                // Clear form
                document.getElementById('edit-entry-content').value = '';
                document.getElementById('edit-entry-priority').value = '3';
                
                // Clear tag selection
                document.querySelectorAll('.edit-tag-button.selected').forEach(btn => {
                    const tag = this.tags.find(t => t._id === btn.dataset.tagId);
                    this.toggleEditTagSelection(btn, tag);
                });

                // Clear friend selection
                this.clearFriendSelection('edit');

                // Close modal
                closeModal('edit-entry-modal');

                // Reload entries
                await this.loadEntries();
                
                // Show success toast
                showToast('Entry updated successfully!', 'success');
            } else {
                showToast('Error updating entry: ' + result.error, 'error');
            }
        } catch (error) {
            console.error('Error updating entry:', error);
            showToast('Error updating entry', 'error');
        }
    }

    async deleteEntry(entryId) {
        if (!confirm('Are you sure you want to delete this entry? This will also delete any sub-entries.')) {
            return;
        }

        try {
            const response = await fetch(`/api/entries/${entryId}`, {
                method: 'DELETE'
            });

            const result = await response.json();
              if (result.success) {
                await this.loadEntries();
                // Show success toast
                showToast('Entry deleted successfully!', 'success');
            } else {
                showToast('Error deleting entry: ' + result.error, 'error');
            }
        } catch (error) {
            console.error('Error deleting entry:', error);
            showToast('Error deleting entry', 'error');
        }
    }

    showLoading() {
        document.getElementById('loading').classList.remove('hidden');
        document.getElementById('entries-container').style.opacity = '0.5';
    }

    hideLoading() {
        document.getElementById('loading').classList.add('hidden');
        document.getElementById('entries-container').style.opacity = '1';
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;        return div.innerHTML.replace(/\n/g, '<br>');
    }

    // Helper method to calculate the depth of an entry in the hierarchy
    calculateEntryDepth(entryId, entries = this.entries, currentDepth = 0) {
        for (const entry of entries) {
            if (entry._id === entryId) {
                return currentDepth;
            }
            if (entry.children && entry.children.length > 0) {
                const foundDepth = this.calculateEntryDepth(entryId, entry.children, currentDepth + 1);
                if (foundDepth !== -1) {
                    return foundDepth;
                }
            }
        }
        return -1;
    }

    // Mobile detection
    isMobile() {
        return window.innerWidth < 768;
    }    // Create context menu for mobile
    createContextMenu() {
        // Create backdrop
        this.contextBackdrop = document.createElement('div');
        this.contextBackdrop.className = 'diary-context-backdrop';
        this.contextBackdrop.addEventListener('click', () => this.hideContextMenu());
        document.body.appendChild(this.contextBackdrop);

        // Create context menu
        this.contextMenu = document.createElement('div');
        this.contextMenu.className = 'diary-context-menu';
        document.body.appendChild(this.contextMenu);
    }

    // Remove context menu when switching to desktop
    removeContextMenu() {
        if (this.contextMenu) {
            this.hideContextMenu();
            if (this.contextMenu.parentNode) {
                this.contextMenu.parentNode.removeChild(this.contextMenu);
            }
            if (this.contextBackdrop && this.contextBackdrop.parentNode) {
                this.contextBackdrop.parentNode.removeChild(this.contextBackdrop);
            }
            this.contextMenu = null;
            this.contextBackdrop = null;
        }
    }

    // Show context menu
    showContextMenu(entry, x, y) {
        if (!this.isMobile()) return;

        // Check if we've reached the maximum depth for sub-entries
        const currentDepth = this.calculateEntryDepth(entry._id);
        const isAtMaxDepth = currentDepth >= this.maxSubEntryDepth - 1;

        this.contextMenu.innerHTML = `
            <button class="diary-context-menu-item" data-action="add-sub" ${isAtMaxDepth ? 'disabled style="opacity: 0.5; cursor: not-allowed;"' : ''}>
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"></path>
                </svg>
                ${isAtMaxDepth ? 'Max depth reached' : 'Add sub-entry'}
            </button>
            <button class="diary-context-menu-item" data-action="edit">
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path>
                </svg>
                Edit
            </button>
            <button class="diary-context-menu-item danger" data-action="delete">
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
                </svg>
                Delete
            </button>
        `;

        // Add event listeners
        this.contextMenu.querySelectorAll('.diary-context-menu-item').forEach(item => {
            item.addEventListener('click', (e) => {
                if (item.disabled) return;
                
                const action = item.dataset.action;
                this.hideContextMenu();
                
                switch (action) {
                    case 'add-sub':
                        this.addSubEntry(entry._id);
                        break;
                    case 'edit':
                        this.editEntry(entry._id);
                        break;
                    case 'delete':
                        this.deleteEntry(entry._id);
                        break;
                }
            });
        });

        // Position the menu
        const rect = this.contextMenu.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        let menuX = x;
        let menuY = y;

        // Adjust position if menu would go off screen
        if (menuX + rect.width > viewportWidth) {
            menuX = viewportWidth - rect.width - 10;
        }
        if (menuY + rect.height > viewportHeight) {
            menuY = viewportHeight - rect.height - 10;
        }

        this.contextMenu.style.left = menuX + 'px';
        this.contextMenu.style.top = menuY + 'px';

        // Show menu
        this.contextBackdrop.classList.add('show');
        this.contextMenu.classList.add('show');
    }

    // Hide context menu
    hideContextMenu() {
        if (this.contextMenu) {
            this.contextMenu.classList.remove('show');
            this.contextBackdrop.classList.remove('show');
        }
    }

    // Handle long press start
    handleLongPressStart(entry, element, event) {
        if (!this.isMobile()) return;

        // Prevent default to avoid text selection
        event.preventDefault();
        
        this.longPressEntry = entry;
        element.classList.add('long-press-active');
        
        this.longPressTimer = setTimeout(() => {
            const touch = event.touches ? event.touches[0] : event;
            this.showContextMenu(entry, touch.clientX, touch.clientY);
            this.longPressTimer = null;
        }, LONG_PRESS_DELAY);
    }

    // Handle long press end
    handleLongPressEnd(element) {
        if (!this.isMobile()) return;

        if (this.longPressTimer) {
            clearTimeout(this.longPressTimer);
            this.longPressTimer = null;
        }
        
        element.classList.remove('long-press-active');
        this.longPressEntry = null;
    }    // Helper method to add tooltip functionality to friend count badges
    addFriendTooltip(entryDiv, entry) {
        const friendBadge = entryDiv.querySelector('.friend-count-badge');
        if (!friendBadge || !entry.friends || entry.friends.length === 0) return;

        let tooltip = null;
        let hideTimeout = null;

        const showTooltip = () => {
            // Clear any existing hide timeout
            if (hideTimeout) {
                clearTimeout(hideTimeout);
                hideTimeout = null;
            }

            // Don't create a new tooltip if one already exists
            if (tooltip) return;

            // Create tooltip element
            tooltip = document.createElement('div');
            tooltip.className = 'friend-tooltip fixed z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg';
            tooltip.style.minWidth = '160px';
            tooltip.style.maxWidth = '250px';
            tooltip.style.pointerEvents = 'auto'; // Allow interaction with tooltip
            
            // Create scrollable content
            const friendsList = document.createElement('div');
            friendsList.className = 'p-2';
            
            // Calculate dynamic height based on number of friends
            const itemHeight = 28; // Approximate height per friend item including padding
            const maxItems = 6; // Maximum number of items to show before scrolling
            const actualItems = Math.min(entry.friends.length, maxItems);
            const listHeight = actualItems * itemHeight;
            const maxHeight = Math.min(listHeight + 16, 180); // Add padding and cap at 180px
            
            friendsList.style.maxHeight = maxHeight + 'px';
            friendsList.style.overflowY = entry.friends.length > maxItems ? 'auto' : 'visible';
            
            entry.friends.forEach((friend, index) => {
                const friendItem = document.createElement('div');
                friendItem.className = 'text-sm text-gray-800 dark:text-gray-200 py-1.5 px-2 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors';
                friendItem.textContent = friend.name;
                friendsList.appendChild(friendItem);
            });
            
            tooltip.appendChild(friendsList);
            
            // Add hover events to tooltip to keep it visible
            tooltip.addEventListener('mouseenter', () => {
                if (hideTimeout) {
                    clearTimeout(hideTimeout);
                    hideTimeout = null;
                }
            });

            tooltip.addEventListener('mouseleave', hideTooltip);
            
            // Set initial position off-screen for measurement
            tooltip.style.visibility = 'hidden';
            tooltip.style.opacity = '0';
            document.body.appendChild(tooltip);
            
            // Force layout calculation
            tooltip.offsetHeight;
            
            // Position tooltip after it's been added to DOM
            const badgeRect = friendBadge.getBoundingClientRect();
            const tooltipRect = tooltip.getBoundingClientRect();
            
            let left = badgeRect.left + (badgeRect.width / 2) - (tooltipRect.width / 2);
            let top = badgeRect.top - tooltipRect.height - 8;
            
            // Adjust if tooltip goes off screen horizontally
            if (left < 8) left = 8;
            if (left + tooltipRect.width > window.innerWidth - 8) {
                left = window.innerWidth - tooltipRect.width - 8;
            }
            
            // Adjust if tooltip goes off screen vertically
            if (top < 8) {
                top = badgeRect.bottom + 8;
                tooltip.classList.add('tooltip-bottom');
            }
            
            // Ensure tooltip doesn't go below viewport
            if (top + tooltipRect.height > window.innerHeight - 8) {
                top = window.innerHeight - tooltipRect.height - 8;
            }
            
            tooltip.style.left = left + 'px';
            tooltip.style.top = top + 'px';
            tooltip.style.visibility = 'visible';
            
            // Animate in
            tooltip.style.transition = 'opacity 0.2s ease-in-out, transform 0.2s ease-in-out';
            tooltip.style.transform = 'translateY(-4px)';
            
            requestAnimationFrame(() => {
                tooltip.style.opacity = '1';
                tooltip.style.transform = 'translateY(0)';
            });
        };

        const hideTooltip = () => {
            // Add a small delay before hiding to allow for mouse movement between badge and tooltip
            hideTimeout = setTimeout(() => {
                if (tooltip) {
                    tooltip.style.opacity = '0';
                    tooltip.style.transform = 'translateY(-4px)';
                    setTimeout(() => {
                        if (tooltip && tooltip.parentNode) {
                            tooltip.parentNode.removeChild(tooltip);
                        }
                        tooltip = null;
                    }, 200);
                }
                hideTimeout = null;
            }, 100);
        };

        friendBadge.addEventListener('mouseenter', showTooltip);
        friendBadge.addEventListener('mouseleave', hideTooltip);
    }
}

// Initialize the diary app when the page loads
document.addEventListener('DOMContentLoaded', () => {
    window.diaryApp = new DiaryApp();
});

// Global function to open add entry modal with date set
function openAddEntryModal() {
    if (window.diaryApp) {
        window.diaryApp.openAddEntryModal();
    }
}
