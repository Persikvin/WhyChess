import { SOURCE_LABELS, START_FEN } from '../shared/constants.js';
import { normalizeSan, parsePgn, sanListToPgn } from '../shared/chess-utils.js';

const CHESSCOM_MOVE_LISTS = [
  'wc-simple-move-list',
  'wc-vertical-move-list',
  'wc-horizontal-move-list',
  '.move-list',
  '.vertical-move-list',
  '#move-list',
];

const CHESSCOM_MOVE_NODES = [
  '[data-node]',
  '[data-ply]',
  '.node',
  '.move-text',
  '.node-highlight-content',
];

const CHESSCOM_BOARD = [
  'wc-chess-board',
  'chess-board',
  '#board-single',
  '#board-play-computer',
  '.board',
];

const LICHESS_MOVE_SAN = [
  '.analyse__moves move san',
  '.tview2 move san',
  '.analyse__moves move',
  '.tview2 move',
];

export function detectSource(locationLike = globalThis.location) {
  const host = locationLike?.hostname || '';
  if (host.includes('chess.com')) return 'chesscom';
  if (host.includes('lichess.org')) return 'lichess';
  return null;
}

export function extractGame(doc = document, locationLike = globalThis.location) {
  const source = detectSource(locationLike);
  if (source === 'chesscom') return extractChessCom(doc, locationLike);
  if (source === 'lichess') return extractLichess(doc, locationLike);
  return null;
}

export function extractChessCom(doc, locationLike) {
  const sans = readChessComSans(doc);
  if (sans.length === 0) return null;

  const userColor = detectChessComOrientation(doc);
  const names = readChessComNames(doc);
  const pgn = sanListToPgn(sans, {
    event: 'Партия Chess.com',
    site: locationLike?.href || 'https://www.chess.com',
    white: names.white,
    black: names.black,
    result: '*',
  });

  return finalizeGame({
    source: 'chesscom',
    pgn,
    url: locationLike?.href || '',
    userColor,
    white: names.white,
    black: names.black,
    result: '*',
    ongoing: /\/(?:play|game\/live)\//.test(locationLike?.pathname || ''),
    pageKind: 'game',
  });
}

export function extractLichess(doc, locationLike) {
  const init = readLichessPageInit(doc);
  const variant = init?.data?.game?.variant;
  if (variant && variant.key && variant.key !== 'standard') {
    return {
      source: 'lichess',
      sourceLabel: SOURCE_LABELS.lichess,
      url: locationLike?.href || '',
      error: `Поддерживаются только обычные шахматы. На этой странице вариант «${variant.name || variant.key}».`,
      unsupported: true,
    };
  }

  const userColor = normalizeColor(
    init?.data?.player?.color || detectLichessOrientation(doc) || init?.data?.orientation,
  );
  const orientation = normalizeColor(init?.data?.orientation) || userColor || 'w';
  const treeAttempt = init ? readLichessTreeGame(init, locationLike, orientation) : null;  if (treeAttempt) {
    const finalized = finalizeGame({ ...treeAttempt, userColor: treeAttempt.userColor || userColor });
    if (!finalized.error) return finalized;
  }

  const pgnAttempt = readLichessPgnText(doc);
  if (pgnAttempt) {
    const finalized = finalizeGame({
      source: 'lichess',
      pgn: pgnAttempt,
      url: locationLike?.href || '',
      userColor,
      ongoing: isLichessOngoing(init),
      pageKind: init?.mode || 'analysis',
    });
    if (!finalized.error) return finalized;
  }

  const domSans = readLichessDomSans(doc);
  if (domSans.length > 0) {
    const pgn = sanListToPgn(domSans, {
      event: 'Партия Lichess',
      site: locationLike?.href || 'https://lichess.org',
      white: 'Белые',
      black: 'Чёрные',
    });
    const finalized = finalizeGame({
      source: 'lichess',
      pgn,
      url: locationLike?.href || '',
      userColor,
      ongoing: isLichessOngoing(init),
      pageKind: init?.mode || 'analysis',
    });
    if (!finalized.error) return finalized;
  }

  return null;
}

export function gameFromPgn(pgn, locationLike = globalThis.location) {
  return finalizeGame({
    source: 'manual',
    pgn,
    url: locationLike?.href || '',
    userColor: null,
    ongoing: false,
    pageKind: 'manual',
  });
}

export function shouldAutoOpen(game, locationLike = globalThis.location) {
  if (!game || game.error || game.unsupported || game.ongoing) return false;
  const path = locationLike?.pathname || '';
  if (game.source === 'chesscom') {
    return !/\/(?:play|game\/live)\//.test(path);
  }
  if (game.source === 'lichess') {
    if (path === '/' || /^\/(?:training|practice|learn|video|broadcast|tv|forum|blog|team|coach)/.test(path)) {
      return false;
    }
    return true;
  }
  return false;
}

/**
 * Returns the clickable mainline move nodes in ply order. Used only for the
 * optional "show on board" action; the review itself never depends on it.
 */
export function mainlineMoveElements(doc = document, source = null) {
  if (source === 'lichess') {
    const nodes = Array.from(doc.querySelectorAll('.analyse__moves move, .tview2 move'));
    // A finished Lichess game renders the server analysis inline: the mainline
    // is followed by "branch" blocks with alternative moves (`move.comp`).
    // They share the same <move> tag but must not shift the ply indexes.
    return unique(nodes.filter((node) => !isLichessVariation(node)));
  }
  if (source !== 'chesscom') return [];

  const list = queryFirst(doc, CHESSCOM_MOVE_LISTS);
  if (!list) return [];
  const indexed = Array.from(list.querySelectorAll('[data-node]')).filter((node) => {
    if (!/^0-\d+$/.test(node.getAttribute('data-node') || '')) return false;
    return !node.parentElement?.closest('[data-node]');
  });
  if (indexed.length > 0) {
    return unique(indexed).sort(
      (a, b) => Number(a.getAttribute('data-node').split('-')[1]) - Number(b.getAttribute('data-node').split('-')[1]),
    );
  }
  return Array.from(list.querySelectorAll('.node, .move')).filter(
    (node) => !node.closest('.variation, .variations'),
  );
}

function unique(elements) {
  return Array.from(new Set(elements));
}

function isLichessVariation(node) {
  return Boolean(node.closest('branch, lines, inline, move.comp')) || node.classList.contains('comp');
}


function finalizeGame(input) {
  try {
    const parsed = parsePgn(input.pgn);
    const sans = parsed.allMoves.map((move) => move.san);
    return {
      source: input.source,
      sourceLabel: SOURCE_LABELS[input.source] || 'PGN',
      url: input.url || '',
      pgn: input.pgn,
      sans,
      userColor: input.userColor || null,
      white: input.white || parsed.white,
      black: input.black || parsed.black,
      result: input.result || parsed.result,
      initialFen: parsed.initialFen,
      totalMoves: sans.length,
      headers: parsed.headers,
      ongoing: Boolean(input.ongoing),
      pageKind: input.pageKind || 'game',
      signature: makeSignature(input.source, input.url, parsed.initialFen, sans),
    };
  } catch (error) {
    return {
      source: input.source,
      sourceLabel: SOURCE_LABELS[input.source] || 'PGN',
      url: input.url || '',
      pgn: input.pgn,
      error: error instanceof Error ? error.message : 'Не удалось прочитать партию.',
      unsupported: error?.code === 'UNSUPPORTED_VARIANT',
      ongoing: Boolean(input.ongoing),
      pageKind: input.pageKind || 'game',
    };
  }
}

function makeSignature(source, url, initialFen, sans) {
  return [
    source,
    // Lichess stores the current board position in the URL hash. Jumping to a
    // move must not look like a different game to the content script.
    String(url || '').split('#')[0],
    initialFen,
    sans.length,
    sans[0] || '',
    sans[sans.length - 1] || '',
  ].join('|');
}

function readChessComSans(doc) {
  const list = queryFirst(doc, CHESSCOM_MOVE_LISTS);
  if (!list) return [];
  const nodes = queryAllFirst(list, CHESSCOM_MOVE_NODES);
  if (nodes.length === 0) return [];

  const entries = [];
  for (const node of nodes) {
    const dataNode = node.getAttribute('data-node') || node.dataset?.node || '';
    if (dataNode) {
      const [variation] = dataNode.split('-');
      if (variation && variation !== '0') continue;
    }
    const ply = chessComPly(node);
    const explicitSan = node.getAttribute('data-san') || node.dataset?.san || '';
    const san = normalizeSan(explicitSan) || normalizeSan(extractNodeText(node));
    if (!san) continue;
    entries.push({ node, ply, san, order: entries.length });
  }

  const allIndexed = entries.length > 0 && entries.every((entry) => entry.ply !== null);
  if (allIndexed) {
    entries.sort((a, b) => a.ply - b.ply || a.order - b.order);
    const seen = new Set();
    return entries
      .filter((entry) => {
        if (seen.has(entry.ply)) return false;
        seen.add(entry.ply);
        return true;
      })
      .map((entry) => entry.san);
  }
  return entries.map((entry) => entry.san);
}

function chessComPly(node) {
  const dataPly = node.getAttribute('data-ply');
  if (dataPly !== null && dataPly !== '' && Number.isFinite(Number(dataPly))) {
    return Number(dataPly);
  }
  const dataNode = node.getAttribute('data-node');
  if (dataNode) {
    const parts = dataNode.split('-');
    if (parts.length === 2 && parts[0] === '0' && Number.isFinite(Number(parts[1]))) {
      return Number(parts[1]);
    }
  }
  return null;
}

function extractNodeText(node) {
  let output = '';
  const walk = (current) => {
    if (current.nodeType === 3) {
      output += current.textContent || '';
      return;
    }
    if (current.nodeType !== 1) return;
    const element = current;
    const letter = figurineLetter(element);
    if (letter !== null) {
      output += letter;
      return;
    }
    for (const child of element.childNodes) walk(child);
  };
  walk(node);
  return output;
}

function figurineLetter(element) {
  const classText = element.getAttribute('class') || '';
  if (!/icon-font-chess|figurine|move-piece/.test(classText)) return null;
  const names = [
    ['king', 'K'],
    ['queen', 'Q'],
    ['rook', 'R'],
    ['bishop', 'B'],
    ['knight', 'N'],
    ['pawn', ''],
  ];
  for (const [name, letter] of names) {
    if (new RegExp(`\\b${name}\\b`).test(classText)) return letter;
  }
  return '';
}

function readChessComNames(doc) {
  const white = textOf(
    doc,
    '.player.color-white .username, .player-white .username, .player.white .username',
  );
  const black = textOf(
    doc,
    '.player.color-black .username, .player-black .username, .player.black .username',
  );
  return {
    white: white || 'Белые',
    black: black || 'Чёрные',
  };
}

function detectChessComOrientation(doc) {
  const board = queryFirst(doc, CHESSCOM_BOARD);
  if (!board) return null;
  return board.classList.contains('flipped') ? 'b' : 'w';
}

function readLichessPageInit(doc) {
  const script = doc.getElementById('page-init-data');
  if (!script?.textContent) return null;
  try {
    const parsed = JSON.parse(script.textContent);
    const cfg = parsed.cfg || parsed;
    return {
      mode: parsed.mode || 'analysis',
      data: cfg.data || {},
    };
  } catch {
    return null;
  }
}

function readLichessTreeGame(init, locationLike, fallbackUserColor) {
  const parts = Array.isArray(init.data?.treeParts) ? init.data.treeParts : [];
  if (parts.length < 2) return null;
  const sorted = [...parts].sort((a, b) => (a.ply || 0) - (b.ply || 0));
  const root = sorted.find((part) => part.ply === 0) || { fen: START_FEN };
  const sans = sorted
    .filter((part) => part.ply > 0 && part.san)
    .map((part) => part.san);
  if (sans.length === 0) return null;

  const data = init.data;
  const playerName = data.player?.user?.username || data.player?.name;
  const opponentName = data.opponent?.user?.username || data.opponent?.name;
  const playerColor = normalizeColor(data.player?.color) || fallbackUserColor;
  const white =
    data.player?.color === 'white'
      ? playerName
      : data.player?.color === 'black'
        ? opponentName
        : null;
  const black =
    data.player?.color === 'black'
      ? playerName
      : data.player?.color === 'white'
        ? opponentName
        : null;
  const winner = data.game?.winner;
  const result =
    winner === 'white' ? '1-0' : winner === 'black' ? '0-1' : data.game?.status?.name === 'draw' ? '1/2-1/2' : '*';

  const pgn = sanListToPgn(sans, {
    event: 'Партия Lichess',
    site: locationLike?.href || 'https://lichess.org',
    white: white || 'Белые',
    black: black || 'Чёрные',
    result,
    startFen: root.fen || START_FEN,
  });

  return {
    source: 'lichess',
    pgn,
    url: locationLike?.href || '',
    userColor: playerColor,
    white: white || 'Белые',
    black: black || 'Чёрные',
    result,
    ongoing: isLichessOngoing(init),
    pageKind: init.mode,
  };
}

function readLichessPgnText(doc) {
  const textarea = doc.querySelector('.copyables .pgn textarea, .analyse__underboard .pgn textarea');
  if (textarea?.value?.trim()) return textarea.value.trim();
  const pgnElement = doc.querySelector('.pgn');
  if (pgnElement?.textContent?.trim()) return pgnElement.textContent.trim();
  return null;
}

function readLichessDomSans(doc) {
  for (const selector of LICHESS_MOVE_SAN) {
    const nodes = Array.from(doc.querySelectorAll(selector));
    if (nodes.length === 0) continue;
    const sans = [];
    for (const node of nodes) {
      if (isLichessVariation(node)) continue;
      const sanNode = node.matches('san') ? node : node.querySelector('san');
      const raw = sanNode?.textContent || node.textContent || '';
      const san = normalizeSan(raw);
      if (san) sans.push(san);
    }
    if (sans.length > 0) return sans;
  }
  return [];
}

function detectLichessOrientation(doc) {
  const wrap = doc.querySelector('.cg-wrap');
  if (wrap) return wrap.classList.contains('orientation-black') ? 'b' : 'w';
  return null;
}

function normalizeColor(value) {
  if (value === 'w' || value === 'white') return 'w';
  if (value === 'b' || value === 'black') return 'b';
  return null;
}

function isLichessOngoing(init) {
  return init?.data?.game?.status?.id === 20 || init?.data?.game?.status?.name === 'started';
}

function queryFirst(root, selectors) {
  for (const selector of selectors) {
    const element = root.querySelector(selector);
    if (element) return element;
  }
  return null;
}

function queryAllFirst(root, selectors) {
  for (const selector of selectors) {
    const elements = Array.from(root.querySelectorAll(selector));
    if (elements.length > 0) return elements;
  }
  return [];
}

function textOf(root, selector) {
  const element = root.querySelector(selector);
  return element?.textContent?.trim() || '';
}
