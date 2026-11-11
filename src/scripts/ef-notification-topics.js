(function (global) {
  'use strict';

  var NOTIFICATION_PAGE_GROUPS = {
    users: {
      id: 'users',
      label: 'Users',
      prefixes: ['v2.users.'],
      excludePatterns: [
        /workforcemanagement/i,
        /\.wem\./i,
        /\.recordings/i,
        /\.export/i,
        /\.jobs/i,
        /coaching/i,
        /learning/i,
        /analytics/i,
        /preview/i,
        /summaries/i,
        /conversationsummary/i
      ],
      preferredTopics: [
        'v2.users.{id}.conversations',
        'v2.users.{id}.persistentconnection',
        'v2.users.{id}.alerting.alerts',
        'v2.users.{id}.presence',
        'v2.users.{id}.routingStatus',
        'v2.users.{id}.station',
        'v2.users.{id}.activity',
        'v2.users.{id}.voicemail.messages'
      ],
      defaultTopics: [
        'v2.users.{id}.conversations',
        'v2.users.{id}.persistentconnection',
        'v2.users.{id}.alerting.alerts'
      ],
      placeholderKeys: ['{id}', '{userId}']
    }
  };

  function normalizeAvailableTopics(payload) {
    var entities = Array.isArray(payload && payload.entities)
      ? payload.entities
      : Array.isArray(payload)
        ? payload
        : [];

    return entities
      .map(function (entry) {
        return {
          id: String(entry && entry.id || '').trim(),
          description: String(entry && (entry.description || entry.name) || '').trim()
        };
      })
      .filter(function (entry) {
        return entry.id;
      });
  }

  function topicMatchesGroup(topicId, group) {
    var i;
    if (!group || !group.prefixes) {
      return false;
    }
    var hasPrefix = false;
    for (i = 0; i < group.prefixes.length; i += 1) {
      if (topicId.indexOf(group.prefixes[i]) === 0) {
        hasPrefix = true;
        break;
      }
    }
    if (!hasPrefix) {
      return false;
    }
    for (i = 0; i < (group.excludePatterns || []).length; i += 1) {
      if (group.excludePatterns[i].test(topicId)) {
        return false;
      }
    }
    return true;
  }

  function filterTopicsForGroup(availableTopics, groupKey) {
    var group = NOTIFICATION_PAGE_GROUPS[groupKey];
    var normalized;
    var matching;
    var preferredSet;
    var preferred;
    var rest;

    if (!group) {
      return [];
    }

    normalized = normalizeAvailableTopics(availableTopics);
    matching = normalized.filter(function (topic) {
      return topicMatchesGroup(topic.id, group);
    });
    preferredSet = new Set(group.preferredTopics);

    preferred = group.preferredTopics
      .map(function (topicId) {
        var found = null;
        var j;
        for (j = 0; j < matching.length; j += 1) {
          if (matching[j].id === topicId) {
            found = matching[j];
            break;
          }
        }
        return found;
      })
      .filter(Boolean);

    rest = matching
      .filter(function (topic) {
        return !preferredSet.has(topic.id);
      })
      .sort(function (left, right) {
        return left.id.localeCompare(right.id);
      });

    return preferred.concat(rest);
  }

  function getDefaultTopicIds(groupKey, availableTopics) {
    var group = NOTIFICATION_PAGE_GROUPS[groupKey];
    var filtered;
    var availableIds;

    if (!group) {
      return [];
    }

    filtered = filterTopicsForGroup(availableTopics, groupKey);
    availableIds = new Set(filtered.map(function (topic) {
      return topic.id;
    }));

    return group.defaultTopics.filter(function (topicId) {
      return availableIds.has(topicId);
    });
  }

  function resolveEntityTopics(entityId, topicTemplates, options) {
    var normalizedEntityId = String(entityId || '').trim();
    var defaultTopics = (options && options.defaultTopics) || [];
    var placeholderKeys = (options && options.placeholderKeys) || ['{id}'];
    var templates;
    var i;
    var ph;
    var pattern;

    if (!normalizedEntityId) {
      throw new Error('Entity ID is required.');
    }

    templates = (Array.isArray(topicTemplates) && topicTemplates.length ? topicTemplates : defaultTopics)
      .map(function (topic) {
        return String(topic || '').trim();
      })
      .filter(Boolean);

    if (!templates.length) {
      throw new Error('At least one subscription topic is required.');
    }

    return templates.map(function (topic) {
      var resolvedTopic = topic;
      for (i = 0; i < placeholderKeys.length; i += 1) {
        ph = placeholderKeys[i];
        pattern = new RegExp(ph.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
        resolvedTopic = resolvedTopic.replace(pattern, normalizedEntityId);
      }
      return resolvedTopic;
    });
  }

  global.EfNotificationTopics = {
    NOTIFICATION_PAGE_GROUPS: NOTIFICATION_PAGE_GROUPS,
    normalizeAvailableTopics: normalizeAvailableTopics,
    filterTopicsForGroup: filterTopicsForGroup,
    getDefaultTopicIds: getDefaultTopicIds,
    resolveEntityTopics: resolveEntityTopics,
    topicMatchesGroup: topicMatchesGroup
  };
}(window));
