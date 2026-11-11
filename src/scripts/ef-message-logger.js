(function () {
  'use strict';

  var STORAGE_KEY = 'ef_message_log_export';
  var messageEntries = [];
  var nextId = 1;

  var logEl = document.getElementById('log');
  var participantLogEl = document.getElementById('participantLog');
  var clearBtn = document.getElementById('clearBtn');
  var openParserBtn = document.getElementById('openParserBtn');

  var softphoneIframe = null;

  var platformState = {
    accessToken: null,
    apiBaseUrl: null,
    userId: null,
    channelId: null,
    webSocket: null,
    starting: false,
    active: false,
    authPollTimer: null,
    authPollAttempts: 0
  };

  var MAX_AUTH_POLL_ATTEMPTS = 120;

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

  function writeParticipantLog(line, obj) {
    if (!participantLogEl) {
      writeLog(line, obj);
      return;
    }

    var stamp = new Date().toISOString();
    var text = '[' + stamp + '] ' + line;
    console.log('[participant]', text, obj || '');
    participantLogEl.textContent += text + '\n';

    if (obj !== undefined) {
      try {
        participantLogEl.textContent += JSON.stringify(obj, null, 2) + '\n\n';
      } catch (error) {
        participantLogEl.textContent += String(obj) + '\n\n';
      }
    }

    participantLogEl.scrollTop = participantLogEl.scrollHeight;
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

  function resolveApiBaseUrl() {
    var iframeSrc = window.__EF_IFRAME_SRC__ || '';
    var match = iframeSrc.match(/^https:\/\/apps\.([^.]+\.pure\.cloud)/i);
    if (match && match[1]) {
      return 'https://api.' + match[1];
    }
    return 'https://api.usw2.pure.cloud';
  }

  function getParticipantsFromValue(value, depth) {
    var found = [];
    var key;
    var i;
    var item;

    if (!value || depth > 6) {
      return found;
    }

    if (Array.isArray(value)) {
      for (i = 0; i < value.length; i += 1) {
        found = found.concat(getParticipantsFromValue(value[i], depth + 1));
      }
      return found;
    }

    if (typeof value !== 'object') {
      return found;
    }

    if (Array.isArray(value.participants) && value.participants.length) {
      found.push({
        source: 'participants',
        conversationId: value.id || value.conversationId || null,
        participants: value.participants
      });
    }

    for (key in value) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) {
        continue;
      }
      if (key === 'participants') {
        continue;
      }
      item = value[key];
      if (item && typeof item === 'object') {
        found = found.concat(getParticipantsFromValue(item, depth + 1));
      }
    }

    return found;
  }

  function recordParticipantPayload(label, payload, origin) {
    var extracts = getParticipantsFromValue(payload, 0);
    var i;
    var entryData;

    if (!extracts.length) {
      return false;
    }

    for (i = 0; i < extracts.length; i += 1) {
      entryData = {
        label: label,
        extract: extracts[i],
        fullPayload: payload
      };

      addEntry({
        label: label,
        category: 'participant',
        origin: origin || null,
        data: entryData
      });

      writeParticipantLog(label, entryData);
    }

    return true;
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

  function apiRequest(path, options) {
    return fetch(platformState.apiBaseUrl + path, {
      method: options.method || 'GET',
      headers: {
        Authorization: 'Bearer ' + platformState.accessToken,
        'Content-Type': 'application/json'
      },
      body: options.body
    }).then(function (response) {
      if (!response.ok) {
        throw new Error(path + ' failed with status ' + response.status);
      }
      if (response.status === 204) {
        return {};
      }
      return response.json();
    });
  }

  function stopPlatformSubscription() {
    if (platformState.authPollTimer) {
      clearInterval(platformState.authPollTimer);
      platformState.authPollTimer = null;
    }

    if (platformState.webSocket) {
      try {
        platformState.webSocket.onclose = null;
        platformState.webSocket.close();
      } catch (error) {
        // ignore
      }
      platformState.webSocket = null;
    }

    if (platformState.channelId && platformState.accessToken && platformState.apiBaseUrl) {
      apiRequest('/api/v2/notifications/channels/' + encodeURIComponent(platformState.channelId), {
        method: 'DELETE'
      }).catch(function (error) {
        writeLog('platform channel delete warning', { message: error.message });
      });
    }

    platformState.channelId = null;
    platformState.active = false;
    platformState.starting = false;
  }

  function handlePlatformNotification(rawMessage) {
    var message;
    var eventBody;
    var topicName;

    try {
      message = typeof rawMessage === 'string' ? JSON.parse(rawMessage) : rawMessage;
    } catch (error) {
      writeLog('platform notification parse error', { message: error.message, rawMessage: rawMessage });
      return;
    }

    topicName = message.topicName || '';
    eventBody = message.eventBody || null;

    addEntry({
      label: 'platform notification',
      category: 'platform',
      origin: 'notifications-wss',
      data: message
    });

    writeLog('platform notification', {
      topicName: topicName,
      eventBody: eventBody
    });

    if (eventBody && eventBody.participants && eventBody.participants.length) {
      recordParticipantPayload(
        'platform conversation notification (participants)',
        eventBody,
        'notifications-wss'
      );
    }
  }

  function openPlatformWebSocket(connectUri) {
    return new Promise(function (resolve, reject) {
      var webSocket;
      var opened = false;

      try {
        webSocket = new WebSocket(connectUri);
      } catch (error) {
        reject(error);
        return;
      }

      webSocket.onopen = function () {
        opened = true;
        platformState.webSocket = webSocket;
        resolve();
      };

      webSocket.onerror = function () {
        if (!opened) {
          reject(new Error('Failed to open the notifications WebSocket.'));
        } else {
          writeLog('platform WebSocket error', {});
        }
      };

      webSocket.onclose = function (event) {
        platformState.active = false;
        writeLog('platform WebSocket closed', {
          code: event.code,
          reason: event.reason || ''
        });
      };

      webSocket.onmessage = function (event) {
        handlePlatformNotification(event.data);
      };
    });
  }

  function startPlatformSubscription(accessToken) {
    var userTopic;

    if (platformState.active || platformState.starting) {
      return Promise.resolve();
    }

    if (!accessToken) {
      return Promise.resolve();
    }

    platformState.starting = true;
    platformState.accessToken = accessToken;
    platformState.apiBaseUrl = resolveApiBaseUrl();

    writeLog('starting platform conversation notifications', {
      apiBaseUrl: platformState.apiBaseUrl
    });

    return apiRequest('/api/v2/users/me', { method: 'GET' })
      .then(function (user) {
        platformState.userId = user && user.id ? user.id : null;
        if (!platformState.userId) {
          throw new Error('Unable to resolve current user id from /users/me');
        }
        return apiRequest('/api/v2/notifications/channels', { method: 'POST' });
      })
      .then(function (channel) {
        platformState.channelId = channel.id;
        writeLog('platform notification channel created', { channelId: channel.id });
        return openPlatformWebSocket(channel.connectUri).then(function () {
          return channel;
        });
      })
      .then(function () {
        userTopic = 'v2.users.' + platformState.userId + '.conversations';
        return apiRequest('/api/v2/notifications/channels/' + encodeURIComponent(platformState.channelId) + '/subscriptions', {
          method: 'POST',
          body: JSON.stringify([{ id: userTopic }])
        }).then(function () {
          writeLog('platform notification subscription active', { topic: userTopic });
          writeParticipantLog('listening for participant data', { topic: userTopic });
          platformState.active = true;
        });
      })
      .catch(function (error) {
        writeLog('platform notification subscription failed', {
          message: error && error.message ? error.message : String(error)
        });
      })
      .then(function () {
        platformState.starting = false;
      });
  }

  function requestAuthTokenFromIframe() {
    if (!softphoneIframe || !softphoneIframe.contentWindow) {
      return;
    }

    platformState.authPollAttempts += 1;
    if (platformState.authPollAttempts > MAX_AUTH_POLL_ATTEMPTS) {
      if (platformState.authPollTimer) {
        clearInterval(platformState.authPollTimer);
        platformState.authPollTimer = null;
      }
      writeLog('stopped polling for EF auth token (log in to the embedded client to enable participant notifications)');
      return;
    }

    softphoneIframe.contentWindow.postMessage(JSON.stringify({
      type: 'diagnosticsGetAuthToken'
    }), '*');
  }

  function beginAuthTokenPolling() {
    if (platformState.authPollTimer || platformState.active) {
      return;
    }

    platformState.authPollAttempts = 0;
    requestAuthTokenFromIframe();
    platformState.authPollTimer = setInterval(requestAuthTokenFromIframe, 3000);
  }

  clearBtn.addEventListener('click', function () {
    logEl.textContent = '';
    if (participantLogEl) {
      participantLogEl.textContent = '';
    }
    messageEntries = [];
    nextId = 1;
    stopPlatformSubscription();
    writeLog('log cleared');
    beginAuthTokenPolling();
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

      if (parsed.data && parsed.data.stage === 'initialSetup-complete') {
        beginAuthTokenPolling();
      }
    }

    if (parsed && parsed.type === 'diagnosticsAuthToken') {
      if (parsed.data && parsed.data.token) {
        if (platformState.authPollTimer) {
          clearInterval(platformState.authPollTimer);
          platformState.authPollTimer = null;
        }
        startPlatformSubscription(parsed.data.token);
      }
      return;
    }

    if (parsed && (parsed.type === 'interactionSubscription' || parsed.type === 'notificationSubscription')) {
      recordParticipantPayload(parsed.type, parsed.data || parsed, event.origin);
    } else if (parsed) {
      recordParticipantPayload(parsed.type || 'ef message', parsed, event.origin);
    }
  });

  softphoneIframe = mountEmbeddableFrameworkIframe('softphone-container', 'softphone');

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
  writeParticipantLog('waiting for EF login — participant panel will fill from platform conversation notifications', {
    apiBaseUrl: resolveApiBaseUrl(),
    topicPattern: 'v2.users.{userId}.conversations'
  });

  beginAuthTokenPolling();
}());
