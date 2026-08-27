(function (global) {
  'use strict';

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function valueClass(value) {
    if (value === null) {
      return 'json-null';
    }

    switch (typeof value) {
      case 'string':
        return 'json-string';
      case 'number':
        return 'json-number';
      case 'boolean':
        return 'json-boolean';
      default:
        return 'json-unknown';
    }
  }

  function formatPrimitive(value) {
    if (value === null) {
      return 'null';
    }

    if (typeof value === 'string') {
      return '"' + escapeHtml(value) + '"';
    }

    return escapeHtml(String(value));
  }

  function isPlainObject(value) {
    return Object.prototype.toString.call(value) === '[object Object]';
  }

  function renderPrimitiveLine(key, value) {
    var line = document.createElement('div');
    line.className = 'json-line json-leaf';

    if (key !== null && key !== undefined) {
      line.innerHTML =
        '<span class="json-key">' + escapeHtml(JSON.stringify(String(key))) + '</span>' +
        '<span class="json-colon">: </span>' +
        '<span class="' + valueClass(value) + '">' + formatPrimitive(value) + '</span>';
    } else {
      line.innerHTML = '<span class="' + valueClass(value) + '">' + formatPrimitive(value) + '</span>';
    }

    return line;
  }

  function renderCollection(key, value, options) {
    var isArray = Array.isArray(value);
    var entries = isArray
      ? value.map(function (entry, index) {
          return [index, entry];
        })
      : Object.keys(value).map(function (objectKey) {
          return [objectKey, value[objectKey]];
        });

    var details = document.createElement('details');
    details.className = 'json-node';
    if (options && options.expand !== false) {
      details.open = true;
    }

    var summary = document.createElement('summary');
    summary.className = 'json-summary';

    var label = isArray
      ? 'Array(' + entries.length + ')'
      : 'Object(' + entries.length + ')';

    if (key !== null && key !== undefined) {
      summary.innerHTML =
        '<span class="json-key">' + escapeHtml(JSON.stringify(String(key))) + '</span>' +
        '<span class="json-colon">: </span>' +
        '<span class="json-meta">' + escapeHtml(label) + '</span>';
    } else {
      summary.innerHTML = '<span class="json-meta">' + escapeHtml(label) + '</span>';
    }

    details.appendChild(summary);

    var children = document.createElement('div');
    children.className = 'json-children';

    entries.forEach(function (entry) {
      children.appendChild(renderNode(entry[0], entry[1], options));
    });

    if (!entries.length) {
      var empty = document.createElement('div');
      empty.className = 'json-line json-empty';
      empty.textContent = isArray ? '[]' : '{}';
      children.appendChild(empty);
    }

    details.appendChild(children);
    return details;
  }

  function renderNode(key, value, options) {
    if (value === null || typeof value !== 'object') {
      return renderPrimitiveLine(key, value);
    }

    return renderCollection(key, value, options);
  }

  function render(value, options) {
    options = options || {};
    var root = document.createElement('div');
    root.className = 'json-tree';

    if (value === null || typeof value !== 'object') {
      root.appendChild(renderPrimitiveLine(null, value));
      return root;
    }

    root.appendChild(renderCollection(null, value, options));
    return root;
  }

  function setAllExpanded(container, expanded) {
    if (!container) {
      return;
    }

    container.querySelectorAll('details.json-node').forEach(function (node) {
      node.open = expanded;
    });
  }

  global.JsonTree = {
    render: render,
    setAllExpanded: setAllExpanded
  };
}(window));
