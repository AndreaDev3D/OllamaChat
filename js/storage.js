// Local storage keys
const STORAGE_KEYS = {
    CURRENT_MODEL: 'ollama_chat_current_model'
};

// Save current model to local storage
function saveCurrentModel(modelName) {
    if (modelName) {
        localStorage.setItem(STORAGE_KEYS.CURRENT_MODEL, modelName);
    }
}

// Load saved model from local storage
function loadSavedModel() {
    return localStorage.getItem(STORAGE_KEYS.CURRENT_MODEL);
}

// Initialize model selection from storage
document.addEventListener('DOMContentLoaded', () => {
    const modelSelect = document.getElementById('model-select');

    // Listen for model changes
    modelSelect.addEventListener('change', (event) => {
        saveCurrentModel(event.target.value);
    });

    // After models are loaded, try to select the saved model
    const savedModel = loadSavedModel();
    if (savedModel) {
        // Use a MutationObserver to wait for options to be populated
        const observer = new MutationObserver((mutations) => {
            const options = Array.from(modelSelect.options);
            const savedOption = options.find(option => option.value === savedModel);
            if (savedOption) {
                modelSelect.value = savedModel;
                observer.disconnect();
            }
        });

        observer.observe(modelSelect, { childList: true });
    }
});