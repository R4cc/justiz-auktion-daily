import { createHash } from 'node:crypto';

export const GAME_EPOCH = Date.UTC(2026, 0, 1);

export function utcDateKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

export function gameNumber(dateKey = utcDateKey()) {
  return Math.floor(
    (
      Date.parse(`${dateKey}T00:00:00Z`) -
      GAME_EPOCH
    ) / 86400000
  ) + 1;
}

export function scoreGuess(guess, actual) {
  if (
    !Number.isFinite(guess) ||
    guess < 0 ||
    !Number.isFinite(actual) ||
    actual <= 0
  ) {
    return 0;
  }

  const error =
    Math.abs(guess - actual) /
    actual;

  return Math.round(
    1000 *
    Math.exp(
      -2.5 * error
    )
  );
}

function deterministicJitter(
  dateKey,
  id
) {
  const bytes =
    createHash('sha256')
      .update(
        `${dateKey}:${id}`
      )
      .digest();

  return bytes.readUInt32BE(0) /
    0xffffffff;
}

function deterministicOrder(
  dateKey,
  id
) {
  const bytes =
    createHash('sha256')
      .update(
        `order:${dateKey}:${id}`
      )
      .digest();

  return bytes.readUInt32BE(0) /
    0xffffffff;
}

function shortHash(value) {
  return createHash('sha256')
    .update(value)
    .digest('hex')
    .slice(0, 24);
}

function normalizeText(
  value = ''
) {
  return String(value)
    .normalize('NFKD')
    .replace(
      /\p{M}/gu,
      ''
    )
    .toLowerCase()
    .replace(
      /\b(?:auktion\s*id|artikel\s*nr|artikelnummer)\s*[:#.-]?\s*\d+\b/giu,
      ' '
    )
    .replace(
      /\b(?:los|lot|position|pos|nr|nummer)\s*[:#.-]?\s*\d+\b/giu,
      ' '
    )
    .replace(
      /\b\d+\s*(?:von|\/)\s*\d+\b/giu,
      ' '
    )
    .replace(
      /[()\[\]{}]/g,
      ' '
    )
    .replace(
      /[^\p{L}\p{N}]+/gu,
      ' '
    )
    .replace(
      /\s+/g,
      ' '
    )
    .trim();
}

function normalizeTitle(
  value = ''
) {
  const withoutSequenceSuffix =
    String(value)
      .replace(
        /\s*[-–—/#]\s*\d+\s*$/u,
        ''
      )
      .replace(
        /\s*\(\s*\d+\s*(?:von|\/)\s*\d+\s*\)\s*$/iu,
        ''
      )
      .replace(
        /\s+\d+\s+(?:von)\s+\d+\s*$/iu,
        ''
      );

  return normalizeText(
    withoutSequenceSuffix
  )
    .replace(
      /\s+(?:los|lot|position|pos|nr|nummer)\s+\d+$/u,
      ''
    )
    .trim();
}

function sourceImageIdentity(
  auction
) {
  const source =
    auction?.sourceImages?.[0];

  if (
    !source ||
    source.startsWith(
      '/auction-images/'
    )
  ) {
    return null;
  }

  try {
    const url =
      new URL(
        source,
        'https://www.justiz-auktion.de'
      );

    const identity =
      `${url.hostname}${url.pathname}`
        .toLowerCase();

    if (
      /placeholder|no[-_]?image|kein[-_]?bild|default/i
        .test(identity)
    ) {
      return null;
    }

    return identity;
  } catch {
    return null;
  }
}

export function auctionDuplicateKeys(
  auction
) {
  if (!auction) {
    return [];
  }

  const title =
    normalizeTitle(
      auction.title || ''
    );

  const description =
    normalizeText(
      auction.description || ''
    );

  const image =
    sourceImageIdentity(
      auction
    );

  const keys = [];

  if (image) {
    keys.push(
      `image:${shortHash(image)}`
    );
  }

  if (
    title &&
    description
  ) {
    keys.push(
      `content:${shortHash(
        `${title}\n${description}`
      )}`
    );
  } else if (title) {
    const condition =
      normalizeText(
        auction.condition || ''
      );

    const location =
      normalizeText(
        auction.location || ''
      );

    const startBid =
      Number.isFinite(
        auction.startBid
      )
        ? auction.startBid
        : '';

    keys.push(
      `fallback:${shortHash(
        `${title}|${condition}|${location}|${startBid}`
      )}`
    );
  }

  return [
    ...new Set(keys)
  ];
}

export function auctionFamilyKey(
  auction
) {
  const title =
    normalizeTitle(
      auction?.title || ''
    );

  if (!title) {
    return null;
  }

  return `title:${shortHash(title)}`;
}

function priceBand(price) {
  if (price < 50) {
    return 'under-50';
  }

  if (price < 250) {
    return 'under-250';
  }

  if (price < 1000) {
    return 'under-1000';
  }

  if (price < 5000) {
    return 'under-5000';
  }

  return 'over-5000';
}

function endSlot(endAt) {
  return endAt
    ? endAt.slice(0, 13)
    : 'unknown';
}

function qualityScore(
  auction,
  now
) {
  let score = 0;

  if (auction.image) {
    score += 35;
  }

  if (
    (
      auction.description ||
      ''
    ).length >= 80
  ) {
    score += 18;
  }

  if (
    (
      auction.title ||
      ''
    ).length >= 12
  ) {
    score += 12;
  }

  if (
    (
      auction.bidCount ||
      0
    ) > 0
  ) {
    score += 20;
  }

  if (
    (
      auction.bidCount ||
      0
    ) >= 5
  ) {
    score += 8;
  }

  if (
    auction.endAt &&
    Date.parse(
      auction.endAt
    ) > now
  ) {
    score += 20;
  }

  return score;
}

function playableAuction(
  auction,
  correctPrice =
    auction.finalPrice ??
    auction.currentBid
) {
  return {
    id:
      auction.id,

    title:
      auction.title,

    description:
      auction.description,

    category:
      auction.category ||
      'Sonstiges',

    image:
      auction.image,

    images:
      [...new Set([
        auction.image,
        ...(auction.images || []),
        ...(auction.sourceImages || []).slice(1)
      ].filter(Boolean))],

    condition:
      auction.condition ||
      'Keine Angabe',

    fulfillment:
      auction.fulfillment ||
      'Siehe Auktion',

    startBid:
      auction.startBid,

    correctPrice,

    bidCount:
      auction.bidCount ||
      0,

    startAt:
      auction.startAt ||
      null,

    endAt:
      auction.endAt ||
      null,

    location:
      auction.location ||
      null,

    sourceCapturedAt:
      auction.capturedAt ||
      null,

    url:
      auction.url
  };
}

function collidesWithKeys(
  auction,
  seenKeys
) {
  return auctionDuplicateKeys(
    auction
  ).some(
    key =>
      seenKeys.has(key)
  );
}

function rememberKeys(
  auction,
  seenKeys
) {
  for (
    const key of
      auctionDuplicateKeys(
        auction
      )
  ) {
    seenKeys.add(key);
  }
}

function uniqueCandidates(
  candidates,
  blockedStrongKeys =
    new Set(),
  blockedFamilyKeys =
    new Set()
) {
  const strongKeys =
    new Set(
      blockedStrongKeys
    );

  const familyKeys =
    new Set(
      blockedFamilyKeys
    );

  const unique = [];

  for (
    const auction of
      candidates
  ) {
    if (
      collidesWithKeys(
        auction,
        strongKeys
      )
    ) {
      continue;
    }

    const family =
      auctionFamilyKey(
        auction
      );

    if (
      family &&
      familyKeys.has(
        family
      )
    ) {
      continue;
    }

    unique.push(
      auction
    );

    rememberKeys(
      auction,
      strongKeys
    );

    if (family) {
      familyKeys.add(
        family
      );
    }
  }

  return unique;
}

export function selectDailySet(
  auctions,
  dateKey,
  previousSets = {},
  count = 5
) {
  const now =
    Date.parse(
      `${dateKey}T00:00:00Z`
    );

  const historicalDates =
    Object.keys(
      previousSets
    ).sort();

  const recentDates =
    historicalDates.slice(
      -30
    );

  const previouslyUsedIds =
    new Set(
      historicalDates.flatMap(
        key =>
          previousSets[key]
            ?.auctions
            ?.map(
              item =>
                item.id
            ) ||
          []
      )
    );

  const previouslyUsedStrongKeys =
    new Set();

  for (
    const item of
      historicalDates.flatMap(
        key =>
          previousSets[key]
            ?.auctions ||
          []
      )
  ) {
    rememberKeys(
      item,
      previouslyUsedStrongKeys
    );
  }

  const recentFamilyKeys =
    new Set(
      recentDates
        .flatMap(
          key =>
            previousSets[key]
              ?.auctions ||
            []
        )
        .map(
          auctionFamilyKey
        )
        .filter(Boolean)
    );

  const recentCategoryCounts =
    recentDates
      .slice(-7)
      .flatMap(
        key =>
          previousSets[key]
            ?.auctions ||
          []
      )
      .reduce(
        (
          counts,
          item
        ) =>
          counts.set(
            item.category,
            (
              counts.get(
                item.category
              ) ||
              0
            ) + 1
          ),
        new Map()
      );

  const ranked =
    auctions
      .filter(
        auction =>
          auction?.id &&
          auction.title &&
          auction.image
      )
      .filter(
        auction =>
          Number.isFinite(
            auction.currentBid
          ) &&
          auction.currentBid >
            0
      )
      .filter(
        auction =>
          !auction.endAt ||
          Date.parse(
            auction.endAt
          ) > now
      )
      .filter(
        auction =>
          !previouslyUsedIds
            .has(
              auction.id
            )
      )
      .filter(
        auction =>
          !collidesWithKeys(
            auction,
            previouslyUsedStrongKeys
          )
      )
      .map(
        auction => ({
          ...auction,

          _quality:
            qualityScore(
              auction,
              now
            ),

          _jitter:
            deterministicJitter(
              dateKey,
              auction.id
            )
        })
      )
      .sort(
        (a, b) =>
          b._quality -
            a._quality ||
          b._jitter -
            a._jitter
      );

  const candidates =
    uniqueCandidates(
      ranked,
      new Set(),
      recentFamilyKeys
    );

  const selected = [];
  const categories =
    new Set();
  const priceBands =
    new Set();
  const endSlots =
    new Set();

  const remaining = [
    ...candidates
  ];

  while (
    selected.length <
      count &&
    remaining.length
  ) {
    remaining.sort(
      (a, b) => {
        const score =
          item =>
            item._quality +
            (
              categories.has(
                item.category
              )
                ? -100
                : 60
            ) -
            (
              recentCategoryCounts.get(
                item.category
              ) ||
              0
            ) *
              12 +
            (
              priceBands.has(
                priceBand(
                  item.currentBid
                )
              )
                ? 0
                : 20
            ) +
            (
              endSlots.has(
                endSlot(
                  item.endAt
                )
              )
                ? -260
                : 35
            ) +
            item._jitter *
              12;

        return score(b) -
          score(a);
      }
    );

    const choice =
      remaining.shift();

    selected.push(
      choice
    );

    categories.add(
      choice.category ||
      'Sonstiges'
    );

    priceBands.add(
      priceBand(
        choice.currentBid
      )
    );

    endSlots.add(
      endSlot(
        choice.endAt
      )
    );
  }

  if (
    selected.length <
    count
  ) {
    const selectedIds =
      new Set(
        selected.map(
          item =>
            item.id
        )
      );

    const selectedStrongKeys =
      new Set();

    const selectedFamilyKeys =
      new Set(
        selected
          .map(
            auctionFamilyKey
          )
          .filter(Boolean)
      );

    for (
      const item of
        selected
    ) {
      rememberKeys(
        item,
        selectedStrongKeys
      );
    }

    const archivedRanked =
      auctions
        .filter(
          item =>
            item?.id &&
            item.title &&
            item.image &&
            (
              item.finalPrice ??
              item.currentBid
            ) > 0
        )
        .filter(
          item =>
            !selectedIds.has(
              item.id
            ) &&
            !previouslyUsedIds.has(
              item.id
            )
        )
        .filter(
          item =>
            !collidesWithKeys(
              item,
              previouslyUsedStrongKeys
            )
        )
        .sort(
          (a, b) =>
            deterministicJitter(
              dateKey,
              b.id
            ) -
            deterministicJitter(
              dateKey,
              a.id
            )
        );

    const archived =
      uniqueCandidates(
        archivedRanked,
        selectedStrongKeys,
        selectedFamilyKeys
      );

    selected.push(
      ...archived.slice(
        0,
        count -
        selected.length
      )
    );
  }

  if (
    selected.length <
    count
  ) {
    throw new Error(
      `Only ${selected.length} unique eligible auctions are available; ${count} required`
    );
  }

  const ordered =
    selected.sort(
      (a, b) =>
        deterministicOrder(
          dateKey,
          a.id
        ) -
        deterministicOrder(
          dateKey,
          b.id
        )
    );

  return {
    date:
      dateKey,

    gameNumber:
      gameNumber(
        dateKey
      ),

    generatedAt:
      new Date()
        .toISOString(),

    auctions:
      ordered.map(
        ({
          _quality,
          _jitter,
          ...auction
        }) =>
          playableAuction(
            auction,
            auction.endAt &&
            Date.parse(
              auction.endAt
            ) <= now
              ? auction.finalPrice ??
                auction.currentBid
              : auction.currentBid
          )
      )
  };
}

export function selectRandomSet(
  auctions,
  count = 5,
  random = Math.random
) {
  const byId =
    [
      ...new Map(
        auctions.map(
          auction => [
            auction?.id,
            auction
          ]
        )
      ).values()
    ]
      .filter(
        auction =>
          auction?.id &&
          auction.title &&
          auction.image
      )
      .filter(
        auction =>
          Number.isFinite(
            auction.finalPrice ??
            auction.currentBid
          )
      )
      .filter(
        auction =>
          (
            auction.finalPrice ??
            auction.currentBid
          ) > 0
      );

  for (
    let index =
      byId.length - 1;
    index > 0;
    index -= 1
  ) {
    const target =
      Math.floor(
        random() *
        (
          index + 1
        )
      );

    [
      byId[index],
      byId[target]
    ] = [
      byId[target],
      byId[index]
    ];
  }

  const unique =
    uniqueCandidates(
      byId
    );

  if (
    unique.length <
    count
  ) {
    throw new Error(
      `Only ${unique.length} unique playable auctions are available; ${count} required`
    );
  }

  return {
    mode:
      'random',

    generatedAt:
      new Date()
        .toISOString(),

    auctions:
      unique
        .slice(
          0,
          count
        )
        .map(
          auction =>
            playableAuction(
              auction
            )
        )
  };
}
