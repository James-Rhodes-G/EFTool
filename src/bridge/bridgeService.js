'use strict';

function safeString(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}

function asLower(value) {
  return safeString(value).toLowerCase();
}

function getParticipants(conversation) {
  if (!conversation || typeof conversation !== 'object') {
    return [];
  }
  if (Array.isArray(conversation.participants)) {
    return conversation.participants;
  }
  if (conversation.participants && typeof conversation.participants === 'object') {
    return Object.values(conversation.participants);
  }
  return [];
}

function findParticipantByPurpose(conversation, purposeNames) {
  const list = Array.isArray(purposeNames) ? purposeNames : [purposeNames];
  const targets = list.map(asLower);
  return getParticipants(conversation).find((participant) => {
    const purpose = asLower(participant && (participant.purpose || participant.participantPurpose || participant.type || participant.participantType));
    return targets.includes(purpose);
  }) || null;
}

function hasActiveEndTime(conversation) {
  return Boolean(conversation && conversation.endTime);
}

function serializeConversation(conversation) {
  if (!conversation || typeof conversation !== 'object') {
    return null;
  }

  return {
    id: conversation.id || conversation.conversationId || null,
    startTime: conversation.startTime || null,
    endTime: conversation.endTime || null,
    participantCount: getParticipants(conversation).length,
    raw: conversation,
  };
}

function buildUpdatePayload({ dataTableKeyField, dataTableAnchorField, dnis, currentConversationId }) {
  const payload = {};
  payload[dataTableKeyField] = dnis;
  payload[dataTableAnchorField] = currentConversationId;
  return payload;
}

async function evaluateBridgeRequest(input, genesysClient, config) {
  const conferenceConversationId = safeString(input.conferenceConversationId || input.conferenceConversationID || input.bridgeAnchorConversationId);
  const currentConversationId = safeString(input.currentConversationId || input.currentConversationID);
  const dnis = safeString(input.dnis || input.DNIS || input.bridgeDnis);

  if (!conferenceConversationId) {
    throw new Error('conferenceConversationId is required');
  }
  if (!currentConversationId) {
    throw new Error('currentConversationId is required');
  }
  if (!dnis) {
    throw new Error('DNIS is required');
  }

  const trace = [];
  const dataTableId = safeString(config.dataTableId);
  const dataTableKeyField = safeString(config.dataTableKeyField) || 'dnis';
  const dataTableAnchorField = safeString(config.dataTableAnchorField) || 'conferenceConversationId';

  trace.push({ step: 'input', conferenceConversationId, currentConversationId, dnis });

  const conferenceConversationResponse = await genesysClient.getConversation(conferenceConversationId);
  const conferenceConversation = conferenceConversationResponse.body || conferenceConversationResponse;
  trace.push({ step: 'conferenceConversationFetched', conversation: serializeConversation(conferenceConversation) });

  const currentConversationResponse = await genesysClient.getConversation(currentConversationId);
  const currentConversation = currentConversationResponse.body || currentConversationResponse;
  trace.push({ step: 'currentConversationFetched', conversation: serializeConversation(currentConversation) });

  const active = !hasActiveEndTime(conferenceConversation);
  const conferenceAcdParticipant = findParticipantByPurpose(conferenceConversation, ['acd', 'queue']);
  const currentAcdParticipant = findParticipantByPurpose(currentConversation, ['acd', 'queue']);
  const currentCustomerParticipant = findParticipantByPurpose(currentConversation, ['customer', 'external', 'participant']);

  if (active) {
    const actionOutcome = {
      merged: false,
      mergeAttempted: false,
      mergeActionConfigured: Boolean(config.mergeActionPathTemplate),
      disconnectActionConfigured: Boolean(config.disconnectActionPathTemplate),
      mergeResponse: null,
      disconnectResponse: null,
    };

    if (config.disconnectActionPathTemplate) {
      const disconnectVars = {
        conferenceConversationId,
        currentConversationId,
        dnis,
        acdParticipantId: (conferenceAcdParticipant && (conferenceAcdParticipant.id || conferenceAcdParticipant.participantId)) || '',
        currentParticipantId: (currentCustomerParticipant && (currentCustomerParticipant.id || currentCustomerParticipant.participantId)) || (currentAcdParticipant && (currentAcdParticipant.id || currentAcdParticipant.participantId)) || '',
      };
      actionOutcome.disconnectResponse = await genesysClient.runConfiguredAction({
        method: config.disconnectActionMethod || 'POST',
        template: config.disconnectActionPathTemplate,
        vars: disconnectVars,
        body: config.disconnectActionBodyTemplate ? JSON.parse(JSON.stringify(config.disconnectActionBodyTemplate)) : undefined,
      });
    }

    if (config.mergeActionPathTemplate) {
      const mergeVars = {
        conferenceConversationId,
        currentConversationId,
        dnis,
        acdParticipantId: (conferenceAcdParticipant && (conferenceAcdParticipant.id || conferenceAcdParticipant.participantId)) || '',
        currentParticipantId: (currentCustomerParticipant && (currentCustomerParticipant.id || currentCustomerParticipant.participantId)) || (currentAcdParticipant && (currentAcdParticipant.id || currentAcdParticipant.participantId)) || '',
      };
      actionOutcome.mergeAttempted = true;
      actionOutcome.mergeResponse = await genesysClient.runConfiguredAction({
        method: config.mergeActionMethod || 'POST',
        template: config.mergeActionPathTemplate,
        vars: mergeVars,
        body: config.mergeActionBodyTemplate || undefined,
      });
      actionOutcome.merged = true;
    }

    trace.push({
      step: 'activeBridgeDetected',
      conferenceEndTime: conferenceConversation && conferenceConversation.endTime ? conferenceConversation.endTime : null,
      acdParticipantId: conferenceAcdParticipant && (conferenceAcdParticipant.id || conferenceAcdParticipant.participantId) || null,
      currentParticipantId: currentCustomerParticipant && (currentCustomerParticipant.id || currentCustomerParticipant.participantId) || (currentAcdParticipant && (currentAcdParticipant.id || currentAcdParticipant.participantId)) || null,
      actionOutcome,
    });

    return {
      status: 'ACTIVE',
      conferenceConversationId,
      currentConversationId,
      dnis,
      trace,
      conferenceConversation: serializeConversation(conferenceConversation),
      currentConversation: serializeConversation(currentConversation),
      participantHints: {
        conferenceAcdParticipantId: conferenceAcdParticipant && (conferenceAcdParticipant.id || conferenceAcdParticipant.participantId) || null,
        currentParticipantId: currentCustomerParticipant && (currentCustomerParticipant.id || currentCustomerParticipant.participantId) || (currentAcdParticipant && (currentAcdParticipant.id || currentAcdParticipant.participantId)) || null,
      },
    };
  }

  const updatePayload = buildUpdatePayload({
    dataTableKeyField,
    dataTableAnchorField,
    dnis,
    currentConversationId,
  });

  let dataTableUpdateResponse = null;
  if (dataTableId) {
    dataTableUpdateResponse = await genesysClient.updateDataTableRow(dataTableId, dnis, updatePayload);
  }

  trace.push({
    step: 'bridgeEnded',
    conferenceEndTime: conferenceConversation && conferenceConversation.endTime ? conferenceConversation.endTime : null,
    updatePayload,
    dataTableUpdated: Boolean(dataTableId),
  });

  return {
    status: 'NEW',
    conferenceConversationId,
    currentConversationId,
    dnis,
    trace,
    conferenceConversation: serializeConversation(conferenceConversation),
    currentConversation: serializeConversation(currentConversation),
    updatePayload,
    dataTableUpdateResponse: dataTableUpdateResponse ? dataTableUpdateResponse.body || dataTableUpdateResponse : null,
  };
}

module.exports = {
  evaluateBridgeRequest,
  getParticipants,
  findParticipantByPurpose,
  hasActiveEndTime,
  serializeConversation,
};
