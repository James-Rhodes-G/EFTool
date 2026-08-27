// Shared Embeddable Framework iframe settings for local development.
// Chrome/Edge: local-network-access
// Firefox 150+: local-network + loopback-network (local-network-access is ignored)
window.__EF_IFRAME_ALLOW__ =
  'camera *; microphone *; autoplay *; hid *; local-network-access *; local-network *; loopback-network *';

window.__EF_IFRAME_SRC__ =
  'https://apps.usw2.pure.cloud/crm/index.html?crm=framework-local-secure';

window.__EF_LOCAL_FRAMEWORK_URL__ = 'https://localhost/framework.js';

function mountEmbeddableFrameworkIframe(containerId, iframeId) {
  var container = document.getElementById(containerId);
  if (!container) {
    return null;
  }

  var iframe = document.createElement('iframe');
    iframe.id = iframeId || 'softphone';
    iframe.allow = window.__EF_IFRAME_ALLOW__;
    iframe.src = window.__EF_IFRAME_SRC__;
    iframe.setAttribute('allow', window.__EF_IFRAME_ALLOW__);
    iframe.style.width = '100%';
    iframe.style.height = '700px';
    iframe.style.border = '1px solid #ccc';
    container.appendChild(iframe);
  return iframe;
}

function preflightLocalFramework() {
  return fetch(window.__EF_LOCAL_FRAMEWORK_URL__, {
    method: 'GET',
    cache: 'no-store',
    credentials: 'omit'
  }).then(function (response) {
    if (!response.ok) {
      throw new Error('framework.js returned HTTP ' + response.status);
    }
    return response.text();
  }).then(function (source) {
    if (source.indexOf('window.Framework') === -1) {
      throw new Error('framework.js loaded but does not define window.Framework');
    }
    return true;
  });
}
