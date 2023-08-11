// ref. https://connpass.com/about/api/

const SERIESES_SHEET = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('serieses');
// わざわざシートに書かかなくてもいいけど、GitHub に公開する前提なので
const SLACK_WEBHOOK_URL = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('slack_webhook_url').getRange('A1').getValue();

const CONNPASS_API_BASE_URL = 'https://connpass.com/api/v1/event/';

const notifyEventsToSlack = () => {
  const oneWeekLaterDate = getOneWeekLaterDate();
  const eventsBySeries = fetchConnpassEventsBySeries({
    yearMonth: getCurrentYearMonth(),
    fromDate: new Date(),
    toDate: oneWeekLaterDate,
  });
  if (!eventsBySeries.length) return;

  // NOTE: 一度のメッセージ内容が大きすぎると？エラーで送れないため
  eventsBySeries.forEach((series) => {
    const options = {
      'method': 'post',
      'contentType': 'application/json',
      'payload': constructSlackWebhookPayload(series)
    };

    UrlFetchApp.fetch(SLACK_WEBHOOK_URL, options);
  });
};

const fetchConnpassEventsBySeries = (filterParams) => {
  const ids = getSeriesIds();
  return getSeriesIds().map((seriesId) => {
    return fetchConnpassEvents(seriesId, filterParams);
  }).filter(obj => Object.keys(obj).length && obj.events.length);
};

const getSeriesIds = () => {
  const range = SERIESES_SHEET.getRange(2, 1, SERIESES_SHEET.getLastRow()-1);
  return range.getValues().flat();
};

const fetchConnpassEvents = (seriesId, filterParams) => {
  Utilities.sleep(5000);

  const response = UrlFetchApp.fetch(constructRequestUrl({ yearMonth: filterParams.yearMonth, seriesId: seriesId }));
  const json = JSON.parse(response.getContentText());
  if (json.events.length === 0) return {};

  let seriesTitle;
  const filteredEvents = filterEvents(json.events, filterParams);
  const events = filteredEvents.map((event) => {
    seriesTitle = event.series.title;
    return {
      seriesTitle: event.series.title,
      title: event.title,
      url: event.event_url,
      startedAt: event.started_at,
      endedAt: event.ended_at
    };
  });

  return { id: seriesId, title: seriesTitle, events };
};

function getCurrentYearMonth() {
  var today = new Date();
  var year = today.getFullYear();
  var month = today.getMonth() + 1;

  if (month < 10) {
    month = '0' + month;
  }

  return year + month;
};

const getOneWeekLaterDate = () => {
  const currentDate = new Date();
  const oneWeekLater = new Date(currentDate);
  oneWeekLater.setDate(oneWeekLater.getDate() + 7);

  return oneWeekLater;
};

// NOTE: API のクエリでは期間指定ができないため
/**
 * @param {event[]} events connpassのイベント一覧
 * @param {object} filterParams イベントをフィルタするためのパラメータ (fromDate, toDate)
 */
const filterEvents = (events, filterParams) => {
  return events.filter((event) => {
    const startedAtDate = new Date(event.started_at);
    if (!filterParams.fromDate && !filterParams.toDate) return true;

    if (filterParams.fromDate) {
      return !filterParams.toDate ? startedAtDate >= filterParams.fromDate : 
        startedAtDate >= filterParams.fromDate && startedAtDate <= filterParams.toDate;
    }

    if (filterParams.toDate) {
      return startedAtDate <= filterParams.toDate;
    }
  });
};

const constructRequestUrl = (params) => {
  return `${CONNPASS_API_BASE_URL}?ym=${params.yearMonth}&series_id=${params.seriesId}`;
};

const constructSlackWebhookPayload = (series) => {
  const jsonData = {
    'username': 'connpass-events-notifier',
    'icon_emoji': ':calendar:',
    'blocks': consructSlackMessageBlocks(series),
  };
  return JSON.stringify(jsonData);
};

// ref. https://app.slack.com/block-kit-builder
const consructSlackMessageBlocks = (series) => {
  let blocks = [
    {
      'type': 'header',
      'text': {
        'type': 'plain_text',
        'text': series.title
      }
    }
  ]

  const eventBlocks = series.events.flatMap((event) => {
    return [
      {
        'type': 'context',
        'elements': [
          {
            'type': 'plain_text',
            'text': event.title
          }
        ]
      },
      {
        'type': 'section',
        'fields': [
          {
            'type': 'plain_text',
            'text': `開始日時: ${formatDateTime(event.startedAt)}`
          },
          {
            'type': 'plain_text',
            'text': `終了日時: ${formatDateTime(event.endedAt)}`
          },
          {
            'type': 'mrkdwn',
            'text': `イベントページ: <${event.url}>`
          }
        ]
      },
      {
        'type': 'divider'
      }
    ];
  });

  return blocks.concat(eventBlocks);
};

const formatDateTime = (dateTime) => {
  const dateObj = new Date(dateTime);
  const year = dateObj.getFullYear();
  const month = String(dateObj.getMonth() + 1).padStart(2, '0');
  const day = String(dateObj.getDate()).padStart(2, '0');
  const hours = String(dateObj.getHours()).padStart(2, '0');
  const minutes = String(dateObj.getMinutes()).padStart(2, '0');

  return `${year}-${month}-${day} ${hours}:${minutes}`;
}
