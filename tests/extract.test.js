import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import {
  detectSource,
  extractChessCom,
  extractGame,
  extractLichess,
  gameFromPgn,
  mainlineMoveElements,
  shouldAutoOpen,
} from '../src/content/extract.js';
import { START_FEN } from '../src/shared/constants.js';

const SAMPLE_PGN = `[Event "Тестовая партия"]
[Site "https://lichess.org/test"]
[White "Алиса"]
[Black "Боб"]
[Result "1-0"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 1-0
`;

function documentFrom(html) {
  return new JSDOM(`<!doctype html><html><body>${html}</body></html>`, {
    url: 'https://lichess.org/analysis',
  }).window.document;
}

function locationLike(url) {
  const parsed = new URL(url);
  return {
    href: parsed.href,
    hostname: parsed.hostname,
    pathname: parsed.pathname,
  };
}

function chessComDocument() {
  return documentFrom(`
    <wc-simple-move-list>
      <div data-node="0-1"><span class="node-highlight-content">e4</span></div>
      <div data-node="0-2"><span class="node-highlight-content">e5</span></div>
      <div data-node="0-3"><span class="icon-font-chess knight"></span><span class="node-highlight-content">f3</span></div>
      <div data-node="0-4"><span class="node-highlight-content">Nc6</span></div>
      <div data-node="0-5"><span class="node-highlight-content">Bb5</span></div>
      <div data-node="0-6"><span class="node-highlight-content">a6</span></div>
      <div data-node="1-2"><span class="node-highlight-content">d4</span></div>
    </wc-simple-move-list>
    <wc-chess-board class="flipped"></wc-chess-board>
    <div class="player color-white"><span class="username">Alice</span></div>
    <div class="player color-black"><span class="username">Bob</span></div>
  `);
}

function lichessInit(data) {
  const payload = { mode: 'analysis', cfg: { data } };
  return documentFrom(`
    <script id="page-init-data" type="application/json">${JSON.stringify(payload)}</script>
  `);
}

describe('detectSource', () => {
  it('recognises the supported sites', () => {
    expect(detectSource({ hostname: 'www.chess.com' })).toBe('chesscom');
    expect(detectSource({ hostname: 'lichess.org' })).toBe('lichess');
    expect(detectSource({ hostname: 'example.com' })).toBeNull();
    expect(detectSource(null)).toBeNull();
  });

  it('routes extractGame to the matching extractor', () => {
    const location = locationLike('https://www.chess.com/game/123');
    const game = extractGame(chessComDocument(), location);
    expect(game.source).toBe('chesscom');
    expect(extractGame(documentFrom(''), location)).toBeNull();
  });
});

describe('Chess.com extraction', () => {
  const location = locationLike('https://www.chess.com/game/123');

  it('reads the mainline, names and board orientation', () => {
    const game = extractChessCom(chessComDocument(), location);
    expect(game).toMatchObject({
      source: 'chesscom',
      sourceLabel: 'Chess.com',
      url: 'https://www.chess.com/game/123',
      userColor: 'b',
      white: 'Alice',
      black: 'Bob',
      result: '*',
      initialFen: START_FEN,
      totalMoves: 6,
      ongoing: false,
      pageKind: 'game',
    });
    expect(game.sans).toEqual(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6']);
    expect(game.error).toBeUndefined();
    expect(game.signature).toContain('chesscom|');
  });

  it('falls back to plain move nodes without data-attributes', () => {
    const doc = documentFrom(`
      <div class="move-list">
        <div class="node">1. e4</div>
        <div class="node">e5</div>
        <div class="node">2. Nf3</div>
        <div class="node">Nc6</div>
      </div>
    `);
    const game = extractChessCom(doc, location);
    expect(game.sans).toEqual(['e4', 'e5', 'Nf3', 'Nc6']);
  });

  it('returns null when there is no move list', () => {
    expect(extractChessCom(documentFrom('<div>no game</div>'), location)).toBeNull();
  });

  it('flags a game that is still being played', () => {
    const game = extractChessCom(
      chessComDocument(),
      locationLike('https://www.chess.com/play/computer'),
    );
    expect(game.ongoing).toBe(true);
  });
});

describe('Lichess extraction', () => {
  const location = locationLike('https://lichess.org/analysis/abc');

  it('reads a completed game from page-init-data', () => {
    const doc = lichessInit({
      game: {
        variant: { key: 'standard', name: 'Standard' },
        status: { id: 60, name: 'finished' },
        winner: 'white',
      },
      player: { color: 'white', user: { username: 'Alice' } },
      opponent: { color: 'black', user: { username: 'Bob' } },
      orientation: 'white',
      treeParts: [
        { ply: 0, fen: START_FEN },
        { ply: 1, san: 'e4' },
        { ply: 2, san: 'e5' },
        { ply: 3, san: 'Nf3' },
      ],
    });

    const game = extractLichess(doc, location);
    expect(game).toMatchObject({
      source: 'lichess',
      sourceLabel: 'Lichess',
      userColor: 'w',
      white: 'Alice',
      black: 'Bob',
      result: '1-0',
      ongoing: false,
      pageKind: 'analysis',
      initialFen: START_FEN,
    });
    expect(game.sans).toEqual(['e4', 'e5', 'Nf3']);
  });

  it('normalises black colour and swaps player names', () => {
    const doc = lichessInit({
      game: { variant: { key: 'standard' }, status: { id: 60 }, winner: 'black' },
      player: { color: 'black', user: { username: 'Bob' } },
      opponent: { color: 'white', user: { username: 'Alice' } },
      orientation: 'white',
      treeParts: [
        { ply: 0, fen: START_FEN },
        { ply: 1, san: 'd4' },
      ],
    });

    const game = extractLichess(doc, location);
    expect(game.userColor).toBe('b');
    expect(game.white).toBe('Alice');
    expect(game.black).toBe('Bob');
    expect(game.result).toBe('0-1');
  });

  it('rejects unsupported variants', () => {
    const doc = lichessInit({
      game: { variant: { key: 'chess960', name: 'Chess960' } },
      treeParts: [{ ply: 0, fen: START_FEN }],
    });
    const game = extractLichess(doc, location);
    expect(game.unsupported).toBe(true);
    expect(game.error).toContain('Chess960');
  });

  it('falls back to the visible move list and skips variations', () => {
    const doc = documentFrom(`
      <div class="analyse__moves">
        <move><san>e4</san></move>
        <move><san>e5</san></move>
        <lines><move><san>d4</san></move></lines>
        <move><san>Nf3</san></move>
        <move><san>Nc6</san></move>
      </div>
    `);
    const game = extractLichess(doc, location);
    expect(game.sans).toEqual(['e4', 'e5', 'Nf3', 'Nc6']);
    expect(game.userColor).toBeNull();
  });

  it('falls back to the PGN textarea and board orientation', () => {
    const doc = documentFrom(`
      <div class="cg-wrap orientation-black"></div>
      <div class="copyables"><div class="pgn"><textarea>${SAMPLE_PGN}</textarea></div></div>
    `);
    const game = extractLichess(doc, locationLike('https://lichess.org/analysis/xyz'));
    expect(game.sans).toEqual(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6']);
    expect(game.white).toBe('Алиса');
    expect(game.black).toBe('Боб');
    expect(game.userColor).toBe('b');
  });

  it('returns null when the page has no game', () => {
    expect(extractLichess(documentFrom('<div>analysis board</div>'), location)).toBeNull();
  });
});

describe('gameFromPgn', () => {
  it('creates a manual review game', () => {
    const game = gameFromPgn(SAMPLE_PGN, locationLike('https://example.com/'));
    expect(game).toMatchObject({
      source: 'manual',
      sourceLabel: 'PGN',
      userColor: null,
      totalMoves: 6,
      white: 'Алиса',
      black: 'Боб',
    });
    expect(game.sans).toEqual(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6']);
  });

  it('reports invalid, empty and unsupported PGN', () => {
    expect(gameFromPgn('1. e4 e5 2. Bh6').error).toMatch(
      /Не удалось прочитать PGN/,
    );
    expect(gameFromPgn('   ').error).toMatch(/PGN пустой/);
    const unsupported = gameFromPgn('[Variant "Chess960"]\n\n1. e4 e5 *');
    expect(unsupported.unsupported).toBe(true);
    expect(unsupported.error).toContain('Chess960');
  });
});

describe('shouldAutoOpen', () => {
  it('skips ongoing, errored and unsupported games', () => {
    expect(shouldAutoOpen(null)).toBe(false);
    expect(shouldAutoOpen({ source: 'lichess', error: 'bad' })).toBe(false);
    expect(shouldAutoOpen({ source: 'lichess', unsupported: true })).toBe(false);
    expect(shouldAutoOpen({ source: 'lichess', ongoing: true })).toBe(false);
  });

  it('opens finished Chess.com games but not live play', () => {
    const game = { source: 'chesscom', ongoing: false };
    expect(shouldAutoOpen(game, { pathname: '/game/123' })).toBe(true);
    expect(shouldAutoOpen(game, { pathname: '/game/live/123' })).toBe(false);
    expect(shouldAutoOpen(game, { pathname: '/play/computer' })).toBe(false);
  });

  it('opens Lichess analysis pages but not unrelated sections', () => {
    const game = { source: 'lichess', ongoing: false };
    expect(shouldAutoOpen(game, { pathname: '/analysis/abc' })).toBe(true);
    expect(shouldAutoOpen(game, { pathname: '/' })).toBe(false);
    expect(shouldAutoOpen(game, { pathname: '/training' })).toBe(false);
    expect(shouldAutoOpen(game, { pathname: '/practice' })).toBe(false);
    expect(shouldAutoOpen(game, { pathname: '/broadcast/abc' })).toBe(false);
    expect(shouldAutoOpen(game, { pathname: '/tv' })).toBe(false);
  });

  it('never auto-opens manual reviews', () => {
    expect(shouldAutoOpen({ source: 'manual', ongoing: false }, { pathname: '/game/1' })).toBe(
      false,
    );
  });
});

describe('mainlineMoveElements', () => {
  it('returns Lichess mainline nodes without variations', () => {
    const doc = documentFrom(`
      <div class="analyse__moves">
        <move id="m1"><san>e4</san></move>
        <move id="m2"><san>e5</san></move>
        <lines><move id="variation"><san>d4</san></move></lines>
        <move id="m3"><san>Nf3</san></move>
      </div>
    `);
    const nodes = mainlineMoveElements(doc, 'lichess');
    expect(nodes.map((node) => node.id)).toEqual(['m1', 'm2', 'm3']);
  });

  it('sorts Chess.com nodes by ply and ignores nested duplicates', () => {
    const doc = documentFrom(`
      <wc-simple-move-list>
        <div data-node="0-2" id="second"></div>
        <div data-node="0-1" id="first"></div>
        <div data-node="0-3" id="outer"><span data-node="0-3" id="inner"></span></div>
      </wc-simple-move-list>
    `);
    const nodes = mainlineMoveElements(doc, 'chesscom');
    expect(nodes.map((node) => node.id)).toEqual(['first', 'second', 'outer']);
  });

  it('falls back to plain Chess.com nodes and excludes variations', () => {
    const doc = documentFrom(`
      <div class="move-list">
        <div class="node" id="m1">e4</div>
        <div class="variation"><div class="node" id="var">d4</div></div>
        <div class="node" id="m2">e5</div>
      </div>
    `);
    const nodes = mainlineMoveElements(doc, 'chesscom');
    expect(nodes.map((node) => node.id)).toEqual(['m1', 'm2']);
  });

  it('returns an empty list for unknown sources and missing boards', () => {
    expect(mainlineMoveElements(documentFrom('<div></div>'), null)).toEqual([]);
    expect(mainlineMoveElements(documentFrom('<div></div>'), 'chesscom')).toEqual([]);
  });
});
