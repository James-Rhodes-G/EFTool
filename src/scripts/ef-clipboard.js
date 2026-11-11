(function (global) {
  'use strict';

  function copyText(text) {
    var value = text == null ? '' : String(text);

    if (global.navigator && global.navigator.clipboard && global.navigator.clipboard.writeText) {
      return global.navigator.clipboard.writeText(value);
    }

    return new Promise(function (resolve, reject) {
      var textarea;
      try {
        textarea = document.createElement('textarea');
        textarea.value = value;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.left = '-9999px';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  }

  function flashCopiedLabel(button, originalLabel, durationMs) {
    var previous = originalLabel != null ? originalLabel : (button.textContent || 'Copy');

    button.textContent = 'Copied';
    button.disabled = true;

    global.setTimeout(function () {
      button.textContent = previous;
      button.disabled = false;
    }, ms);
  }

  function bindCopyButton(button, getText, options) {
    if (!button) {
      return;
    }

    options = options || {};
    var originalLabel = button.textContent;

    button.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();

      var text = typeof getText === 'function' ? getText() : String(getText || '');

      copyText(text)
        .then(function () {
          if (options.flash !== false) {
            flashCopiedLabel(button, originalLabel, options.flashDurationMs);
          }
        })
        .catch(function (error) {
          console.error('[EfClipboard] copy failed', error);
          if (options.onError) {
            options.onError(error);
          }
        });
    });
  }

  global.EfClipboard = {
    copyText: copyText,
    bindCopyButton: bindCopyButton,
    flashCopiedLabel: flashCopiedLabel
  };
}(window));
