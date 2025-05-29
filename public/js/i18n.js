// Client-side internationalization (i18n) system
class I18nClient {
    constructor() {
        this.translations = {};
        this.currentLocale = 'en';
        this.initialized = false;
    }

    /**
     * Initialize the i18n system with translations data
     * This is called from the server-rendered template
     */
    init(translations, locale = 'en') {
        this.translations = translations || {};
        this.currentLocale = locale;
        this.initialized = true;
    }

    /**
     * Get a translation for a given key
     * Supports nested keys like 'diary.title' or 'relevance.levels.1'
     */
    t(key, params = {}) {
        if (!this.initialized) {
            console.warn('I18n not initialized. Returning key:', key);
            return key;
        }

        const keys = key.split('.');
        let value = this.translations;

        // Navigate through nested object
        for (const k of keys) {
            if (value && typeof value === 'object' && k in value) {
                value = value[k];
            } else {
                console.warn(`Translation key not found: ${key}`);
                return key; // Return the key if translation not found
            }
        }

        // If final value is not a string, return the key
        if (typeof value !== 'string') {
            console.warn(`Translation value is not a string for key: ${key}`);
            return key;
        }

        // Replace parameters in the translation string
        // Supports patterns like {{paramName}}
        return this.interpolate(value, params);
    }

    /**
     * Replace parameters in translation strings
     * Supports patterns like {{paramName}} or {paramName}
     */
    interpolate(template, params) {
        if (!params || Object.keys(params).length === 0) {
            return template;
        }

        return template.replace(/\{\{?(\w+)\}?\}/g, (match, key) => {
            return params.hasOwnProperty(key) ? params[key] : match;
        });
    }

    /**
     * Get the current locale
     */
    getLocale() {
        return this.currentLocale;
    }

    /**
     * Check if i18n is initialized
     */
    isInitialized() {
        return this.initialized;
    }
}

// Create global instance
window.i18n = new I18nClient();

// Global convenience function for translations
window.t = function(key, params) {
    return window.i18n.t(key, params);
};
