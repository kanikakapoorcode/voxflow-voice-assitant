/**
 * VoxFlow Playground Script
 * Adds interactive behaviors to the sandbox simulators
 */

document.addEventListener('DOMContentLoaded', () => {
  // Tweet Character Counter
  const tweetArea = document.getElementById('tweet-textarea');
  const tweetCount = document.getElementById('tweet-char-count');

  if (tweetArea && tweetCount) {
    tweetArea.addEventListener('input', () => {
      const len = tweetArea.value.length;
      tweetCount.textContent = `${len} / 280`;
      if (len > 260) {
        tweetCount.style.color = '#ef4444';
      } else {
        tweetCount.style.color = '#94a3b8';
      }
    });
  }

  // Chat message send simulator
  const chatTextarea = document.getElementById('chat-textarea');
  const chatSendBtn = document.getElementById('chat-send-btn');
  const chatHistory = document.querySelector('.pg-chat-history');

  function sendChatMessage() {
    const text = chatTextarea.value.trim();
    if (!text) return;

    const msgEl = document.createElement('div');
    msgEl.className = 'pg-chat-msg';
    msgEl.style.marginTop = '8px';
    msgEl.style.alignSelf = 'flex-end';
    msgEl.style.background = 'rgba(99, 102, 241, 0.2)';
    msgEl.style.borderColor = 'rgba(99, 102, 241, 0.3)';
    msgEl.innerHTML = `
      <span class="pg-msg-author" style="color: #a5b4fc;">You (Dictated):</span>
      <p style="white-space: pre-line;">${escapeHtml(text)}</p>
    `;

    chatHistory.appendChild(msgEl);
    chatTextarea.value = '';
    chatHistory.scrollTop = chatHistory.scrollHeight;
  }

  if (chatSendBtn && chatTextarea) {
    chatSendBtn.addEventListener('click', sendChatMessage);
    chatTextarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendChatMessage();
      }
    });
  }

  function escapeHtml(str) {
    return str.replace(/[&<>'"]/g, tag => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[tag] || tag));
  }
});
