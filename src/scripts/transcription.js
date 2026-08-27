// transcription.js

(function () {
    'use strict';

    var state = {
        webSocket: null,
        channelId: null,
        accessToken: null,
        apiBaseUrl: null,
        userId: null,
        subscribedConversations: {},
        currentConversationId: null,
        currentAni: null,
        currentStatus: null,
        conversationBlocks: {},
        utteranceNodes: {},
        lastMessageSignature: null
    };

    function $(id) {
        return document.getElementById(id);
    }

    function setText(id, value) {
        var node = $(id);
        if (node) {
            node.textContent = value;
        }
    }

    function nowIso() {
        return new Date().toISOString();
    }

    function formatTimestamp(date) {
        return date.toISOString().replace('T', ' ').replace('Z', ' UTC');
    }

    function stringifySafe(value) {
        try {
            return JSON.stringify(value, null, 2);
        } catch (error) {
            return String(value);
        }
    }

    function appendLog(type, payload, topicName) {
        var messageLog = $('messageLog');
        if (!messageLog) {
            return;
        }

        var entry = document.createElement('div');
        entry.className = 'logEntry';

        var header = document.createElement('div');
        header.className = 'logHeader';

        var time = document.createElement('span');
        time.textContent = formatTimestamp(new Date());

        var label = document.createElement('span');
        label.className = 'logType';
        label.textContent = type;

        var topic = document.createElement('span');
        topic.textContent = topicName || '';

        header.appendChild(time);
        header.appendChild(label);
        header.appendChild(topic);

        var pre = document.createElement('pre');
        pre.className = 'logJson';
        pre.textContent = stringifySafe(payload);

        entry.appendChild(header);
        entry.appendChild(pre);
        messageLog.appendChild(entry);
        messageLog.scrollTop = messageLog.scrollHeight;
    }

    function appendSystemLog(type, payload) {
        appendLog(type, payload, 'system');
        if (window.console && console.log) {
            console.log('[transcription] ' + type, payload);
        }
    }

    function setStatus(text) {
        setText('statusText', text);
    }

    function setChannel(text) {
        setText('channelText', text);
    }

    function setCurrentConversation(conversationId, ani, status) {
        state.currentConversationId = conversationId || null;
        state.currentAni = ani || null;
        state.currentStatus = status || null;

        setText('conversationIdText', state.currentConversationId || 'None');
        setText('aniText', state.currentAni || 'None');
        setText('conversationStatusText', state.currentStatus || 'None');
    }

    function clearOutput() {
        var transcriptionOutput = $('transcriptionOutput');
        var messageLog = $('messageLog');

        if (transcriptionOutput) {
            transcriptionOutput.innerHTML = '';
        }
        if (messageLog) {
            messageLog.innerHTML = '';
        }

        state.conversationBlocks = {};
        state.utteranceNodes = {};
        setCurrentConversation(null, null, null);
        appendSystemLog('Display Cleared', { at: nowIso() });
    }

    function getConfidenceClass(confidence) {
        if (typeof confidence !== 'number' || isNaN(confidence)) {
            return 'unknown';
        }
        if (confidence < 0.6) {
            return 'low';
        }
        if (confidence < 0.8) {
            return 'mid';
        }
        return 'high';
    }

    function escapeText(value) {
        var div = document.createElement('div');
        div.textContent = value == null ? '' : String(value);
        return div.textContent;
    }

    function renderWord(word) {
        var span = document.createElement('span');
        var confidence = typeof word.confidence === 'number' ? word.confidence : null;
        var colorClass = getConfidenceClass(confidence);

        span.className = 'word ' + colorClass;
        span.textContent = escapeText(word.word || '');
        span.style.display = 'inline-block';
        span.style.padding = '2px 6px';
        span.style.marginRight = '6px';
        span.style.marginBottom = '4px';
        span.style.borderRadius = '4px';
        span.style.backgroundColor = confidence === null ? '#f8f9fa' : (colorClass === 'low' ? '#f8d7da' : colorClass === 'mid' ? '#fff3cd' : '#d4edda');
        span.style.color = '#111';
        span.style.whiteSpace = 'pre';

        if (confidence !== null) {
            span.title = 'Confidence: ' + confidence.toFixed(3);
        }

        return span;
    }

    function extractConversationId(payload) {
        if (!payload) {
            return null;
        }
        return payload.conversationId || payload.id || (payload.conversation && payload.conversation.id) || null;
    }

    function extractConversationStatus(payload) {
        if (!payload) {
            return null;
        }
        if (payload.status && payload.status.status) {
            return payload.status.status;
        }
        return payload.state || payload.conversationState || null;
    }

    function extractAni(payload) {
        var participants, i, participant, session;

        if (!payload) {
            return null;
        }

        if (payload.ani) {
            return payload.ani;
        }
        if (payload.customerAni) {
            return payload.customerAni;
        }

        participants = payload.participants || [];
        for (i = 0; i < participants.length; i += 1) {
            participant = participants[i];
            if (!participant) {
                continue;
            }

            if (participant.ani) {
                return participant.ani;
            }
            if (participant.address) {
                return participant.address;
            }
            if (participant.attributes && participant.attributes.ani) {
                return participant.attributes.ani;
            }
            if (participant.sessions && participant.sessions.length) {
                session = participant.sessions[0];
                if (session.ani) {
                    return session.ani;
                }
                if (session.address) {
                    return session.address;
                }
                if (session.remote) {
                    return session.remote;
                }
            }
        }

        return null;
    }

    function isUserConversationTopic(topicName) {
        return typeof topicName === 'string' && topicName.indexOf('v2.users.') === 0 && topicName.indexOf('.conversations') > -1;
    }

    function isTranscriptionTopic(topicName) {
        return typeof topicName === 'string' && topicName.indexOf('.transcription') > -1;
    }

    function getPrimaryAlternative(utterance) {
        if (!utterance || !utterance.alternatives || !utterance.alternatives.length) {
            return null;
        }
        return utterance.alternatives[0];
    }

    function ensureConversationBlock(conversationId, ani, status) {
        var transcriptionOutput = $('transcriptionOutput');
        var block = state.conversationBlocks[conversationId];
        var header, title, meta, transcriptList;

        if (block) {
            header = block.querySelector('.conversationHeader strong');
            meta = block.querySelector('.conversationMeta');
            if (header) {
                header.textContent = 'Conversation ' + conversationId;
            }
            if (meta) {
                meta.innerHTML = '';
                meta.appendChild(createMetaSpan('ANI: ' + (ani || 'Unknown')));
                meta.appendChild(createMetaSpan('Status: ' + (status || 'Unknown')));
            }
            return block;
        }

        block = document.createElement('section');
        block.className = 'conversationBlock';
        block.dataset.conversationId = conversationId;

        header = document.createElement('div');
        header.className = 'conversationHeader';

        title = document.createElement('strong');
        title.textContent = 'Conversation ' + conversationId;

        meta = document.createElement('div');
        meta.className = 'conversationMeta';
        meta.appendChild(createMetaSpan('ANI: ' + (ani || 'Unknown')));
        meta.appendChild(createMetaSpan('Status: ' + (status || 'Unknown')));

        header.appendChild(title);
        header.appendChild(meta);

        transcriptList = document.createElement('div');
        transcriptList.className = 'transcriptList';

        block.appendChild(header);
        block.appendChild(transcriptList);

        if (transcriptionOutput) {
            transcriptionOutput.appendChild(block);
            transcriptionOutput.scrollTop = transcriptionOutput.scrollHeight;
        }

        state.conversationBlocks[conversationId] = block;
        return block;
    }

    function createMetaSpan(text) {
        var span = document.createElement('span');
        span.textContent = text;
        return span;
    }

    function renderUtterance(container, conversationId, utterance, eventTime, topicName) {
        var key, card, header, metaLine, timestampSpan, channelSpan, wordsWrap, alt, words, i;
        if (!utterance || !utterance.utteranceId) {
            return;
        }

        key = conversationId + ':' + utterance.utteranceId;
        card = state.utteranceNodes[key];
        if (!card) {
            card = document.createElement('article');
            card.className = 'utteranceCard';
            card.dataset.utteranceId = utterance.utteranceId;
            state.utteranceNodes[key] = card;
            container.appendChild(card);
        }

        card.innerHTML = '';

        header = document.createElement('div');
        header.className = 'utteranceHeader';

        metaLine = document.createElement('div');
        metaLine.className = 'utteranceMetaLine';

        timestampSpan = document.createElement('span');
        timestampSpan.className = 'utteranceTimestamp';
        timestampSpan.textContent = formatTimestamp(new Date(eventTime));

        channelSpan = document.createElement('span');
        channelSpan.className = 'utteranceChannel';
        channelSpan.textContent = utterance.channel || 'UNKNOWN';

        metaLine.appendChild(timestampSpan);
        metaLine.appendChild(document.createTextNode(' • '));
        metaLine.appendChild(channelSpan);

        header.appendChild(metaLine);

        wordsWrap = document.createElement('div');
        wordsWrap.className = 'wordLine';

        alt = getPrimaryAlternative(utterance);
        words = (alt && alt.words) ? alt.words : [];
        if (words.length) {
            for (i = 0; i < words.length; i += 1) {
                wordsWrap.appendChild(renderWord(words[i]));
            }
        } else if (alt && alt.transcript) {
            wordsWrap.appendChild(renderWord({ word: alt.transcript, confidence: alt.confidence }));
        } else {
            wordsWrap.appendChild(renderWord({ word: '(no transcript text)', confidence: null }));
        }

        card.appendChild(header);
        card.appendChild(wordsWrap);
    }

    function renderTranscriptionConversation(conversationId, payload, topicName) {
        var block, list, transcripts, i;
        block = ensureConversationBlock(conversationId, extractAni(payload), extractConversationStatus(payload) || 'Unknown');
        list = block.querySelector('.transcriptList');
        transcripts = payload.transcripts || [];

        if (!transcripts.length) {
            return;
        }

        for (i = 0; i < transcripts.length; i += 1) {
            renderUtterance(list, conversationId, transcripts[i], payload.eventTime || payload.timestamp || nowIso(), topicName);
        }

        if ($('transcriptionOutput')) {
            $('transcriptionOutput').scrollTop = $('transcriptionOutput').scrollHeight;
        }
    }

    function handleConversationEvent(conversation) {
        var conversationId = extractConversationId(conversation);
        var ani = extractAni(conversation);
        var status = extractConversationStatus(conversation) || 'UNKNOWN';

        if (!conversationId) {
            appendSystemLog('Conversation Event Missing Conversation Id', conversation);
            return;
        }

        setCurrentConversation(conversationId, ani, status);
        ensureConversationBlock(conversationId, ani, status);
        subscribeToTranscription(conversationId);
    }

    function handleTranscriptionEvent(payload, topicName) {
        var conversationId = extractConversationId(payload);
        if (!conversationId) {
            appendSystemLog('Transcription Event Missing Conversation Id', payload);
            return;
        }

        if (conversationId === state.currentConversationId || !state.currentConversationId) {
            setCurrentConversation(conversationId, extractAni(payload) || state.currentAni, extractConversationStatus(payload) || state.currentStatus);
        }

        ensureConversationBlock(conversationId, extractAni(payload) || state.currentAni, extractConversationStatus(payload) || state.currentStatus);
        renderTranscriptionConversation(conversationId, payload, topicName);
    }

    function handleNotificationMessage(rawMessage) {
        var message, signature, eventBody;

        try {
            message = typeof rawMessage === 'string' ? JSON.parse(rawMessage) : rawMessage;
        } catch (error) {
            appendSystemLog('WSS Message Parse Error', { message: error.message, rawMessage: rawMessage });
            return;
        }

        if (!message) {
            return;
        }

        signature = stringifySafe({
            topicName: message.topicName || '',
            conversationId: extractConversationId(message.eventBody || message.data || message) || ''
        });
        state.lastMessageSignature = signature;

        appendLog('WSS Message', message, message.topicName || 'notification');

        eventBody = message.eventBody || message.data || message;
        if (!eventBody) {
            return;
        }

        if (isUserConversationTopic(message.topicName)) {
            handleConversationEvent(eventBody);
            return;
        }

        if (isTranscriptionTopic(message.topicName) || (eventBody.transcripts && eventBody.transcripts.length)) {
            handleTranscriptionEvent(eventBody, message.topicName);
        }
    }

    function apiRequest(path, options) {
        return fetch(state.apiBaseUrl + path, {
            method: options.method,
            headers: {
                Authorization: 'Bearer ' + state.accessToken,
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

    function getCurrentUser() {
        return apiRequest('/api/v2/users/me', { method: 'GET' });
    }

    function resolveUserId() {
        var typed = $('userId').value.trim();
        if (typed) {
            return Promise.resolve(typed);
        }
        return getCurrentUser().then(function (user) {
            return user.id;
        });
    }

    function resolveConversationTopic(userId) {
        return 'v2.users.' + userId + '.conversations';
    }

    function resolveTranscriptionTopic(conversationId) {
        return 'v2.conversations.' + conversationId + '.transcription';
    }

    function subscribeTopics(topics) {
        return apiRequest('/api/v2/notifications/channels/' + encodeURIComponent(state.channelId) + '/subscriptions', {
            method: 'POST',
            body: JSON.stringify(topics.map(function (topicId) {
                return { id: topicId };
            }))
        });
    }

    function openWebSocket(connectUri) {
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
                state.webSocket = webSocket;
                setStatus('Listening');
                setChannel(state.channelId || 'Connected');
                appendSystemLog('WebSocket Connected', { connectUri: connectUri });
                resolve();
            };

            webSocket.onerror = function () {
                if (!opened) {
                    reject(new Error('Failed to open the notifications WebSocket.'));
                    return;
                }
                appendSystemLog('WebSocket Error', { message: 'WebSocket reported an error after opening.' });
            };

            webSocket.onclose = function (event) {
                appendSystemLog('WebSocket Closed', {
                    code: event.code,
                    reason: event.reason || 'No close reason provided'
                });
            };

            webSocket.onmessage = function (event) {
                handleNotificationMessage(event.data);
            };
        });
    }

    function subscribeToTranscription(conversationId) {
        var topic;
        if (!conversationId || state.subscribedConversations[conversationId] || !state.channelId) {
            return Promise.resolve();
        }

        state.subscribedConversations[conversationId] = true;
        topic = resolveTranscriptionTopic(conversationId);

        return subscribeTopics([topic]).then(function () {
            appendSystemLog('Transcription Subscription Created', {
                conversationId: conversationId,
                topic: topic
            });
        }).catch(function (error) {
            delete state.subscribedConversations[conversationId];
            appendSystemLog('Transcription Subscription Error', {
                conversationId: conversationId,
                topic: topic,
                message: error.message
            });
        });
    }

    function readConnectionInputs() {
        return GenesysConnectionFields.ready.then(function () {
            state.apiBaseUrl = GenesysConnectionFields.getApiBaseUrl();
            state.accessToken = GenesysConnectionFields.getAccessToken();

            if (!state.apiBaseUrl || !state.accessToken) {
                throw new Error('Genesys Region and Access Token are required.');
            }
        });
    }

    function startSubscription() {
        appendSystemLog('Start Button Clicked', { at: nowIso() });
        setStatus('Starting');

        stopSubscription().then(function () {
            return readConnectionInputs();
        }).then(function () {
            setStatus('Resolving user');
            return resolveUserId();
        }).then(function (userId) {
            state.userId = userId;
            setStatus('Creating notification channel');
            return apiRequest('/api/v2/notifications/channels', { method: 'POST' });
        }).then(function (channel) {
            state.channelId = channel.id;
            setChannel(channel.id);
            appendSystemLog('Channel Created', channel);
            setStatus('Opening WebSocket');
            return openWebSocket(channel.connectUri).then(function () {
                return channel;
            });
        }).then(function () {
            var userTopic = resolveConversationTopic(state.userId);
            setStatus('Subscribing to user conversations');
            return subscribeTopics([userTopic]).then(function () {
                appendSystemLog('Subscription Created', { topic: userTopic });
                setStatus('Listening');
            });
        }).catch(function (error) {
            setStatus('Error');
            appendSystemLog('Subscription Error', { message: error && error.message ? error.message : String(error) });
        });
    }

    function stopSubscription() {
        var closePromise;
        appendSystemLog('Stop Button Clicked', { at: nowIso() });

        if (state.webSocket) {
            try {
                state.webSocket.onclose = null;
                state.webSocket.close();
            } catch (error) {
                appendSystemLog('WebSocket Close Error', { message: error.message });
            }
            state.webSocket = null;
        }

        closePromise = Promise.resolve();
        if (state.channelId && state.accessToken && state.apiBaseUrl) {
            closePromise = apiRequest('/api/v2/notifications/channels/' + encodeURIComponent(state.channelId), { method: 'DELETE' }).catch(function (error) {
                appendSystemLog('Channel Delete Warning', { message: error.message });
            });
        }

        state.channelId = null;
        state.subscribedConversations = {};
        setChannel('Not created');
        setStatus('Idle');
        return closePromise;
    }

    function wireControls() {
        var startButton = $('startSubscription');
        var stopButton = $('stopSubscription');
        var clearButton = $('clearOutput');

        if (startButton) {
            startButton.onclick = startSubscription;
            startButton.addEventListener('click', startSubscription);
        }
        if (stopButton) {
            stopButton.onclick = stopSubscription;
            stopButton.addEventListener('click', stopSubscription);
        }
        if (clearButton) {
            clearButton.onclick = clearOutput;
            clearButton.addEventListener('click', clearOutput);
        }

        appendSystemLog('Controls Wired', {
            startButton: !!startButton,
            stopButton: !!stopButton,
            clearButton: !!clearButton
        });
        setStatus('Idle');
        setChannel('Not created');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', wireControls);
    } else {
        wireControls();
    }

    window.transcriptionPage = {
        startSubscription: startSubscription,
        stopSubscription: stopSubscription,
        clearOutput: clearOutput,
        handleNotificationMessage: handleNotificationMessage
    };
})();
