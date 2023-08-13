const SLACK_WEBHOOK_URL = PropertiesService.getScriptProperties().getProperty('SLACK_WEBHOOK_URL');
const CONNPASS_SERIES_IDS = PropertiesService.getScriptProperties().getProperty('CONNPASS_SERIES_IDS').split(',');
const CONNPASS_API_BASE_URL = 'https://connpass.com/api/v1/event/';

const notifyEventsToSlack = () => {
  var today = new Date();
  const oneWeekLaterDate = getOneWeekLaterDate();
  // NOTE: today の年月だけだと、月末などの場合にイベントが少なくなってしまうため、oneWeekLaterDate が翌月だったら翌月のイベントも取得できるようにしている
  const yearMonths = [...new Set([getYearMonth(today), getYearMonth(oneWeekLaterDate)])];
  const eventsBySeries = fetchEventsBySeries({
    yearMonths: yearMonths,
    fromDate: today,
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

function getYearMonth(date) {
  var year = date.getFullYear();
  var month = date.getMonth() + 1;

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

const fetchEventsBySeries = (params) => {
  const eventsBySeriesAndYearMonth = CONNPASS_SERIES_IDS.flatMap((seriesId) => {
    return params.yearMonths.map((yearMonth) => {
      return fetchEvents(seriesId, { ...params, yearMonth });
    });
  }).filter(obj => Object.keys(obj).length && obj.events.length);
  return mergeEventsBySeries(eventsBySeriesAndYearMonth);
};

const fetchEvents = (seriesId, filterParams) => {
  Utilities.sleep(5000);

  const response = UrlFetchApp.fetch(constructRequestUrl({ yearMonth: filterParams.yearMonth, seriesId: seriesId }));
  const json = JSON.parse(response.getContentText());
  if (json.events.length === 0) return {};

  let seriesTitle;
  const filteredEvents = filterEvents(json.events, filterParams);
  const events = filteredEvents.map((event) => {
    seriesTitle = event.series.title;
    return {
      title: event.title,
      url: event.event_url,
      startedAt: event.started_at,
      endedAt: event.ended_at
    };
  });

  return { id: seriesId, title: seriesTitle, events };
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
  return `${CONNPASS_API_BASE_URL}?ym=${params.yearMonth}&series_id=${params.seriesId}&order=2`;
};

const mergeEventsBySeries = (eventsBySeriesAndYearMonth) => {
  return eventsBySeriesAndYearMonth.reduce((result, currentSeries) => {
    const existingSeries = result.find(series => series.id === currentSeries.id);

    if (existingSeries) {
      existingSeries.events = [...new Set([...existingSeries.events, ...currentSeries.events])];
    } else {
      result.push({ id: currentSeries.id, title: currentSeries.title, events: [...currentSeries.events] });
    }

    return result;
  }, []);
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
