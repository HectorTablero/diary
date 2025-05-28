/**
 * Component System JavaScript
 * Handles modal interactions, form components, and reusable UI elements
 */

// Modal Management
class ModalManager {
    constructor() {
        this.activeModals = new Set();
        this.initializeEventListeners();
    }

    initializeEventListeners() {
        // Close modal when clicking outside
        document.addEventListener('click', (e) => {
            if (e.target.classList.contains('modal-overlay')) {
                const modal = e.target.closest('.modal');
                if (modal) {
                    this.closeModal(modal.id);
                }
            }
        });

        // Close modal with Escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.activeModals.size > 0) {
                const modals = Array.from(this.activeModals);
                this.closeModal(modals[modals.length - 1]);
            }
        });

        // Handle close buttons
        document.addEventListener('click', (e) => {
            if (e.target.matches('[data-modal-close]')) {
                const modalId = e.target.getAttribute('data-modal-close');
                this.closeModal(modalId);
            }
        });
    }

    openModal(modalId) {
        const modal = document.getElementById(modalId);
        if (!modal) {
            console.warn(`Modal with id "${modalId}" not found`);
            return;
        }

        modal.classList.remove('hidden');
        modal.classList.add('flex');
        this.activeModals.add(modalId);
        
        // Focus the first focusable element
        setTimeout(() => {
            const focusable = modal.querySelector('input, button, select, textarea, [tabindex]:not([tabindex="-1"])');
            if (focusable) {
                focusable.focus();
            }
        }, 100);

        // Prevent body scroll
        document.body.style.overflow = 'hidden';
    }

    closeModal(modalId) {
        const modal = document.getElementById(modalId);
        if (!modal) return;

        modal.classList.add('hidden');
        modal.classList.remove('flex');
        this.activeModals.delete(modalId);

        // Restore body scroll if no modals are open
        if (this.activeModals.size === 0) {
            document.body.style.overflow = '';
        }

        // Clear form data if present
        const form = modal.querySelector('form');
        if (form) {
            form.reset();
        }
    }

    closeAllModals() {
        this.activeModals.forEach(modalId => this.closeModal(modalId));
    }
}

// Tag Component Management
class TagManager {
    constructor() {
        this.selectedTags = new Set();
        this.initializeEventListeners();
    }

    initializeEventListeners() {
        document.addEventListener('click', (e) => {
            if (e.target.matches('.tag-selectable')) {
                this.toggleTagSelection(e.target);
            }
            
            if (e.target.matches('.tag-removable')) {
                this.removeTag(e.target);
            }
        });
    }

    toggleTagSelection(tagElement) {
        const tagId = tagElement.getAttribute('data-tag-id');
        const isSelected = tagElement.classList.contains('tag-selected');

        if (isSelected) {
            tagElement.classList.remove('tag-selected');
            this.selectedTags.delete(tagId);
        } else {
            tagElement.classList.add('tag-selected');
            this.selectedTags.add(tagId);
        }

        // Trigger custom event
        const event = new CustomEvent('tagSelectionChanged', {
            detail: { tagId, selected: !isSelected, allSelected: Array.from(this.selectedTags) }
        });
        document.dispatchEvent(event);
    }

    removeTag(tagElement) {
        const tagId = tagElement.getAttribute('data-tag-id');
        
        // Trigger custom event before removal
        const event = new CustomEvent('tagRemoved', {
            detail: { tagId, element: tagElement }
        });
        document.dispatchEvent(event);

        // Remove from selected tags if present
        this.selectedTags.delete(tagId);
        
        // Remove element with animation
        tagElement.style.opacity = '0';
        tagElement.style.transform = 'scale(0.8)';
        setTimeout(() => {
            tagElement.remove();
        }, 200);
    }

    getSelectedTags() {
        return Array.from(this.selectedTags);
    }

    clearSelection() {
        document.querySelectorAll('.tag-selected').forEach(tag => {
            tag.classList.remove('tag-selected');
        });
        this.selectedTags.clear();
    }

    selectTags(tagIds) {
        this.clearSelection();
        tagIds.forEach(tagId => {
            const tagElement = document.querySelector(`[data-tag-id="${tagId}"]`);
            if (tagElement) {
                tagElement.classList.add('tag-selected');
                this.selectedTags.add(tagId);
            }
        });
    }
}

// Loading State Manager
class LoadingManager {
    static show(elementId, text = 'Loading...') {
        const element = document.getElementById(elementId);
        if (!element) return;

        element.classList.remove('hidden');
        element.classList.add('flex');
        
        if (text) {
            const textElement = element.querySelector('.loading-text');
            if (textElement) {
                textElement.textContent = text;
            }
        }
    }

    static hide(elementId) {
        const element = document.getElementById(elementId);
        if (!element) return;

        element.classList.add('hidden');
        element.classList.remove('flex');
    }

    static toggle(elementId, show, text) {
        if (show) {
            this.show(elementId, text);
        } else {
            this.hide(elementId);
        }
    }
}

// Empty State Manager
class EmptyStateManager {
    static show(elementId) {
        const element = document.getElementById(elementId);
        if (!element) return;

        element.classList.remove('hidden');
        element.classList.add('block');
    }

    static hide(elementId) {
        const element = document.getElementById(elementId);
        if (!element) return;

        element.classList.add('hidden');
        element.classList.remove('block');
    }

    static toggle(elementId, show) {
        if (show) {
            this.show(elementId);
        } else {
            this.hide(elementId);
        }
    }
}

// Form Validation Helper
class FormValidator {
    static validateForm(formElement) {
        const inputs = formElement.querySelectorAll('input[required], select[required], textarea[required]');
        let isValid = true;
        const errors = [];

        inputs.forEach(input => {
            if (!input.value.trim()) {
                isValid = false;
                errors.push(`${input.getAttribute('data-label') || input.name || 'Field'} is required`);
                this.addErrorState(input);
            } else {
                this.removeErrorState(input);
            }
        });

        return { isValid, errors };
    }

    static addErrorState(input) {
        input.classList.add('border-red-500', 'focus:ring-red-500');
        input.classList.remove('border-gray-300', 'focus:ring-blue-500');
    }

    static removeErrorState(input) {
        input.classList.remove('border-red-500', 'focus:ring-red-500');
        input.classList.add('border-gray-300', 'focus:ring-blue-500');
    }

    static clearFormErrors(formElement) {
        const inputs = formElement.querySelectorAll('input, select, textarea');
        inputs.forEach(input => this.removeErrorState(input));
    }
}

// Toast Notification System
class ToastManager {
    constructor() {
        this.container = null;
        this.toasts = new Map();
        // Initialize container when DOM is ready
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                this.container = this.createContainer();
            });
        } else {
            this.container = this.createContainer();
        }
    }createContainer() {
        let container = document.getElementById('toast-container');
        if (!container) {
            // Make sure document.body exists
            if (!document.body) {
                console.warn('Document body not ready for toast container');
                return null;
            }
            container = document.createElement('div');
            container.id = 'toast-container';
            container.className = 'fixed top-4 right-4 z-50 space-y-2';
            document.body.appendChild(container);
        }
        return container;
    }    show(message, type = 'info', duration = 5000) {
        // Ensure container exists
        if (!this.container) {
            this.container = this.createContainer();
        }
        
        if (!this.container) {
            console.warn('Toast container not available');
            return;
        }

        const id = 'toast-' + Date.now();
        const toast = this.createToast(id, message, type);
        
        this.container.appendChild(toast);
        this.toasts.set(id, toast);

        // Animate in
        setTimeout(() => {
            toast.classList.add('translate-x-0', 'opacity-100');
            toast.classList.remove('translate-x-full', 'opacity-0');
        }, 10);

        // Auto remove
        if (duration > 0) {
            setTimeout(() => this.remove(id), duration);
        }

        return id;
    }    createToast(id, message, type) {
        const toast = document.createElement('div');
        toast.id = id;
        toast.className = `transform translate-x-full opacity-0 transition-all duration-300 ease-in-out max-w-sm w-full bg-white dark:bg-gray-800 shadow-lg rounded-lg pointer-events-auto ring-1 ring-black ring-opacity-5`;

        const colorClasses = {
            success: 'text-green-600 dark:text-green-400',
            error: 'text-red-600 dark:text-red-400',
            warning: 'text-yellow-600 dark:text-yellow-400',
            info: 'text-blue-600 dark:text-blue-400'
        };

        const iconPaths = {
            success: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z',
            error: 'M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z',
            warning: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.732-.833-2.464 0L4.732 16.5c-.77.833.192 2.5 1.732 2.5z',
            info: 'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z'
        };

        toast.innerHTML = `
            <div class="p-4">
                <div class="flex items-start">
                    <div class="flex-shrink-0">
                        <svg class="h-6 w-6 ${colorClasses[type] || colorClasses.info}" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="${iconPaths[type] || iconPaths.info}" />
                        </svg>
                    </div>
                    <div class="ml-3 flex-1 min-w-0 pt-0.5 pr-4">
                        <p class="text-sm font-medium text-gray-900 dark:text-white break-words">${message}</p>
                    </div>
                    <div class="ml-2 flex-shrink-0">
                        <button class="bg-white dark:bg-gray-800 rounded-md inline-flex text-gray-400 hover:text-gray-500 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500" onclick="toastManager.remove('${id}')">
                            <span class="sr-only">Close</span>
                            <svg class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
                            </svg>
                        </button>
                    </div>
                </div>
            </div>
        `;

        return toast;
    }

    remove(id) {
        const toast = this.toasts.get(id);
        if (!toast) return;

        // Animate out
        toast.classList.add('translate-x-full', 'opacity-0');
        toast.classList.remove('translate-x-0', 'opacity-100');

        setTimeout(() => {
            if (toast.parentNode) {
                toast.parentNode.removeChild(toast);
            }
            this.toasts.delete(id);
        }, 300);
    }

    success(message, duration) {
        return this.show(message, 'success', duration);
    }

    error(message, duration) {
        return this.show(message, 'error', duration);
    }

    warning(message, duration) {
        return this.show(message, 'warning', duration);
    }

    info(message, duration) {
        return this.show(message, 'info', duration);
    }
}

// Initialize global instances when DOM is ready
let modalManager, tagManager, toastManager;

function initializeComponents() {
    modalManager = new ModalManager();
    tagManager = new TagManager();
    toastManager = new ToastManager();

    // Global functions for easy access
    window.openModal = (modalId) => modalManager.openModal(modalId);
    window.closeModal = (modalId) => modalManager.closeModal(modalId);
    window.showLoading = (elementId, text) => LoadingManager.show(elementId, text);
    window.hideLoading = (elementId) => LoadingManager.hide(elementId);
    window.showEmptyState = (elementId) => EmptyStateManager.show(elementId);
    window.hideEmptyState = (elementId) => EmptyStateManager.hide(elementId);
    window.showToast = (message, type, duration) => toastManager.show(message, type, duration);
    window.validateForm = (formElement) => FormValidator.validateForm(formElement);
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeComponents);
} else {
    initializeComponents();
}
