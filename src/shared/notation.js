import { PIECE_NAMES } from './constants.js';

const LETTER_TO_PIECE = {
  K: 'k',
  Q: 'q',
  R: 'r',
  B: 'b',
  N: 'n',
};

const SAN_PATTERN = /^([KQRBN])?([a-h1-8]{0,2})(x)?([a-h][1-8])(?:=?([QRBN]))?([+#]+)?$/;

/**
 * Turns standard algebraic notation into a Russian phrase a beginner can read:
 * "Qxe5" -> "ферзь × e5", "Nf3" -> "конь f3", "e4" -> "пешка e4".
 * The move keeps capture, promotion, check and mate markers, and the SAN
 * disambiguation when two identical pieces can reach the same square.
 */
export function formatSan(san, { capitalize = false } = {}) {
  const text = String(san ?? '').trim().replace(/[!?]+$/, '');
  if (!text) return '—';

  const castling = /^(O-O-O|O-O|0-0-0|0-0)([+#]+)?$/.exec(text);
  if (castling) {
    const isLong = castling[1].replace(/0/g, 'O') === 'O-O-O';
    const label = isLong ? 'длинная рокировка' : 'короткая рокировка';
    return finish(label, castling[2], capitalize);
  }

  const match = SAN_PATTERN.exec(text);
  if (!match) return capitalize ? capitalizeFirst(text) : text;

  const [, pieceLetter, disambiguation, capture, destination, promotion, check] = match;
  const piece = pieceLetter ? PIECE_NAMES[LETTER_TO_PIECE[pieceLetter]] : PIECE_NAMES.p;

  let body;
  if (capture) {
    body = disambiguation
      ? `${piece} ${disambiguation} × ${destination}`
      : `${piece} × ${destination}`;
  } else if (pieceLetter && disambiguation) {
    body = `${piece} ${disambiguation}–${destination}`;
  } else {
    body = `${piece} ${destination}`;
  }

  if (promotion) body += ` = ${PIECE_NAMES[LETTER_TO_PIECE[promotion]]}`;

  return finish(body, check, capitalize);
}

function finish(body, check = '', capitalize) {
  const suffix = check.includes('#') ? ', мат' : check.includes('+') ? ', шах' : '';
  const text = `${body}${suffix}`;
  return capitalize ? capitalizeFirst(text) : text;
}

function capitalizeFirst(text) {
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}
