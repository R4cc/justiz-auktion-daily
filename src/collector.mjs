import {
  mkdir,
  readFile,
  writeFile
} from 'node:fs/promises';

import path from 'node:path';

import {
  selectDailySet,
  utcDateKey
} from './core.mjs';

import {
  readArchive,
  readDailyGames,
  readDailyUsedIds,
  readQueue,
  saveDailyGame,
  upsertAuctions,
  writeQueue
} from './database.mjs';

const BASE_URL =
  'https://www.justiz-auktion.de';

const USER_AGENT =
  'JUSTIZGUESSR/1.0 (+daily public auction indexer; respectful adaptive fetches)';

const DAILY_SELECTION_VERSION =
  3;

export const ROLLING_QUEUE_VERSION =
  5;

const LEGACY_LISTING_PAGE_SIZE =
  10;

const LISTING_PAGE_SIZE =
  50;

const DEFAULT_MAX_LISTING_PAGES =
  250;

const DEFAULT_MIN_INTERVAL_MS =
  250;

const DEFAULT_INITIAL_INTERVAL_MS =
  750;

const DEFAULT_MAX_INTERVAL_MS =
  120_000;

const IDLE_POLL_MS =
  30_000;

function emptyQueue() {
  return {
    version:
      ROLLING_QUEUE_VERSION,

    updatedAt:
      null,

    lastRequestAt:
      null,

    lastDiscoveryAt:
      null,

    needsFullDiscovery:
      false,

    listingSession:
      {},

    discovery:
      null,

    throttle:
      null,

    tasks:
      []
  };
}

function normalizeQueue(
  queue
) {
  queue.tasks ||= [];
  queue.listingSession ||= {};

  if (
    queue.version !==
    ROLLING_QUEUE_VERSION
  ) {
    queue.needsFullDiscovery =
      true;
  }

  queue.needsFullDiscovery =
    Boolean(
      queue.needsFullDiscovery
    );

  return queue;
}

function decodeEntities(
  value = ''
) {
  const named = {
    amp: '&',
    quot: '"',
    apos: "'",
    lt: '<',
    gt: '>',
    nbsp: ' ',
    auml: 'ä',
    ouml: 'ö',
    uuml: 'ü',
    Auml: 'Ä',
    Ouml: 'Ö',
    Uuml: 'Ü',
    szlig: 'ß',
    euro: '€',
    lowbar: '_',
    period: '.',
    comma: ',',
    colon: ':',
    sol: '/',
    frasl: '/',
    permil: '‰',
    NewLine: '\n'
  };

  return value.replace(
    /&(#x?[0-9a-f]+|[a-z]+);/gi,
    (
      _,
      entity
    ) => {
      if (
        entity[0] === '#'
      ) {
        const hex =
          entity[1]
            ?.toLowerCase() ===
          'x';

        return String.fromCodePoint(
          Number.parseInt(
            entity.slice(
              hex
                ? 2
                : 1
            ),
            hex
              ? 16
              : 10
          )
        );
      }

      return named[
        entity
      ] ??
        named[
          entity.toLowerCase()
        ] ??
        `&${entity};`;
    }
  );
}

function cleanText(
  value = ''
) {
  return decodeEntities(
    value
  )
    .replace(
      /<script\b[^>]*>[\s\S]*?<\/script>/gi,
      ' '
    )
    .replace(
      /<style\b[^>]*>[\s\S]*?<\/style>/gi,
      ' '
    )
    .replace(
      /<br\s*\/?>|<\/(?:p|div|h\d|li|tr)>/gi,
      '\n'
    )
    .replace(
      /<[^>]+>/g,
      ' '
    )
    .replace(
      /[ \t]+/g,
      ' '
    )
    .replace(
      /\n\s+/g,
      '\n'
    )
    .replace(
      /\n{3,}/g,
      '\n\n'
    )
    .trim();
}

function parseMoney(
  value
) {
  if (!value) {
    return null;
  }

  const normalized =
    value
      .replace(
        /\./g,
        ''
      )
      .replace(
        ',',
        '.'
      )
      .replace(
        /[^\d.-]/g,
        ''
      );

  const amount =
    Number(
      normalized
    );

  return Number.isFinite(
    amount
  )
    ? amount
    : null;
}

function zonedLocalToUtc(
  value,
  timeZone =
    'Europe/Berlin'
) {
  const match =
    value?.match(
      /(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?/
    );

  if (!match) {
    return null;
  }

  const [
    ,
    day,
    month,
    year,
    hour,
    minute,
    second = '00'
  ] = match;

  const desired =
    Date.UTC(
      +year,
      +month - 1,
      +day,
      +hour,
      +minute,
      +second
    );

  const parts =
    new Intl.DateTimeFormat(
      'en-CA',
      {
        timeZone,
        year:
          'numeric',
        month:
          '2-digit',
        day:
          '2-digit',
        hour:
          '2-digit',
        minute:
          '2-digit',
        second:
          '2-digit',
        hourCycle:
          'h23'
      }
    )
      .formatToParts(
        new Date(
          desired
        )
      )
      .reduce(
        (
          all,
          part
        ) => ({
          ...all,
          [part.type]:
            part.value
        }),
        {}
      );

  const observed =
    Date.UTC(
      +parts.year,
      +parts.month -
        1,
      +parts.day,
      +parts.hour,
      +parts.minute,
      +parts.second
    );

  return new Date(
    desired -
    (
      observed -
      desired
    )
  ).toISOString();
}

function inferCategory(
  title,
  description = ''
) {
  const groups = [
    [
      'Fahrzeuge',
      /\b(pkw|auto|fahrzeug|bmw|mercedes|volkswagen|vw|audi|motorrad|roller)\b/
    ],
    [
      'Fahrräder',
      /\b(fahrrad|mountainbike|e-bike|ebike)\b/
    ],
    [
      'Schmuck & Uhren',
      /\b(ring|kette|armreif|armband|schmuck|gold|silber|uhr|rolex)\b/
    ],
    [
      'Elektronik',
      /\b(notebook|laptop|computer|monitor|fernseher|smartphone|iphone|tablet|kamera|konsole)\b/
    ],
    [
      'Werkzeuge',
      /\b(werkzeug|bohr|makita|hilti|bosch|säge|schleifer|maschine)\b/
    ],
    [
      'Mode',
      /\b(sneaker|schuhe|jacke|shirt|kleidung|jeans|tasche)\b/
    ],
    [
      'Sammlerstücke',
      /\b(münze|sammlung|figur|lego|modell|antiqu|briefmarke)\b/
    ],
    [
      'Möbel & Wohnen',
      /\b(möbel|schrank|tisch|stuhl|sofa|lampe|porzellan)\b/
    ],
    [
      'Kosmetik',
      /\b(parfum|eau de toilette|kosmetik)\b/
    ]
  ];

  const titleValue =
    title.toLowerCase();

  const titleMatch =
    groups.find(
      ([
        ,
        matcher
      ]) =>
        matcher.test(
          titleValue
        )
    );

  if (titleMatch) {
    return titleMatch[
      0
    ];
  }

  const descriptionValue =
    description
      .toLowerCase()
      .replace(
        /\b\d{1,2}(?::\d{2})?\s*uhr\b/g,
        ' '
      );

  return groups.find(
    ([
      ,
      matcher
    ]) =>
      matcher.test(
        descriptionValue
      )
  )?.[0] ||
    'Sonstiges';
}

export function extractListingUrls(
  html
) {
  const urls =
    new Set();

  const pattern =
    /href=["']([^"']*?-(\d{5,8})(?:[?#][^"']*)?)["']/gi;

  for (
    const match of
      html.matchAll(
        pattern
      )
  ) {
    const raw =
      decodeEntities(
        match[1]
      );

    if (
      /auktion_(?:drucken|gebote)/i
        .test(raw) ||
      /uplimg/i
        .test(raw)
    ) {
      continue;
    }

    try {
      const url =
        new URL(
          raw,
          BASE_URL
        );

      if (
        url.origin ===
        BASE_URL
      ) {
        urls.add(
          url.href
        );
      }
    } catch {}
  }

  return [
    ...urls
  ];
}

export function parseAuctionPage(
  html,
  url
) {
  const text =
    cleanText(html);

  const id =
    Number(
      text.match(
        /Auktion ID\s*(\d+)/i
      )?.[1] ||
      url.match(
        /-(\d{5,8})(?:\D|$)/
      )?.[1]
    );

  if (!id) {
    throw new Error(
      `Could not find auction ID for ${url}`
    );
  }

  const heading =
    html.match(
      /<h2\b[^>]*class=["'][^"']*auktionstitel[^"']*["'][^>]*>([\s\S]*?)<\/h2>/i
    )?.[1];

  const titleFallback =
    html.match(
      /<title\b[^>]*>([\s\S]*?)<\/title>/i
    )?.[1]
      ?.replace(
        /\s*\(#\d+\).*$/s,
        ''
      );

  const title =
    cleanText(
      heading ||
      titleFallback ||
      `Auktion #${id}`
    );

  const startBid =
    parseMoney(
      text.match(
        /Startgebot:\s*([\d.,]+)\s*€/i
      )?.[1]
    );

  const currentBid =
    parseMoney(
      text.match(
        /Aktuelles Gebot:\s*([\d.,]+)\s*€/i
      )?.[1]
    );

  const bidCount =
    Number(
      text.match(
        /Anzahl Gebote\s*(\d+)/i
      )?.[1] ||
      0
    );

  const endText =
    text.match(
      /Endet am:\s*(\d{2}\.\d{2}\.\d{4}\s+\d{2}:\d{2}(?::\d{2})?)/i
    )?.[1];

  const condition =
    text.match(
      /Zustand:\s*([^\n]+)/i
    )?.[1]
      ?.trim() ||
    'Keine Angabe';

  const fulfillment =
    text.match(
      /Versand:\s*([^\n]+)/i
    )?.[1]
      ?.trim() ||
    text.match(
      /Versandart:\s*([^\n]+)/i
    )?.[1]
      ?.trim() ||
    'Siehe Auktion';

  const location =
    text.match(
      /Artikelstandort:\s*([^\n]+)/i
    )?.[1]
      ?.trim() ||
    null;

  const descriptionHtml =
    html.match(
      /Artikelbeschreibung[\s\S]*?<\/h3>([\s\S]*?)(?:<h3\b[^>]*>|<div\b[^>]*class=["'][^"']*details)/i
    )?.[1] ||
    '';

  const description =
    cleanText(
      descriptionHtml
    ).slice(
      0,
      1800
    ) ||
    `${condition}. Weitere Angaben auf der Originalauktion.`;

  const imageUrls = [];

  const imagePattern =
    /(?:src|href)=["']([^"']*uplimg\/[^"']+?\.(?:jpe?g|png|webp))(?:\?[^"']*)?["']/gi;

  const decodedHtml =
    decodeEntities(
      html
    );

  for (
    const match of
      decodedHtml.matchAll(
        imagePattern
      )
  ) {
    const raw =
      match[1];

    if (
      /\/tn\//i
        .test(raw) ||
      /tn\d+_/i
        .test(raw)
    ) {
      continue;
    }

    try {
      const absolute =
        new URL(
          raw,
          BASE_URL
        ).href;

      if (
        new URL(
          absolute
        ).origin ===
          BASE_URL &&
        !imageUrls.includes(
          absolute
        )
      ) {
        imageUrls.push(
          absolute
        );
      }
    } catch {}
  }

  return {
    id,
    title,
    description,

    category:
      inferCategory(
        title,
        description
      ),

    sourceImages:
      imageUrls,

    startBid:
      startBid ??
      0,

    currentBid:
      currentBid ??
      0,

    finalPrice:
      endText &&
      Date.parse(
        zonedLocalToUtc(
          endText
        )
      ) <= Date.now()
        ? currentBid
        : null,

    bidCount,

    startAt:
      null,

    endAt:
      zonedLocalToUtc(
        endText
      ),

    condition,
    fulfillment,
    location,
    url,

    capturedAt:
      new Date()
        .toISOString()
  };
}

export function parseAuctionStart(
  html
) {
  const text =
    cleanText(html);

  const value =
    text.match(
      /Starttermin\s*(\d{2}\.\d{2}\.\d{4})\s*-\s*(\d{2}:\d{2}(?::\d{2})?)/i
    );

  return value
    ? zonedLocalToUtc(
        `${value[1]} ${value[2]}`
      )
    : null;
}

function createHttpError(
  url,
  response
) {
  const error =
    new Error(
      `${url} returned HTTP ${response.status}`
    );

  error.status =
    response.status;

  const retryAfter =
    response.headers.get(
      'retry-after'
    );

  if (retryAfter) {
    const seconds =
      Number(
        retryAfter
      );

    error.retryAfterMs =
      Number.isFinite(
        seconds
      )
        ? seconds *
          1000
        : Math.max(
            0,
            Date.parse(
              retryAfter
            ) -
            Date.now()
          );
  }

  return error;
}

async function fetchText(
  url,
  fetchImpl
) {
  const response =
    await fetchImpl(
      url,
      {
        headers: {
          'user-agent':
            USER_AGENT,

          accept:
            'text/html,application/xhtml+xml'
        },

        redirect:
          'error',

        signal:
          AbortSignal.timeout(
            20_000
          )
      }
    );

  if (!response.ok) {
    throw createHttpError(
      url,
      response
    );
  }

  return response.text();
}

function parseHtmlAttributes(
  source = ''
) {
  const attributes = {};

  const pattern =
    /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

  for (
    const match of
      source.matchAll(
        pattern
      )
  ) {
    attributes[
      match[1]
        .toLowerCase()
    ] =
      decodeEntities(
        match[2] ??
        match[3] ??
        match[4] ??
        ''
      );
  }

  return attributes;
}

function optionValue(
  attributes,
  body
) {
  return attributes.value ??
    cleanText(
      body
    );
}

function selectedValue(
  selectBody
) {
  const options =
    [
      ...selectBody.matchAll(
        /<option\b([^>]*)>([\s\S]*?)<\/option>/gi
      )
    ].map(
      match => {
        const attributes =
          parseHtmlAttributes(
            match[1]
          );

        return {
          attributes,

          value:
            optionValue(
              attributes,
              match[2]
            )
        };
      }
    );

  return options.find(
    option =>
      Object.hasOwn(
        option.attributes,
        'selected'
      )
  )?.value ??
    options[0]?.value ??
    '';
}

function extractPageSizePreference(
  html,
  currentUrl,
  pageSize =
    LISTING_PAGE_SIZE
) {
  for (
    const formMatch of
      html.matchAll(
        /<form\b([^>]*)>([\s\S]*?)<\/form>/gi
      )
  ) {
    const formAttributes =
      parseHtmlAttributes(
        formMatch[1]
      );

    const formBody =
      formMatch[2];

    const selects =
      [
        ...formBody.matchAll(
          /<select\b([^>]*)>([\s\S]*?)<\/select>/gi
        )
      ];

    let pageSizeField =
      null;

    for (
      const selectMatch of
        selects
    ) {
      const attributes =
        parseHtmlAttributes(
          selectMatch[1]
        );

      if (
        !attributes.name
      ) {
        continue;
      }

      const values =
        [
          ...selectMatch[2]
            .matchAll(
              /<option\b([^>]*)>([\s\S]*?)<\/option>/gi
            )
        ].map(
          optionMatch =>
            optionValue(
              parseHtmlAttributes(
                optionMatch[1]
              ),
              optionMatch[2]
            )
        );

      if (
        values.includes(
          String(
            pageSize
          )
        ) &&
        values.includes(
          String(
            LEGACY_LISTING_PAGE_SIZE
          )
        )
      ) {
        pageSizeField =
          attributes.name;

        break;
      }
    }

    if (!pageSizeField) {
      continue;
    }

    const params =
      new URLSearchParams();

    for (
      const inputMatch of
        formBody.matchAll(
          /<input\b([^>]*)>/gi
        )
    ) {
      const attributes =
        parseHtmlAttributes(
          inputMatch[1]
        );

      const name =
        attributes.name;

      const type =
        (
          attributes.type ||
          'text'
        ).toLowerCase();

      if (
        !name ||
        Object.hasOwn(
          attributes,
          'disabled'
        ) ||
        [
          'file',
          'reset',
          'button'
        ].includes(type)
      ) {
        continue;
      }

      if (
        [
          'checkbox',
          'radio'
        ].includes(
          type
        ) &&
        !Object.hasOwn(
          attributes,
          'checked'
        )
      ) {
        continue;
      }

      params.append(
        name,
        attributes.value ??
        ''
      );
    }

    for (
      const selectMatch of
        selects
    ) {
      const attributes =
        parseHtmlAttributes(
          selectMatch[1]
        );

      if (
        !attributes.name ||
        Object.hasOwn(
          attributes,
          'disabled'
        )
      ) {
        continue;
      }

      params.set(
        attributes.name,
        selectedValue(
          selectMatch[2]
        )
      );
    }

    for (
      const buttonMatch of
        formBody.matchAll(
          /<button\b([^>]*)>[\s\S]*?<\/button>/gi
        )
    ) {
      const attributes =
        parseHtmlAttributes(
          buttonMatch[1]
        );

      if (
        attributes.name &&
        !Object.hasOwn(
          attributes,
          'disabled'
        )
      ) {
        params.append(
          attributes.name,
          attributes.value ??
          ''
        );
      }
    }

    params.set(
      pageSizeField,
      String(
        pageSize
      )
    );

    return {
      action:
        new URL(
          formAttributes.action ||
          currentUrl,
          currentUrl
        ).href,

      method:
        (
          formAttributes.method ||
          'GET'
        ).toUpperCase(),

      params:
        [
          ...params.entries()
        ]
    };
  }

  return null;
}

function splitSetCookieHeader(
  value
) {
  if (!value) {
    return [];
  }

  return value.split(
    /,(?=\s*[^;,=\s]+=[^;,]+)/g
  );
}

function updateCookieJar(
  cookieJar,
  headers
) {
  const values =
    typeof headers
      .getSetCookie ===
    'function'
      ? headers.getSetCookie()
      : splitSetCookieHeader(
          headers.get(
            'set-cookie'
          )
        );

  for (
    const value of values
  ) {
    const [
      pair,
      ...attributes
    ] =
      value.split(
        ';'
      );

    const separator =
      pair.indexOf(
        '='
      );

    if (
      separator < 1
    ) {
      continue;
    }

    const name =
      pair
        .slice(
          0,
          separator
        )
        .trim();

    const cookieValue =
      pair
        .slice(
          separator + 1
        )
        .trim();

    const expired =
      attributes.some(
        attribute =>
          /^\s*max-age\s*=\s*0\s*$/i
            .test(
              attribute
            )
      );

    if (expired) {
      delete cookieJar[
        name
      ];
    } else {
      cookieJar[
        name
      ] =
        cookieValue;
    }
  }
}

function serializeCookies(
  cookieJar
) {
  return Object.entries(
    cookieJar
  )
    .map(
      ([
        name,
        value
      ]) =>
        `${name}=${value}`
    )
    .join('; ');
}

async function fetchWithCookieJar(
  url,
  options,
  fetchImpl,
  cookieJar
) {
  let requestUrl =
    url;

  let method =
    (
      options.method ||
      'GET'
    ).toUpperCase();

  let body =
    options.body;

  for (
    let redirectCount = 0;
    redirectCount <= 5;
    redirectCount += 1
  ) {
    const headers = {
      ...(
        options.headers ||
        {}
      )
    };

    const cookies =
      serializeCookies(
        cookieJar
      );

    if (cookies) {
      headers.cookie =
        cookies;
    }

    const response =
      await fetchImpl(
        requestUrl,
        {
          ...options,
          method,
          body,
          headers,

          redirect:
            'manual'
        }
      );

    updateCookieJar(
      cookieJar,
      response.headers
    );

    if (
      ![
        301,
        302,
        303,
        307,
        308
      ].includes(
        response.status
      )
    ) {
      return response;
    }

    const location =
      response.headers.get(
        'location'
      );

    if (!location) {
      return response;
    }

    requestUrl =
      new URL(
        location,
        requestUrl
      ).href;

    if (
      response.status ===
        303 ||
      (
        [
          301,
          302
        ].includes(
          response.status
        ) &&
        method ===
          'POST'
      )
    ) {
      method =
        'GET';

      body =
        undefined;
    }
  }

  throw new Error(
    `Too many redirects while fetching ${url}`
  );
}

async function submitPageSizePreference(
  preference,
  start,
  fetchImpl,
  cookieJar
) {
  const params =
    new URLSearchParams(
      preference.params
    );

  const headers = {
    'user-agent':
      USER_AGENT,

    accept:
      'text/html,application/xhtml+xml'
  };

  const url =
    new URL(
      preference.action
    );

  let body;

  if (
    preference.method ===
    'GET'
  ) {
    for (
      const [
        name,
        value
      ] of params
    ) {
      url.searchParams.set(
        name,
        value
      );
    }

    url.searchParams.set(
      'start',
      String(start)
    );
  } else {
    url.searchParams.set(
      'start',
      String(start)
    );

    body =
      params.toString();

    headers[
      'content-type'
    ] =
      'application/x-www-form-urlencoded';
  }

  const response =
    await fetchWithCookieJar(
      url.href,
      {
        method:
          preference.method,

        body,
        headers,

        signal:
          AbortSignal.timeout(
            20_000
          )
      },
      fetchImpl,
      cookieJar
    );

  if (!response.ok) {
    throw createHttpError(
      url.href,
      response
    );
  }

  return {
    html:
      await response.text(),

    url:
      url.href
  };
}

async function fetchListingPage({
  start,
  fetchImpl,
  session,
  requestedPageSize =
    LISTING_PAGE_SIZE
}) {
  const baseUrl =
    `${BASE_URL}/auction_search.php?start=${start}`;

  session.cookies ||= {};

  if (
    requestedPageSize <=
      LEGACY_LISTING_PAGE_SIZE ||
    session.pageSizeSupported ===
      false
  ) {
    const response =
      await fetchWithCookieJar(
        baseUrl,
        {
          headers: {
            'user-agent':
              USER_AGENT,

            accept:
              'text/html,application/xhtml+xml'
          },

          signal:
            AbortSignal.timeout(
              20_000
            )
        },
        fetchImpl,
        session.cookies
      );

    if (!response.ok) {
      throw createHttpError(
        baseUrl,
        response
      );
    }

    return {
      html:
        await response.text(),

      effectivePageSize:
        LEGACY_LISTING_PAGE_SIZE,

      requestUrl:
        baseUrl
    };
  }

  if (
    session.pageSizeSupported ===
      true &&
    session.preference
      ?.method ===
      'POST'
  ) {
    const response =
      await fetchWithCookieJar(
        baseUrl,
        {
          headers: {
            'user-agent':
              USER_AGENT,

            accept:
              'text/html,application/xhtml+xml'
          },

          signal:
            AbortSignal.timeout(
              20_000
            )
        },
        fetchImpl,
        session.cookies
      );

    if (!response.ok) {
      throw createHttpError(
        baseUrl,
        response
      );
    }

    const html =
      await response.text();

    if (
      extractListingUrls(
        html
      ).length >
      LEGACY_LISTING_PAGE_SIZE
    ) {
      return {
        html,

        effectivePageSize:
          requestedPageSize,

        requestUrl:
          baseUrl
      };
    }
  }

  if (
    session.preference
  ) {
    const result =
      await submitPageSizePreference(
        session.preference,
        start,
        fetchImpl,
        session.cookies
      );

    if (
      extractListingUrls(
        result.html
      ).length >
      LEGACY_LISTING_PAGE_SIZE
    ) {
      session.pageSizeSupported =
        true;

      return {
        ...result,

        effectivePageSize:
          requestedPageSize,

        requestUrl:
          result.url
      };
    }
  }

  const initialResponse =
    await fetchWithCookieJar(
      baseUrl,
      {
        headers: {
          'user-agent':
            USER_AGENT,

          accept:
            'text/html,application/xhtml+xml'
        },

        signal:
          AbortSignal.timeout(
            20_000
          )
      },
      fetchImpl,
      session.cookies
    );

  if (
    !initialResponse.ok
  ) {
    throw createHttpError(
      baseUrl,
      initialResponse
    );
  }

  const initialHtml =
    await initialResponse.text();

  const initialUrls =
    extractListingUrls(
      initialHtml
    );

  if (
    initialUrls.length >
    LEGACY_LISTING_PAGE_SIZE
  ) {
    session.pageSizeSupported =
      true;

    return {
      html:
        initialHtml,

      effectivePageSize:
        requestedPageSize,

      requestUrl:
        baseUrl
    };
  }

  session.preference =
    extractPageSizePreference(
      initialHtml,
      baseUrl,
      requestedPageSize
    );

  if (
    session.preference
  ) {
    const result =
      await submitPageSizePreference(
        session.preference,
        start,
        fetchImpl,
        session.cookies
      );

    if (
      extractListingUrls(
        result.html
      ).length >
      LEGACY_LISTING_PAGE_SIZE
    ) {
      session.pageSizeSupported =
        true;

      return {
        ...result,

        effectivePageSize:
          requestedPageSize,

        requestUrl:
          result.url
      };
    }
  }

  session.pageSizeSupported =
    false;

  return {
    html:
      initialHtml,

    effectivePageSize:
      LEGACY_LISTING_PAGE_SIZE,

    requestUrl:
      baseUrl
  };
}

function taskKey(task) {
  return `${task.kind}:${task.url}`;
}

function addTasks(
  queue,
  tasks
) {
  const known =
    new Set(
      queue.tasks.map(
        taskKey
      )
    );

  for (
    const task of tasks
  ) {
    const key =
      taskKey(task);

    if (
      known.has(key)
    ) {
      continue;
    }

    queue.tasks.push({
      attempts: 0,
      notBefore: 0,
      priority: 50,
      ...task
    });

    known.add(key);
  }
}

function removeTask(
  queue,
  task
) {
  const key =
    taskKey(task);

  const index =
    queue.tasks.findIndex(
      candidate =>
        taskKey(
          candidate
        ) === key
    );

  if (
    index >= 0
  ) {
    queue.tasks.splice(
      index,
      1
    );
  }
}

function clamp(
  value,
  minimum,
  maximum
) {
  return Math.min(
    maximum,
    Math.max(
      minimum,
      value
    )
  );
}

function isRateLimitError(
  error
) {
  return error?.status ===
      429 ||
    error?.status ===
      503 ||
    /rate.?limit|too many requests/i
      .test(
        error?.message ||
        ''
      );
}

function isTransientError(
  error
) {
  return isRateLimitError(
    error
  ) ||
    [
      408,
      425,
      502,
      504
    ].includes(
      error?.status
    ) ||
    error?.status >=
      500 ||
    error?.name ===
      'TimeoutError' ||
    error?.name ===
      'AbortError';
}

function retryDelay(
  error,
  attempts,
  now
) {
  if (
    error.retryAfterMs !=
    null
  ) {
    return Math.max(
      1_000,
      error.retryAfterMs
    );
  }

  const exponent =
    2 **
    Math.min(
      Math.max(
        attempts - 1,
        0
      ),
      6
    );

  const base =
    isRateLimitError(
      error
    )
      ? 15_000
      : isTransientError(
            error
          )
        ? 5_000
        : 3_000;

  return Math.min(
    10 * 60_000,
    base * exponent
  ) +
    (
      now % 1_000
    );
}

function normalizeThrottle(
  queue,
  {
    minimumIntervalMs =
      DEFAULT_MIN_INTERVAL_MS,

    initialIntervalMs =
      DEFAULT_INITIAL_INTERVAL_MS,

    maximumIntervalMs =
      DEFAULT_MAX_INTERVAL_MS
  } = {}
) {
  const minimum =
    Math.max(
      0,
      Number(
        minimumIntervalMs
      ) ||
      0
    );

  const maximum =
    Math.max(
      minimum,
      Number(
        maximumIntervalMs
      ) ||
      DEFAULT_MAX_INTERVAL_MS
    );

  const initial =
    clamp(
      Number(
        initialIntervalMs
      ) ||
      DEFAULT_INITIAL_INTERVAL_MS,
      minimum,
      maximum
    );

  const existing =
    queue.throttle &&
    typeof queue.throttle ===
      'object'
      ? queue.throttle
      : {};

  queue.throttle = {
    intervalMs:
      clamp(
        Number(
          existing.intervalMs
        ) ||
        initial,
        minimum,
        maximum
      ),

    globalNotBefore:
      Math.max(
        0,
        Number(
          existing.globalNotBefore
        ) ||
        0
      ),

    successStreak:
      Math.max(
        0,
        Number(
          existing.successStreak
        ) ||
        0
      )
  };

  return {
    minimum,
    maximum
  };
}

function speedUpThrottle(
  queue,
  minimum
) {
  const throttle =
    queue.throttle;

  throttle.successStreak +=
    1;

  if (
    throttle.successStreak >=
    5
  ) {
    throttle.intervalMs =
      Math.max(
        minimum,
        Math.round(
          throttle.intervalMs *
          0.8
        )
      );

    throttle.successStreak =
      0;
  }
}

function slowDownThrottle(
  queue,
  error,
  now,
  minimum,
  maximum,
  retryMs
) {
  const throttle =
    queue.throttle;

  throttle.successStreak =
    0;

  if (
    isRateLimitError(
      error
    )
  ) {
    throttle.intervalMs =
      clamp(
        Math.max(
          minimum,
          Math.round(
            throttle.intervalMs *
            2
          )
        ),
        minimum,
        maximum
      );

    throttle.globalNotBefore =
      Math.max(
        throttle.globalNotBefore,
        now +
        retryMs
      );

    return;
  }

  if (
    isTransientError(
      error
    )
  ) {
    throttle.intervalMs =
      clamp(
        Math.max(
          minimum,
          Math.round(
            throttle.intervalMs *
            1.35
          )
        ),
        minimum,
        maximum
      );
  }
}

function nextAllowedRequestAt(
  queue
) {
  const lastRequestAt =
    Date.parse(
      queue.lastRequestAt ||
      ''
    );

  const intervalReadyAt =
    Number.isFinite(
      lastRequestAt
    )
      ? lastRequestAt +
        (
          queue.throttle
            ?.intervalMs ||
          0
        )
      : 0;

  return Math.max(
    intervalReadyAt,
    queue.throttle
      ?.globalNotBefore ||
    0
  );
}

function nextTaskReadyAt(
  queue
) {
  if (
    !queue.tasks.length
  ) {
    return null;
  }

  return Math.min(
    ...queue.tasks.map(
      task =>
        Math.max(
          0,
          Number(
            task.notBefore
          ) ||
          0
        )
    )
  );
}

function detailPriority(
  auction,
  now
) {
  if (!auction?.endAt) {
    return 50;
  }

  const remaining =
    Date.parse(
      auction.endAt
    ) -
    now;

  if (
    remaining <= 0 &&
    auction.finalPrice ==
      null
  ) {
    return 95;
  }

  if (
    remaining <=
    60 * 60_000
  ) {
    return 90;
  }

  if (
    remaining <=
    6 * 60 * 60_000
  ) {
    return 80;
  }

  if (
    remaining <=
    24 * 60 * 60_000
  ) {
    return 70;
  }

  return 50;
}

function refreshIntervalFor(
  auction,
  now
) {
  const endAt =
    Date.parse(
      auction?.endAt ||
      ''
    );

  if (
    !Number.isFinite(
      endAt
    )
  ) {
    return 6 *
      60 *
      60_000;
  }

  const remaining =
    endAt -
    now;

  if (
    remaining <= 0
  ) {
    return 0;
  }

  if (
    remaining <=
    60 * 60_000
  ) {
    return 5 *
      60_000;
  }

  if (
    remaining <=
    6 * 60 * 60_000
  ) {
    return 15 *
      60_000;
  }

  if (
    remaining <=
    24 * 60 * 60_000
  ) {
    return 60 *
      60_000;
  }

  return 6 *
    60 *
    60_000;
}

function shouldRefreshAuction(
  auction,
  now
) {
  if (!auction) {
    return true;
  }

  if (
    auction.finalPrice !=
    null
  ) {
    return false;
  }

  const endAt =
    Date.parse(
      auction.endAt ||
      ''
    );

  if (
    Number.isFinite(
      endAt
    ) &&
    endAt <= now
  ) {
    return true;
  }

  const capturedAt =
    Date.parse(
      auction.capturedAt ||
      auction.firstCapturedAt ||
      ''
    );

  if (
    !Number.isFinite(
      capturedAt
    )
  ) {
    return true;
  }

  return now -
    capturedAt >=
    refreshIntervalFor(
      auction,
      now
    );
}

function listingHasNextLink(
  html,
  nextStart
) {
  const decoded =
    decodeEntities(
      html
    );

  const escaped =
    String(
      nextStart
    ).replace(
      /[.*+?^${}()|[\]\\]/g,
      '\\$&'
    );

  return new RegExp(
    `(?:[?&]|&amp;)start=${escaped}(?:[&"'<>\\s]|$)`,
    'i'
  ).test(
    decoded
  );
}

function auctionIdFromUrl(
  url
) {
  return Number(
    url.match(
      /-(\d{5,8})(?:\D|$)/
    )?.[1]
  ) ||
    null;
}

function reusableImage(
  byId,
  item
) {
  const source =
    item.sourceImages?.[0];

  if (!source) {
    return null;
  }

  for (
    const candidate of
      byId.values()
  ) {
    if (
      candidate.id ===
      item.id
    ) {
      continue;
    }

    if (
      candidate
        .sourceImages?.[0] !==
      source
    ) {
      continue;
    }

    if (
      candidate.image
        ?.startsWith(
          '/auction-images/'
        )
    ) {
      return candidate.image;
    }
  }

  return null;
}

async function requestResource(
  task,
  fetchImpl
) {
  const image =
    task.kind ===
    'image';

  const response =
    await fetchImpl(
      task.url,
      {
        headers: {
          'user-agent':
            USER_AGENT,

          accept:
            image
              ? 'image/*'
              : 'text/html,application/xhtml+xml'
        },

        redirect:
          'error',

        signal:
          AbortSignal.timeout(
            20_000
          )
      }
    );

  if (!response.ok) {
    throw createHttpError(
      task.url,
      response
    );
  }

  return response;
}

async function saveImageResponse(
  auction,
  response,
  dataDir
) {
  const contentType =
    (
      response.headers.get(
        'content-type'
      ) ||
      ''
    ).toLowerCase();

  if (
    !contentType.startsWith(
      'image/'
    )
  ) {
    throw new Error(
      `Unexpected image content type: ${contentType || 'missing'}`
    );
  }

  const bytes =
    Buffer.from(
      await response.arrayBuffer()
    );

  if (
    bytes.length < 1000 ||
    bytes.length >
      12_000_000
  ) {
    throw new Error(
      `Unexpected image size: ${bytes.length}`
    );
  }

  const extension =
    contentType.includes(
      'png'
    )
      ? 'png'
      : contentType.includes(
            'webp'
          )
        ? 'webp'
        : 'jpg';

  const filename =
    `${auction.id}.${extension}`;

  await mkdir(
    path.join(
      dataDir,
      'images'
    ),
    {
      recursive:
        true
    }
  );

  await writeFile(
    path.join(
      dataDir,
      'images',
      filename
    ),
    bytes
  );

  return `/auction-images/${filename}`;
}

export async function enqueueRollingDiscovery({
  dataDir,
  pages,
  maxPages =
    DEFAULT_MAX_LISTING_PAGES,
  now = Date.now(),
  force = false
} = {}) {
  if (!dataDir) {
    throw new Error(
      'dataDir is required'
    );
  }

  const queue =
    normalizeQueue(
      readQueue(
        dataDir,
        emptyQueue()
      )
    );

  if (
    !force &&
    queue.tasks.length >
      0
  ) {
    return queue;
  }

  if (
    queue.tasks.some(
      task =>
        task.kind ===
        'listing'
    )
  ) {
    return queue;
  }

  const exactPages =
    Number.isFinite(
      pages
    )
      ? Math.max(
          1,
          Number(pages)
        )
      : null;

  const pageLimit =
    exactPages ??
    Math.max(
      1,
      Number(
        maxPages
      ) ||
      DEFAULT_MAX_LISTING_PAGES
    );

  queue.listingSession =
    {};

  queue.discovery = {
    startedAt:
      new Date(now)
        .toISOString(),

    completedAt:
      null,

    pagesFetched:
      0,

    listingsSeen:
      0,

    complete:
      false,

    maxPages:
      pageLimit,

    seenAuctionIds:
      []
  };

  queue.needsFullDiscovery =
    false;

  addTasks(
    queue,
    [
      {
        kind:
          'listing',

        url:
          `${BASE_URL}/auction_search.php?start=0`,

        listingStart:
          0,

        listingPage:
          0,

        maxPages:
          pageLimit,

        stopOnShortPage:
          exactPages ==
          null,

        requestedPageSize:
          LISTING_PAGE_SIZE,

        priority:
          100,

        notBefore:
          now
      }
    ]
  );

  queue.lastDiscoveryAt =
    new Date(
      now
    ).toISOString();

  queue.version =
    ROLLING_QUEUE_VERSION;

  queue.updatedAt =
    queue.lastDiscoveryAt;

  writeQueue(
    dataDir,
    queue
  );

  return queue;
}

export async function processRollingTask({
  dataDir,
  fetchImpl = fetch,
  now = Date.now(),
  minimumIntervalMs =
    DEFAULT_MIN_INTERVAL_MS,
  initialIntervalMs =
    DEFAULT_INITIAL_INTERVAL_MS,
  maximumIntervalMs =
    DEFAULT_MAX_INTERVAL_MS,
  logger = console
} = {}) {
  if (!dataDir) {
    throw new Error(
      'dataDir is required'
    );
  }

  const queue =
    normalizeQueue(
      readQueue(
        dataDir,
        emptyQueue()
      )
    );

  const {
    minimum,
    maximum
  } =
    normalizeThrottle(
      queue,
      {
        minimumIntervalMs,
        initialIntervalMs,
        maximumIntervalMs
      }
    );

  const allowedAt =
    nextAllowedRequestAt(
      queue
    );

  if (
    allowedAt > now
  ) {
    return {
      status:
        'waiting',

      pending:
        queue.tasks.length,

      lastRequestAt:
        queue.lastRequestAt,

      lastDiscoveryAt:
        queue.lastDiscoveryAt ??
        null,

      adaptiveIntervalMs:
        queue.throttle
          .intervalMs,

      waitMs:
        allowedAt -
        now
    };
  }

  const eligible =
    queue.tasks
      .filter(
        task =>
          (
            task.notBefore ||
            0
          ) <= now
      )
      .sort(
        (a, b) =>
          (
            b.priority ||
            0
          ) -
            (
              a.priority ||
              0
            ) ||
          (
            a.notBefore ||
            0
          ) -
            (
              b.notBefore ||
              0
            )
      );

  const task =
    eligible[0];

  if (!task) {
    const taskReadyAt =
      nextTaskReadyAt(
        queue
      );

    return {
      status:
        taskReadyAt ==
        null
          ? 'idle'
          : 'waiting',

      pending:
        queue.tasks.length,

      lastRequestAt:
        queue.lastRequestAt,

      lastDiscoveryAt:
        queue.lastDiscoveryAt ??
        null,

      adaptiveIntervalMs:
        queue.throttle
          .intervalMs,

      waitMs:
        taskReadyAt ==
        null
          ? IDLE_POLL_MS
          : Math.max(
              1,
              taskReadyAt -
              now
            )
    };
  }

  const archive =
    readArchive(
      dataDir
    );

  const byId =
    new Map(
      (
        archive.auctions ||
        []
      ).map(
        item => [
          item.id,
          item
        ]
      )
    );

  queue.lastRequestAt =
    new Date(
      now
    ).toISOString();

  queue.updatedAt =
    queue.lastRequestAt;

  queue.version =
    ROLLING_QUEUE_VERSION;

  writeQueue(
    dataDir,
    queue
  );

  try {
    let response;

    let listingResultCount =
      null;

    let archiveChanged =
      false;

    let changedAuction =
      null;

    if (
      task.kind ===
      'listing'
    ) {
      const start =
        Number.isFinite(
          task.listingStart
        )
          ? task.listingStart
          : Number(
              new URL(
                task.url
              )
                .searchParams
                .get(
                  'start'
                ) ||
              0
            );

      const requestedPageSize =
        task.requestedPageSize ||
        LISTING_PAGE_SIZE;

      const result =
        await fetchListingPage({
          start,
          fetchImpl,

          session:
            queue.listingSession,

          requestedPageSize
        });

      const urls =
        extractListingUrls(
          result.html
        );

      listingResultCount =
        urls.length;

      const discovery =
        queue.discovery ||
        {
          startedAt:
            queue.lastDiscoveryAt ||
            new Date(
              now
            ).toISOString(),

          completedAt:
            null,

          pagesFetched:
            0,

          listingsSeen:
            0,

          complete:
            false,

          maxPages:
            task.maxPages ||
            DEFAULT_MAX_LISTING_PAGES,

          seenAuctionIds:
            []
        };

      const seenIds =
        new Set(
          discovery.seenAuctionIds ||
          []
        );

      const newUrls = [];

      for (
        const url of urls
      ) {
        const id =
          auctionIdFromUrl(
            url
          );

        if (
          id &&
          seenIds.has(id)
        ) {
          continue;
        }

        if (id) {
          seenIds.add(
            id
          );
        }

        newUrls.push(
          url
        );
      }

      discovery.pagesFetched =
        Number(
          discovery.pagesFetched ||
          0
        ) + 1;

      discovery.listingsSeen =
        seenIds.size ||
        Number(
          discovery.listingsSeen ||
          0
        ) +
        newUrls.length;

      discovery.seenAuctionIds =
        [
          ...seenIds
        ];

      queue.discovery =
        discovery;

      addTasks(
        queue,
        newUrls.flatMap(
          url => {
            const id =
              auctionIdFromUrl(
                url
              );

            const previous =
              id
                ? byId.get(
                    id
                  )
                : null;

            if (
              !shouldRefreshAuction(
                previous,
                now
              )
            ) {
              return [];
            }

            return [
              {
                kind:
                  'detail',

                url,

                auctionId:
                  id,

                priority:
                  detailPriority(
                    previous,
                    now
                  ),

                notBefore:
                  now
              }
            ];
          }
        )
      );

      const nextStart =
        start +
        result.effectivePageSize;

      const pageIndex =
        Number.isFinite(
          task.listingPage
        )
          ? task.listingPage
          : 0;

      const nextPage =
        pageIndex + 1;

      let hasMore;

      if (
        Number.isFinite(
          task.listingTarget
        )
      ) {
        hasMore =
          nextStart <
          task.listingTarget;
      } else {
        const pageLimit =
          Math.max(
            1,
            Number(
              task.maxPages
            ) ||
            DEFAULT_MAX_LISTING_PAGES
          );

        const shortPage =
          urls.length <
          result.effectivePageSize;

        hasMore =
          newUrls.length > 0 &&
          nextPage <
            pageLimit &&
          (
            !task.stopOnShortPage ||
            !shortPage ||
            listingHasNextLink(
              result.html,
              nextStart
            )
          );
      }

      if (hasMore) {
        addTasks(
          queue,
          [
            {
              kind:
                'listing',

              url:
                `${BASE_URL}/auction_search.php?start=${nextStart}`,

              listingStart:
                nextStart,

              listingPage:
                nextPage,

              maxPages:
                task.maxPages,

              stopOnShortPage:
                task.stopOnShortPage,

              listingTarget:
                task.listingTarget,

              requestedPageSize,

              priority:
                100,

              notBefore:
                now
            }
          ]
        );
      } else if (
        queue.discovery
      ) {
        queue.discovery.complete =
          true;

        queue.discovery.completedAt =
          new Date(
            now
          ).toISOString();

        queue.discovery.seenAuctionIds =
          [];
      }
    } else {
      response =
        await requestResource(
          task,
          fetchImpl
        );
    }

    if (
      task.kind ===
      'detail'
    ) {
      const item =
        parseAuctionPage(
          await response.text(),
          task.url
        );

      const previous =
        byId.get(
          item.id
        );

      if (
        previous?.startAt
      ) {
        item.startAt =
          previous.startAt;
      }

      const sharedImage =
        reusableImage(
          byId,
          item
        );

      const merged = {
        ...previous,
        ...item,

        image:
          previous?.image ||
          sharedImage ||
          item.sourceImages
            ?.[0] ||
          null,

        images:
          previous?.images ||
          (
            sharedImage
              ? [
                  sharedImage
                ]
              : item.sourceImages ||
                []
          ),

        firstCapturedAt:
          previous
            ?.firstCapturedAt ||
          item.capturedAt,

        finalPrice:
          item.finalPrice ??
          previous
            ?.finalPrice ??
          null
      };

      byId.set(
        item.id,
        merged
      );

      archiveChanged =
        true;

      changedAuction =
        merged;

      if (
        !merged.startAt
      ) {
        addTasks(
          queue,
          [
            {
              kind:
                'start',

              url:
                `${BASE_URL}/auktion_drucken-${item.id}`,

              auctionId:
                item.id,

              priority:
                45,

              notBefore:
                now
            }
          ]
        );
      }

      if (
        !merged.image
          ?.startsWith(
            '/auction-images/'
          ) &&
        item.sourceImages
          ?.[0]
      ) {
        addTasks(
          queue,
          [
            {
              kind:
                'image',

              url:
                item.sourceImages[
                  0
                ],

              auctionId:
                item.id,

              priority:
                40,

              notBefore:
                now
            }
          ]
        );
      }
    } else if (
      task.kind ===
      'start'
    ) {
      const auction =
        byId.get(
          task.auctionId
        );

      if (auction) {
        const updatedAuction = {
          ...auction,

          startAt:
            parseAuctionStart(
              await response.text()
            ) ||
            auction.startAt
        };

        byId.set(
          task.auctionId,
          updatedAuction
        );

        archiveChanged =
          true;

        changedAuction =
          updatedAuction;
      }
    } else if (
      task.kind ===
      'image'
    ) {
      const auction =
        byId.get(
          task.auctionId
        );

      if (auction) {
        const image =
          await saveImageResponse(
            auction,
            response,
            dataDir
          );

        const updatedAuction = {
          ...auction,

          image,

          images: [
            image
          ]
        };

        byId.set(
          task.auctionId,
          updatedAuction
        );

        archiveChanged =
          true;

        changedAuction =
          updatedAuction;
      }
    } else if (
      task.kind !==
      'listing'
    ) {
      throw new Error(
        `Unknown rolling task kind: ${task.kind}`
      );
    }

    removeTask(
      queue,
      task
    );

    const updatedAt =
      new Date(
        now
      ).toISOString();

    if (
      archiveChanged
    ) {
      upsertAuctions(
        dataDir,
        [changedAuction]
          .filter(Boolean),
        updatedAt
      );
    }

    if (
      queue.throttle
        .globalNotBefore <=
      now
    ) {
      queue.throttle
        .globalNotBefore =
        0;
    }

    speedUpThrottle(
      queue,
      minimum
    );

    queue.version =
      ROLLING_QUEUE_VERSION;

    queue.updatedAt =
      updatedAt;

    writeQueue(
      dataDir,
      queue
    );

    const pageSuffix =
      task.kind ===
        'listing' &&
      queue.discovery
        ? `; page ${queue.discovery.pagesFetched}; ${queue.discovery.listingsSeen} unique listings seen`
        : '';

    const resultSuffix =
      listingResultCount ==
      null
        ? ''
        : `; ${listingResultCount} results`;

    logger.info(
      `Rolling fetch completed: ${task.kind} ${task.url} ` +
      `(${queue.tasks.length} pending${resultSuffix}${pageSuffix}; pace ${queue.throttle.intervalMs}ms)`
    );

    return {
      status:
        'ok',

      kind:
        task.kind,

      pending:
        queue.tasks.length,

      lastRequestAt:
        queue.lastRequestAt,

      lastDiscoveryAt:
        queue.lastDiscoveryAt ??
        null,

      adaptiveIntervalMs:
        queue.throttle
          .intervalMs,

      waitMs:
        queue.throttle
          .intervalMs
    };
  } catch (error) {
    const attempts =
      (
        task.attempts ||
        0
      ) + 1;

    const retryMs =
      retryDelay(
        error,
        attempts,
        now
      );

    const persisted =
      queue.tasks.find(
        candidate =>
          taskKey(
            candidate
          ) ===
          taskKey(
            task
          )
      );

    if (persisted) {
      if (
        attempts <= 8
      ) {
        persisted.attempts =
          attempts;

        persisted.notBefore =
          now +
          retryMs;

        persisted.priority =
          Math.max(
            10,
            (
              task.priority ||
              50
            ) - 5
          );
      } else {
        removeTask(
          queue,
          task
        );
      }
    } else if (
      attempts <= 8
    ) {
      addTasks(
        queue,
        [
          {
            ...task,

            attempts,

            notBefore:
              now +
              retryMs,

            priority:
              Math.max(
                10,
                (
                  task.priority ||
                  50
                ) - 5
              )
          }
        ]
      );
    }

    slowDownThrottle(
      queue,
      error,
      now,
      minimum,
      maximum,
      retryMs
    );

    queue.version =
      ROLLING_QUEUE_VERSION;

    queue.updatedAt =
      new Date(
        now
      ).toISOString();

    writeQueue(
      dataDir,
      queue
    );

    const globalWaitMs =
      Math.max(
        0,
        queue.throttle
          .globalNotBefore -
        now
      );

    const waitMs =
      Math.max(
        queue.throttle
          .intervalMs,
        globalWaitMs ||
        0
      );

    logger.warn(
      `Rolling fetch failed: ${error.message}; attempt ${attempts}; pace ${queue.throttle.intervalMs}ms` +
      (
        globalWaitMs
          ? `; cooldown ${globalWaitMs}ms`
          : ''
      )
    );

    return {
      status:
        'error',

      kind:
        task.kind,

      pending:
        queue.tasks.length,

      lastRequestAt:
        queue.lastRequestAt,

      lastDiscoveryAt:
        queue.lastDiscoveryAt ??
        null,

      adaptiveIntervalMs:
        queue.throttle
          .intervalMs,

      waitMs,

      error:
        error.message
    };
  }
}

async function cacheMainImage(
  auction,
  dataDir,
  fetchImpl,
  previous
) {
  if (
    previous?.image
      ?.startsWith(
        '/auction-images/'
      )
  ) {
    return {
      ...auction,

      image:
        previous.image,

      images:
        previous.images ||
        [
          previous.image
        ]
    };
  }

  if (
    !auction.sourceImages
      ?.[0]
  ) {
    return auction;
  }

  try {
    const response =
      await fetchImpl(
        auction.sourceImages[
          0
        ],
        {
          headers: {
            'user-agent':
              USER_AGENT,

            accept:
              'image/*'
          },

          redirect:
            'error',

          signal:
            AbortSignal.timeout(
              20_000
            )
        }
      );

    if (!response.ok) {
      return auction;
    }

    const contentType =
      (
        response.headers.get(
          'content-type'
        ) ||
        ''
      ).toLowerCase();

    if (
      !contentType.startsWith(
        'image/'
      )
    ) {
      return auction;
    }

    const bytes =
      Buffer.from(
        await response.arrayBuffer()
      );

    if (
      bytes.length < 1000 ||
      bytes.length >
        12_000_000
    ) {
      return auction;
    }

    const extension =
      contentType.includes(
        'png'
      )
        ? 'png'
        : contentType.includes(
              'webp'
            )
          ? 'webp'
          : 'jpg';

    const filename =
      `${auction.id}.${extension}`;

    await mkdir(
      path.join(
        dataDir,
        'images'
      ),
      {
        recursive:
          true
      }
    );

    await writeFile(
      path.join(
        dataDir,
        'images',
        filename
      ),
      bytes
    );

    return {
      ...auction,

      image:
        `/auction-images/${filename}`,

      images: [
        `/auction-images/${filename}`
      ]
    };
  } catch {
    return auction;
  }
}

export async function collectAuctions({
  dataDir,
  fetchImpl = fetch,
  pages,
  maxPages =
    DEFAULT_MAX_LISTING_PAGES,
  maxDetails =
    Number.POSITIVE_INFINITY,
  logger = console
} = {}) {
  if (!dataDir) {
    throw new Error(
      'dataDir is required'
    );
  }

  const existing =
    readArchive(
      dataDir
    );

  const byId =
    new Map(
      (
        existing.auctions ||
        []
      ).map(
        item => [
          item.id,
          item
        ]
      )
    );

  const listingUrls =
    new Set();

  const listingSession =
    {};

  const exactPages =
    Number.isFinite(
      pages
    )
      ? Math.max(
          1,
          Number(pages)
        )
      : null;

  const pageLimit =
    exactPages ??
    Math.max(
      1,
      Number(
        maxPages
      ) ||
      DEFAULT_MAX_LISTING_PAGES
    );

  let listingStart =
    0;

  for (
    let page = 0;
    page <
      pageLimit;
    page += 1
  ) {
    try {
      const result =
        await fetchListingPage({
          start:
            listingStart,

          fetchImpl,

          session:
            listingSession,

          requestedPageSize:
            LISTING_PAGE_SIZE
        });

      const urls =
        extractListingUrls(
          result.html
        );

      const previousListingCount =
        listingUrls.size;

      urls.forEach(
        url =>
          listingUrls.add(
            url
          )
      );

      const newListingCount =
        listingUrls.size -
        previousListingCount;

      const nextStart =
        listingStart +
        result.effectivePageSize;

      if (
        exactPages ==
          null &&
        urls.length <
          result.effectivePageSize &&
        !listingHasNextLink(
          result.html,
          nextStart
        )
      ) {
        break;
      }

      if (
        !urls.length
      ) {
        break;
      }

      if (
        newListingCount ===
        0
      ) {
        logger.info(
          `Listing discovery stopped at page ${page + 1}: no new auctions`
        );

        break;
      }

      listingStart =
        nextStart;
    } catch (error) {
      logger.warn(
        `Listing page ${page + 1} failed: ${error.message}`
      );

      listingStart +=
        listingSession
          .pageSizeSupported ===
          true
          ? LISTING_PAGE_SIZE
          : LEGACY_LISTING_PAGE_SIZE;
    }
  }

  const incoming = [];

  const detailUrls =
    [
      ...listingUrls
    ]
      .filter(
        url =>
          shouldRefreshAuction(
            byId.get(
              auctionIdFromUrl(
                url
              )
            ),
            Date.now()
          )
      )
      .slice(
        0,
        Number.isFinite(
          maxDetails
        )
          ? maxDetails
          : undefined
      );

  for (
    let index = 0;
    index <
      detailUrls.length;
    index += 5
  ) {
    const batch =
      detailUrls.slice(
        index,
        index + 5
      );

    const records =
      await Promise.all(
        batch.map(
          async url => {
            try {
              const item =
                parseAuctionPage(
                  await fetchText(
                    url,
                    fetchImpl
                  ),
                  url
                );

              const previous =
                byId.get(
                  item.id
                );

              if (
                previous?.startAt
              ) {
                item.startAt =
                  previous.startAt;
              } else {
                try {
                  item.startAt =
                    parseAuctionStart(
                      await fetchText(
                        `${BASE_URL}/auktion_drucken-${item.id}`,
                        fetchImpl
                      )
                    );
                } catch (error) {
                  logger.warn(
                    `Start date fetch failed for ${item.id}: ${error.message}`
                  );
                }
              }

              return item;
            } catch (error) {
              logger.warn(
                `Auction fetch failed for ${url}: ${error.message}`
              );

              return null;
            }
          }
        )
      );

    incoming.push(
      ...records.filter(
        Boolean
      )
    );
  }

  for (
    const item of incoming
  ) {
    const previous =
      byId.get(
        item.id
      );

    const sharedImage =
      reusableImage(
        byId,
        item
      );

    const withImage =
      sharedImage
        ? {
            ...item,

            image:
              sharedImage,

            images: [
              sharedImage
            ]
          }
        : await cacheMainImage(
            item,
            dataDir,
            fetchImpl,
            previous
          );

    byId.set(
      item.id,
      {
        ...previous,
        ...withImage,

        image:
          withImage.image ||
          previous?.image ||
          withImage
            .sourceImages?.[0] ||
          null,

        images:
          withImage.images ||
          previous?.images ||
          withImage
            .sourceImages ||
          [],

        firstCapturedAt:
          previous
            ?.firstCapturedAt ||
          item.capturedAt,

        finalPrice:
          withImage.finalPrice ??
          previous
            ?.finalPrice ??
          null
      }
    );
  }

  const updatedAt =
    new Date()
      .toISOString();

  const auctions =
    [
      ...byId.values()
    ].map(
      item => {
        if (
          item.finalPrice ==
            null &&
          item.endAt &&
          Date.parse(
            item.endAt
          ) <= Date.now() &&
          item.currentBid >
            0
        ) {
          return {
            ...item,

            finalPrice:
              item.currentBid,

            finalizedAt:
              updatedAt
          };
        }

        return item;
      }
    );

  const archive = {
    updatedAt,
    auctions
  };

  upsertAuctions(
    dataDir,
    auctions,
    updatedAt
  );

  logger.info(
    `Collected ${incoming.length} auctions; archive contains ${archive.auctions.length}`
  );

  return archive;
}

export async function ensureDailyGame({
  dataDir,
  dateKey = utcDateKey(),
  logger = console
} = {}) {
  const daily =
    readDailyGames(
      dataDir
    );

  if (
    daily.games[
      dateKey
    ]?.auctions?.length ===
    5
  ) {
    return daily.games[
      dateKey
    ];
  }

  const archive =
    readArchive(
      dataDir
    );

  const game = {
    ...selectDailySet(
      archive.auctions,
      dateKey,
      daily.games,
      5,
      readDailyUsedIds(
        dataDir
      )
    ),

    selectionVersion:
      DAILY_SELECTION_VERSION
  };

  saveDailyGame(
    dataDir,
    game
  );

  logger.info(
    `Generated game #${game.gameNumber} for ${dateKey}`
  );

  return game;
}

export async function seedArchiveIfEmpty({
  dataDir,
  seedFile
}) {
  const current =
    readArchive(
      dataDir
    );

  if (
    current?.auctions
      ?.length >= 5
  ) {
    return current;
  }

  const seed =
    JSON.parse(
      await readFile(
        seedFile,
        'utf8'
      )
    );

  upsertAuctions(
    dataDir,
    seed.auctions || [],
    seed.updatedAt
  );

  return seed;
}
