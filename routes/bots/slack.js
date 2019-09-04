const express = require('express');
const { createEventAdapter } = require('@slack/events-api');
const { WebClient } = require('@slack/web-api');
const moment = require('moment');

const router = express.Router();

function createSessionId(channel, user, ts) {
  return `${channel}-${user}-${ts}`;
}

module.exports = (params) => {
  const {
    config,
    witService,
    reservationService,
    sessionService,
  } = params;

  const slackEvents = createEventAdapter(config.slack.signingSecret);
  const slackWebClient = new WebClient(config.slack.token);

  router.use('/events', slackEvents.requestListener());

  async function processEvent(session, event) {

    const mention = /<@[A-Z0-9]+>/;
    const eventText = event.text.replace(mention, '').trim();

    let text = '';

    if (!eventText) {
      text = 'Hey!';
    } else {
      const entities = await witService.query(eventText);
      const { intent, customerName, reservationDateTime, numberOfGuests } = entities;

      if (!intent || intent !== 'reservation' || !customerName || !reservationDateTime || !numberOfGuests) {
        text = 'Sorry - could you rephrase that?';
        console.log(entities);
      } else {
        const reservationResult = await reservationService
          .tryReservation(moment(reservationDateTime).unix(), numberOfGuests, customerName);
        text = reservationResult.success || reservationResult.error;
      }
    }

    return slackWebClient.chat.postMessage({
      text,
      channel: session.context.slack.channel,
      thread_ts: session.context.slack.thread_ts,
      username: 'Resi',
    });
  }

  async function handleMention(event) {
    const sessionId = createSessionId(event.channel, event.user, event.thread_ts || event.ts);
    let session = sessionService.get(sessionId);

    if (!session) {
      session = sessionService.create(sessionId);

      session.context = {
        slack: {
          channel: event.channel,
          user: event.user,
          thread_ts: event.thread_ts || event.ts,
        },
      };
    }
    return processEvent(session, event);
  }

  async function handleMessage(event) {
    const sessionId = createSessionId(event.channel, event.user, event.thread_ts || event.ts);
    const session = sessionService.get(sessionId);
    if (!session) return false;
    return processEvent(session, event);
  }

  slackEvents.on('app_mention', handleMention);
  slackEvents.on('message', handleMessage);

  return router;
};
