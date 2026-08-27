(function () {
  'use strict';

  var STORAGE_KEY = 'ef_message_log_export';
  var messageEntries = [];
  var nextId = 1;

  var logEl = document.getElementById('log');
  var clearBtn = document.getElementById('clearBtn');
  var openParserBtn = document.getElementById('openParserBtn');

  function writeLog(line, obj) {
    var stamp = new Date().toISOString();
    var text = '[' + stamp + '] ' + line;
    console.log(text, obj || '');
    logEl.textContent += text + '\n';

    if (obj !== undefined) {
      try {
        logEl.textContent += JSON.stringify(obj, null, 2) + '\n\n';
      } catch (error) {
        logEl.textContent += String(obj) + '\n\n';
      }
    }

    logEl.scrollTop = logEl.scrollHeight;
  }

  function addEntry(entry) {
    var record = {
      id: nextId++,
      timestamp: entry.timestamp || new Date().toISOString(),
      label: entry.label || 'message',
      category: entry.category || 'message',
      origin: entry.origin || null,
      data: entry.data
    };

    messageEntries.push(record);
    return record;
  }

  function exportToParser() {
    if (!messageEntries.length) {
      window.alert('No messages have been collected yet.');
      return;
    }

    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
      exportedAt: new Date().toISOString(),
      source: 'EF Message Logger',
      sourceUrl: window.location.pathname,
      messages: messageEntries
    }));

    window.location.href = '/ef-message-parser.html';
  }

  clearBtn.addEventListener('click', function () {
    logEl.textContent = '';
    messageEntries = [];
    nextId = 1;
    writeLog('log cleared');
  });

  openParserBtn.addEventListener('click', exportToParser);

  window.addEventListener('message', function (event) {
    addEntry({
      label: 'raw message received',
      category: 'raw',
      origin: event.origin,
      data: {
        origin: event.origin,
        data: event.data
      }
    });

    writeLog('raw message received', {
      origin: event.origin,
      data: event.data
    });

    var parsed;

    if (typeof event.data === 'string') {
      try {
        parsed = JSON.parse(event.data);
        addEntry({
          label: 'parsed message',
          category: 'parsed',
          origin: event.origin,
          data: parsed
        });
        writeLog('parsed message', parsed);
      } catch (error) {
        addEntry({
          label: 'non-JSON string payload',
          category: 'string',
          origin: event.origin,
          data: event.data
        });
        writeLog('non-JSON string payload', event.data);
        return;
      }
    } else {
      parsed = event.data;
      addEntry({
        label: 'parsed message',
        category: 'parsed',
        origin: event.origin,
        data: parsed
      });
    }

    if (parsed && parsed.type === 'settingsRequest') {
      addEntry({
        label: 'settingsRequest received',
        category: 'settings',
        origin: event.origin,
        data: parsed
      });
      writeLog('settingsRequest received (optional for dynamic init; defaults are in framework.js)');
    }

    if (parsed && parsed.type === 'efLifecycle') {
      addEntry({
        label: 'EF lifecycle: ' + (parsed.data && parsed.data.stage ? parsed.data.stage : 'unknown'),
        category: 'lifecycle',
        origin: event.origin,
        data: parsed
      });
      writeLog(
        'EF lifecycle: ' + (parsed.data && parsed.data.stage ? parsed.data.stage : 'unknown'),
        parsed.data || null
      );
    }
  });

  mountEmbeddableFrameworkIframe('softphone-container', 'softphone');

  addEntry({
    label: 'parent logger ready',
    category: 'system',
    data: { message: 'parent logger ready' }
  });
  writeLog('parent logger ready');

  addEntry({
    label: 'EF iframe mounted',
    category: 'system',
    data: { message: 'EF iframe mounted' }
  });
  writeLog('EF iframe mounted');
}());
