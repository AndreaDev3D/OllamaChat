// Supported languages
const supportedLanguages = {
    'en': 'English',
    'es': 'Español',
    'pl': 'Polski',
    'fr': 'Français',
    'de': 'Deutsch',
    'it': 'Italiano',
    'zh': '中文',
    'ja': '日本語',
    "tr": "Türkçe"
};

let currentLanguage = 'en';
let translations = {};

// Function to load language file
async function loadLanguage(lang) {
    try {
        const response = await fetch(`lang/${lang}.json`);
        if (!response.ok) throw new Error(`Failed to load ${lang} language file`);
        translations = await response.json();
        currentLanguage = lang;

        // Update UI text with translations
        document.querySelectorAll('[data-i18n]').forEach(element => {
            const key = element.getAttribute('data-i18n');
            if (translations[key]) {
                if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
                    element.placeholder = translations[key];
                } else {
                    element.textContent = translations[key];
                }
            }
        });

        // Update tooltips
        document.querySelectorAll('[data-bs-toggle="tooltip"]').forEach(element => {
            // Remove existing tooltip instance
            const oldTooltip = bootstrap.Tooltip.getInstance(element);
            if (oldTooltip) {
                oldTooltip.dispose();
            }

            // Get tooltip key and create new instance with translated text
            const tooltipKey = element.getAttribute('data-i18n-title');
            if (tooltipKey && translations[tooltipKey]) {
                element.setAttribute('data-bs-title', translations[tooltipKey]);
            }

            // Initialize new tooltip
            new bootstrap.Tooltip(element);
        });

        // Update dynamic elements
        updateDynamicText();

        // Store the selected language
        localStorage.setItem('preferred_language', lang);
    } catch (error) {
        console.error('Error loading language:', error);
        // Fallback to English if loading fails and we're not already trying English
        if (lang !== 'en') {
            loadLanguage('en');
        }
    }
}

// Function to get translated text
function t(key) {
    return translations[key] || key;
}

// Function to update dynamic text like placeholders and UI states
function updateDynamicText() {
    // Update file upload area text
    const dropZoneInstruction = document.getElementById('drop-zone-instruction');
    if (dropZoneInstruction) {
        dropZoneInstruction.innerHTML = `<i class="bi bi-cloud-upload me-2"></i>${t('drop_files')}`;
    }

    // Update message input placeholder
    const userInput = document.getElementById('user-input');
    if (userInput) {
        userInput.placeholder = t('type_message');
    }

    // Update system prompt placeholder
    const systemPromptInput = document.getElementById('system-prompt-input');
    if (systemPromptInput) {
        systemPromptInput.placeholder = t('system_prompt_placeholder');
    }

    // Update send button text
    const sendButton = document.getElementById('send-button');
    if (sendButton) {
        const sendIcon = '<i class="bi bi-send-fill me-1"></i>';
        sendButton.innerHTML = sendIcon + t('send_message');
    }

    // Update reset chat button text
    const resetChatButton = document.getElementById('reset-chat-button');
    if (resetChatButton) {
        const trashIcon = '<i class="bi bi-trash3-fill me-1"></i>';
        resetChatButton.innerHTML = trashIcon + t('reset_chat');
    }
}

// Initialize language selector
document.addEventListener('DOMContentLoaded', () => {
    const languageSelect = document.getElementById('language-select');
    if (languageSelect) {
        // Populate dropdown with supported languages
        for (const [code, name] of Object.entries(supportedLanguages)) {
            const option = document.createElement('option');
            option.value = code;
            option.textContent = name;
            languageSelect.appendChild(option);
        }

        // Set initial value from localStorage or browser language
        const savedLang = localStorage.getItem('preferred_language') || navigator.language.split('-')[0];
        const validLang = supportedLanguages[savedLang] ? savedLang : 'en';
        languageSelect.value = validLang;
        loadLanguage(validLang);

        // Add change event listener
        languageSelect.addEventListener('change', (e) => {
            const selectedLang = e.target.value;
            loadLanguage(selectedLang);
            localStorage.setItem('preferred_language', selectedLang);
        });
    }
});

// Initialize with English
loadLanguage('en');

// Export for use in other files
window.t = t;
window.loadLanguage = loadLanguage;