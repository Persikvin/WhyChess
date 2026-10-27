export const APP_NAME = 'WhyChess';
export const APP_VERSION = '1.0.0';

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export const MATE_VALUE = 100000;
export const MATE_DISPLAY_THRESHOLD = MATE_VALUE - 1000;

export const DEFAULT_SETTINGS = Object.freeze({
  depth: 10,
  maxPlies: 80,
  autoOpen: true,
  showArrow: true,
});

export const DEPTH_MIN = 4;
export const DEPTH_MAX = 18;
export const MAX_PLIES_LIMIT = 300;

export const CLASSIFICATION_META = Object.freeze({
  best: { label: 'лучший ход', short: 'лучший', tone: 'best' },
  excellent: { label: 'отличный ход', short: 'отлично', tone: 'excellent' },
  good: { label: 'хороший ход', short: 'хорошо', tone: 'good' },
  inaccuracy: { label: 'неточность', short: 'неточность', tone: 'inaccuracy' },
  mistake: { label: 'ошибка', short: 'ошибка', tone: 'mistake' },
  blunder: { label: 'грубая ошибка', short: 'грубая ошибка', tone: 'blunder' },
  forced: { label: 'вынужденный ход', short: 'вынужденный', tone: 'forced' },
});

export const ERROR_CLASSIFICATIONS = Object.freeze(['inaccuracy', 'mistake', 'blunder']);

export const PIECE_VALUES = Object.freeze({
  p: 100,
  n: 320,
  b: 330,
  r: 500,
  q: 900,
  k: 20000,
});

export const PIECE_NAMES = Object.freeze({
  p: 'пешка',
  n: 'конь',
  b: 'слон',
  r: 'ладья',
  q: 'ферзь',
  k: 'король',
});

export const PIECE_NAMES_ACCUSATIVE = Object.freeze({
  p: 'пешку',
  n: 'коня',
  b: 'слона',
  r: 'ладью',
  q: 'ферзя',
  k: 'короля',
});

export const PIECE_NAMES_GENITIVE = Object.freeze({
  p: 'пешки',
  n: 'коня',
  b: 'слона',
  r: 'ладьи',
  q: 'ферзя',
  k: 'короля',
});

export const PIECE_LETTERS = Object.freeze({
  p: '',
  n: 'N',
  b: 'B',
  r: 'R',
  q: 'Q',
  k: 'K',
});

export const SOURCE_LABELS = Object.freeze({
  chesscom: 'Chess.com',
  lichess: 'Lichess',
  manual: 'PGN',
});
