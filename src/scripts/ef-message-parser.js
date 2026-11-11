(function () {
  'use strict';

  var STORAGE_KEY = 'ef_message_log_export';
  var HIDE_RAW_KEY = 'ef_message_parser_hide_raw';

  var messageCountEl = document.getElementById('messageCount');
  var exportedAtEl = document.getElementById('exportedAt');
  var sourceEl = document.getElementById('sourceLabel');
  var messageListEl = document.getElementById('messageList');
  var emptyStateEl = document.getElementById('emptyState');
  var hideRawFilterEl = document.getElementById('hideRawFilter');

  var expandCardsBtn = document.getElementById('expandCardsBtn');
  var collapseCardsBtn = document.getElementById('collapseCardsBtn');
  var expandJsonBtn = document.getElementById('expandJsonBtn');
  var collapseJsonBtn = document.getElementById('collapseJsonBtn');
  var clearImportBtn = document.getElementById('clearImportBtn');

  var exportedData = null;
  var hideRawMessages = localStorage.getItem(HIDE_RAW_KEY) !== '0';

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatTimestamp(value) {
    if (!value) {
      return 'Unknown time';
    }

    return String(value).replace('T', ' ').replace('Z', ' UTC');
  }

  function extractJsonType(data) {
    if (!data || typeof data !== 'object') {
      return null;
    }

    if (typeof data.type === 'string' && data.type) {
      return data.type;
    }

    if (data.data && typeof data.data === 'object' && typeof data.data.type === 'string' && data.data.type) {
      return data.data.type;
    }

    if (typeof data.data === 'string') {
      try {
        var inner = JSON.parse(data.data);
        if (inner && typeof inner.type === 'string' && inner.type) {
          return inner.type;
        }
      } catch (error) {
        return null;
      }
    }

    return null;
  }

  function getMessageLabel(message) {
    var type = extractJsonType(message.data);
    if (type) {
      return type;
    }

    return message.label || 'Message';
  }

  function inferBadge(message) {
    if (message.category) {
      return message.category;
    }

    if (message.data && typeof message.data === 'object' && message.data.type) {
      return String(message.data.type);
    }

    return 'message';
  }

  function isRawMessage(message) {
    return message.category === 'raw';
  }

  function getVisibleMessages(messages) {
    if (!hideRawMessages) {
      return messages;
    }

    return messages.filter(function (message) {
      return !isRawMessage(message);
    });
  }

  function updateMessageCount(totalCount, visibleCount) {
    if (hideRawMessages && visibleCount !== totalCount) {
      messageCountEl.textContent = visibleCount + ' shown (' + totalCount + ' total)';
      return;
    }

    messageCountEl.textContent = String(visibleCount);
  }

  function loadExport() {
    var raw = sessionStorage.getItem(STORAGE_KEY);

    if (!raw) {
      return null;
    }

    try {
      return JSON.parse(raw);
    } catch (error) {
      console.error('Unable to parse exported EF message log', error);
      return null;
    }
  }

  function renderMessageCard(message, index) {
    var card = document.createElement('details');
    card.className = 'message-card';
    card.open = index < 3;

    var summary = document.createElement('summary');

    summary.innerHTML =
      '<span class="message-card__index">#' + escapeHtml(String(index + 1)) + '</span>' +
      '<span class="message-card__time">' + escapeHtml(formatTimestamp(message.timestamp)) + '</span>' +
      '<span class="message-card__label">' + escapeHtml(getMessageLabel(message)) + '</span>' +
      '<span class="message-card__badge">' + escapeHtml(inferBadge(message)) + '</span>' +
      (message.origin
        ? '<span class="message-card__origin">' + escapeHtml(message.origin) + '</span>'
        : '');

    var copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'btn-copy-json message-card__copy';
    copyBtn.textContent = 'Copy';
    copyBtn.setAttribute('aria-label', 'Copy message payload');
    if (window.EfClipboard) {
      window.EfClipboard.bindCopyButton(copyBtn, function () {
        try {
          return JSON.stringify(message.data, null, 2);
        } catch (error) {
          return String(message.data);
        }
      });
    }
    summary.appendChild(copyBtn);

    var body = document.createElement('div');
    body.className = 'message-card__body';

    var payloadSection = document.createElement('div');
    payloadSection.className = 'message-card__section';

    var payloadTitle = document.createElement('h3');
    payloadTitle.className = 'message-card__section-title';
    payloadTitle.textContent = 'Payload';
    payloadSection.appendChild(payloadTitle);
    payloadSection.appendChild(JsonTree.render(message.data, { expand: true }));

    body.appendChild(payloadSection);
    card.appendChild(summary);
    card.appendChild(body);

    return card;
  }

  function renderExport(exported) {
    var messages = Array.isArray(exported.messages) ? exported.messages : [];
    var visibleMessages = getVisibleMessages(messages);

    updateMessageCount(messages.length, visibleMessages.length);
    exportedAtEl.textContent = formatTimestamp(exported.exportedAt);
    sourceEl.textContent = exported.source || 'Unknown source';

    if (!messages.length) {
      emptyStateEl.hidden = false;
      emptyStateEl.innerHTML =
        '<p>No exported message log was found in this browser session.</p>' +
        '<p>Open <a href="/paypaltrouble.html">EF Message Logger</a> or <a href="/user-notifications.html">User Notifications</a>, collect messages, then click <strong>Open in Parser</strong>.</p>';
      messageListEl.innerHTML = '';
      return;
    }

    if (!visibleMessages.length) {
      emptyStateEl.hidden = false;
      emptyStateEl.innerHTML =
        '<p>All ' + messages.length + ' messages are hidden by the current filter.</p>' +
        '<p>Uncheck <strong>Hide raw messages</strong> to show them again.</p>';
      messageListEl.innerHTML = '';
      return;
    }

    emptyStateEl.hidden = true;
    messageListEl.innerHTML = '';

    visibleMessages.forEach(function (message, index) {
      messageListEl.appendChild(renderMessageCard(message, index));
    });
  }

  function setAllCardsExpanded(expanded) {
    messageListEl.querySelectorAll('details.message-card').forEach(function (card) {
      card.open = expanded;
    });
  }

  expandCardsBtn.addEventListener('click', function () {
    setAllCardsExpanded(true);
  });

  collapseCardsBtn.addEventListener('click', function () {
    setAllCardsExpanded(false);
  });

  expandJsonBtn.addEventListener('click', function () {
    JsonTree.setAllExpanded(messageListEl, true);
  });

  collapseJsonBtn.addEventListener('click', function () {
    JsonTree.setAllExpanded(messageListEl, false);
  });

  clearImportBtn.addEventListener('click', function () {
    sessionStorage.removeItem(STORAGE_KEY);
    window.location.reload();
  });

  hideRawFilterEl.checked = hideRawMessages;
  hideRawFilterEl.addEventListener('change', function () {
    hideRawMessages = hideRawFilterEl.checked;
    localStorage.setItem(HIDE_RAW_KEY, hideRawMessages ? '1' : '0');
    if (exportedData) {
      renderExport(exportedData);
    }
  });

  var exported = loadExport();

  if (!exported) {
    emptyStateEl.hidden = false;
    updateMessageCount(0, 0);
    exportedAtEl.textContent = 'Not available';
    sourceEl.textContent = 'No import found';
    return;
  }

  exportedData = exported;
  renderExport(exportedData);
}());
