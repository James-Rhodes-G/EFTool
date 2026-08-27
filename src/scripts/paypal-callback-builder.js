document.addEventListener('DOMContentLoaded', function () {
  'use strict';

  var state = {
    apiBaseUrl: null,
    accessToken: null,
    conversation: null,
    customerParticipant: null,
    acdParticipant: null
  };

  var conversationIdInput = document.getElementById('conversationId');
  var delayMinutesInput = document.getElementById('delayMinutes');

  var scheduleButton = document.getElementById('scheduleCallback');
  var clearLogButton = document.getElementById('clearLog');

  var statusText = document.getElementById('statusText');
  var targetTimeText = document.getElementById('targetTimeText');
  var customerParticipantText = document.getElementById('customerParticipantText');
  var queueText = document.getElementById('queueText');
  var logWindow = document.getElementById('logWindow');

  function nowStamp() {
    return new Date().toISOString();
  }

  function logLine(label, payload) {
    var entry = '[' + nowStamp() + '] ' + label + '\n';

    if (payload !== undefined) {
      if (typeof payload === 'string') {
        entry += payload + '\n';
      } else {
        try {
          entry += JSON.stringify(payload, null, 2) + '\n';
        } catch (error) {
          entry += String(payload) + '\n';
        }
      }
    }

    entry += '\n';
    logWindow.textContent += entry;
    logWindow.scrollTop = logWindow.scrollHeight;
    console.log(label, payload);
  }

  function setStatus(text) {
    statusText.textContent = text;
  }

  function clearLog() {
    logWindow.textContent = '';
  }


  function getAuthHeaders() {
    return {
      Authorization: 'Bearer ' + state.accessToken,
      'Content-Type': 'application/json'
    };
  }

  async function apiRequest(path, options) {
    var response = await fetch(state.apiBaseUrl + path, {
      method: options && options.method ? options.method : 'GET',
      headers: getAuthHeaders(),
      body: options && Object.prototype.hasOwnProperty.call(options, 'body') ? options.body : undefined
    });

    var text = await response.text();
    var parsed = null;

    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch (error) {
        parsed = text;
      }
    }

    if (!response.ok) {
      var message = 'Request failed (' + response.status + ') for ' + path;
      if (parsed && typeof parsed === 'object') {
        message += ': ' + (parsed.message || parsed.error || JSON.stringify(parsed));
      } else if (parsed) {
        message += ': ' + parsed;
      }
      throw new Error(message);
    }

    return parsed;
  }

  function getParticipants(conversation) {
    return Array.isArray(conversation && conversation.participants) ? conversation.participants : [];
  }

  function findCustomerParticipant(conversation) {
    var participants = getParticipants(conversation);
    return participants.find(function (participant) {
      return String(participant.purpose || '').toLowerCase() === 'customer';
    }) || null;
  }

  function findLastAcdParticipant(conversation) {
    var participants = getParticipants(conversation);
    var acdParticipants = participants.filter(function (participant) {
      return String(participant.purpose || '').toLowerCase() === 'acd';
    });
    return acdParticipants.length ? acdParticipants[acdParticipants.length - 1] : null;
  }

  function normalizePhoneNumber(value) {
    if (!value) {
      return '';
    }
    return String(value).replace(/^tel:/i, '').trim();
  }

  function getAniFromParticipant(participant) {
    if (!participant) {
      return '';
    }
    return normalizePhoneNumber(
      participant.address ||
      participant.ani ||
      participant.callableAni ||
      participant.callbackNumber ||
      (participant.attributes && (participant.attributes.ani || participant.attributes.ANI)) ||
      ''
    );
  }

  function getAniNameFromParticipant(participant) {
    if (!participant) {
      return '';
    }
    return participant.aniName || participant.name || participant.displayName || '';
  }

  function getQueueIdFromParticipant(participant) {
    if (!participant) {
      return '';
    }

    return participant.queueId ||
      (participant.queue && participant.queue.id) ||
      (participant.conversationRoutingData && participant.conversationRoutingData.queue && participant.conversationRoutingData.queue.id) ||
      (participant.attributes && (participant.attributes.queueId || participant.attributes.queueid)) ||
      '';
  }

  function getQueueNameFromParticipant(participant) {
    if (!participant) {
      return '';
    }

    return participant.queueName ||
      (participant.queue && participant.queue.name) ||
      '';
  }

  function formatTargetTime(minutesFromNow) {
    return new Date(Date.now() + (minutesFromNow * 60 * 1000)).toISOString();
  }

  function renderResolvedValues(targetTimeIso) {
    if (state.customerParticipant) {
      customerParticipantText.textContent = state.customerParticipant.id || 'Found (no id)';
    } else {
      customerParticipantText.textContent = 'Not found';
    }

    if (state.acdParticipant) {
      queueText.textContent = getQueueNameFromParticipant(state.acdParticipant) || getQueueIdFromParticipant(state.acdParticipant) || 'Found';
    } else {
      queueText.textContent = 'Not found';
    }

    if (targetTimeIso) {
      targetTimeText.textContent = targetTimeIso;
    }
  }

  function buildCallbackBody(customerParticipant, acdParticipant, targetTimeIso) {
    var ani = getAniFromParticipant(customerParticipant);
    var aniName = getAniNameFromParticipant(customerParticipant);
    var queueId = getQueueIdFromParticipant(acdParticipant);

    if (!ani) {
      throw new Error('The customer participant did not contain an ANI.');
    }

    if (!queueId) {
      throw new Error('The last ACD participant did not contain a queueId.');
    }

    return {
      queueId: queueId,
      routingData: {
        queueId: queueId
      },
      callbackUserName: aniName,
      callbackNumbers: [ani],
      callbackScheduledTime: targetTimeIso,
      validateCallbackNumbers: true,
      data: {}
    };
  }

  async function readConnectionInputs() {
    await GenesysConnectionFields.ready;
    state.apiBaseUrl = GenesysConnectionFields.getApiBaseUrl();
    state.accessToken = GenesysConnectionFields.getAccessToken();

    if (!state.apiBaseUrl) {
      throw new Error('Genesys Region is required.');
    }

    if (!state.accessToken) {
      throw new Error('Access Token is required.');
    }
  }

  async function loadConversation() {
    try {
      setStatus('Validating inputs');
      await readConnectionInputs();

      var conversationId = conversationIdInput.value.trim();
      if (!conversationId) {
        throw new Error('Conversation ID is required.');
      }

      logLine('INPUT', {
        apiBaseUrl: state.apiBaseUrl,
        conversationId: conversationId
      });

      setStatus('Fetching conversation');
      var conversation = await apiRequest('/api/v2/conversations/calls/' + encodeURIComponent(conversationId), {
        method: 'GET'
      });

      state.conversation = conversation;
      logLine('OUTPUT - Conversation', conversation);

      if (conversation && conversation.endTime) {
        throw new Error('This tool only supports active conversations.');
      }

      state.customerParticipant = findCustomerParticipant(conversation);
      if (!state.customerParticipant) {
        renderResolvedValues('');
        throw new Error('No participant with purpose customer was found.');
      }

      state.acdParticipant = findLastAcdParticipant(conversation);
      if (!state.acdParticipant) {
        renderResolvedValues('');
        throw new Error('No participant with purpose ACD was found.');
      }

      renderResolvedValues('');

      logLine('OUTPUT - Customer Participant', state.customerParticipant);
      logLine('OUTPUT - Last ACD Participant', state.acdParticipant);
      logLine('READY', {
        conversationId: conversationId,
        customerParticipantId: state.customerParticipant.id,
        customerAniName: getAniNameFromParticipant(state.customerParticipant),
        customerAni: getAniFromParticipant(state.customerParticipant),
        queueId: getQueueIdFromParticipant(state.acdParticipant),
        queueName: getQueueNameFromParticipant(state.acdParticipant)
      });

      setStatus('Conversation loaded');
    } catch (error) {
      setStatus('Error');
      logLine('ERROR', { message: error.message });
    }
  }

  async function scheduleCallback() {
    try {
      if (!state.conversation || !state.customerParticipant || !state.acdParticipant) {
        await loadConversation();
      }

      if (!state.conversation || !state.customerParticipant || !state.acdParticipant) {
        throw new Error('Conversation resolution failed. Check the log for details.');
      }

      var delayMinutes = parseInt(delayMinutesInput.value, 10);
      if (!delayMinutes || delayMinutes < 1) {
        throw new Error('A valid schedule offset is required.');
      }

      var targetTimeIso = formatTargetTime(delayMinutes);
      renderResolvedValues(targetTimeIso);

      var conversationId = conversationIdInput.value.trim();
      var callbackBody = buildCallbackBody(state.customerParticipant, state.acdParticipant, targetTimeIso);

      logLine('INPUT - Callback Request Body', callbackBody);

      setStatus('Creating callback');
      var callbackResponse = await apiRequest(
        '/api/v2/conversations/' +
          encodeURIComponent(conversationId) +
          '/participants/' +
          encodeURIComponent(state.customerParticipant.id) +
          '/callbacks',
        {
          method: 'POST',
          body: JSON.stringify(callbackBody)
        }
      );

      logLine('OUTPUT - Callback Response', callbackResponse);
      setStatus('Callback scheduled');
    } catch (error) {
      setStatus('Error');
      logLine('ERROR', { message: error.message });
    }
  }

  scheduleButton.addEventListener('click', scheduleCallback);
  clearLogButton.addEventListener('click', clearLog);

  GenesysConnectionFields.ready.then(function () {
    logLine('READY', {
      message: 'Callback builder loaded',
      defaultRegionId: GenesysConnectionFields.getRegionId(),
      defaultApiBaseUrl: GenesysConnectionFields.getApiBaseUrl(),
      defaultScheduleOffset: delayMinutesInput.value + ' minutes'
    });
  }).catch(function (error) {
    logLine('ERROR', { message: error.message });
  });
});
