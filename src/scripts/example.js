document.addEventListener('DOMContentLoaded',function(){
    var pendingScreenPopRequests = {};

    if (window.opener && !window.name) {
        window.name = 'ef-popup';
    }

    if (window.name === 'ef-popup') {
        sessionStorage.setItem('efPopup', '1');
    }
    
    var popupButton = document.getElementById("openFrameworkPopup");
    if (popupButton) {
        popupButton.addEventListener("click", openFrameworkPopup);
    }
    document.getElementById("clickToDial").addEventListener("click", clickToDial);
    document.getElementById("addAssociation").addEventListener("click", addAssociation);
    document.getElementById("addAttribute").addEventListener("click", addAttribute);
    document.getElementById('addTransferContext').addEventListener("click", addTransferContext);
    document.getElementById('updateUserStatus').addEventListener("click", updateUserStatus);
    document.getElementById('pickupInteraction').addEventListener("click", updateInteractionState);
    document.getElementById('securePauseInteraction').addEventListener("click", updateInteractionState);
    document.getElementById('disconnectInteraction').addEventListener("click", updateInteractionState);
    document.getElementById('holdInteraction').addEventListener("click", updateInteractionState);
    document.getElementById('muteInteraction').addEventListener("click", updateInteractionState);
    document.getElementById('updateAudioConfiguration').addEventListener("click", updateAudioConfiguration);
    document.getElementById('sendCustomNotification').addEventListener("click", sendCustomNotification);
    
    document.getElementById('view-interactionList').addEventListener("click", setView);
    document.getElementById('view-calllog').addEventListener("click", setView);
    document.getElementById('view-newInteraction').addEventListener("click", setView);
    document.getElementById('view-callback').addEventListener("click", setView);
    document.getElementById('view-settings').addEventListener("click", setView);

    window.addEventListener("message", function(event) {
        var message;
        try {
            message = JSON.parse(event.data);
        } catch (parseError) {
            return;
        }

        if(message){
            if(message.type == "screenPop"){
                handleScreenPop(message);
            } else if(message.type == "outboundContactLookupResult"){
                handleOutboundContactLookupResult(message);
            } else if(message.type == "processCallLog"){
                if (message.data && message.data.eventName === "openCallLog") {
                    document.getElementById("openCallLogPayLoad").value = event.data;
                } else {
                    document.getElementById("processCallLogPayLoad").value = event.data;
                }
            } else if(message.type == "openCallLog"){
                document.getElementById("openCallLogPayLoad").value = event.data;
            } else if(message.type == "interactionSubscription"){
                document.getElementById("interactionSubscriptionPayload").value = event.data;
            } else if(message.type == "userActionSubscription"){
                document.getElementById("userActionSubscriptionPayload").value = event.data;
            } else if(message.type == "notificationSubscription"){
                document.getElementById("notificationSubscriptionPayload").value = event.data;
            } else if(message.type == "efLifecycle"){
                console.log('[EF lifecycle]', message.data);
            } else if(message.type == "contactSearch") {
                document.getElementById("searchText").innerHTML = ": " + message.data.searchString;
                sendContactSearch();
            }
        }
    });

    function handleScreenPop(message) {
        document.getElementById("screenPopPayload").value = JSON.stringify(message, null, 2);

        var interaction = message.data && message.data.interactionId ? message.data.interactionId : null;
        var contactId = interaction && interaction.dialerContactId ? interaction.dialerContactId : null;
        var contactListId = interaction && interaction.dialerContactListId ? interaction.dialerContactListId : null;

        if (!contactId || !contactListId) {
            document.getElementById("screenPopPayload").value = JSON.stringify({
                screenPop: message,
                contactLookupError: 'Missing message.data.interactionId.dialerContactId or message.data.interactionId.dialerContactListId'
            }, null, 2);
            return;
        }

        var requestId = String(Date.now()) + '-' + String(Math.random()).substring(2);
        pendingScreenPopRequests[requestId] = message;

        document.getElementById("softphone").contentWindow.postMessage(JSON.stringify({
            type: 'lookupOutboundContact',
            data: {
                requestId: requestId,
                contactId: contactId,
                contactListId: contactListId
            }
        }), "*");
    }

    function handleOutboundContactLookupResult(message) {
        var requestId = message.data ? message.data.requestId : null;
        var screenPopMessage = requestId ? pendingScreenPopRequests[requestId] : null;

        if (requestId) {
            delete pendingScreenPopRequests[requestId];
        }

        document.getElementById("screenPopPayload").value = JSON.stringify({
            screenPop: screenPopMessage || null,
            contactRecord: message.data ? message.data.contactRecord : null,
            contactLookupError: message.data ? message.data.contactLookupError : 'Unknown contact lookup error'
        }, null, 2);
    }

    function openFrameworkPopup() {
        var popupUrl = window.location.origin + '/example.html?popup=1';
        var popup = window.open(
            popupUrl,
            'ef-popup',
            'popup=yes,width=540,height=860,resizable=yes,scrollbars=yes'
        );

        if (popup) {
            popup.name = 'ef-popup';
        }
    }

    function clickToDial() {
        console.log('process click to dial');
        document.getElementById("softphone").contentWindow.postMessage(JSON.stringify({
            type: 'clickToDial',
            data: { number: '3172222222', autoPlace: true }
        }), "*");
    }

    function addAssociation() {
        console.log('process add association');
        document.getElementById("softphone").contentWindow.postMessage(JSON.stringify({
            type: 'addAssociation',
            data: JSON.parse(document.getElementById("associationPayload").value)
        }), "*");
    }

    function addAttribute() {
        console.log('process add attribute');
        document.getElementById("softphone").contentWindow.postMessage(JSON.stringify({
            type: 'addAttribute',
            data: JSON.parse(document.getElementById("attributePayload").value)
        }), "*");
    }

    function addTransferContext() {
        console.log('process add Transfer Context');
        document.getElementById("softphone").contentWindow.postMessage(JSON.stringify({
            type: 'addTransferContext',
            data: JSON.parse(document.getElementById("transferContextPayload").value)
        }), "*");
    }

    function sendContactSearch() {
        console.log('process add Search Context');
        document.getElementById("softphone").contentWindow.postMessage(JSON.stringify({
            type: 'sendContactSearch',
            data: JSON.parse(document.getElementById("contactSearchPayload").value)
        }), "*");
    }

    function updateUserStatus() {
        console.log('process user status update');
        document.getElementById("softphone").contentWindow.postMessage(JSON.stringify({
            type: 'updateUserStatus',
            data: { id:document.getElementById("statusDropDown").value }
        }), "*");
    }

    function updateInteractionState(event) {
        console.log('process interaction state change');
        var payloadText = document.getElementById("interactionSubscriptionPayload").value;
        if (!payloadText) {
            console.warn('No Interaction subscription payload available yet.');
            return;
        }

        var lastInteractionPayload;
        try {
            lastInteractionPayload = JSON.parse(payloadText);
        } catch (parseError) {
            console.warn('Interaction subscription payload is not valid JSON.');
            return;
        }

        var interaction = lastInteractionPayload.data && lastInteractionPayload.data.interaction;
        if (!interaction) {
            console.warn('Interaction subscription payload is missing data.interaction.');
            return;
        }

        var interactionId;
        if (interaction.old){
            interactionId = interaction.old.id;
        } else {
            interactionId = interaction.id;
        }
        let payload = {
            action: event.target.outerText,
            id: interactionId
        };
        document.getElementById("softphone").contentWindow.postMessage(JSON.stringify({
            type: 'updateInteractionState',
            data: payload
        }), "*");
    }

    function updateAudioConfiguration(){
        console.log('Update Audio Configuration');
        var payload = {
            call: document.getElementById('audio-call').checked,
            chat: document.getElementById('audio-chat').checked,
            email: document.getElementById('audio-email').checked,
            callback: document.getElementById('audio-callback').checked,
            message: document.getElementById('audio-message').checked,
            voicemail: document.getElementById('audio-voicemail').checked
        }
        document.getElementById("softphone").contentWindow.postMessage(JSON.stringify({
            type: 'updateAudioConfiguration',
            data: payload
        }), "*");
    }


    function setView(event) {
        console.log('process view update');
        let payload = {
            type:"main", 
            view: {
                name:event.target.outerText
            }
        };
        document.getElementById("softphone").contentWindow.postMessage(JSON.stringify({
            type: 'setView',
            data: payload
        }), "*");
    }

    function sendCustomNotification(){
        console.log('Send Custom User Notification');
        var payload = {
            message: document.getElementById('customNotificationMessage').value,
            type: document.getElementById('notificationType').value,  
            timeout: document.getElementById('notificationTimeout').value
        };
        document.getElementById("softphone").contentWindow.postMessage(JSON.stringify({
            type: 'sendCustomNotification',
            data: payload
        }), "*");
    }
})
