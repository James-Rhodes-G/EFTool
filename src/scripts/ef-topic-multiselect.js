(function (global) {
  'use strict';

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function renderTopicMultiselect(options) {
    options = options || {};
    var classPrefix = options.classPrefix || 'user-notifications-topics';
    var label = options.label || 'Subscription Topics';
    var topics = options.topics || [];
    var emptyMessage = options.emptyMessage || 'No user notification topics are currently available from Genesys Cloud.';
    var selectedTopics = topics.filter(function (topic) {
      return topic.selected;
    });
    var optionsHtml;
    var i;
    var topic;

    if (!topics.length) {
      return (
        '<div class="field-container notification-topic-picker notification-topic-picker--empty">' +
        '<label class="field-label">' + escapeHtml(label) + '</label>' +
        '<p class="muted">' + escapeHtml(emptyMessage) + '</p>' +
        '<div class="notification-topic-selected">' +
        '<div class="notification-topic-selected__label">Selected topics</div>' +
        '<ul class="notification-topic-selected__list"><li class="muted">No topics selected.</li></ul>' +
        '</div></div>'
      );
    }

    optionsHtml = '';
    for (i = 0; i < topics.length; i += 1) {
      topic = topics[i];
      optionsHtml +=
        '<label class="notification-topic-option">' +
        '<input type="checkbox" class="' + escapeHtml(classPrefix) + '-topic-option" ' +
        'data-topic-id="' + escapeHtml(topic.id) + '" value="' + escapeHtml(topic.id) + '" ' +
        (topic.selected ? 'checked' : '') + '>' +
        '<span class="notification-topic-option__id">' + escapeHtml(topic.id) + '</span>' +
        (topic.description
          ? '<span class="notification-topic-option__description">' + escapeHtml(topic.description) + '</span>'
          : '') +
        '</label>';
    }

    return (
      '<div class="field-container notification-topic-picker">' +
      '<label class="field-label">' + escapeHtml(label) + '</label>' +
      '<details class="notification-topic-multiselect ' + escapeHtml(classPrefix) + '-multiselect">' +
      '<summary class="notification-topic-multiselect__summary">' +
      '<span class="notification-topic-multiselect__summary-text">' +
      '<span class="notification-topic-multiselect__summary-title">Browse available topics</span>' +
      '<span class="notification-topic-multiselect__summary-meta">' +
      escapeHtml(String(selectedTopics.length)) + ' selected · ' + escapeHtml(String(topics.length)) + ' available' +
      '</span></span>' +
      '<span class="notification-topic-multiselect__chevron" aria-hidden="true"></span>' +
      '</summary>' +
      '<div class="notification-topic-multiselect__options">' + optionsHtml + '</div>' +
      '</details>' +
      '<div class="notification-topic-selected">' +
      '<div class="notification-topic-selected__label">Selected topics</div>' +
      '<ul class="notification-topic-selected__list" data-role="selected-topic-list">' +
      (selectedTopics.length
        ? selectedTopics.map(function (t) {
          return '<li><code>' + escapeHtml(t.id) + '</code></li>';
        }).join('')
        : '<li class="muted">No topics selected.</li>') +
      '</ul></div></div>'
    );
  }

  function readSelectedTopicIds(rootEl, classPrefix) {
    if (!rootEl) {
      return [];
    }
    classPrefix = classPrefix || 'user-notifications-topics';
    return Array.prototype.slice
      .call(rootEl.querySelectorAll('.' + classPrefix + '-topic-option:checked'))
      .map(function (input) {
        return input.getAttribute('data-topic-id') || input.value;
      })
      .filter(Boolean);
  }

  function updateSelectedListSummary(rootEl, classPrefix) {
    var listEl;
    var metaEl;
    var selected;
    var details;
    var i;
    var inputs;

    if (!rootEl) {
      return;
    }
    classPrefix = classPrefix || 'user-notifications-topics';
    listEl = rootEl.querySelector('[data-role="selected-topic-list"]');
    details = rootEl.querySelector('.' + classPrefix + '-multiselect');
    metaEl = details && details.querySelector('.notification-topic-multiselect__summary-meta');
    inputs = rootEl.querySelectorAll('.' + classPrefix + '-topic-option');
    selected = readSelectedTopicIds(rootEl, classPrefix);

    if (listEl) {
      if (!selected.length) {
        listEl.innerHTML = '<li class="muted">No topics selected.</li>';
      } else {
        listEl.innerHTML = selected.map(function (id) {
          return '<li><code>' + escapeHtml(id) + '</code></li>';
        }).join('');
      }
    }

    if (metaEl) {
      metaEl.textContent = selected.length + ' selected · ' + inputs.length + ' available';
    }
  }

  global.EfTopicMultiselect = {
    escapeHtml: escapeHtml,
    render: renderTopicMultiselect,
    readSelectedTopicIds: readSelectedTopicIds,
    updateSelectedListSummary: updateSelectedListSummary
  };
}(window));
