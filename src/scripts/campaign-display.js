document.addEventListener('DOMContentLoaded', function () {
    var state = {
        webSocket: null,
        channelId: null,
        accessToken: null,
        apiBaseUrl: null,
        userId: null,
        activeConversationId: null,
        activeParticipantId: null,
        activeMuted: null,
        lastLookupKey: null
    };

    var startButton = document.getElementById('startSubscription');
    var stopButton = document.getElementById('stopSubscription');
    var clearButton = document.getElementById('clearOutput');
    var muteButton = document.getElementById('toggleMute');
    var endCallButton = document.getElementById('endCall');

    var topicIdInput = document.getElementById('topicId');
    var userIdInput = document.getElementById('userId');

    var statusText = document.getElementById('statusText');
    var channelText = document.getElementById('channelText');
    var activeConversationText = document.getElementById('activeConversationText');
    var activeParticipantText = document.getElementById('activeParticipantText');
    var muteStateText = document.getElementById('muteStateText');
    var streamOutput = document.getElementById('streamOutput');
    var lookupOutput = document.getElementById('lookupOutput');

    startButton.addEventListener('click', startSubscription);
    stopButton.addEventListener('click', stopSubscription);
    clearButton.addEventListener('click', clearOutput);
    muteButton.addEventListener('click', toggleMute);
    endCallButton.addEventListener('click', endCall);

    function syncCallControlButtons() {
        var hasActiveConversation = !!state.activeConversationId && !!state.activeParticipantId;
        muteButton.disabled = !hasActiveConversation;
        endCallButton.disabled = !hasActiveConversation;
    }

    function setStatus(text) {
        statusText.textContent = text;
    }

    function setChannel(text) {
        channelText.textContent = text;
    }

    function setActiveCallState(conversationId, participantId, muted) {
        if (state.activeConversationId && conversationId !== state.activeConversationId) {
            state.lastLookupKey = null;
        }

        state.activeConversationId = conversationId || null;
        state.activeParticipantId = participantId || null;
        state.activeMuted = typeof muted === 'boolean' ? muted : null;

        activeConversationText.textContent = state.activeConversationId || 'None';
        activeParticipantText.textContent = state.activeParticipantId || 'None';
        muteStateText.textContent = state.activeMuted === null ? 'Unknown' : (state.activeMuted ? 'Muted' : 'Unmuted');
        muteButton.textContent = state.activeMuted ? 'Unmute' : 'Mute';
        syncCallControlButtons();
    }

    function appendOutput(target, label, payload) {
        var entry = [
            '[' + new Date().toISOString() + '] ' + label,
            typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2),
            ''
        ].join('\n');

        target.value = entry + target.value;
    }

    function clearOutput() {
        streamOutput.value = '';
        lookupOutput.value = '';
    }

    function resolveTopics(rawTopicText) {
        var tokens = rawTopicText
            .split(/\r?\n|,/)
            .map(function (value) {
                return value.trim();
            })
            .filter(function (value) {
                return value.length > 0;
            });

        if (!tokens.length) {
            tokens = ['v2.users.{userId}.conversations.calls'];
        }

        return tokens.map(function (topic) {
            return topic
                .replace(/\{userId\}/g, state.userId)
                .replace(/\{id\}/g, state.userId);
        });
    }

    function getDialerIdentifiers(conversation) {
        var result = {
            contactId: null,
            contactListId: null,
            campaignId: null
        };

        if (!conversation) {
            return result;
        }

        result.contactId = conversation.dialerContactId || null;
        result.contactListId = conversation.dialerContactListId || null;
        result.campaignId = conversation.dialerCampaignId || null;

        if (conversation.outboundContact) {
            result.contactId = result.contactId || conversation.outboundContact.id || null;
            result.contactListId = result.contactListId || conversation.outboundContact.contactListId || null;
        }

        if (conversation.dialerPreview) {
            result.contactId = result.contactId || conversation.dialerPreview.contactId || null;
            result.contactListId = result.contactListId || conversation.dialerPreview.contactListId || null;
            result.campaignId = result.campaignId || conversation.dialerPreview.campaignId || null;
        }

        if (conversation.participants && conversation.participants.length) {
            conversation.participants.forEach(function (participant) {
                var attributes = participant.attributes || {};

                result.contactId = result.contactId || attributes.dialerContactId || null;
                result.contactListId = result.contactListId || attributes.dialerContactListId || null;
                result.campaignId = result.campaignId || attributes.dialerCampaignId || null;

                if (participant.dialerPreview) {
                    result.contactId = result.contactId || participant.dialerPreview.contactId || null;
                    result.contactListId = result.contactListId || participant.dialerPreview.contactListId || null;
                    result.campaignId = result.campaignId || participant.dialerPreview.campaignId || null;
                }

                if (participant.outboundContact) {
                    result.contactId = result.contactId || participant.outboundContact.id || null;
                    result.contactListId = result.contactListId || participant.outboundContact.contactListId || null;
                }
            });
        }

        return result;
    }

    async function readConnectionInputs() {
        await GenesysConnectionFields.ready;
        state.apiBaseUrl = GenesysConnectionFields.getApiBaseUrl();
        state.accessToken = GenesysConnectionFields.getAccessToken();

        if (!state.apiBaseUrl || !state.accessToken) {
            throw new Error('Genesys Region and Access Token are required.');
        }
    }

    async function startSubscription() {
        try {
            await stopSubscription();
            await readConnectionInputs();

            setStatus('Resolving user');
            state.userId = userIdInput.value.trim() || (await getCurrentUser()).id;

            var resolvedTopics = resolveTopics(topicIdInput.value);

            setStatus('Creating notification channel');
            var channel = await apiRequest('/api/v2/notifications/channels', {
                method: 'POST'
            });

            state.channelId = channel.id;
            setChannel(channel.id);
            appendOutput(streamOutput, 'Channel Created', channel);

            setStatus('Opening WebSocket');
            await openWebSocket(channel.connectUri);

            setStatus('Subscribing to topic');
            await apiRequest('/api/v2/notifications/channels/' + encodeURIComponent(channel.id) + '/subscriptions', {
                method: 'POST',
                body: JSON.stringify(resolvedTopics.map(function (topicId) {
                    return { id: topicId };
                }))
            });

            appendOutput(streamOutput, 'Subscription Created', {
                requestedTopics: topicIdInput.value.trim() || 'v2.users.{userId}.conversations.calls',
                resolvedTopics: resolvedTopics
            });
            setStatus('Listening');
        } catch (error) {
            setStatus('Error');
            appendOutput(streamOutput, 'Subscription Error', { message: error.message });
        }
    }

    async function stopSubscription() {
        if (state.webSocket) {
            state.webSocket.onclose = null;
            state.webSocket.close();
            state.webSocket = null;
        }

        if (state.channelId && state.accessToken && state.apiBaseUrl) {
            try {
                await apiRequest('/api/v2/notifications/channels/' + encodeURIComponent(state.channelId), {
                    method: 'DELETE'
                });
            } catch (error) {
                appendOutput(streamOutput, 'Channel Delete Warning', { message: error.message });
            }
        }

        state.channelId = null;
        state.lastLookupKey = null;
        setActiveCallState(null, null, null);
        setChannel('Not created');
        setStatus('Idle');
    }

    function openWebSocket(connectUri) {
        return new Promise(function (resolve, reject) {
            var webSocket = new WebSocket(connectUri);
            var opened = false;

            webSocket.onopen = function () {
                opened = true;
                state.webSocket = webSocket;
                resolve();
            };

            webSocket.onerror = function () {
                if (!opened) {
                    reject(new Error('Failed to open the notifications WebSocket.'));
                } else {
                    appendOutput(streamOutput, 'WebSocket Error', { message: 'WebSocket reported an error after opening.' });
                }
            };

            webSocket.onclose = function (event) {
                appendOutput(streamOutput, 'WebSocket Closed', {
                    code: event.code,
                    reason: event.reason || 'No close reason provided'
                });
            };

            webSocket.onmessage = function (event) {
                handleNotificationMessage(event.data);
            };
        });
    }

    async function handleNotificationMessage(rawMessage) {
        var message;

        try {
            message = JSON.parse(rawMessage);
        } catch (error) {
            appendOutput(streamOutput, 'WSS Message Parse Error', {
                message: error.message,
                rawMessage: rawMessage
            });
            return;
        }

        appendOutput(streamOutput, 'WSS Message', message);

        if (!message.eventBody) {
            return;
        }

        var conversationId = message.eventBody.id || null;
        var dialerIdentifiers = getDialerIdentifiers(message.eventBody);
        var dialerContactId = dialerIdentifiers.contactId;
        var dialerContactListId = dialerIdentifiers.contactListId;

        if (message.eventBody.outboundContact && message.eventBody.outboundContact.data) {
            appendOutput(lookupOutput, 'Contact Data From Event Payload', message.eventBody.outboundContact);
        }

        if ((!dialerContactId || !dialerContactListId) && conversationId) {
            try {
                var conversation = await apiRequest('/api/v2/conversations/calls/' + encodeURIComponent(conversationId), {
                    method: 'GET'
                });

                appendOutput(streamOutput, 'Conversation Lookup', conversation);
                updateActiveCallFromConversation(conversation);
                dialerIdentifiers = getDialerIdentifiers(conversation);
                dialerContactId = dialerIdentifiers.contactId || dialerContactId;
                dialerContactListId = dialerIdentifiers.contactListId || dialerContactListId;

                if (conversation.outboundContact && conversation.outboundContact.data) {
                    appendOutput(lookupOutput, 'Contact Data From Conversation Payload', conversation.outboundContact);
                }
            } catch (error) {
                appendOutput(lookupOutput, 'Conversation Lookup Error', { message: error.message, conversationId: conversationId });
            }
        } else if (conversationId && message.eventBody.participants) {
            updateActiveCallFromConversation(message.eventBody);
        }

        if (!dialerContactId || !dialerContactListId) {
            appendOutput(lookupOutput, 'Contact Lookup Skipped', {
                message: 'dialerContactId or dialerContactListId was not found on the event or conversation payload.',
                conversationId: conversationId,
                dialerIdentifiers: dialerIdentifiers
            });
            return;
        }

        var lookupKey = [
            conversationId || 'no-conversation',
            dialerContactListId,
            dialerContactId
        ].join(':');

        if (state.lastLookupKey === lookupKey) {
            return;
        }

        state.lastLookupKey = lookupKey;

        try {
            var contactRecord = await apiRequest(
                '/api/v2/outbound/contactlists/' + encodeURIComponent(dialerContactListId) + '/contacts/' + encodeURIComponent(dialerContactId),
                { method: 'GET' }
            );

            appendOutput(lookupOutput, 'Contact Lookup Result', contactRecord);
        } catch (error) {
            state.lastLookupKey = null;
            appendOutput(lookupOutput, 'Contact Lookup Error', {
                message: error.message,
                dialerContactId: dialerContactId,
                dialerContactListId: dialerContactListId
            });
        }
    }

    async function getCurrentUser() {
        return apiRequest('/api/v2/users/me', {
            method: 'GET'
        });
    }

    function updateActiveCallFromConversation(conversation) {
        if (!conversation || !conversation.participants || !conversation.participants.length) {
            return;
        }

        var agentParticipant = conversation.participants.find(function (participant) {
            if (participant.user && participant.user.id && state.userId) {
                return participant.user.id === state.userId;
            }

            return participant.purpose === 'agent';
        });

        if (!agentParticipant) {
            return;
        }

        setActiveCallState(conversation.id || state.activeConversationId, agentParticipant.id, !!agentParticipant.muted);
    }

    async function toggleMute() {
        if (!state.activeConversationId || !state.activeParticipantId) {
            appendOutput(lookupOutput, 'Mute Error', { message: 'No active conversation or agent participant is available.' });
            return;
        }

        var nextMuted = !state.activeMuted;

        try {
            await apiRequest(
                '/api/v2/conversations/calls/' + encodeURIComponent(state.activeConversationId) + '/participants/' + encodeURIComponent(state.activeParticipantId),
                {
                    method: 'PATCH',
                    body: JSON.stringify({ muted: nextMuted })
                }
            );

            setActiveCallState(state.activeConversationId, state.activeParticipantId, nextMuted);
            appendOutput(lookupOutput, 'Mute Update', {
                conversationId: state.activeConversationId,
                participantId: state.activeParticipantId,
                muted: nextMuted
            });
        } catch (error) {
            appendOutput(lookupOutput, 'Mute Error', { message: error.message });
        }
    }

    async function endCall() {
        if (!state.activeConversationId || !state.activeParticipantId) {
            appendOutput(lookupOutput, 'End Call Error', { message: 'No active conversation or agent participant is available.' });
            return;
        }

        try {
            await apiRequest(
                '/api/v2/conversations/calls/' + encodeURIComponent(state.activeConversationId) + '/participants/' + encodeURIComponent(state.activeParticipantId),
                {
                    method: 'PATCH',
                    body: JSON.stringify({ state: 'disconnected' })
                }
            );

            appendOutput(lookupOutput, 'End Call Request', {
                conversationId: state.activeConversationId,
                participantId: state.activeParticipantId,
                state: 'disconnected'
            });
        } catch (error) {
            appendOutput(lookupOutput, 'End Call Error', { message: error.message });
        }
    }

    async function apiRequest(path, options) {
        var response = await fetch(state.apiBaseUrl + path, {
            method: options.method,
            headers: {
                Authorization: 'Bearer ' + state.accessToken,
                'Content-Type': 'application/json'
            },
            body: options.body
        });

        if (!response.ok) {
            throw new Error(path + ' failed with status ' + response.status);
        }

        if (response.status === 204) {
            return {};
        }

        return response.json();
    }

    syncCallControlButtons();
});
