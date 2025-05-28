class SettingsManager {
    constructor() {
        this.defaultDurations = {
            1: 30,
            2: 14,
            3: 7,
            4: 3,
            5: 1
        };
        this.init();
    }

    init() {
        this.bindEvents();
        this.loadPriorityDurations();
    }
    bindEvents() {
        // Priority durations form
        const form = document.getElementById('priority-durations-form');
        if (form) {
            form.addEventListener('submit', (e) => {
                e.preventDefault();
                this.handleSavePriorityDurations();
            });
        }

        // Reset to defaults button
        const resetBtn = document.getElementById('reset-durations');
        if (resetBtn) {
            resetBtn.addEventListener('click', () => {
                this.resetToDefaults();
            });
        }

        // Input validation - bind after form is shown
        this.bindInputValidation();
    }
    bindInputValidation() {
        ['priority-1', 'priority-2', 'priority-3', 'priority-4', 'priority-5'].forEach(id => {
            const input = document.getElementById(id);
            if (input) {
                input.addEventListener('input', () => {
                    this.validateDurationInput(input);
                });
            }
        });
    }
    async loadPriorityDurations() {
        try {
            showLoading('durations-loading');

            const response = await fetch('/api/settings/priority-durations');
            const result = await response.json();

            if (!result.success) {
                throw new Error(result.error || 'Failed to load priority durations');
            }

            this.populateDurationForm(result.data);
            this.showForm();

        } catch (error) {
            console.error('Error loading priority durations:', error);
            showToast('Failed to load settings. Please try again.', 'error');
            // Use defaults if loading fails
            this.populateDurationForm(this.defaultDurations);
            this.showForm();
        } finally {
            // Ensure loading is hidden even if an error occurs
            hideLoading('durations-loading');
        }
    }
    async handleSavePriorityDurations() {
        try {
            const durations = {
                1: parseInt(document.getElementById('priority-1').value),
                2: parseInt(document.getElementById('priority-2').value),
                3: parseInt(document.getElementById('priority-3').value),
                4: parseInt(document.getElementById('priority-4').value),
                5: parseInt(document.getElementById('priority-5').value)
            };

            // Validate inputs
            for (const [level, duration] of Object.entries(durations)) {
                if (!duration || duration < 1 || duration > 365) {
                    showToast(`Priority ${level} duration must be between 1 and 365 days`, 'error');
                    return;
                }
            }            const response = await fetch('/api/settings/priority-durations', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(durations),
            });

            const result = await response.json();

            if (!result.success) {
                throw new Error(result.error || 'Failed to save settings');
            }

            showToast('Priority duration settings saved successfully!', 'success');

        } catch (error) {
            console.error('Error saving priority durations:', error);
            showToast(error.message || 'Failed to save settings', 'error');
        }
    }

    resetToDefaults() {
        if (confirm('Are you sure you want to reset priority durations to default values?')) {
            this.populateDurationForm(this.defaultDurations);
            showToast('Settings reset to defaults. Click "Save Changes" to apply.', 'info');
        }
    }

    populateDurationForm(durations) {
        document.getElementById('priority-1').value = durations[1] || this.defaultDurations[1];
        document.getElementById('priority-2').value = durations[2] || this.defaultDurations[2];
        document.getElementById('priority-3').value = durations[3] || this.defaultDurations[3];
        document.getElementById('priority-4').value = durations[4] || this.defaultDurations[4];
        document.getElementById('priority-5').value = durations[5] || this.defaultDurations[5];
    }

    validateDurationInput(input) {
        const value = parseInt(input.value);
        const isValid = value >= 1 && value <= 365;

        if (!isValid && input.value !== '') {
            input.classList.add('border-red-500', 'focus:ring-red-500');
            input.classList.remove('border-gray-300', 'focus:ring-blue-500');
        } else {
            input.classList.remove('border-red-500', 'focus:ring-red-500');
            input.classList.add('border-gray-300', 'focus:ring-blue-500');
        }
        return isValid;
    }
    showForm() {
        hideLoading('durations-loading');
        const form = document.getElementById('durations-form');
        if (form) {
            form.classList.remove('hidden');
            // Bind input validation after form is shown
            this.bindInputValidation();
        }
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Initialize the settings manager when the page loads
document.addEventListener('DOMContentLoaded', () => {
    new SettingsManager();
});