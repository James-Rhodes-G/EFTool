document.addEventListener('DOMContentLoaded', function () {
    var softphone = document.getElementById('softphone');
    var events = [];
    var lastRelevantEvent = null;
    var snapshotTimer = null;
    var snapshotRequestInFlight = false;

    var authState = {
        accessToken: null,
        userId: null,
        apiBaseUrl: null,
        channel: null,
        socket: null,
        subscribing: false
    };

    var DOM = {
        clearEvents: document.getElementById('clearEvents'),
        refreshSnapshots: document.getElementById('refreshSnapshots'),
        autoRefresh: document.getElementById('autoRefresh'),
        showOnlyRelevant: document.getElementById('showOnlyRelevant'),
        eventFilter: document.getElementById('eventFilter'),
        loginState: document.getElementById('loginState'),
        phoneState: document.getElementById('phoneState'),
        webrtcState: document.getElementById('webrtcState'),
        lastRelevantEvent: document.getElementById('lastRelevantEvent'),
        userSnapshot: document.getElementById('userSnapshot'),
        presenceSnapshot: document.getElementById('presenceSnapshot'),
        routingSnapshot: document.getElementById('routingSnapshot'),
        stationSnapshot: document.getElementById('stationSnapshot'),
        relevantEvents: document.getElementById('relevantEvents'),
        latestEvent: document.getElementById('latestEvent'),
        eventCount: document.getElementById('eventCount'),
        eventFeed: document.getElementById('eventFeed'),
        watchCheckbox: document.getElementById('watchAgentErrors'),
        modal: document.getElementById('errorModal'),
        modalText: document.getElementById('errorModalText'),
        modalClose: document.getElementById('errorModalClose')
    };

    DOM.clearEvents.addEventListener('click', clearEvents);
    DOM.refreshSnapshots.addEventListener('click', function () {
        requestSnapshot(true);
    });
    DOM.autoRefresh.addEventListener('change', syncAutoRefresh);
    DOM.showOnlyRelevant.addEventListener('change', renderEventFeed);
    DOM.eventFilter.addEventListener('input', renderEventFeed);
    if (DOM.watchCheckbox) {
        DOM.watchCheckbox.addEventListener('change', syncWatchAgentErrors);
    }
    if (DOM.modalClose) {
        DOM.modalClose.addEventListener('click', hideAgentErrorModal);
    }
    if (DOM.modal) {
        DOM.modal.addEventListener('click', function (event) {
            if (event.target === DOM.modal) {
                hideAgentErrorModal();
            }
        });
    }

    window.addEventListener('keydown', function (event) {
        if (event.key === 'Escape') {
            hideAgentErrorModal();
        }
    });

    window.addEventListener('message', function (event) {
        var message;
        console.log(event);
        try {
            message = JSON.parse(event.data);
        } catch (parseError) {
            return;
        }

        if (!message || !message.type) {
            return;
        }

        if (/^diagnostics(AuthToken|SnapshotResult)$/.test(message.type)) {
            return;
        }

        var normalized = normalizeMessage(message);
        events.unshift(normalized);
        if (events.length > 100) {
            events.length = 100;
        }

        DOM.latestEvent.textContent = JSON.stringify(normalized.payload, null, 2);
        if (normalized.relevant) {
            lastRelevantEvent = normalized;
            DOM.lastRelevantEvent.textContent = normalized.summary;
        }

        deriveState();
        renderRelevantEvents();
        renderEventFeed();

        updateLivePanelsFromEvent(normalized.payload);

        if (DOM.autoRefresh.checked && shouldTriggerSnapshotRefresh(normalized)) {
            requestSnapshot(false);
        }
    });

    syncAutoRefresh();
    deriveState();
    renderRelevantEvents();
    renderEventFeed();

    function syncWatchAgentErrors() {
        if (!DOM.watchCheckbox || !DOM.watchCheckbox.checked) {
            hideAgentErrorModal();
        }
    }

    function showAgentErrorModal(text) {
        if (!DOM.modal || !DOM.modalText) {
            return;
        }

        DOM.modalText.textContent = text || 'Unknown error';
        DOM.modal.classList.remove('hidden');
    }

    function hideAgentErrorModal() {
        if (!DOM.modal || !DOM.modalText) {
            return;
        }

        DOM.modal.classList.add('hidden');
        DOM.modalText.textContent = '';
    }

    function clearEvents() {
        events = [];
        lastRelevantEvent = null;
        DOM.latestEvent.textContent = 'No events captured yet.';
        DOM.relevantEvents.textContent = 'No events captured yet.';
        DOM.lastRelevantEvent.textContent = 'None';
        deriveState();
        renderEventFeed();
    }

    function syncAutoRefresh() {
        if (snapshotTimer) {
            clearInterval(snapshotTimer);
            snapshotTimer = null;
        }

        if (DOM.autoRefresh.checked) {
            snapshotTimer = setInterval(function () {
                requestSnapshot(false);
            }, 15000);
        }
    }

    function handleConversationEvent(notificationMessage) {
        if (!DOM.watchCheckbox || !DOM.watchCheckbox.checked) {
            return;
        }

        var conversation = notificationMessage && notificationMessage.eventBody ? notificationMessage.eventBody : notificationMessage;
        if (!conversation || !conversation.participants || !conversation.participants.length) {
            return;
        }

        var agentParticipants = conversation.participants.filter(function (participant) {
            return participant && participant.purpose === 'agent';
        });

        agentParticipants.forEach(function (agent) {
            var text = agent && agent.errorInfo && agent.errorInfo.messageParams && agent.errorInfo.messageParams.text;
            if (text) {
                showAgentErrorModal(text);
            }
        });
    }

    function normalizeMessage(message) {
        var payload = {
            receivedAt: new Date().toISOString(),
            type: message.type,
            data: message.data || null
        };
        var lowerText = JSON.stringify(payload).toLowerCase();
        var relevant = /(phone|station|webrtc|web rtc|microphone|speaker|media helper|mediahelper|audio|login|auth|routingstatus|presence)/i.test(lowerText);
        var category = payload.data && payload.data.category ? payload.data.category : '-';
        var summary = payload.type + ' / ' + category;

        return {
            payload: payload,
            relevant: relevant,
            summary: summary,
            text: lowerText
        };
    }

    function shouldTriggerSnapshotRefresh(message) {
        if (!message.relevant) {
            return false;
        }

        if (message.payload.type !== 'notificationSubscription') {
            return false;
        }

        if (!message.payload.data || message.payload.data.category !== 'change') {
            return false;
        }

        return /station|effectiveStation|associatedStation|lastAssociatedStation|webrtc/i.test(message.text);
    }

    function deriveState() {
        var loginState = 'Not observed';
        var phoneState = 'No phone or station state observed';
        var webrtcState = 'No WebRTC or Media Helper state observed';

        for (var i = 0; i < events.length; i++) {
            var entry = events[i];
            var payloadText = entry.text;

            if (loginState === 'Not observed' && /(token|auth|login|authenticated)/i.test(payloadText)) {
                loginState = 'Login-related event observed';
            }

            if (phoneState === 'No phone or station state observed' && /(station|phone)/i.test(payloadText)) {
                phoneState = summarizePhoneState(entry.payload);
            }

            if (webrtcState === 'No WebRTC or Media Helper state observed' && /(webrtc|microphone|speaker|audio|media helper|mediahelper)/i.test(payloadText)) {
                webrtcState = summarizeWebrtcState(entry.payload);
            }

            if (loginState !== 'Not observed' &&
                phoneState !== 'No phone or station state observed' &&
                webrtcState !== 'No WebRTC or Media Helper state observed') {
                break;
            }
        }

        DOM.loginState.textContent = loginState;
        DOM.phoneState.textContent = phoneState;
        DOM.webrtcState.textContent = webrtcState;
    }

    function summarizePhoneState(payload) {
        var text = JSON.stringify(payload);
        if (/logout phone|disassociate|deselect/i.test(text)) {
            return 'Phone logout or disassociation signal observed';
        }
        if (/select phone|selectedphone|station/i.test(text)) {
            return 'Phone or station selection signal observed';
        }
        return 'Phone or station-related payload observed';
    }

    function summarizeWebrtcState(payload) {
        var text = JSON.stringify(payload);
        if (/permission|microphone|speaker|device/i.test(text)) {
            return 'WebRTC device or permission signal observed';
        }
        if (/media helper|mediahelper/i.test(text)) {
            return 'Media Helper-related signal observed';
        }
        if (/webrtc|audio/i.test(text)) {
            return 'WebRTC or audio-related payload observed';
        }
        return 'WebRTC-related payload observed';
    }

    function renderRelevantEvents() {
        var relevant = events.filter(function (entry) {
            return entry.relevant;
        }).slice(0, 10);

        if (!relevant.length) {
            DOM.relevantEvents.textContent = 'No events captured yet.';
            return;
        }

        DOM.relevantEvents.textContent = relevant.map(function (entry) {
            return JSON.stringify(entry.payload, null, 2);
        }).join('\n\n--------------------\n\n');
    }

    function renderEventFeed() {
        var filterText = DOM.eventFilter.value.trim().toLowerCase();
        var showOnlyRelevant = DOM.showOnlyRelevant.checked;
        var filtered = events.filter(function (entry) {
            if (showOnlyRelevant && !entry.relevant) {
                return false;
            }
            if (!filterText) {
                return true;
            }
            return entry.text.indexOf(filterText) !== -1;
        });

        DOM.eventCount.textContent = String(filtered.length);
        DOM.eventFeed.innerHTML = '';

        if (!filtered.length) {
            var empty = document.createElement('div');
            empty.className = 'event-item';
            empty.innerHTML = '<div class="event-summary"><span>No matching events yet.</span></div>';
            DOM.eventFeed.appendChild(empty);
            return;
        }

        filtered.forEach(function (entry) {
            var item = document.createElement('article');
            item.className = 'event-item' + (entry.relevant ? ' relevant' : '');

            var summary = document.createElement('div');
            summary.className = 'event-summary';
            summary.innerHTML = '<strong>' + escapeHtml(entry.summary) + '</strong><span class="event-meta">' + escapeHtml(entry.payload.receivedAt) + '</span>';

            var body = document.createElement('div');
            body.className = 'event-body';
            var pre = document.createElement('pre');
            pre.textContent = JSON.stringify(entry.payload, null, 2);
            body.appendChild(pre);

            item.appendChild(summary);
            item.appendChild(body);
            DOM.eventFeed.appendChild(item);
        });
    }

    function requestSnapshot(verbose) {
        if (snapshotRequestInFlight) {
            return;
        }

        snapshotRequestInFlight = true;
        postToIframe({
            type: 'diagnosticsRunSnapshot'
        });

        if (verbose) {
            DOM.userSnapshot.textContent = 'Requesting snapshot from iframe...';
            DOM.stationSnapshot.textContent = 'Requesting snapshot from iframe...';
        }
    }

    function requestAuthTokenAndRefresh(verbose) {
        postToIframe({
            type: 'diagnosticsGetAuthToken'
        });

        if (verbose) {
            DOM.userSnapshot.textContent = 'Requesting auth token from iframe...';
        }
    }

    function postToIframe(payload) {
        if (!softphone || !softphone.contentWindow) {
            return;
        }
        softphone.contentWindow.postMessage(JSON.stringify(payload), '*');
    }

    window.addEventListener('message', function (event) {
        var message;

        try {
            message = JSON.parse(event.data);
        } catch (parseError) {
            return;
        }

        if (!message || message.type !== 'diagnosticsAuthToken') {
            if (!message || message.type !== 'diagnosticsSnapshotResult') {
                return;
            }

            snapshotRequestInFlight = false;
            renderSnapshots(message.data || {});
            return;
        }

        if (!message.data || !message.data.token) {
            DOM.userSnapshot.textContent = 'No auth token available yet. Log in to the embedded client first.';
            return;
        }

        authState.accessToken = message.data.token;
        authState.userId = message.data.userId || (message.data.user && message.data.user.id) || authState.userId;
        authState.apiBaseUrl = message.data.apiBaseUrl || message.data.baseUrl || authState.apiBaseUrl;

        DOM.userSnapshot.textContent = 'Auth token acquired. Snapshot calls now run inside the iframe context.';
        initNotificationSubscription();
    });

    async function initNotificationSubscription() {
        if (authState.subscribing || authState.channel || authState.socket) {
            return;
        }

        authState.subscribing = true;

        try {
            var userId = authState.userId || await resolveCurrentUserId();
            if (!userId) {
                console.warn('Unable to resolve user id for notifications subscription.');
                authState.subscribing = false;
                return;
            }

            var topic = 'v2.users.' + userId + '.conversations';

            if (window.platformClient && window.platformClient.NotificationsApi) {
                var notificationsApi = new window.platformClient.NotificationsApi();
                var channel = await notificationsApi.postNotificationsChannels();
                await notificationsApi.putNotificationsChannelSubscriptions(channel.id, [{ id: topic }]);
                authState.channel = channel;
                openNotificationSocket(channel.connectUri);
                return;
            }

            var apiBaseUrl = getApiBaseUrl();
            if (!apiBaseUrl || !authState.accessToken) {
                console.warn('Missing apiBaseUrl or access token for notifications subscription.');
                authState.subscribing = false;
                return;
            }

            var channelResponse = await fetch(apiBaseUrl + '/api/v2/notifications/channels', {
                method: 'POST',
                headers: {
                    'Authorization': 'Bearer ' + authState.accessToken,
                    'Content-Type': 'application/json'
                }
            });

            if (!channelResponse.ok) {
                throw new Error('Failed to create notifications channel: ' + channelResponse.status + ' ' + channelResponse.statusText);
            }

            var channelJson = await channelResponse.json();

            var subscriptionResponse = await fetch(apiBaseUrl + '/api/v2/notifications/channels/' + channelJson.id + '/subscriptions', {
                method: 'PUT',
                headers: {
                    'Authorization': 'Bearer ' + authState.accessToken,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify([{ id: topic }])
            });

            if (!subscriptionResponse.ok) {
                throw new Error('Failed to subscribe to topic: ' + subscriptionResponse.status + ' ' + subscriptionResponse.statusText);
            }

            authState.channel = channelJson;
            openNotificationSocket(channelJson.connectUri);
        } catch (error) {
            console.error('Notification subscription error', error);
            authState.subscribing = false;
        }
    }

    function openNotificationSocket(connectUri) {
        if (!connectUri) {
            authState.subscribing = false;
            return;
        }

        if (authState.socket) {
            try {
                authState.socket.close();
            } catch (closeError) {
                // ignore
            }
        }

        authState.socket = new WebSocket(connectUri);

        authState.socket.onmessage = function (event) {
            var notificationMessage;
            try {
                notificationMessage = JSON.parse(event.data);
            } catch (parseError) {
                return;
            }

            handleConversationEvent(notificationMessage);
        };

        authState.socket.onerror = function (error) {
            console.error('Notification socket error', error);
            authState.subscribing = false;
        };

        authState.socket.onclose = function () {
            authState.subscribing = false;
        };
    }

    async function resolveCurrentUserId() {
        if (authState.userId) {
            return authState.userId;
        }

        if (window.platformClient && window.platformClient.UsersApi) {
            try {
                var usersApi = new window.platformClient.UsersApi();
                var me = await usersApi.getUsersMe();
                authState.userId = me && me.id ? me.id : null;
                return authState.userId;
            } catch (error) {
                console.warn('Unable to resolve user id using platformClient.UsersApi', error);
            }
        }

        if (authState.accessToken) {
            try {
                var apiBaseUrl = getApiBaseUrl();
                if (!apiBaseUrl) {
                    return null;
                }

                var meResponse = await fetch(apiBaseUrl + '/api/v2/users/me', {
                    headers: {
                        'Authorization': 'Bearer ' + authState.accessToken
                    }
                });

                if (meResponse.ok) {
                    var meJson = await meResponse.json();
                    authState.userId = meJson && meJson.id ? meJson.id : null;
                    return authState.userId;
                }
            } catch (fetchError) {
                console.warn('Unable to resolve user id using /users/me', fetchError);
            }
        }

        return null;
    }

    function getApiBaseUrl() {
        if (authState.apiBaseUrl) {
            return String(authState.apiBaseUrl).replace(/\/$/, '');
        }

        if (window.location && window.location.origin && !/localhost|127\.0\.0\.1/i.test(window.location.origin)) {
            return window.location.origin.replace(/\/$/, '');
        }

        return null;
    }

    function renderSnapshots(data) {
        DOM.userSnapshot.textContent = JSON.stringify(data.user || { error: 'No data' }, null, 2);
        DOM.stationSnapshot.textContent = JSON.stringify({
            userStation: data.station || { error: 'No data' },
            stationDetails: data.stationDetails || { error: 'No data' }
        }, null, 2);

        if (data.station && data.station.station) {
            var stationInfo = data.station.station.effectiveStation || data.station.station.associatedStation || data.station.station.lastAssociatedStation || null;
            if (stationInfo) {
                DOM.phoneState.textContent = 'Selected station: ' + (stationInfo.id || 'unknown') + ' / ' + (((stationInfo.providerInfo || {}).name) || 'unnamed');
            }
        }

        if (data.stationDetails && !data.stationDetails.error) {
            DOM.webrtcState.textContent = 'Station type: ' +
                (data.stationDetails.type || 'unknown') +
                ' / persistent=' + String(!!data.stationDetails.webRtcPersistentEnabled) +
                ' / forceTurn=' + String(!!data.stationDetails.webRtcForceTurn);
        }
    }

    function updateLivePanelsFromEvent(payload) {
        var type = payload.type || '';
        var data = payload.data || {};
        var body = data.data || data.interaction || {};

        if (type === 'notificationSubscription' && data.category === 'change') {
            var bodyText = JSON.stringify(body, null, 2);

            if (/presenceDefinition|systemPresence|presence/i.test(bodyText)) {
                DOM.presenceSnapshot.textContent = bodyText;
            }

            if (/routingStatus|onQueue|offQueue|idle|interacting|notResponding/i.test(bodyText)) {
                DOM.routingSnapshot.textContent = bodyText;
            }

            if (/station|effectiveStation|associatedStation|lastAssociatedStation/i.test(bodyText)) {
                DOM.stationSnapshot.textContent = bodyText;
            }
        }

        if (type === 'userActionSubscription') {
            var actionText = JSON.stringify(data, null, 2);

            //if (/webrtc|microphone|speaker|audio|station|phone/i.test(actionText)) {
                DOM.lastRelevantEvent.textContent = 'userActionSubscription / ' + (data.category || '-');
            //}
        }
    }

    function escapeHtml(value) {
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }
});
