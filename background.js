// VoxFlow Background Service Worker (Manifest V3)

// Default user settings
const DEFAULT_SETTINGS = {
  tone: 'clean', // 'raw', 'clean', 'professional', 'casual', 'bullet', 'concise'
  language: 'en-US',
  soundEffects: true,
  autoInsert: true,
  floatingBubbleVisible: true,
  bubbleTheme: 'dark', // 'dark', 'light', 'glass'
  apiKey: '',
  aiProvider: 'gemini', // 'gemini' or 'openai'
  triggerKey: 'Alt+Shift+V'
};

// Initialize settings on installation
chrome.runtime.onInstalled.addListener(async (details) => {
  const existing = await chrome.storage.sync.get(Object.keys(DEFAULT_SETTINGS));
  const toSet = {};
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    if (existing[key] === undefined) {
      toSet[key] = value;
    }
  }
  if (Object.keys(toSet).length > 0) {
    await chrome.storage.sync.set(toSet);
  }

  // Create context menu for editable elements
  chrome.contextMenus.create({
    id: 'voxflow-dictate-target',
    title: '🎤 Start VoxFlow Voice Dictation',
    contexts: ['editable']
  });
});

// Handle Context Menu clicks
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'voxflow-dictate-target' && tab?.id) {
    chrome.tabs.sendMessage(tab.id, { action: 'toggle_dictation' }).catch(() => {
      // Content script may not be loaded on this page
    });
  }
});

// Handle Keyboard Shortcuts
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'toggle-dictation') {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      chrome.tabs.sendMessage(tab.id, { action: 'toggle_dictation' }).catch((err) => {
        console.warn('Could not send shortcut command to tab:', err);
      });
    }
  }
});

// Handle AI Polish requests if an API Key is provided
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'ai_polish_text') {
    handleAIPolish(request.text, request.tone, request.apiKey, request.aiProvider)
      .then((polishedText) => sendResponse({ success: true, text: polishedText }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true; // Keep message channel open for async response
  }
});

/**
 * Handle AI transformation using Gemini API or OpenAI API
 */
async function handleAIPolish(text, tone, apiKey, provider) {
  if (!apiKey || !apiKey.trim()) {
    throw new Error('No API key provided.');
  }

  const promptMap = {
    clean: `Fix any grammar, spelling, punctuation, and stuttering errors in the following transcribed speech. Keep the exact meaning and natural wording. Return ONLY the polished text without any comments or quotes:\n\n"${text}"`,
    professional: `Rewrite the following dictated speech into articulate, polished, professional business English suitable for emails or work communication. Retain the core message. Return ONLY the rewritten text:\n\n"${text}"`,
    casual: `Rewrite the following dictated speech into a friendly, clear, natural conversational tone suitable for chats or social messages. Return ONLY the rewritten text:\n\n"${text}"`,
    bullet: `Convert the key points of the following dictated speech into clean, well-formatted bullet points (using • ). Return ONLY the bullet points:\n\n"${text}"`,
    concise: `Summarize and tighten the following dictated speech to be as concise and punchy as possible without losing essential details. Return ONLY the concise text:\n\n"${text}"`
  };

  const prompt = promptMap[tone] || promptMap.clean;

  if (provider === 'gemini') {
    // Google Gemini API call
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey.trim()}`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 800
        }
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error?.message || `Gemini API returned status ${response.status}`);
    }

    const data = await response.json();
    const candidateText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!candidateText) throw new Error('No response returned from Gemini.');
    return candidateText.trim();
  } else {
    // OpenAI Compatible API call
    const endpoint = 'https://api.openai.com/v1/chat/completions';
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey.trim()}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'You are an elite dictation and grammar polish assistant. Always output only the revised text.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.3,
        max_tokens: 800
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error?.message || `OpenAI API returned status ${response.status}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content?.trim() || text;
  }
}
