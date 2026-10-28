import {
  CLASSIFICATION_META,
  MATE_DISPLAY_THRESHOLD,
  PIECE_NAMES,
  PIECE_NAMES_ACCUSATIVE,
  PIECE_NAMES_GENITIVE,
} from './constants.js';
import {
  evaluationSummary,
  formatEvaluation,
  formatLoss,
  scoreToWhite,
} from './chess-utils.js';
import { formatSan } from './notation.js';

const PIECE_SUBJECTS = {
  p: 'Пешка',
  n: 'Конь',
  b: 'Слон',
  r: 'Ладья',
  q: 'Ферзь',
  k: 'Король',
};

export function buildExplanation(context) {
  return buildExplanationRich(context).map(paragraphText);
}

/**
 * Same explanation as buildExplanation, but split into presentational tokens.
 * The panel renders labels in bold and move tokens in the colour of the side
 * that made the move.
 */
export function buildExplanationRich(context) {
  const {
    bestFeatures,
    playedFeatures,
    forced,
    isBest,
    isUser = false,
    classification,
    lossCp,
    bestScore,
    turn,
    afterScore,
    afterTurn,
    bestPvSan = [],
    refutation = null,
    depth,
  } = context;

  const paragraphs = [];
  const bestColor = bestFeatures?.color || turn;
  const bestSan = bestFeatures?.san || context.bestSan || '—';
  const bestName = bestFeatures ? PIECE_NAMES[bestFeatures.piece] : 'фигура';

  if (forced) {
    paragraphs.push(
      paragraph(
        bold('Лучший ход'),
        ' — ',
        move(bestSan, bestColor),
        '. У стороны был только один законный ход, поэтому движок не сравнивал его с альтернативами.',
      ),
    );
  } else if (isBest) {
    paragraphs.push(
      isUser
        ? paragraph(
            bold('Вы нашли лучший ход'),
            ' — ',
            move(bestSan, bestColor),
            '.',
          )
        : paragraph(
            bold('Лучший ход'),
            ' — ',
            move(bestSan, bestColor),
            '; именно он и был сыгран.',
          ),
    );
  } else {
    paragraphs.push(paragraph(bold('Лучший ход'), ' — ', move(bestSan, bestColor), '.'));
  }

  if (bestFeatures) {
    const action = describeMove(bestFeatures);
    const effects = describePositionalEffects(bestFeatures);
    const threat = describeThreats(bestFeatures);
    const firstParagraph = [action, effects, threat].filter(Boolean).join(' ');
    if (firstParagraph) paragraphs.push(paragraph(firstParagraph));
  }

  if (bestScore) {
    const bestEval = formatEvaluation(bestScore, turn);
    const summary = evaluationSummary(bestScore, turn);
    paragraphs.push(
      paragraph(`Оценка позиции после рекомендованного продолжения — ${bestEval}; ${summary}.`),
    );
  }

  if (bestPvSan.length >= 2) {
    paragraphs.push(
      paragraph(
        `Движок на глубине ${depth} рассматривает вариант: `,
        moveSequence(bestPvSan.slice(0, 8), bestColor),
        '.',
      ),
    );
  }

  if (!isBest && playedFeatures && !forced) {
    const label = CLASSIFICATION_META[classification]?.label || 'неточность';
    const playedDescription = describeMove(playedFeatures);
    const playedColor = playedFeatures.color || turn;
    paragraphs.push(
      isUser
        ? paragraph(
            bold('Вы сыграли ход'),
            ' «',
            move(playedFeatures.san, playedColor),
            '». ',
            playedDescription,
          )
        : paragraph(
            bold('Было сыграно'),
            ': «',
            move(playedFeatures.san, playedColor),
            '». ',
            playedDescription,
          ),
    );

    const lossText = formatLoss(lossCp);
    const quality =
      classification === 'inaccuracy'
        ? 'Это неточность: ход не проигрывает сразу, но упускает более точное продолжение.'
        : classification === 'mistake'
          ? 'Это ошибка: позиция заметно ухудшается.'
          : classification === 'blunder'
            ? 'Это грубая ошибка: последствия для позиции очень серьёзные.'
            : `Это ${label}.`;
    const lossSentence =
      lossCp >= MATE_DISPLAY_THRESHOLD
        ? 'По расчёту движка ход ведёт к мату.'
        : lossCp > 0
          ? `По расчёту движка ход уступает лучшему примерно на ${lossText}.`
          : 'По расчёту движка разница с лучшим ходом минимальна.';
    paragraphs.push(paragraph(`${quality} ${lossSentence}`));

    if (afterScore) {
      paragraphs.push(
        paragraph(
          `${isUser ? 'После вашего хода' : 'После этого хода'} оценка — ${formatEvaluation(afterScore, afterTurn)}; ${evaluationSummary(afterScore, afterTurn)}.`,
        ),
      );
      const note = stillBetterNote({
        isUser,
        classification,
        playedColor,
        afterScore,
        afterTurn,
      });
      if (note) paragraphs.push(paragraph(note));
    }

    if (refutation?.san) {
      const refutationColor = afterTurn || otherColor(playedColor);
      const lineParts = [];
      if (refutation.pvSan?.length > 1) {
        lineParts.push(' (', moveSequence(refutation.pvSan.slice(0, 5), refutationColor), ')');
      }
      paragraphs.push(
        paragraph(
          'Соперник мог ответить: ',
          move(refutation.san, refutationColor),
          ...lineParts,
          '.',
        ),
      );
    }
  } else if (isBest && !forced) {
    const lossText =
      lossCp <= 5
        ? 'без потери оценки'
        : lossCp >= MATE_DISPLAY_THRESHOLD
          ? 'но с потерей, ведущей к мату'
          : `с минимальной потерей ${formatLoss(lossCp)}`;
    paragraphs.push(
      paragraph(
        isUser
          ? `Выбор совпал с рекомендацией движка, ${lossText}.`
          : `Сыгранный ход совпал с рекомендацией движка, ${lossText}.`,
      ),
    );
  }

  if (context.truncated) {
    paragraphs.push(paragraph('Партия разобрана не до конца: достигнут заданный предел числа полуходов.'));
  }

  if (paragraphs.length === 1 && bestName) {
    paragraphs.push(paragraph('Этот ход движок считает наиболее точным в данной позиции.'));
  }

  return paragraphs;
}

function paragraph(...tokens) {
  return tokens.flat().map((token) => (typeof token === 'string' ? { text: token } : token));
}

function paragraphText(tokens) {
  return tokens.map((token) => token.text).join('');
}

function bold(text) {
  return { text, bold: true };
}

function move(san, color) {
  return { text: formatSan(san), move: color === 'w' || color === 'b' ? color : null };
}

function moveSequence(sans, startColor) {
  const tokens = [];
  let color = startColor === 'b' ? 'b' : 'w';
  sans.forEach((san, index) => {
    if (index > 0) tokens.push(' ');
    tokens.push(move(san, color));
    color = otherColor(color);
  });
  return tokens;
}

function otherColor(color) {
  return color === 'b' ? 'w' : 'b';
}

/**
 * A move can lose several pawns of advantage and still leave its author ahead.
 * Without this remark "грубая ошибка" next to a positive evaluation looks like
 * a contradiction to a beginner, so state that the position is still better for
 * the side that played the move.
 */
function stillBetterNote({ isUser, classification, playedColor, afterScore, afterTurn }) {
  if (!isUser || (classification !== 'mistake' && classification !== 'blunder')) return null;
  const white = scoreToWhite(afterScore, afterTurn);
  const swing = white.type === 'mate' ? Math.sign(white.value) : Number(white.value) || 0;
  const betterSide = swing > 0 ? 'w' : 'b';
  if (betterSide !== playedColor) return null;
  const pawns = Math.abs(swing) / 100;
  if (pawns >= 3) {
    return 'Несмотря на потерю, запас преимущества по-прежнему большой, и позиция остаётся в вашу пользу.';
  }
  if (pawns > 0.6) {
    return 'Несмотря на потерю, позиция всё ещё в вашу пользу.';
  }
  return null;
}

export function describeMove(features) {
  if (!features) return '';
  const {
    piece,
    from,
    to,
    san,
    isCastle,
    castleSide,
    isCapture,
    captured,
    isEnPassant,
    isPromotion,
    promotion,
    isCheckmate,
    isCheck,
    centerSquaresAttacked,
    openFileAfter,
    isDeveloping,
  } = features;

  const subject = PIECE_SUBJECTS[piece] || 'Фигура';
  const sentences = [];

  if (isCastle) {
    const side = castleSide === 'kingside' ? 'короткую' : 'длинную';
    const rookFrom = castleSide === 'kingside' ? (features.color === 'w' ? 'h1' : 'h8') : features.color === 'w' ? 'a1' : 'a8';
    const rookTo = castleSide === 'kingside' ? (features.color === 'w' ? 'f1' : 'f8') : features.color === 'w' ? 'd1' : 'd8';
    const kingTo = castleSide === 'kingside' ? (features.color === 'w' ? 'g1' : 'g8') : features.color === 'w' ? 'c1' : 'c8';
    sentences.push(
      `Рокировка в ${side} сторону уводит короля на ${kingTo}, а ладью с ${rookFrom} на ${rookTo}.`,
    );
  } else if (isPromotion) {
    const promotionName = PIECE_NAMES_ACCUSATIVE[promotion] || 'ферзя';
    if (isCapture) {
      sentences.push(
        `Пешка с ${from} забирает ${PIECE_NAMES_ACCUSATIVE[captured] || 'фигуру'} на ${to} и превращается в ${promotionName}.`,
      );
    } else {
      sentences.push(
        `Пешка с ${from} идёт на ${to} и превращается в ${promotionName}.`,
      );
    }
  } else if (isEnPassant) {
    const capturedSquare = `${to[0]}${from[1]}`;
    sentences.push(
      `Пешка с ${from} забирает пешку на ${capturedSquare} на проходе и оказывается на ${to}.`,
    );
  } else if (isCapture) {
    sentences.push(
      `${subject} с ${from} забирает ${PIECE_NAMES_ACCUSATIVE[captured] || 'фигуру'} на ${to}.`,
    );
  } else if (piece === 'p') {
    const central = centerSquaresAttacked?.length > 0;
    if (central) {
      sentences.push(
        `Пешка идёт с ${from} на ${to}; с поля ${to} она берёт под контроль ${centerSquaresAttacked.join(', ')}.`,
      );
    } else {
      sentences.push(`Пешка продвигается с ${from} на ${to} и получает больше пространства.`);
    }
  } else if (isDeveloping) {
    sentences.push(
      `${subject} с ${from} переходит на ${to}; это развитие фигуры.`,
    );
  } else if (piece === 'k') {
    sentences.push(`${subject} уходит с ${from} на ${to}.`);
  } else {
    sentences.push(`${subject} с ${from} переходит на ${to}.`);
  }

  if (centerSquaresAttacked?.length > 0 && piece !== 'p') {
    sentences.push(`С поля ${to} фигура контролирует ${centerSquaresAttacked.join(', ')}.`);
  }

  if (openFileAfter) {
    sentences.push(`Фигура занимает открытую линию ${to[0]}.`);
  }

  if (isCheckmate) {
    sentences.push('Это мат: король соперника не может уйти из-под удара.');
  } else if (isCheck) {
    sentences.push('Ход даёт шах и заставляет соперника реагировать на угрозу королю.');
  }

  return sentences.join(' ');
}

function describePositionalEffects(features) {
  const sentences = [];

  if (features.isCastle) {
    sentences.push('Король оказывается в безопасности, а ладья входит в игру.');
  }

  if (features.resolvedThreats?.length > 0) {
    const first = features.resolvedThreats[0];
    if (first.movedAway) {
      sentences.push(`Одновременно фигура уходит с ${first.square} из-под удара.`);
    } else {
      sentences.push(`Ход защищает ${PIECE_NAMES_ACCUSATIVE[first.type] || 'фигуру'} на ${first.square}.`);
    }
    if (features.resolvedThreats.length > 1) {
      const second = features.resolvedThreats[1];
      sentences.push(`Также защищена фигура на ${second.square}.`);
    }
  }

  if (features.isFork) {
    const targets = features.attackedEnemyVulnerable.slice(0, 3);
    const targetText = targets
      .map((target) => `${PIECE_NAMES[target.type]} на ${target.square}`)
      .join(' и ');
    sentences.push(`Возникает двойное нападение на ${targetText}.`);
  } else if (features.attackedEnemyVulnerable?.length > 0) {
    const target = features.attackedEnemyVulnerable[0];
    sentences.push(
      `После хода под ударом оказывается ${PIECE_NAMES[target.type]} на ${target.square}.`,
    );
  }

  if (features.centerControlGain > 0 && features.centerSquaresAttacked?.length > 0 && features.piece !== 'p') {
    sentences.push('Ход усиливает контроль над центром.');
  }

  if (features.isDeveloping && !features.isCastle) {
    sentences.push('Фигура покидает начальную позицию, и развитие продолжается.');
  }

  return sentences.join(' ');
}

function describeThreats(features) {
  if (features.isCheckmate) return '';
  if (features.isFork) return 'Сопернику приходится спасать сразу несколько фигур.';
  if (features.attackedEnemyVulnerable?.length > 0) {
    const target = features.attackedEnemyVulnerable[0];
    if (target.type === 'q' || target.type === 'r') {
      return `Это создаёт серьёзное давление на ${PIECE_NAMES[target.type]} соперника.`;
    }
  }
  return '';
}

export function describePieceShort(features) {
  if (!features) return 'фигура';
  return formatSan(features.san, { capitalize: true });
}

export function pieceGenitive(type) {
  return PIECE_NAMES_GENITIVE[type] || 'фигуры';
}
