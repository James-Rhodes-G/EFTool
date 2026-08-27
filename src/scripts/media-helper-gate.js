document.addEventListener('DOMContentLoaded', () => {
  const eventLog = document.getElementById('event-log');
  const efLoginState = document.getElementById('ef-login-state');
  const mediaHelperRequired = document.getElementById('media-helper-required');
  const mediaHelperLogin = document.getElementById('media-helper-login');
  const clearLogBtn = document.getElementById('clear-log-btn');

  if (!eventLog || !efLoginState || !mediaHelperRequired || !mediaHelperLogin || !clearLogBtn) {
    console.error('Media Helper Gate: required DOM elements were not found.');
    return;
  }

  let helperRequired = false;
  let helperCallAttempted = false;

  function appendLog(message, payload) {
    const timestamp = new Date().toISOString();
    let output = `[${timestamp}] ${message}`;

    if (payload !== undefined) {
      try {
        output += '\n\n' + JSON.stringify(payload, null, 2);
      } catch (err) {
        output += '\n' + String(payload);
      }
    }

    output += '\n';
    eventLog.textContent = output + eventLog.textContent;
    console.log(message, payload);
  }

  function showMediaHelperPopup() {
    alert(
      'Media Helper appears to require authentication.\n\n' +
      'Please complete the Media Helper login process and try again.'
    );
  }

  function sendMediaHelperClickToDial() {
    const softphoneFrame = document.getElementById('softphone');

    if (!softphoneFrame || !softphoneFrame.contentWindow) {
      appendLog('Unable to locate EF iframe for clickToDial.');
      return;
    }

    const payload = {
      type: 'clickToDial',
      data: {
        number: 'mediaHelper@localhost',
        autoPlace: true
      }
    };

    appendLog('Sending clickToDial payload to EF', payload);

    softphoneFrame.contentWindow.postMessage(
      JSON.stringify(payload),
      '*'
    );

    mediaHelperLogin.textContent = 'Dial Request Sent';
  }

  async function attemptMediaHelperCall() {
    if (helperCallAttempted) {
      return;
    }

    helperCallAttempted = true;
    appendLog('Attempting outbound Media Helper clickToDial...');

    sendMediaHelperClickToDial();
  }

  function extractMediaHelperRequired(parsed) {
    return parsed?.data?.data?.webRtcRequireMediaHelper;
  }

  window.addEventListener('message', async (event) => {
    appendLog('Raw EF event.data received', event.data);

    let parsed;
    try {
      parsed = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
    } catch (err) {
      appendLog('Failed to parse EF payload', {
        message: err.message
      });
      return;
    }

    appendLog('Parsed EF payload', parsed);

    const helperFlag = extractMediaHelperRequired(parsed);
    if (typeof helperFlag === 'boolean') {
      helperRequired = helperFlag;
      mediaHelperRequired.textContent = helperFlag ? 'True' : 'False';
    }

    if (parsed?.type) {
      efLoginState.textContent = `Last event: ${parsed.type}`;
    }

    if (helperRequired) {
      await attemptMediaHelperCall();
    }
  });

  clearLogBtn.addEventListener('click', () => {
    eventLog.textContent = '';
  });

  appendLog('Media Helper Gate initialized');
});