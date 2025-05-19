window.MathJax = {
    tex: { inlineMath: [['$', '$'], ['\\(', '\\)']], displayMath: [['$$', '$$'], ['\\[', '\\]']], processEscapes: true },
    svg: { fontCache: 'global' },
    startup: { ready: () => { console.log('MathJax is ready.'); MathJax.startup.defaultReady(); } }
};


if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
} else {
    console.warn("pdf.js library not loaded. PDF parsing will not be available.");
}

let OLLAMA_API_URL = "http://localhost:11434";

const modelSelect = document.getElementById('model-select');
const systemPromptInput = document.getElementById('system-prompt-input');
const chatMessagesArea = document.getElementById('chat-messages-area');
const userInput = document.getElementById('user-input');
const sendButton = document.getElementById('send-button');
const resetChatButton = document.getElementById('reset-chat-button');
const ollamaUrlInput = document.getElementById('ollama-url-input');
const updateOllamaUrlButton = document.getElementById('update-ollama-url-button');
const toggleFilesButton = document.getElementById('toggle-files-button');

// Initialize the API URL input
ollamaUrlInput.value = OLLAMA_API_URL;

const fileManagementArea = document.getElementById('file-management-area');
const fileInputHidden = document.getElementById('file-input-hidden');
const selectedFilesContainer = document.getElementById('selected-files-container');
const dropZoneInstruction = document.getElementById('drop-zone-instruction');

let conversationHistory = [];
let isAwaitingResponse = false;
let currentAiMessageElement = null;
let currentAiMessageContentDiv = null;
let attachedFiles = [];

const THINK_TAG_PLACEHOLDER_PREFIX = "%%THINK_BLOCK_ID_";
const THINK_TAG_PLACEHOLDER_SUFFIX = "%%";

marked.setOptions({
    highlight: function (code, lang) {
        if (Prism.languages[lang]) {
            return Prism.highlight(code, Prism.languages[lang], lang);
        } else if (lang) {
            Prism.plugins.autoloader.loadLanguages(lang, () => { });
            return code;
        }
        return Prism.highlight(code, Prism.languages.markup, 'markup');
    },
    gfm: true, breaks: true, pedantic: false, smartLists: true, smartypants: false, headerIds: false, mangle: false
});

function escapeHTML(str) {
    if (!str) return '';
    return str.replace(/[&<>'"]/g,
        tag => ({
            '&': '&',
            '<': '<',
            '>': '>',
            "'": '\'',
            '"': '"'
        }[tag] || tag)
    );
}

// Store models data globally
let modelTagsData = [];

function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

async function fetchModels() {
    try {
        const response = await fetch(`${OLLAMA_API_URL}/api/tags`);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const data = await response.json();
        modelTagsData = data.models || []; // Store the models data
        populateModelSelector(modelTagsData);
    } catch (error) {
        console.error("Error fetching models:", error);
        const errorMessage = OLLAMA_API_URL.includes('localhost') || OLLAMA_API_URL.includes('127.0.0.1')
            ? `Error: Cannot connect to ${OLLAMA_API_URL}. When using this web app from a hosted domain, you cannot connect to localhost. Please enter the public URL of your Ollama server.`
            : `Error: Cannot connect to ${OLLAMA_API_URL}. Please check if the server is running and accessible.`;
        modelSelect.innerHTML = `<option value="">${errorMessage}</option>`;
    }
}

// Call fetchModels when the page loads
document.addEventListener('DOMContentLoaded', () => {
    // Initialize API URL input
    ollamaUrlInput.value = OLLAMA_API_URL;
    // Fetch models on load
    fetchModels();
    // Focus user input
    userInput.focus();
});

function populateModelSelector(models) {
    modelSelect.innerHTML = '';
    if (models.length === 0) {
        modelSelect.innerHTML = '<option value="">No models found</option>';
        return;
    }

    // Load the saved model from storage
    const savedModel = loadSavedModel();

    models.forEach(model => {
        const option = document.createElement('option');
        option.value = model.name;
        option.textContent = model.name;
        if (savedModel === model.name) {
            option.selected = true;
        }
        modelSelect.appendChild(option);
        option.value = model.name;
        option.textContent = model.name;
        modelSelect.appendChild(option);
    });
}

function addCopyButtonsToCodeBlocks(parentElement) {
    parentElement.querySelectorAll('pre').forEach(pre => {
        // Only add button if it doesn't already exist
        if (!pre.querySelector('.copy-code-button')) {
            const button = document.createElement('button');
            button.className = 'copy-code-button';
            button.innerHTML = '<i class="bi bi-clipboard"></i>';  // Using Bootstrap icon

            button.addEventListener('click', async () => {
                const code = pre.querySelector('code')?.textContent || pre.textContent;
                try {
                    await navigator.clipboard.writeText(code);
                    button.innerHTML = 'Copied!';
                    button.classList.add('copied');
                    setTimeout(() => {
                        button.innerHTML = 'Copy';
                        button.classList.remove('copied');
                    }, 2000);
                } catch (err) {
                    console.error('Failed to copy text:', err);
                    button.innerHTML = 'Failed to copy';
                    setTimeout(() => {
                        button.innerHTML = 'Copy';
                    }, 2000);
                }
            });

            pre.appendChild(button);
        }
    });
}

function displayMessage(sender, textContent, isStreaming = false, attachedFilenamesArray = null) {
    const messageBubble = document.createElement('div');
    messageBubble.classList.add('message-bubble', sender.toLowerCase() + '-message');

    const senderDiv = document.createElement('div');
    senderDiv.classList.add('message-sender');
    senderDiv.textContent = sender === 'User' ? 'You' : (modelSelect.value.split(':')[0] || 'AI');
    messageBubble.appendChild(senderDiv); if (sender === 'User' && attachedFiles && attachedFiles.length > 0) {
        // Create preview container for images
        const previewContainer = document.createElement('div');
        previewContainer.classList.add('attachment-preview');

        // Add image previews
        const imageFiles = attachedFiles.filter(file => file.type.startsWith('image/'));
        const otherFiles = attachedFiles.filter(file => !file.type.startsWith('image/'));

        // Add image previews
        imageFiles.forEach(file => {
            const img = document.createElement('img');
            img.src = file.content;
            img.alt = file.name;
            img.title = file.name;
            img.addEventListener('click', () => {
                window.open(file.content, '_blank');
            });
            previewContainer.appendChild(img);
        });

        if (previewContainer.children.length > 0) {
            messageBubble.appendChild(previewContainer);
        }

        // Add file names note
        if (attachedFiles.length > 0) {
            const attachmentNoteDiv = document.createElement('div');
            attachmentNoteDiv.classList.add('attachment-note');
            const filenamesString = attachedFiles.map(f => escapeHTML(f.name)).join(', ');
            attachmentNoteDiv.innerHTML = `Attached file(s): ${filenamesString}`;
            messageBubble.appendChild(attachmentNoteDiv);
        }
    }

    const contentDiv = document.createElement('div');
    contentDiv.classList.add('message-content');

    if (isStreaming && sender === 'AI') {
        contentDiv.innerHTML = "<em>Typing...</em>";
        currentAiMessageElement = messageBubble;
        currentAiMessageContentDiv = contentDiv;
    } else {
        contentDiv.innerHTML = marked.parse(textContent);
        Prism.highlightAllUnder(contentDiv);
        addCopyButtonsToCodeBlocks(contentDiv);
        if (typeof MathJax !== 'undefined' && MathJax.typesetPromise) {
            MathJax.typesetPromise([contentDiv])
                .catch(err => console.warn(`MathJax processing error for ${sender} message:`, err));
        }
    }
    messageBubble.appendChild(contentDiv);

    const timestampDiv = document.createElement('div');
    timestampDiv.classList.add('message-timestamp');
    timestampDiv.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    messageBubble.appendChild(timestampDiv);

    chatMessagesArea.appendChild(messageBubble);
    scrollToBottom();
    return { messageBubble, contentDiv };
}

function updateStreamingMessage(chunk) {
    if (currentAiMessageContentDiv) {
        currentAiMessageContentDiv.dataset.rawMarkdown = (currentAiMessageContentDiv.dataset.rawMarkdown || '') + chunk;
        const { processedMarkdown, thinkBlocks } = processThinkTagsInMarkdown(currentAiMessageContentDiv.dataset.rawMarkdown);
        const html = marked.parse(processedMarkdown);
        currentAiMessageContentDiv.innerHTML = html;
        renderThinkBlocksHTML(currentAiMessageContentDiv, thinkBlocks);
        addCopyButtonsToCodeBlocks(currentAiMessageContentDiv);
        MathJax.typesetPromise([currentAiMessageContentDiv]);
        Prism.highlightAllUnder(currentAiMessageContentDiv);
        scrollToBottom();
    }
}

function processThinkTagsInMarkdown(markdown) {
    const thinkBlocks = [];
    let blockIdCounter = 0;
    const processedMarkdown = markdown.replace(/<think>([\s\S]*?)<\/think>/g, (match, thinkContent) => {
        const blockId = blockIdCounter++;
        thinkBlocks.push({
            id: blockId,
            content: thinkContent
        });
        return THINK_TAG_PLACEHOLDER_PREFIX + blockId + THINK_TAG_PLACEHOLDER_SUFFIX;
    });
    return { processedMarkdown, thinkBlocks };
}

function renderThinkBlocksHTML(contentDiv, thinkBlocks) {
    if (!thinkBlocks || thinkBlocks.length === 0) return; let html = contentDiv.innerHTML;
    // Create a wrapper accordion for all think blocks in this message
    const accordionWrapperId = `accordion-wrapper-${Date.now()}`;
    html = `<div class="accordion" id="${accordionWrapperId}">${html}</div>`;

    thinkBlocks.forEach(block => {
        const placeholder = THINK_TAG_PLACEHOLDER_PREFIX + block.id + THINK_TAG_PLACEHOLDER_SUFFIX;
        const thinkHTML = `
            <div class="accordion-item border-0">
                <h2 class="accordion-header" id="heading-${block.id}">
                    <button class="accordion-button collapsed" type="button" 
                            data-bs-toggle="collapse" 
                            data-bs-target="#think-content-${block.id}" 
                            aria-expanded="false" 
                            aria-controls="think-content-${block.id}">
                        🤔 AI's thinking process
                    </button>
                </h2>
                <div id="think-content-${block.id}" 
                     class="accordion-collapse collapse" 
                     data-bs-parent="#${accordionWrapperId}">
                    <div class="accordion-body">
                        ${marked.parse(block.content)}
                    </div>
                </div>
            </div>
        `;
        html = html.replace(placeholder, thinkHTML);
    });
    contentDiv.innerHTML = html;
    addThinkBlockListeners(contentDiv);
}

function addThinkBlockListeners(parentElement) {
    // Re-initialize Bootstrap collapse for dynamically added content
    parentElement.querySelectorAll('.accordion-collapse').forEach(collapseEl => {
        // Clean up any existing collapse instance
        if (bootstrap.Collapse.getInstance(collapseEl)) {
            bootstrap.Collapse.getInstance(collapseEl).dispose();
        }

        // Create new collapse instance
        new bootstrap.Collapse(collapseEl, {
            toggle: false
        });        // Add content rendering on expand
        collapseEl.addEventListener('shown.bs.collapse', () => {
            if (typeof MathJax !== 'undefined' && MathJax.typesetPromise) {
                MathJax.typesetPromise([collapseEl]);
            }
            Prism.highlightAllUnder(collapseEl);
        });
    });
}

function finalizeAiMessage() {
    if (currentAiMessageContentDiv && currentAiMessageContentDiv.dataset.rawMarkdown) {
        const finalRawMarkdown = currentAiMessageContentDiv.dataset.rawMarkdown;
        const { processedMarkdown, thinkBlocks } = processThinkTagsInMarkdown(finalRawMarkdown);
        currentAiMessageContentDiv.innerHTML = marked.parse(processedMarkdown);
        renderThinkBlocksHTML(currentAiMessageContentDiv, thinkBlocks);
        addThinkBlockListeners(currentAiMessageContentDiv);
        Prism.highlightAllUnder(currentAiMessageContentDiv);
        if (typeof MathJax !== 'undefined' && MathJax.typesetPromise) {
            MathJax.typesetPromise([currentAiMessageContentDiv]).catch(err => console.warn("MathJax (final):", err));
        }
    }
    currentAiMessageElement = null; currentAiMessageContentDiv = null; scrollToBottom();
}

async function sendMessage() {
    const messageText = userInput.value.trim();
    const selectedModel = modelSelect.value;
    const systemPrompt = systemPromptInput.value.trim();

    // Hide file management area if it's visible
    if (fileManagementArea.style.display === 'block') {
        fileManagementArea.style.display = 'none';
        toggleFilesButton.innerHTML = '<i class="bi bi-paperclip"></i>';
    }

    if ((!messageText && attachedFiles.length === 0) || !selectedModel || isAwaitingResponse) {
        if (!selectedModel) alert("Please select a model or ensure API URL is correct.");
        return;
    } isAwaitingResponse = true;
    sendButton.disabled = true;
    sendButton.innerHTML = '<div class="spinner-border spinner-border-sm" role="status"><span class="visually-hidden">Loading...</span></div>';
    userInput.disabled = true;
    fileManagementArea.classList.add('disabled-drop-zone');

    displayMessage("User", messageText, false, attachedFiles.map(f => f.name));
    userInput.value = '';

    const aiMessageElements = displayMessage("AI", "<em>Typing...</em>", true);
    currentAiMessageContentDiv = aiMessageElements.contentDiv;
    currentAiMessageContentDiv.dataset.rawMarkdown = "";

    let userMessageForApi = messageText;
    const imagesForApi = [];
    let textFileContentsForApi = "";

    if (attachedFiles.length > 0) {
        let filePreamble = "User has attached the following files:\n";
        for (const file of attachedFiles) {
            const safeFilename = escapeHTML(file.name);
            filePreamble += `- "${safeFilename}" (${file.type})\n`; // Display original type

            if (file.type.startsWith('image/')) {
                imagesForApi.push(file.content.split(',')[1]);
            } else { // Includes text files and PDF-extracted text
                textFileContentsForApi += `\n\nContent of "${safeFilename}":\n\`\`\`\n${file.content}\n\`\`\`\n`;
            }
        }
        userMessageForApi = `${filePreamble}${textFileContentsForApi}\nUser's typed message:\n${messageText || "(No typed message)"}`;
    }


    const messagesForApiPayload = [];
    if (systemPrompt) messagesForApiPayload.push({ role: "system", content: systemPrompt });
    messagesForApiPayload.push(...conversationHistory);
    const currentUserMessagePayload = { role: "user", content: userMessageForApi };
    if (imagesForApi.length > 0) {
        currentUserMessagePayload.images = imagesForApi;
    }
    messagesForApiPayload.push(currentUserMessagePayload);

    try {
        const requestBody = {
            model: selectedModel,
            messages: messagesForApiPayload,
            stream: true
        };

        const response = await fetch(`${OLLAMA_API_URL}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
            const errorBody = await response.text();
            throw new Error(`API error: ${response.status} ${response.statusText}. ${errorBody}`);
        }

        let historyUserContent = messageText;
        if (attachedFiles.length > 0) {
            const fileNamesForHistory = attachedFiles.map(f => escapeHTML(f.name)).join(', ');
            historyUserContent = `(Files: ${fileNamesForHistory}) ${messageText || ""}`.trim();
        }
        conversationHistory.push({ role: "user", content: historyUserContent });


        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let aiResponseContent = "";

        if (currentAiMessageContentDiv.innerHTML === "<em>Typing...</em>") currentAiMessageContentDiv.innerHTML = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split('\n').filter(line => line.trim() !== ''); for (const line of lines) {
                try {
                    const parsedLine = JSON.parse(line);
                    if (parsedLine.message && parsedLine.message.content) {
                        const contentPiece = parsedLine.message.content;

                        // If it starts with "AI Thoughts" or similar, wrap it in think tags
                        if (contentPiece.includes("AI Thoughts") || contentPiece.includes("Let me") || contentPiece.includes("I'll") || contentPiece.includes("First,")) {
                            aiResponseContent += `<think>${contentPiece}</think>`;
                            updateStreamingMessage(`<think>${contentPiece}</think>`);
                        } else {
                            aiResponseContent += contentPiece;
                            updateStreamingMessage(contentPiece);
                        }
                    }
                } catch (e) { console.warn("Failed to parse JSON line:", line, e); }
            }
        }
        conversationHistory.push({ role: "assistant", content: aiResponseContent });
    } catch (error) {
        console.error("Error sending message:", error);
        const errorMessage = `**Error:** ${error.message || "An unknown error occurred."}`;
        if (currentAiMessageContentDiv) {
            currentAiMessageContentDiv.innerHTML = marked.parse(errorMessage);
            Prism.highlightAllUnder(currentAiMessageContentDiv);
            currentAiMessageContentDiv.dataset.rawMarkdown = errorMessage;
        } else { displayMessage("AI", errorMessage); }
    } finally {
        finalizeAiMessage();
        clearAllAttachedFiles();
        isAwaitingResponse = false;
        sendButton.disabled = false;
        sendButton.innerHTML = '<i class="bi bi-send-fill me-1"></i>Send';
        userInput.disabled = false;
        fileManagementArea.classList.remove('disabled-drop-zone');
        userInput.focus();
    }
}

function renderAttachedFilesUI() {
    selectedFilesContainer.innerHTML = '';
    if (attachedFiles.length > 0) {
        dropZoneInstruction.style.display = 'none';
        selectedFilesContainer.style.display = 'block';
        attachedFiles.forEach(file => {
            const fileItem = document.createElement('div');
            fileItem.classList.add('file-item');

            const fileInfo = document.createElement('div');
            fileInfo.classList.add('file-info');

            if (file.type.startsWith('image/')) {
                const thumbnail = document.createElement('img');
                thumbnail.classList.add('file-thumbnail');
                thumbnail.src = file.content;
                thumbnail.alt = file.name;
                fileInfo.appendChild(thumbnail);
            } else {
                const fileIcon = document.createElement('div');
                fileIcon.classList.add('file-thumbnail');
                fileIcon.innerHTML = '<i class="bi bi-file-text" style="font-size: 24px; line-height: 40px; text-align: center; display: block;"></i>';
                fileInfo.appendChild(fileIcon);
            }

            const fileNameSpan = document.createElement('span');
            fileNameSpan.textContent = file.name;
            fileNameSpan.title = file.name;
            fileInfo.appendChild(fileNameSpan);

            const removeBtn = document.createElement('button');
            removeBtn.classList.add('remove-file-btn');
            removeBtn.innerHTML = '×';
            removeBtn.title = `Remove ${file.name}`;
            removeBtn.dataset.fileId = file.id;
            removeBtn.onclick = (e) => {
                e.stopPropagation();
                removeSpecificFile(file.id);
            };

            fileItem.appendChild(fileInfo);
            fileItem.appendChild(removeBtn);
            selectedFilesContainer.appendChild(fileItem);
        });
    } else {
        dropZoneInstruction.style.display = 'block';
        selectedFilesContainer.style.display = 'none';
    }
}

async function extractTextFromPdf(arrayBuffer) {
    if (typeof pdfjsLib === 'undefined') {
        console.error("pdf.js is not loaded. Cannot parse PDF.");
        return "[PDF.js library not loaded. Cannot extract text.]";
    }
    try {
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        let fullText = '';
        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            const pageText = textContent.items.map(item => item.str).join(' ');
            fullText += pageText + '\n\n';
        }
        return fullText.trim();
    } catch (error) {
        console.error('Error parsing PDF:', error);
        return `[Error extracting text from PDF: ${escapeHTML(error.message)}]`;
    }
}

async function extractDataFromSpreadsheet(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = function (e) {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });

                let result = '';

                // Process each sheet
                workbook.SheetNames.forEach((sheetName, sheetIndex) => {
                    const worksheet = workbook.Sheets[sheetName];
                    const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

                    // Add sheet name if there are multiple sheets
                    if (workbook.SheetNames.length > 1) {
                        result += `\nSheet: ${sheetName}\n`;
                    }

                    // Convert to markdown table format
                    if (jsonData.length > 0 && jsonData[0].length > 0) {
                        // Create header row using first row or column indices
                        const headers = jsonData[0].length > 0 ? jsonData[0] : Array.from({ length: jsonData[0].length }, (_, i) => `Column ${i + 1}`);
                        result += '| ' + headers.join(' | ') + ' |\n';
                        // Create separator row
                        result += '| ' + headers.map(() => '---').join(' | ') + ' |\n';
                        // Create data rows
                        for (let i = 1; i < jsonData.length; i++) {
                            // Ensure all rows have the same number of columns
                            while (jsonData[i].length < headers.length) {
                                jsonData[i].push('');
                            }
                            // Convert all values to strings and escape any | characters
                            const rowData = jsonData[i].map(cell => String(cell || '').replace(/\|/g, '\\|'));
                            result += '| ' + rowData.join(' | ') + ' |\n';
                        }
                    } else {
                        result += '*Empty sheet*\n';
                    }

                    // Add spacing between sheets
                    if (sheetIndex < workbook.SheetNames.length - 1) {
                        result += '\n---\n\n';
                    }
                });

                resolve(result.trim());
            } catch (error) {
                reject(`Error processing spreadsheet: ${error.message}`);
            }
        };

        reader.onerror = () => reject('Error reading file');
        reader.readAsArrayBuffer(file);
    });
}

async function addFilesToList(files) {
    for (const file of files) {
        if (attachedFiles.some(f => f.name === file.name)) {
            alert(`File "${escapeHTML(file.name)}" is already attached.`);
            continue;
        }
        const fileId = `file-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
        const reader = new FileReader();

        reader.onload = async (e) => {
            let fileContent = e.target.result;
            let fileType = file.type;

            try {
                if (fileType === 'application/pdf') {
                    dropZoneInstruction.textContent = `Processing PDF: ${escapeHTML(file.name)}...`;
                    fileContent = await extractTextFromPdf(e.target.result);
                } else if (
                    fileType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
                    fileType === 'application/vnd.ms-excel' ||
                    fileType === 'text/csv' ||
                    file.name.endsWith('.xlsx') ||
                    file.name.endsWith('.xls') ||
                    file.name.endsWith('.csv')
                ) {
                    dropZoneInstruction.textContent = `Processing spreadsheet: ${escapeHTML(file.name)}...`;
                    fileContent = await extractDataFromSpreadsheet(file);
                }

                attachedFiles.push({
                    id: fileId,
                    name: file.name,
                    content: fileContent,
                    type: fileType
                });
                renderAttachedFilesUI();
            } catch (error) {
                console.error("Error processing file:", error);
                alert(`Error processing file ${escapeHTML(file.name)}: ${error.message}`);
            } finally {
                dropZoneInstruction.textContent = 'Drag & Drop Files Here or Click to Upload';
            }
        };

        reader.onerror = (e) => {
            console.error("Error reading file:", file.name, e);
            alert("Error reading file: " + escapeHTML(file.name));
            dropZoneInstruction.textContent = 'Drag & Drop Files Here or Click to Upload';
        };        // Determine the file type by both MIME type and extension
        let fileType = file.type;
        const isSpreadsheet = fileType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
            fileType === 'application/vnd.ms-excel' ||
            fileType === 'text/csv' ||
            file.name.endsWith('.xlsx') ||
            file.name.endsWith('.xls') ||
            file.name.endsWith('.csv');

        // For CSV files that might be incorrectly typed
        if (file.name.endsWith('.csv')) {
            fileType = 'text/csv';
        }

        if (fileType === 'application/pdf' || isSpreadsheet) {
            reader.readAsArrayBuffer(file);
        } else if (file.type.startsWith('image/')) {
            reader.readAsDataURL(file);
        } else if (file.type.startsWith('text/') || file.type === 'application/json' || file.type === 'application/xml' || !file.type) {
            reader.readAsText(file);
        } else {
            alert(`File type "${escapeHTML(file.type)}" for "${escapeHTML(file.name)}" may not be optimally supported. It will be treated as text if possible.`);
            reader.readAsText(file);
        }
    }
    fileInputHidden.value = '';
}

function removeSpecificFile(fileId) {
    attachedFiles = attachedFiles.filter(f => f.id !== fileId);
    renderAttachedFilesUI();
    fileInputHidden.value = '';
}

function clearAllAttachedFiles() {
    attachedFiles = [];
    fileInputHidden.value = '';
    renderAttachedFilesUI();
}

function resetChat() {
    chatMessagesArea.innerHTML = '';
    conversationHistory = [];
    if (currentAiMessageContentDiv) {
        currentAiMessageContentDiv.innerHTML = ''; currentAiMessageContentDiv.dataset.rawMarkdown = '';
    }
    finalizeAiMessage();
    clearAllAttachedFiles();
    isAwaitingResponse = false;
    sendButton.disabled = false;
    userInput.disabled = false;
    fileManagementArea.classList.remove('disabled-drop-zone');
    userInput.focus();
    console.log("Chat reset.");
}

function scrollToBottom() { chatMessagesArea.scrollTop = chatMessagesArea.scrollHeight; }

sendButton.addEventListener('click', sendMessage);
resetChatButton.addEventListener('click', resetChat);
userInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); sendMessage(); }
});

updateOllamaUrlButton.addEventListener('click', () => {
    const newUrl = ollamaUrlInput.value.trim();
    if (newUrl && (newUrl.startsWith('http://') || newUrl.startsWith('https://'))) {
        OLLAMA_API_URL = newUrl;
        console.log(`Ollama API URL updated to: ${OLLAMA_API_URL}`);
        modelSelect.innerHTML = `<option value="">Refreshing models from ${OLLAMA_API_URL}...</option>`;
        fetchModels();
    } else {
        alert("Please enter a valid Ollama API URL (e.g., http://localhost:11434).");
        ollamaUrlInput.value = OLLAMA_API_URL;
    }
});

fileManagementArea.addEventListener('click', () => {
    if (!fileManagementArea.classList.contains('disabled-drop-zone')) {
        fileInputHidden.click();
    }
});

fileInputHidden.addEventListener('change', (event) => {
    if (event.target.files.length > 0) {
        addFilesToList(event.target.files);
    }
});

['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
    fileManagementArea.addEventListener(eventName, preventDefaults, false);
});
function preventDefaults(e) {
    e.preventDefault();
    e.stopPropagation();
}
['dragenter', 'dragover'].forEach(eventName => {
    fileManagementArea.addEventListener(eventName, () => {
        if (!fileManagementArea.classList.contains('disabled-drop-zone')) {
            fileManagementArea.classList.add('drag-over');
        }
    }, false);
});
['dragleave', 'drop'].forEach(eventName => {
    fileManagementArea.addEventListener(eventName, () => {
        if (!fileManagementArea.classList.contains('disabled-drop-zone')) {
            fileManagementArea.classList.remove('drag-over');
        }
    }, false);
});
fileManagementArea.addEventListener('drop', (event) => {
    if (!fileManagementArea.classList.contains('disabled-drop-zone')) {
        const dt = event.dataTransfer;
        const files = dt.files;
        if (files && files.length > 0) {
            addFilesToList(files);
        }
    }
}, false);

fileManagementArea.style.display = 'none';
toggleFilesButton.innerHTML = '<i class="bi bi-paperclip"></i>';

toggleFilesButton.addEventListener('click', () => {
    const isHidden = fileManagementArea.style.display === 'none';
    fileManagementArea.style.display = isHidden ? 'block' : 'none';
});

// Initialize tooltips
const tooltipTriggerList = document.querySelectorAll('[data-bs-toggle="tooltip"]');
const tooltipList = [...tooltipTriggerList].map(tooltipTriggerEl => new bootstrap.Tooltip(tooltipTriggerEl));

// Auto-resize textarea
function autoResizeTextarea() {
    userInput.style.height = '38px'; // Reset height to minimum
    const scrollHeight = userInput.scrollHeight;
    const maxHeight = parseInt(window.getComputedStyle(userInput).maxHeight);
    userInput.style.height = Math.min(scrollHeight, maxHeight) + 'px';
}

userInput.addEventListener('input', autoResizeTextarea);
userInput.addEventListener('keydown', autoResizeTextarea);

// Model information functions
async function getModelDetails(modelName) {
    try {
        const response = await fetch(`${OLLAMA_API_URL}/api/show`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: modelName })
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch model details: ${response.status}`);
        }

        const details = await response.json();
        console.log(`Model details for ${modelName}:`, details); // Debug log
        return details;
    } catch (error) {
        console.error(`Error fetching details for model ${modelName}:`, error);
        return null;
    }
}

async function updateModelsModal() {
    const modelsContainer = document.getElementById('models-container');
    modelsContainer.innerHTML = '<div class="text-center w-100"><div class="spinner-border" role="status"><span class="visually-hidden">Loading...</span></div></div>';

    try {
        // Add download button to modal header
        const modalHeader = document.querySelector('#modelsModal .modal-header');
        if (modalHeader && !modalHeader.querySelector('.download-model-btn')) {
            const closeBtn = modalHeader.querySelector('.btn-close');
            const downloadBtn = document.createElement('button');
            downloadBtn.className = 'btn btn-sm btn-outline-light download-model-btn me-2 btn-download-model';
            downloadBtn.onclick = showDownloadModal;
            downloadBtn.innerHTML = '<i class="bi bi-cloud-download"></i> Download Model';
            modalHeader.insertBefore(downloadBtn, closeBtn);
        }

        // Get details for each model
        const modelDetails = await Promise.all(
            modelTagsData.map(async model => {
                try {
                    const showResponse = await fetch(`${OLLAMA_API_URL}/api/show`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ name: model.name })
                    });

                    if (!showResponse.ok) {
                        throw new Error(`Failed to fetch model details: ${showResponse.status}`);
                    }

                    const details = await showResponse.json();
                    return {
                        name: model.name,
                        details,
                        size: model.size // Get size from the stored tags data
                    };
                } catch (error) {
                    console.error(`Error fetching details for ${model.name}:`, error);
                    return {
                        name: model.name,
                        details: null,
                        size: model.size // Still include size even if details fetch fails
                    };
                }
            })
        );

        modelsContainer.innerHTML = '';
        modelDetails.forEach(({ name, details, size }) => {
            if (!details) return;

            const card = document.createElement('div');
            card.className = 'col-md-12 col-lg-6';

            const parameters = details.parameters || {};
            const license = details.license || 'Not specified';
            const modelType = details.modelfile?.split('\n')
                .find(line => line.startsWith('FROM'))?.replace('FROM ', '') || 'Unknown';

            const cardId = `model-${name.replace(/[^a-zA-Z0-9]/g, '-')}`;
            const licenseAccordionId = `license-${cardId}`;
            const modelTypeAccordionId = `model-type-${cardId}`;

            card.innerHTML = `
                <div class="card w-100 bg-dark">
                    <div class="card-header d-flex justify-content-between align-items-center">
                        <div>
                            <h5 class="card-title mb-0">${name}</h5>
                            ${size ? `<small class="text-muted">Size: ${formatBytes(size)}</small>` : ''}
                        </div>
                        <button class="btn btn-sm btn-outline-danger" onclick="showDeleteModelModal('${name}')">
                            <i class="bi bi-trash"></i>
                        </button>
                    </div>
                    <div class="card-body">
                        ${details.capabilities ? `<div class="mb-2">${details.capabilities.map(cap => `<span class='badge bg-primary me-1'>${cap}</span>`).join('')}</div>` : ''}
                        
                        <div class="accordion accordion-flush mb-2" id="details-${cardId}">
                            <div class="accordion-item bg-transparent">
                                <h2 class="accordion-header">
                                    <button class="accordion-button collapsed bg-dark text-light p-0" type="button" 
                                            data-bs-toggle="collapse" 
                                            data-bs-target="#details-${cardId}-collapse">
                                        <strong>Details</strong>
                                    </button>
                                </h2>
                                <div id="details-${cardId}-collapse" class="accordion-collapse collapse">
                                    <div class="accordion-body ps-0 pt-2">
                                        <pre class="mb-0"><code>${JSON.stringify(details, null, 2)}</code></pre>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div class="accordion accordion-flush mb-2" id="${licenseAccordionId}">
                            <div class="accordion-item bg-transparent">
                                <h2 class="accordion-header">
                                    <button class="accordion-button collapsed bg-dark text-light p-0" type="button" 
                                            data-bs-toggle="collapse" 
                                            data-bs-target="#${licenseAccordionId}-collapse">
                                        <strong>License</strong>
                                    </button>
                                </h2>
                                <div id="${licenseAccordionId}-collapse" class="accordion-collapse collapse">
                                    <div class="accordion-body ps-0 pt-2">
                                        <pre class="mb-0"><code>${license}</code></pre>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div class="accordion accordion-flush mb-2" id="${modelTypeAccordionId}">
                            <div class="accordion-item bg-transparent">
                                <h2 class="accordion-header">
                                    <button class="accordion-button collapsed bg-dark text-light p-0" type="button" 
                                            data-bs-toggle="collapse" 
                                            data-bs-target="#${modelTypeAccordionId}-collapse">
                                        <strong>Model Digest</strong>
                                    </button>
                                </h2>
                                <div id="${modelTypeAccordionId}-collapse" class="accordion-collapse collapse">
                                    <div class="accordion-body ps-0 pt-2">
                                        <pre class="mb-0"><code>${modelType}</code></pre>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            `; modelsContainer.appendChild(card);
            // Add copy buttons to all code blocks in this card
            addCopyButtonsToCodeBlocks(card);
        });
    } catch (error) {
        console.error('Error updating models modal:', error);
        modelsContainer.innerHTML = `<div class="alert alert-danger">Error loading model details: ${error.message}</div>`;
    }
}

// Event listener for models modal
document.getElementById('modelsModal').addEventListener('show.bs.modal', updateModelsModal);

// Refresh models info when API URL is updated
updateOllamaUrlButton.addEventListener('click', () => {
    const newUrl = ollamaUrlInput.value.trim();
    if (newUrl && (newUrl.startsWith('http://') || newUrl.startsWith('https://'))) {
        OLLAMA_API_URL = newUrl;
        console.log(`Ollama API URL updated to: ${OLLAMA_API_URL}`);
        modelSelect.innerHTML = `<option value="">Refreshing models from ${OLLAMA_API_URL}...</option>`;
        fetchModels();
        updateModelsModal();
    } else {
        alert("Please enter a valid Ollama API URL (e.g., http://localhost:11434).");
        ollamaUrlInput.value = OLLAMA_API_URL;
    }
});

// Download model functionality
function showDownloadModal() {
    const modalHtml = `
        <div class="modal fade" id="downloadModelModal" tabindex="-1" aria-labelledby="downloadModelModalLabel" aria-hidden="true">
            <div class="modal-dialog">
        <div class="modal-content bg-dark text-light">
                    <div class="modal-header">
                        <h5 class="modal-title" id="downloadModelModalLabel">Download Model</h5>
                        <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal" aria-label="Close"></button>
                    </div>
                    <div class="modal-body">
                        <div class="alert alert-info" role="alert">
                            <i class="bi bi-info-circle"></i> Browse available models at <a href="https://ollama.com/search" target="_blank" class="alert-link text-info">ollama.com/search</a>
                        </div>
                        <div class="mb-3">
                            <label for="modelNameInput" class="form-label">Model Name</label>
                            <input type="text" class="form-control bg-dark text-light" id="modelNameInput" 
                                placeholder="e.g., nomic-embed-text:v1.5">
                            <small class="text-muted">Enter the model name with optional version tag</small>
                        </div>
                        <div id="downloadProgress" class="d-none">
                            <div class="progress mb-2">
                                <div class="progress-bar progress-bar-striped progress-bar-animated" 
                                    role="progressbar" style="width: 0%" 
                                    id="downloadProgressBar"></div>
                            </div>
                            <div id="downloadStatus" class="small text-muted"></div>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
                        <button type="button" class="btn btn-primary" id="startDownloadBtn">Download</button>
                    </div>
                </div>
            </div>
        </div>
    `;

    // Remove existing modal if it exists
    const existingModal = document.getElementById('downloadModelModal');
    if (existingModal) {
        existingModal.remove();
    }

    // Add modal to body
    document.body.insertAdjacentHTML('beforeend', modalHtml);

    // Get modal elements
    const modal = new bootstrap.Modal(document.getElementById('downloadModelModal'));
    const startDownloadBtn = document.getElementById('startDownloadBtn');
    const modelNameInput = document.getElementById('modelNameInput');
    const downloadProgress = document.getElementById('downloadProgress');
    const downloadProgressBar = document.getElementById('downloadProgressBar');
    const downloadStatus = document.getElementById('downloadStatus');

    startDownloadBtn.addEventListener('click', async () => {
        let modelName = modelNameInput.value.trim();

        // Remove 'ollama pull' if present
        modelName = modelName.replace(/^ollama\s+pull\s+/i, '');

        if (!modelName) {
            alert('Please enter a model name');
            return;
        }

        startDownloadBtn.disabled = true;
        downloadProgress.classList.remove('d-none');
        downloadProgressBar.style.width = '0%';
        downloadStatus.textContent = 'Starting download...';

        try {
            const response = await fetch(`${OLLAMA_API_URL}/api/pull`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: modelName }),
            });

            const reader = response.body.getReader();
            let totalSize = 0;
            let downloadedSize = 0;

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = new TextDecoder().decode(value);
                const lines = chunk.split('\n').filter(line => line.trim());

                for (const line of lines) {
                    try {
                        const status = JSON.parse(line);
                        if (status.total) {
                            totalSize = status.total;
                            downloadedSize = status.completed;
                            const progress = (downloadedSize / totalSize) * 100;
                            downloadProgressBar.style.width = `${progress}%`;
                            downloadStatus.textContent = `Downloading: ${formatBytes(downloadedSize)} / ${formatBytes(totalSize)}`;
                        } else if (status.status) {
                            downloadStatus.textContent = status.status;
                        }
                    } catch (e) {
                        console.warn('Error parsing status:', e);
                    }
                }
            }

            downloadProgressBar.style.width = '100%';
            downloadStatus.textContent = 'Download complete!';
            setTimeout(() => {
                modal.hide();
                updateModelsModal(); // Refresh the models list
            }, 1500);

        } catch (error) {
            console.error('Error downloading model:', error);
            downloadStatus.textContent = `Error: ${error.message}`;
            downloadProgressBar.classList.add('bg-danger');
        } finally {
            startDownloadBtn.disabled = false;
        }
    });

    modal.show();
}

// Delete model functionality
function showDeleteModelModal(modelName) {
    const modalHtml = `
        <div class="modal fade" id="deleteModelModal" tabindex="-1" aria-labelledby="deleteModelModalLabel" aria-hidden="true">
            <div class="modal-dialog">
                <div class="modal-content bg-dark text-light">
                    <div class="modal-header">
                        <h5 class="modal-title" id="deleteModelModalLabel">Delete Model</h5>
                        <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal" aria-label="Close"></button>
                    </div>
                    <div class="modal-body">
                        <p>Are you sure you want to delete the model <strong>${modelName}</strong>?</p>
                        <p class="text-danger">This action cannot be undone.</p>
                        <div id="deleteProgress" class="d-none">
                            <div class="progress mb-2">
                                <div class="progress-bar progress-bar-striped progress-bar-animated bg-danger" 
                                    role="progressbar" style="width: 100%" 
                                    id="deleteProgressBar"></div>
                            </div>
                            <div id="deleteStatus" class="small text-muted"></div>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
                        <button type="button" class="btn btn-danger" id="confirmDeleteBtn">Delete</button>
                    </div>
                </div>
            </div>
        </div>
    `;

    // Remove existing modal if it exists
    const existingModal = document.getElementById('deleteModelModal');
    if (existingModal) {
        existingModal.remove();
    }

    // Add modal to body
    document.body.insertAdjacentHTML('beforeend', modalHtml);

    // Get modal elements
    const modal = new bootstrap.Modal(document.getElementById('deleteModelModal'));
    const confirmDeleteBtn = document.getElementById('confirmDeleteBtn');
    const deleteProgress = document.getElementById('deleteProgress');
    const deleteStatus = document.getElementById('deleteStatus');

    confirmDeleteBtn.addEventListener('click', async () => {
        confirmDeleteBtn.disabled = true;
        deleteProgress.classList.remove('d-none');
        deleteStatus.textContent = 'Deleting model...';

        try {
            const response = await fetch(`${OLLAMA_API_URL}/api/delete`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: modelName }),
            });

            if (!response.ok) {
                throw new Error(`Failed to delete model: ${response.statusText}`);
            } deleteStatus.textContent = 'Model deleted successfully!';
            setTimeout(() => {
                modal.hide();
                // Show success notification
                const toast = new bootstrap.Toast(Object.assign(document.createElement('div'), {
                    className: 'toast align-items-center text-bg-success border-0 position-fixed top-0 start-50 translate-middle-x mt-3',
                    role: 'alert',
                    'aria-live': 'assertive',
                    'aria-atomic': 'true',
                    innerHTML: `
                        <div class="d-flex">
                            <div class="toast-body">
                                Model "${modelName}" has been deleted successfully.
                            </div>
                            <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button>
                        </div>
                    `
                }));
                document.body.appendChild(toast.element);
                toast.show();

                // Refresh both the model selector and the models modal
                fetchModels();
                updateModelsModal();
            }, 1000);

        } catch (error) {
            console.error('Error deleting model:', error);
            deleteStatus.textContent = `Error: ${error.message}`;
            deleteProgress.querySelector('.progress-bar').classList.add('bg-danger');
            // Show error notification
            const toast = new bootstrap.Toast(Object.assign(document.createElement('div'), {
                className: 'toast align-items-center text-bg-danger border-0 position-fixed top-0 start-50 translate-middle-x mt-3',
                role: 'alert',
                'aria-live': 'assertive',
                'aria-atomic': 'true',
                innerHTML: `
                    <div class="d-flex">
                        <div class="toast-body">
                            Failed to delete model "${modelName}": ${error.message}
                        </div>
                        <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button>
                    </div>
                `
            }));
            document.body.appendChild(toast.element);
            toast.show();
        } finally {
            confirmDeleteBtn.disabled = false;
        }
    });

    modal.show();
}