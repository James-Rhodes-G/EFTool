document.addEventListener('DOMContentLoaded', function () {
  'use strict';

  var STORAGE_KEY = 'ef_message_log_export';
  var TOPIC_CLASS_PREFIX = 'user-notifications-topics';
  var PAGE_GROUP = 'users';

  var state = {
    accessToken: null,
    apiBaseUrl: null,
    userId: null,
    userDisplayName: null,
    availableTopics: [],
    selectedTopicIds: [],
    topicsLoading: false,
    topicsError: '',
    subscriptionManager: null,
    subscriptionResult: null,
    subscriptionError: '',
    parsedMessages: [],
    messageEntries: []
  };

  var topicPickerHost = document.getElementById('topicPickerHost');
  var connectedUserReadout = document.getElementById('connectedUserReadout');
  var startButton = document.getElementById('startSubscription');
  var stopButton = document.getElementById('stopSubscription');
  var openParserBtn = document.getElementById('openParserBtn');
  var clearButton = document.getElementById('clearOutput');
  var statusText = document.getElementById('statusText');
  var channelText = document.getElementById('channelText');
  var messageCountText = document.getElementById('messageCountText');
  var subscriptionResultsEl = document.getElementById('subscriptionResults');
  var streamOutput = document.getElementById('streamOutput');

  var softphoneIframe = mountEmbeddableFrameworkIframe('softphone-container', 'softphone');
  var diagnosticsAuth = EfDiagnosticsAuth.create({
    iframe: softphoneIframe,
    onCredentials: onDiagnosticsCredentials
  });

  diagnosticsAuth.bind();

  startButton.addEventListener('click', function () {
    startSubscription().catch(function (error) {
      state.subscriptionError = error.message || String(error);
      setStatus('Error');
      renderSubscriptionResults();
      appendStream('Subscription Error', { message: state.subscriptionError });
    });
  });

  stopButton.addEventListener('click', function () {
    stopSubscription();
  });

  openParserBtn.addEventListener('click', openParser);

  clearButton.addEventListener('click', function () {
    streamOutput.value = '';
    state.parsedMessages = [];
    state.messageEntries = [];
    messageCountText.textContent = '0';
    syncControlButtons();
  });

  GenesysConnectionFields.ready.then(function () {
    return refreshCredentialsFromFields();
  }).then(function () {
    if (state.accessToken && state.apiBaseUrl) {
      return loadAvailableTopics();
    }
    return null;
  }).catch(function (error) {
    console.error('[UserNotifications]', error);
  });

  document.getElementById('genesysRegionSelect').addEventListener('change', function () {
    state.apiBaseUrl = GenesysConnectionFields.getApiBaseUrl();
    EfDiagnosticsAuth.resolveApiBaseUrlFromIframeSrc();
    if (state.accessToken) {
      loadAvailableTopics().catch(console.error);
    }
  });

  document.getElementById('accessToken').addEventListener('blur', function () {
    refreshCredentialsFromFields().then(function () {
      if (state.accessToken) {
        return resolveConnectedUser().then(loadAvailableTopics);
      }
      return null;
    }).catch(console.error);
  });

  function onDiagnosticsCredentials(creds) {
    state.accessToken = creds.accessToken;
    if (creds.apiBaseUrl) {
      state.apiBaseUrl = creds.apiBaseUrl.replace(/\/$/, '');
    }
    if (creds.userId) {
      state.userId = creds.userId;
    }
    if (creds.userDisplayName) {
      state.userDisplayName = creds.userDisplayName;
    }

    var accessTokenField = document.getElementById('accessToken');
    if (accessTokenField && creds.accessToken) {
      accessTokenField.value = creds.accessToken;
    }

    if (!state.apiBaseUrl) {
      state.apiBaseUrl = GenesysConnectionFields.getApiBaseUrl() || EfDiagnosticsAuth.resolveApiBaseUrlFromIframeSrc();
    }

    resolveConnectedUser()
      .then(loadAvailableTopics)
      .catch(function (error) {
        state.topicsError = error.message;
        renderTopicPicker();
      });
  }

  function refreshCredentialsFromFields() {
    return GenesysConnectionFields.ready.then(function () {
      var token = GenesysConnectionFields.getAccessToken();
      if (token) {
        state.accessToken = token;
      }
      state.apiBaseUrl = GenesysConnectionFields.getApiBaseUrl();
      if (!state.apiBaseUrl) {
        state.apiBaseUrl = EfDiagnosticsAuth.resolveApiBaseUrlFromIframeSrc();
      }
      syncControlButtons();
    });
  }

  function getCredentials() {
    if (!state.accessToken || !state.apiBaseUrl) {
      throw new Error('Access token and API base URL are required. Log in to the embedded client or paste a token.');
    }
    return {
      accessToken: state.accessToken,
      apiBaseUrl: state.apiBaseUrl.replace(/\/$/, '')
    };
  }

  function formatUserDisplayName(user) {
    if (!user) {
      return '';
    }
    return (
      user.name ||
      [user.firstName, user.lastName].filter(Boolean).join(' ') ||
      user.username ||
      user.userName ||
      user.id ||
      ''
    );
  }

  function resolveConnectedUser() {
    var creds = getCredentials();

    return EfNotificationClient.apiRequest(creds.apiBaseUrl, creds.accessToken, '/api/v2/users/me', {
      method: 'GET'
    }).then(function (me) {
      state.userId = me && me.id ? me.id : state.userId;
      state.userDisplayName = formatUserDisplayName(me) || state.userDisplayName || state.userId;

      if (connectedUserReadout) {
        if (state.userId) {
          connectedUserReadout.classList.remove('muted-wait');
          connectedUserReadout.textContent =
            (state.userDisplayName || 'User') + ' (' + state.userId + ')';
        } else {
          connectedUserReadout.textContent = 'Unable to resolve connected user.';
        }
      }

      syncControlButtons();
      return state.userId;
    });
  }

  function loadAvailableTopics() {
    var creds;
    state.topicsLoading = true;
    state.topicsError = '';
    renderTopicPicker();

    try {
      creds = getCredentials();
    } catch (error) {
      state.topicsLoading = false;
      state.topicsError = error.message;
      renderTopicPicker();
      return Promise.reject(error);
    }

    return EfNotificationClient.apiRequest(creds.apiBaseUrl, creds.accessToken, '/api/v2/notifications/availabletopics', {
      method: 'GET'
    }).then(function (payload) {
      state.availableTopics = EfNotificationTopics.filterTopicsForGroup(payload, PAGE_GROUP);
      state.topicsError = '';

      if (!state.selectedTopicIds.length && state.availableTopics.length) {
        state.selectedTopicIds = EfNotificationTopics.getDefaultTopicIds(PAGE_GROUP, {
          entities: state.availableTopics
        });
      }

      state.topicsLoading = false;
      renderTopicPicker();
      syncControlButtons();
    }).catch(function (error) {
      state.topicsLoading = false;
      state.topicsError = error.message || 'Unable to load available notification topics.';
      state.availableTopics = [];
      renderTopicPicker();
      throw error;
    });
  }

  function renderTopicPicker() {
    if (!topicPickerHost) {
      return;
    }

    if (state.topicsLoading) {
      topicPickerHost.innerHTML =
        '<div class="field-container"><span class="field-label">Subscription Topics</span>' +
        '<p class="muted">Loading available topics…</p></div>';
      return;
    }

    if (state.topicsError) {
      topicPickerHost.innerHTML =
        '<div class="field-container notification-topic-picker notification-topic-picker--empty">' +
        '<span class="field-label">Subscription Topics</span>' +
        '<p class="muted">' + EfTopicMultiselect.escapeHtml(state.topicsError) + '</p></div>';
      return;
    }

    var selectedSet = new Set(state.selectedTopicIds);
    var topics = state.availableTopics.map(function (topic) {
      return {
        id: topic.id,
        description: topic.description,
        selected: selectedSet.has(topic.id)
      };
    });

    topicPickerHost.innerHTML = EfTopicMultiselect.render({
      classPrefix: TOPIC_CLASS_PREFIX,
      topics: topics
    });

    topicPickerHost.querySelectorAll('.' + TOPIC_CLASS_PREFIX + '-topic-option').forEach(function (input) {
      input.addEventListener('change', function () {
        state.selectedTopicIds = EfTopicMultiselect.readSelectedTopicIds(topicPickerHost, TOPIC_CLASS_PREFIX);
        EfTopicMultiselect.updateSelectedListSummary(topicPickerHost, TOPIC_CLASS_PREFIX);
        syncControlButtons();
      });
    });
  }

  function renderSubscriptionResults() {
    var succeeded;
    var failed;
    var html;

    if (!subscriptionResultsEl) {
      return;
    }

    if (state.subscriptionError) {
      subscriptionResultsEl.innerHTML =
        '<div class="user-notifications-subscription-results user-notifications-subscription-results--error">' +
        '<strong>Subscription failed</strong>' +
        '<p>' + EfTopicMultiselect.escapeHtml(state.subscriptionError) + '</p></div>';
      return;
    }

    if (!state.subscriptionResult) {
      subscriptionResultsEl.innerHTML = '';
      return;
    }

    succeeded = state.subscriptionResult.succeeded || [];
    failed = state.subscriptionResult.failed || [];

    html = '<div class="user-notifications-subscription-results' +
      (failed.length ? ' user-notifications-subscription-results--warning' : '') + '">';

    if (succeeded.length) {
      html += '<div class="user-notifications-subscription-results__section"><strong>Subscribed topics (' +
        succeeded.length + ')</strong><ul>' +
        succeeded.map(function (topic) {
          return '<li><code>' + EfTopicMultiselect.escapeHtml(topic) + '</code></li>';
        }).join('') + '</ul></div>';
    }

    if (failed.length) {
      html += '<div class="user-notifications-subscription-results__section"><strong>Denied topics (' +
        failed.length + ')</strong><ul>' +
        failed.map(function (entry) {
          return '<li><code>' + EfTopicMultiselect.escapeHtml(entry.topic || 'unknown') +
            '</code> — HTTP ' + EfTopicMultiselect.escapeHtml(String(entry.status || 502)) + ': ' +
            EfTopicMultiselect.escapeHtml(entry.message || 'Subscription denied.') + '</li>';
        }).join('') + '</ul><p class="muted">' +
        EfTopicMultiselect.escapeHtml(EfNotificationClient.SUBSCRIPTION_DENIED_GUIDANCE) + '</p></div>';
    }

    html += '</div>';
    subscriptionResultsEl.innerHTML = html;
  }

  function formatSubscriptionStatusLabel(managerStatus) {
    var succeededCount = state.subscriptionResult && state.subscriptionResult.succeeded
      ? state.subscriptionResult.succeeded.length
      : 0;
    var failedCount = state.subscriptionResult && state.subscriptionResult.failed
      ? state.subscriptionResult.failed.length
      : 0;
    var normalized = String(managerStatus || 'idle').replace(/_/g, ' ');

    if (managerStatus === 'listening_with_warnings' && succeededCount) {
      return 'Listening (' + succeededCount + ' topic' + (succeededCount === 1 ? '' : 's') +
        ' active, ' + failedCount + ' denied)';
    }

    return normalized;
  }

  function setStatus(text) {
    statusText.textContent = text;
  }

  function appendStream(label, payload) {
    var entry = [
      '[' + new Date().toISOString() + '] ' + label,
      typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2),
      ''
    ].join('\n');
    streamOutput.value = entry + streamOutput.value;
  }

  function recordMessage(entry) {
    state.parsedMessages.unshift(entry);
    state.messageEntries.push({
      id: state.messageEntries.length + 1,
      timestamp: entry.timestamp,
      label: entry.label,
      category: entry.category,
      origin: 'notifications-wss',
      data: entry.data
    });
    messageCountText.textContent = String(state.parsedMessages.length);
    syncControlButtons();
  }

  function syncControlButtons() {
    var managerStatus = state.subscriptionManager ? state.subscriptionManager.getStatus() : 'idle';
    var isListening = managerStatus === 'listening' || managerStatus === 'listening_with_warnings';
    var canStart = !!state.userId && !!state.accessToken && state.selectedTopicIds.length > 0 && !isListening;
    var messageCount = state.parsedMessages.length;

    startButton.disabled = !canStart;
    stopButton.disabled = !isListening;
    openParserBtn.disabled = !(isListening || messageCount > 0);
  }

  function createSubscriptionManager() {
    var creds = getCredentials();

    return EfNotificationClient.createNotificationSubscriptionManager({
      createChannel: function () {
        return EfNotificationClient.createNotificationChannel(creds.apiBaseUrl, creds.accessToken);
      },
      subscribeTopics: function (options) {
        return EfNotificationClient.subscribeTopicsWithResults(
          creds.apiBaseUrl,
          creds.accessToken,
          options.channelId,
          options.topics
        );
      },
      deleteChannel: function (options) {
        return EfNotificationClient.deleteNotificationChannel(
          creds.apiBaseUrl,
          creds.accessToken,
          options.channelId
        );
      },
      onStatusChange: function (nextStatus) {
        setStatus(formatSubscriptionStatusLabel(nextStatus));
        channelText.textContent = state.subscriptionManager && state.subscriptionManager.getChannelId()
          ? state.subscriptionManager.getChannelId()
          : 'Not created';
        syncControlButtons();
      },
      onMessage: function (message) {
        var entry;
        if (message.type === 'notification') {
          entry = EfNotificationClient.createParsedMessageEntry(message.payload);
          appendStream(entry.label, message.payload);
          recordMessage(entry);
          return;
        }
        if (message.type === 'websocket_closed') {
          appendStream('WebSocket Closed', message.payload);
          entry = {
            id: Date.now() + '-closed',
            timestamp: new Date().toISOString(),
            label: 'WebSocket Closed',
            category: 'system',
            topicName: '',
            data: message.payload
          };
          recordMessage(entry);
        }
      },
      onError: function (error) {
        state.subscriptionError = error.message || 'Subscription failed.';
        renderSubscriptionResults();
        syncControlButtons();
      },
      onSubscriptionResult: function (result) {
        state.subscriptionResult = result;
        state.subscriptionError = '';
        renderSubscriptionResults();
        syncControlButtons();
      }
    });
  }

  function resolveSelectedTopics() {
    state.selectedTopicIds = EfTopicMultiselect.readSelectedTopicIds(topicPickerHost, TOPIC_CLASS_PREFIX);

    if (!state.selectedTopicIds.length) {
      throw new Error('Select at least one subscription topic.');
    }

    return EfNotificationTopics.resolveEntityTopics(state.userId, state.selectedTopicIds, {
      placeholderKeys: EfNotificationTopics.NOTIFICATION_PAGE_GROUPS.users.placeholderKeys
    });
  }

  function startSubscription() {
    return refreshCredentialsFromFields().then(function () {
      return resolveConnectedUser();
    }).then(function () {
      var resolvedTopics;

      state.subscriptionError = '';
      state.subscriptionResult = null;
      renderSubscriptionResults();

      resolvedTopics = resolveSelectedTopics();

      if (state.subscriptionManager) {
        return state.subscriptionManager.stop().then(function () {
          state.subscriptionManager = null;
          return beginListen(resolvedTopics);
        });
      }

      return beginListen(resolvedTopics);
    });
  }

  function beginListen(resolvedTopics) {
    state.subscriptionManager = createSubscriptionManager();

    return state.subscriptionManager.start({
      entityId: state.userId,
      resolvedTopics: resolvedTopics
    }).then(function (result) {
      channelText.textContent = result.channelId;
      setStatus(formatSubscriptionStatusLabel(state.subscriptionManager.getStatus()));
      syncControlButtons();
    });
  }

  function stopSubscription() {
    var stopPromise = Promise.resolve();
    if (state.subscriptionManager) {
      stopPromise = state.subscriptionManager.stop();
    }
    stopPromise.then(function () {
      state.subscriptionManager = null;
      state.subscriptionResult = null;
      setStatus('Idle');
      channelText.textContent = 'Not created';
      renderSubscriptionResults();
      syncControlButtons();
    }).catch(console.error);
  }

  function openParser() {
    if (!state.messageEntries.length) {
      window.alert('No messages have been collected yet.');
      return;
    }

    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
      exportedAt: new Date().toISOString(),
      source: 'User Notifications',
      sourceUrl: window.location.pathname,
      userId: state.userId,
      userName: state.userDisplayName,
      messages: state.messageEntries
    }));

    window.location.href = '/ef-message-parser.html';
  }

  if (window.EfClipboard) {
    EfClipboard.bindCopyButton(document.getElementById('copyStreamBtn'), function () {
      return streamOutput.value;
    });
  }

  syncControlButtons();
});
