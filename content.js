/**
 * VoxFlow Universal Smart Voice Dictation - Content Script
 * Injected on web pages to provide floating voice dictation with direct insertion.
 */

(function () {
  // Prevent duplicate injection
  if (window.__VOXFLOW_INITIALIZED__) return;
  window.__VOXFLOW_INITIALIZED__ = true;

  // State Management
  const state = {
    isRecording: false,
    finalTranscript: '',
    interimTranscript: '',
    lastTargetElement: null,
    lastSelectionRange: null,
    settings: {
      tone: 'clean',
      language: 'en-US',
      soundEffects: true,
      autoInsert: true,
      bubbleTheme: 'dark',
      apiKey: '',
      aiProvider: 'gemini'
    },
    isMinimized: false
  };

  // Web Speech Recognition
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recognition = null;
  let audioContext = null;

  // Load Settings from chrome.storage if available
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
    chrome.storage.sync.get(null, (items) => {
      if (items) Object.assign(state.settings, items);
      updateToneSelector();
    });

    chrome.storage.onChanged.addListener((changes) => {
      for (const [key, { newValue }] of Object.entries(changes)) {
        state.settings[key] = newValue;
      }
      updateToneSelector();
    });
  }

  // --------------------------------------------------------------------------
  // Audio Synthesizer (Zero-dependency Web Audio Sound Effects)
  // --------------------------------------------------------------------------
  function playSound(type) {
    if (!state.settings.soundEffects) return;
    try {
      if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (audioContext.state === 'suspended') {
        audioContext.resume();
      }

      const now = audioContext.currentTime;
      const osc = audioContext.createOscillator();
      const gain = audioContext.createGain();
      osc.connect(gain);
      gain.connect(audioContext.destination);

      if (type === 'start') {
        // High, cheerful ascending ding
        osc.type = 'sine';
        osc.frequency.setValueAtTime(440, now);
        osc.frequency.exponentialRampToValueAtTime(880, now + 0.12);
        gain.gain.setValueAtTime(0.001, now);
        gain.gain.linearRampToValueAtTime(0.18, now + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
        osc.start(now);
        osc.stop(now + 0.22);
      } else if (type === 'stop') {
        // Soft descending tone
        osc.type = 'sine';
        osc.frequency.setValueAtTime(660, now);
        osc.frequency.exponentialRampToValueAtTime(330, now + 0.15);
        gain.gain.setValueAtTime(0.15, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
        osc.start(now);
        osc.stop(now + 0.18);
      } else if (type === 'success') {
        // Bright success chord
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(523.25, now); // C5
        osc.frequency.setValueAtTime(659.25, now + 0.08); // E5
        osc.frequency.setValueAtTime(783.99, now + 0.16); // G5
        gain.gain.setValueAtTime(0.001, now);
        gain.gain.linearRampToValueAtTime(0.16, now + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
        osc.start(now);
        osc.stop(now + 0.35);
      }
    } catch (e) {
      console.warn('Audio tone not supported:', e);
    }
  }

  // --------------------------------------------------------------------------
  // Target Focus Tracker: Knows exactly where to insert text
  // --------------------------------------------------------------------------
  function isEditableElement(el) {
    if (!el) return false;
    const tagName = el.tagName ? el.tagName.toLowerCase() : '';
    const isInput = tagName === 'input' && !['button', 'submit', 'checkbox', 'radio', 'file', 'image', 'range', 'color'].includes(el.type);
    const isTextarea = tagName === 'textarea';
    const isContentEditable = el.isContentEditable || el.getAttribute('contenteditable') === 'true';
    return isInput || isTextarea || isContentEditable;
  }

  document.addEventListener('focusin', (e) => {
    // Ignore clicks inside our own VoxFlow widget
    if (e.target.closest && e.target.closest('#voxflow-root')) return;

    if (isEditableElement(e.target)) {
      state.lastTargetElement = e.target;
      updateTargetBadge(true, e.target);
    }
  }, true);

  document.addEventListener('selectionchange', () => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const activeEl = document.activeElement;
      if (activeEl && !activeEl.closest('#voxflow-root') && isEditableElement(activeEl)) {
        state.lastSelectionRange = sel.getRangeAt(0).cloneRange();
      }
    }
  });

  // --------------------------------------------------------------------------
  // UI Builder: Inject Floating Widget DOM
  // --------------------------------------------------------------------------
  const rootContainer = document.createElement('div');
  rootContainer.id = 'voxflow-root';
  rootContainer.innerHTML = `
    <!-- Live Preview & Action Box -->
    <div class="voxflow-transcript-box" id="vf-transcript-box">
      <div class="vf-transcript-header">
        <div class="vf-status-badge" id="vf-status-badge">
          <span class="vf-pulse-dot"></span>
          <span id="vf-status-text">Ready to Dictate</span>
        </div>
        <select class="vf-tone-selector" id="vf-tone-selector" title="Select Voice Tone Polish">
          <option value="clean">✨ Clean & Punctuate</option>
          <option value="raw">🎙️ Raw Dictation</option>
          <option value="professional">💼 Professional Work</option>
          <option value="casual">💬 Friendly Chat</option>
          <option value="bullet">📋 Bullet Points</option>
          <option value="concise">⚡ Concise / TL;DR</option>
        </select>
      </div>

      <div class="vf-transcript-content" id="vf-transcript-content">
        <span class="vf-placeholder-text">Click the mic or press Alt+Shift+V to speak. Your words will appear here in real-time...</span>
      </div>

      <div class="vf-actions-bar">
        <button class="vf-btn vf-btn-secondary" id="vf-clear-btn" title="Clear text">Clear</button>
        <button class="vf-btn vf-btn-secondary" id="vf-copy-btn" title="Copy to clipboard">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
          </svg>
          Copy
        </button>
        <button class="vf-btn vf-btn-primary" id="vf-insert-btn" title="Insert into focused field">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="9 11 12 14 22 4"></polyline>
            <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path>
          </svg>
          Insert Text
        </button>
      </div>
    </div>

    <!-- Floating Capsule -->
    <div class="voxflow-capsule" id="vf-capsule">
      <button class="vf-mic-btn" id="vf-mic-btn" title="Start / Stop Dictation (Alt+Shift+V)">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"></path>
          <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
          <line x1="12" y1="19" x2="12" y2="22"></line>
        </svg>
      </button>

      <div class="vf-wave-container" id="vf-wave-bars">
        <div class="vf-wave-bar"></div>
        <div class="vf-wave-bar"></div>
        <div class="vf-wave-bar"></div>
        <div class="vf-wave-bar"></div>
        <div class="vf-wave-bar"></div>
      </div>

      <div class="vf-capsule-label">
        <span class="vf-capsule-title">VoxFlow</span>
        <span class="vf-capsule-sub">
          <span id="vf-target-indicator" class="vf-target-badge">● Target detected</span>
          <span class="vf-kbd-badge">Alt+Shift+V</span>
        </span>
      </div>

      <button class="vf-icon-btn" id="vf-minimize-btn" title="Minimize / Expand">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="5" y1="12" x2="19" y2="12"></line>
        </svg>
      </button>
    </div>
  `;

  document.body.appendChild(rootContainer);

  // DOM Elements
  const capsule = document.getElementById('vf-capsule');
  const micBtn = document.getElementById('vf-mic-btn');
  const transcriptBox = document.getElementById('vf-transcript-box');
  const transcriptContent = document.getElementById('vf-transcript-content');
  const statusBadge = document.getElementById('vf-status-badge');
  const statusText = document.getElementById('vf-status-text');
  const toneSelector = document.getElementById('vf-tone-selector');
  const targetIndicator = document.getElementById('vf-target-indicator');
  const insertBtn = document.getElementById('vf-insert-btn');
  const copyBtn = document.getElementById('vf-copy-btn');
  const clearBtn = document.getElementById('vf-clear-btn');
  const minimizeBtn = document.getElementById('vf-minimize-btn');

  function updateToneSelector() {
    if (toneSelector && state.settings.tone) {
      toneSelector.value = state.settings.tone;
    }
  }

  function updateTargetBadge(hasTarget, el) {
    if (!targetIndicator) return;
    if (hasTarget && el) {
      const tag = el.tagName ? el.tagName.toLowerCase() : 'text field';
      targetIndicator.textContent = `● In ${tag}`;
      targetIndicator.style.color = '#10b981';
    } else {
      targetIndicator.textContent = `○ No field selected`;
      targetIndicator.style.color = '#94a3b8';
    }
  }

  // --------------------------------------------------------------------------
  // Draggable Floating Capsule
  // --------------------------------------------------------------------------
  let isDragging = false;
  let startX = 0, startY = 0;
  let initialLeft = 0, initialTop = 0;

  capsule.addEventListener('mousedown', (e) => {
    // Only drag from capsule, not when clicking mic or buttons
    if (e.target.closest('button') || e.target.closest('select')) return;
    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;

    const rect = rootContainer.getBoundingClientRect();
    initialLeft = rect.left;
    initialTop = rect.top;

    rootContainer.style.bottom = 'auto';
    rootContainer.style.right = 'auto';
    rootContainer.style.left = `${initialLeft}px`;
    rootContainer.style.top = `${initialTop}px`;

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  });

  function onMouseMove(e) {
    if (!isDragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    const newLeft = Math.max(10, Math.min(window.innerWidth - 80, initialLeft + dx));
    const newTop = Math.max(10, Math.min(window.innerHeight - 80, initialTop + dy));

    rootContainer.style.left = `${newLeft}px`;
    rootContainer.style.top = `${newTop}px`;
  }

  function onMouseUp() {
    isDragging = false;
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
  }

  // --------------------------------------------------------------------------
  // Local Rule-Based Speech Polish Engine
  // --------------------------------------------------------------------------
  function smartPolishLocal(rawText, tone) {
    if (!rawText || !rawText.trim()) return '';

    let text = rawText.trim();

    // 1. Spoken Punctuation Transformations
    const punctMap = [
      [/\b(new line|next line|enter)\b/gi, '\n'],
      [/\b(new paragraph)\b/gi, '\n\n'],
      [/\b(period|full stop|dot)\b/gi, '.'],
      [/\b(comma)\b/gi, ','],
      [/\b(question mark)\b/gi, '?'],
      [/\b(exclamation mark|exclamation point)\b/gi, '!'],
      [/\b(colon)\b/gi, ':'],
      [/\b(semicolon)\b/gi, ';'],
      [/\b(bullet point|bullet)\b/gi, '\n• '],
      [/\b(open quote|quote)\b/gi, '"'],
      [/\b(close quote|end quote)\b/gi, '"']
    ];

    punctMap.forEach(([regex, replacement]) => {
      text = text.replace(regex, replacement);
    });

    // 2. Clean extra spacing around punctuation (e.g., "hello , world ." -> "hello, world.")
    text = text.replace(/\s+([.,!?:;])/g, '$1');
    text = text.replace(/([.,!?:;])(?=[^\s\d])/g, '$1 ');

    // 3. Stutter & duplicate word removal (e.g. "I I think think" -> "I think")
    text = text.replace(/\b([a-zA-Z]+)\s+\1\b/gi, '$1');

    // 4. Tone-specific transformations
    if (tone === 'clean' || tone === 'professional' || tone === 'concise') {
      // Remove common verbal crutches/fillers
      text = text.replace(/\b(um+|uh+|er+|ah+)\b[,]?\s*/gi, '');
      text = text.replace(/\b(you know|basically|kind of|sort of)\b[,]?\s*/gi, '');
    }

    if (tone === 'bullet') {
      const items = text.split(/(?:[.]\s+|\n|,\s*and\s+)/).map(s => s.trim()).filter(Boolean);
      text = items.map(item => `• ${capitalizeFirst(item)}`).join('\n');
    } else {
      // 5. Capitalize first letter of every sentence
      text = text.replace(/(^\s*|[.!?\n]\s+)([a-z])/g, (_, prefix, char) => prefix + char.toUpperCase());

      // Capitalize lone 'i'
      text = text.replace(/\b(i)\b/g, 'I');
    }

    // Ensure terminal period if missing and not a list
    if (tone !== 'bullet' && !/[.!?\n]$/.test(text)) {
      text += '.';
    }

    return text.trim();
  }

  function capitalizeFirst(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  // --------------------------------------------------------------------------
  // Microphone Permission & Detection Helper
  // --------------------------------------------------------------------------
  async function ensureMicrophonePermission() {
    if (navigator.permissions && navigator.permissions.query) {
      try {
        const perm = await navigator.permissions.query({ name: 'microphone' });
        if (perm.state === 'granted') {
          return true;
        } else if (perm.state === 'denied') {
          alert('Microphone access is blocked for this site. Click the site settings/lock icon in your browser address bar to allow microphone access.');
          return false;
        }
      } catch (e) {
        // Fallback if query({ name: 'microphone' }) is not supported in this browser
      }
    }

    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((track) => track.stop());
        return true;
      } catch (err) {
        console.warn('Microphone permission request denied:', err);
        return false;
      }
    }
    return true;
  }

  // --------------------------------------------------------------------------
  // Speech Recognition Controller
  // --------------------------------------------------------------------------
  function initRecognition() {
    if (!SpeechRecognition) {
      alert('Speech recognition is not supported in this browser. Please use Google Chrome, Microsoft Edge, or Brave.');
      return false;
    }

    if (recognition) return true;

    try {
      recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = state.settings.language || 'en-US';

      recognition.onstart = () => {
        state.isRecording = true;
        rootContainer.classList.add('vf-recording-active');
        statusBadge.classList.add('vf-recording');
        statusText.textContent = 'Listening...';
        transcriptBox.classList.add('vf-visible');
        playSound('start');
      };

      recognition.onresult = (event) => {
        let interim = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            state.finalTranscript += ' ' + transcript;
          } else {
            interim += transcript;
          }
        }
        state.interimTranscript = interim;
        renderTranscript();
      };

      recognition.onerror = (event) => {
        console.warn('Speech recognition error:', event.error);
        if (event.error === 'not-allowed') {
          statusText.textContent = 'Mic Permission Denied';
          alert('VoxFlow needs microphone access. Please allow mic permissions in your browser URL bar.');
        } else if (event.error !== 'no-speech') {
          statusText.textContent = `Error: ${event.error}`;
        }
      };

      recognition.onend = () => {
        const wasRecording = state.isRecording;
        state.isRecording = false;
        rootContainer.classList.remove('vf-recording-active');
        statusBadge.classList.remove('vf-recording');
        playSound('stop');

        const hasText = (state.finalTranscript.trim() || state.interimTranscript.trim()).length > 0;
        if (hasText) {
          statusText.textContent = 'Paused / Finished';
          if (state.settings.autoInsert) {
            applyAndInsert();
          }
        } else {
          statusText.textContent = 'Ready to Dictate';
        }
      };

      return true;
    } catch (e) {
      console.error('Failed to initialize SpeechRecognition:', e);
      return false;
    }
  }

  async function toggleDictation() {
    if (!initRecognition()) return;

    if (state.isRecording) {
      recognition.stop();
      return;
    }

    const permitted = await ensureMicrophonePermission();
    if (!permitted) {
      statusText.textContent = 'Mic Blocked';
      return;
    }

    state.finalTranscript = '';
    state.interimTranscript = '';
    renderTranscript();
    recognition.lang = state.settings.language || 'en-US';
    try {
      recognition.start();
    } catch (err) {
      console.warn('Recognition start error:', err);
      if (err.name === 'InvalidStateError') {
        try {
          recognition.stop();
          setTimeout(() => recognition.start(), 150);
        } catch (e) {}
      }
    }
  }

  function renderTranscript() {
    const finalClean = state.finalTranscript.trim();
    const interimClean = state.interimTranscript.trim();

    if (!finalClean && !interimClean) {
      transcriptContent.innerHTML = `<span class="vf-placeholder-text">Listening... Speak clearly into your microphone.</span>`;
      return;
    }

    transcriptContent.innerHTML = `
      <span>${escapeHTML(finalClean)}</span>
      <span class="vf-interim-text">${escapeHTML(interimClean ? ' ' + interimClean : '')}</span>
    `;
    transcriptContent.scrollTop = transcriptContent.scrollHeight;
  }

  function escapeHTML(str) {
    return str.replace(/[&<>'"]/g, tag => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[tag] || tag));
  }

  // --------------------------------------------------------------------------
  // Insertion Engine: Directly types text into the active field
  // --------------------------------------------------------------------------
  async function applyAndInsert() {
    const raw = (state.finalTranscript + ' ' + state.interimTranscript).trim();
    if (!raw) return;

    statusText.textContent = 'Polishing...';
    let polished = smartPolishLocal(raw, toneSelector.value);

    // If an API key is available, perform enhanced AI polish
    if (state.settings.apiKey && state.settings.apiKey.trim() && toneSelector.value !== 'raw') {
      try {
        const response = await new Promise((resolve) => {
          chrome.runtime.sendMessage({
            action: 'ai_polish_text',
            text: raw,
            tone: toneSelector.value,
            apiKey: state.settings.apiKey,
            aiProvider: state.settings.aiProvider || 'gemini'
          }, resolve);
        });

        if (response && response.success && response.text) {
          polished = response.text;
        }
      } catch (err) {
        console.warn('AI Polish fallback to local polish:', err);
      }
    }

    // Display polished version in preview
    transcriptContent.innerHTML = `<strong>${escapeHTML(polished)}</strong>`;
    statusText.textContent = 'Inserted!';

    // Insert into target element
    insertIntoElement(polished);
    playSound('success');

    // Also copy to clipboard for convenience
    navigator.clipboard.writeText(polished).catch(() => {});
  }

  function insertIntoElement(text) {
    let target = state.lastTargetElement;

    // Check if target is still in DOM and visible
    if (!target || !document.body.contains(target)) {
      // Fallback: check current active element
      if (isEditableElement(document.activeElement)) {
        target = document.activeElement;
      }
    }

    if (!target) {
      console.warn('No editable target element found to insert text. Text copied to clipboard.');
      return;
    }

    target.focus();

    // 1. Textarea & Input Fields
    if (target.tagName && (target.tagName.toLowerCase() === 'textarea' || target.tagName.toLowerCase() === 'input')) {
      const start = target.selectionStart !== null ? target.selectionStart : target.value.length;
      const end = target.selectionEnd !== null ? target.selectionEnd : target.value.length;

      // Try execCommand first so Chrome preserves Undo (Ctrl+Z) history
      let inserted = false;
      try {
        inserted = document.execCommand('insertText', false, text);
      } catch (e) {
        inserted = false;
      }

      if (!inserted) {
        const newVal = target.value.substring(0, start) + text + target.value.substring(end);
        const isInput = target.tagName.toLowerCase() === 'input';
        const proto = isInput ? window.HTMLInputElement.prototype : window.HTMLTextAreaElement.prototype;
        const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;

        if (nativeSetter) {
          nativeSetter.call(target, newVal);
        } else if (typeof target.setRangeText === 'function') {
          target.setRangeText(text, start, end, 'end');
        } else {
          target.value = newVal;
        }
        target.setSelectionRange(start + text.length, start + text.length);
      }

      // Dispatch input & change events for modern frameworks (React, Vue, Svelte)
      target.dispatchEvent(new Event('input', { bubbles: true }));
      target.dispatchEvent(new Event('change', { bubbles: true }));
    }
    // 2. Rich Text / ContentEditable Editors (Gmail, Notion, Slack, Twitter/X, etc.)
    else if (target.isContentEditable || target.getAttribute('contenteditable') === 'true') {
      let inserted = false;
      try {
        inserted = document.execCommand('insertText', false, text);
      } catch (e) {
        inserted = false;
      }

      if (!inserted && state.lastSelectionRange) {
        try {
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(state.lastSelectionRange);
          state.lastSelectionRange.deleteContents();
          const textNode = document.createTextNode(text);
          state.lastSelectionRange.insertNode(textNode);
          state.lastSelectionRange.setStartAfter(textNode);
          state.lastSelectionRange.collapse(true);
          sel.removeAllRanges();
          sel.addRange(state.lastSelectionRange);
        } catch (err) {
          target.innerText += text;
        }
      } else if (!inserted) {
        target.innerText += text;
      }

      target.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  // --------------------------------------------------------------------------
  // Event Listeners & Controls
  // --------------------------------------------------------------------------
  micBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleDictation();
  });

  insertBtn.addEventListener('click', () => {
    applyAndInsert();
  });

  copyBtn.addEventListener('click', () => {
    const raw = (state.finalTranscript + ' ' + state.interimTranscript).trim();
    const text = smartPolishLocal(raw, toneSelector.value);
    navigator.clipboard.writeText(text).then(() => {
      copyBtn.textContent = 'Copied!';
      setTimeout(() => {
        copyBtn.innerHTML = `
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
          </svg> Copy`;
      }, 1500);
    });
  });

  clearBtn.addEventListener('click', () => {
    state.finalTranscript = '';
    state.interimTranscript = '';
    renderTranscript();
    statusText.textContent = 'Cleared';
  });

  minimizeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    state.isMinimized = !state.isMinimized;
    rootContainer.classList.toggle('vf-minimized', state.isMinimized);
    minimizeBtn.title = state.isMinimized ? 'Expand VoxFlow' : 'Minimize';
    minimizeBtn.innerHTML = state.isMinimized
      ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 3 21 3 21 9"></polyline><polyline points="9 21 3 21 3 15"></polyline><line x1="21" y1="3" x2="14" y2="10"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg>`
      : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"></line></svg>`;
  });

  // Global Keyboard Shortcut: Alt+Shift+V
  document.addEventListener('keydown', (e) => {
    if (e.altKey && e.shiftKey && (e.key === 'V' || e.key === 'v')) {
      e.preventDefault();
      toggleDictation();
    }
  });

  // Listen to messages from background worker (shortcut or context menu)
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.action === 'toggle_dictation') {
        toggleDictation();
      }
    });
  }
})();
