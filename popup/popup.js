/**
 * VoxFlow Popup Controller
 * Synchronizes user preferences with chrome.storage and provides mic test.
 */

document.addEventListener('DOMContentLoaded', async () => {
  // DOM Elements
  const toneSelect = document.getElementById('tone-select');
  const languageSelect = document.getElementById('language-select');
  const autoInsertToggle = document.getElementById('auto-insert-toggle');
  const soundEffectsToggle = document.getElementById('sound-effects-toggle');
  const aiProviderSelect = document.getElementById('ai-provider-select');
  const apiKeyInput = document.getElementById('api-key-input');
  const toggleKeyVisibilityBtn = document.getElementById('toggle-key-visibility');
  const testMicBtn = document.getElementById('test-mic-btn');
  const testMicLabel = document.getElementById('test-mic-label');
  const testMicFeedback = document.getElementById('test-mic-feedback');
  const openPlaygroundBtn = document.getElementById('open-playground-btn');

  // Load existing settings from chrome.storage
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
    const data = await chrome.storage.sync.get([
      'tone',
      'language',
      'autoInsert',
      'soundEffects',
      'aiProvider',
      'apiKey'
    ]);

    if (data.tone) toneSelect.value = data.tone;
    if (data.language) languageSelect.value = data.language;
    if (data.autoInsert !== undefined) autoInsertToggle.checked = data.autoInsert;
    if (data.soundEffects !== undefined) soundEffectsToggle.checked = data.soundEffects;
    if (data.aiProvider) aiProviderSelect.value = data.aiProvider;
    if (data.apiKey) apiKeyInput.value = data.apiKey;
  }

  // Save changes automatically
  function saveSetting(key, val) {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
      chrome.storage.sync.set({ [key]: val });
    }
  }

  toneSelect.addEventListener('change', () => saveSetting('tone', toneSelect.value));
  languageSelect.addEventListener('change', () => saveSetting('language', languageSelect.value));
  autoInsertToggle.addEventListener('change', () => saveSetting('autoInsert', autoInsertToggle.checked));
  soundEffectsToggle.addEventListener('change', () => saveSetting('soundEffects', soundEffectsToggle.checked));
  aiProviderSelect.addEventListener('change', () => saveSetting('aiProvider', aiProviderSelect.value));
  apiKeyInput.addEventListener('input', () => saveSetting('apiKey', apiKeyInput.value));

  // Toggle API Key visibility
  toggleKeyVisibilityBtn.addEventListener('click', () => {
    if (apiKeyInput.type === 'password') {
      apiKeyInput.type = 'text';
      toggleKeyVisibilityBtn.textContent = '🔒';
    } else {
      apiKeyInput.type = 'password';
      toggleKeyVisibilityBtn.textContent = '👁️';
    }
  });

  // Open Interactive Playground
  openPlaygroundBtn.addEventListener('click', () => {
    if (typeof chrome !== 'undefined' && chrome.tabs && chrome.runtime) {
      chrome.tabs.create({ url: chrome.runtime.getURL('playground/playground.html') });
    } else {
      window.open('../playground/playground.html', '_blank');
    }
  });

  // --------------------------------------------------------------------------
  // Microphone Calibration & Live Test
  // --------------------------------------------------------------------------
  let testRecognition = null;
  let isTesting = false;

  testMicBtn.addEventListener('click', () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      testMicFeedback.textContent = 'Speech recognition not supported in browser.';
      return;
    }

    if (isTesting) {
      if (testRecognition) testRecognition.stop();
      isTesting = false;
      testMicBtn.classList.remove('recording');
      testMicLabel.textContent = 'Test Microphone Live';
      testMicFeedback.textContent = 'Test stopped.';
      return;
    }

    try {
      testRecognition = new SpeechRecognition();
      testRecognition.continuous = false;
      testRecognition.interimResults = true;
      testRecognition.lang = languageSelect.value || 'en-US';

      testRecognition.onstart = () => {
        isTesting = true;
        testMicBtn.classList.add('recording');
        testMicLabel.textContent = 'Say something...';
        testMicFeedback.textContent = 'Listening to mic...';
      };

      testRecognition.onresult = (e) => {
        const text = Array.from(e.results).map(r => r[0].transcript).join('');
        testMicFeedback.textContent = `"${text}"`;
      };

      testRecognition.onerror = (e) => {
        console.warn('Test mic error:', e.error);
        testMicFeedback.textContent = `Error: ${e.error}`;
      };

      testRecognition.onend = () => {
        isTesting = false;
        testMicBtn.classList.remove('recording');
        testMicLabel.textContent = 'Test Microphone Live';
        if (testMicFeedback.textContent === 'Listening to mic...') {
          testMicFeedback.textContent = 'Ready (No speech detected)';
        }
      };

      testRecognition.start();
    } catch (err) {
      testMicFeedback.textContent = 'Could not start mic test.';
      console.error(err);
    }
  });
});
