(function (global) {
  'use strict';

  var SUBSCRIPTION_DENIED_GUIDANCE =
    'HTTP 403 usually means the connected OAuth client or user lacks permission for that topic. ' +
    'Verify OAuth scopes, user permissions, and whether you are allowed to subscribe to another user\'s topics.';

  function apiRequest(apiBaseUrl, accessToken, path, options) {
    options = options || {};
    return fetch(apiBaseUrl + path, {
      method: options.method || 'GET',
      headers: {
        Authorization: 'Bearer ' + accessToken,
        'Content-Type': 'application/json'
      },
      body: options.body
    }).then(function (response) {
      var errorMessage = path + ' failed with status ' + response.status;

      if (!response.ok) {
        return response.text().then(function (body) {
          var err = new Error(errorMessage);
          err.status = response.status;
          err.details = body;
          throw err;
        });
      }

      if (response.status === 204) {
        return {};
      }
      return response.json();
    });
  }

  function createNotificationChannel(apiBaseUrl, accessToken) {
    return apiRequest(apiBaseUrl, accessToken, '/api/v2/notifications/channels', { method: 'POST' });
  }

  function subscribeNotificationTopics(apiBaseUrl, accessToken, channelId, topics) {
    return apiRequest(
      apiBaseUrl,
      accessToken,
      '/api/v2/notifications/channels/' + encodeURIComponent(channelId) + '/subscriptions',
      {
        method: 'POST',
        body: JSON.stringify((topics || []).map(function (topicId) {
          return { id: topicId };
        }))
      }
    );
  }

  function deleteNotificationChannel(apiBaseUrl, accessToken, channelId) {
    return apiRequest(
      apiBaseUrl,
      accessToken,
      '/api/v2/notifications/channels/' + encodeURIComponent(channelId),
      { method: 'DELETE' }
    );
  }

  function subscribeTopicsWithResults(apiBaseUrl, accessToken, channelId, topics) {
    var normalized = (topics || [])
      .map(function (topicId) {
        return String(topicId || '').trim();
      })
      .filter(Boolean);
    var succeeded = [];
    var failed = [];
    var chain = Promise.resolve();

    normalized.forEach(function (topicId) {
      chain = chain.then(function () {
        return subscribeNotificationTopics(apiBaseUrl, accessToken, channelId, [topicId])
          .then(function () {
            succeeded.push(topicId);
          })
          .catch(function (error) {
            failed.push({
              topic: topicId,
              status: error.status || 502,
              message: error.message || 'Subscription failed.',
              details: error.details || null
            });
          });
      });
    });

    return chain.then(function () {
      return { succeeded: succeeded, failed: failed };
    });
  }

  function summarizeSubscriptionFailures(failedTopics, options) {
    options = options || {};
    var failures = Array.isArray(failedTopics) ? failedTopics : [];
    var allTopicsFailed = !!options.allTopicsFailed;
    var header;
    var i;

    if (!failures.length) {
      return '';
    }

    header = allTopicsFailed
      ? 'Unable to subscribe to any selected topics:'
      : 'Some topics could not be subscribed:';

    return [
      header
    ].concat(failures.map(function (failure) {
      return (
        String(failure.topic || 'unknown topic') +
        ' (' + String(failure.status || 502) + '): ' +
        String(failure.message || 'Subscription failed.')
      );
    })).concat(['', SUBSCRIPTION_DENIED_GUIDANCE]).join('\n');
  }

  function createNotificationSubscriptionManager(config) {
    var webSocket = null;
    var channelId = null;
    var userId = null;
    var status = 'idle';

    function setStatus(nextStatus) {
      status = nextStatus;
      if (config.onStatusChange) {
        config.onStatusChange(nextStatus);
      }
    }

    function reportError(error) {
      if (config.onError) {
        config.onError(error instanceof Error ? error : new Error(String(error)));
      }
    }

    function openWebSocket(connectUri) {
      return new Promise(function (resolve, reject) {
        var socket;
        var opened = false;

        try {
          socket = new WebSocket(connectUri);
        } catch (error) {
          reject(error);
          return;
        }

        socket.onopen = function () {
          opened = true;
          webSocket = socket;
          resolve();
        };

        socket.onerror = function () {
          if (!opened) {
            reject(new Error('Failed to open the notifications WebSocket.'));
          } else {
            reportError(new Error('WebSocket reported an error after opening.'));
          }
        };

        socket.onclose = function (event) {
          if (config.onMessage) {
            config.onMessage({
              type: 'websocket_closed',
              payload: {
                code: event.code,
                reason: event.reason || 'No close reason provided'
              }
            });
          }
        };

        socket.onmessage = function (event) {
          var payload = event.data;
          try {
            payload = JSON.parse(event.data);
          } catch (parseError) {
            // keep raw
          }
          if (config.onMessage) {
            config.onMessage({
              type: 'notification',
              payload: payload
            });
          }
        };
      });
    }

    function stop() {
      if (webSocket) {
        webSocket.onclose = null;
        webSocket.close();
        webSocket = null;
      }

      var deletePromise = Promise.resolve();
      if (channelId && config.deleteChannel) {
        deletePromise = Promise.resolve(
          config.deleteChannel({ channelId: channelId })
        ).catch(function (error) {
          reportError(error);
        });
      }

      return deletePromise.then(function () {
        channelId = null;
        userId = null;
        setStatus('idle');
      });
    }

    function start(options) {
      options = options || {};
      var normalizedEntityId = String(options.entityId || options.userId || '').trim();
      var finalTopics = options.resolvedTopics || [];

      return stop().then(function () {
        if (!normalizedEntityId) {
          throw new Error('Entity ID is required.');
        }
        if (!finalTopics.length) {
          throw new Error('At least one resolved topic is required.');
        }

        userId = normalizedEntityId;
        setStatus('creating_channel');

        return config.createChannel().then(function (channel) {
          channelId = channel.id;
          setStatus('opening_websocket');
          return openWebSocket(channel.connectUri).then(function () {
            setStatus('subscribing');
            return config.subscribeTopics({ channelId: channel.id, topics: finalTopics }).then(function (subscriptionResult) {
              var succeeded = subscriptionResult.succeeded || [];
              var failed = subscriptionResult.failed || [];

              if (!succeeded.length) {
                return stop().then(function () {
                  throw new Error(summarizeSubscriptionFailures(failed, { allTopicsFailed: true }));
                });
              }

              if (config.onSubscriptionResult) {
                config.onSubscriptionResult({
                  succeeded: succeeded,
                  failed: failed,
                  resolvedTopics: finalTopics
                });
              }

              setStatus(failed.length ? 'listening_with_warnings' : 'listening');

              return {
                channelId: channel.id,
                userId: normalizedEntityId,
                resolvedTopics: finalTopics,
                succeededTopics: succeeded,
                failedTopics: failed,
                connectUri: channel.connectUri
              };
            });
          });
        });
      });
    }

    return {
      start: start,
      stop: stop,
      getStatus: function () {
        return status;
      },
      getChannelId: function () {
        return channelId;
      },
      getUserId: function () {
        return userId;
      }
    };
  }

  function createParsedMessageEntry(message) {
    var label = message && message.topicName
      ? message.topicName
      : (message && message.eventBody && message.eventBody.type
        ? String(message.eventBody.type)
        : 'notification');

    return {
      id: Date.now() + '-' + Math.random().toString(36).slice(2, 8),
      timestamp: new Date().toISOString(),
      label: label,
      category: (message && message.topicName) || 'notification',
      topicName: (message && message.topicName) || '',
      data: message
    };
  }

  global.EfNotificationClient = {
    SUBSCRIPTION_DENIED_GUIDANCE: SUBSCRIPTION_DENIED_GUIDANCE,
    apiRequest: apiRequest,
    createNotificationChannel: createNotificationChannel,
    subscribeNotificationTopics: subscribeNotificationTopics,
    deleteNotificationChannel: deleteNotificationChannel,
    subscribeTopicsWithResults: subscribeTopicsWithResults,
    summarizeSubscriptionFailures: summarizeSubscriptionFailures,
    createNotificationSubscriptionManager: createNotificationSubscriptionManager,
    createParsedMessageEntry: createParsedMessageEntry
  };
}(window));
