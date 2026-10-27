import {
  CLASSIFICATION_META,
  PIECE_NAMES,
  PIECE_NAMES_ACCUSATIVE,
  PIECE_NAMES_GENITIVE,
} from './constants.js';
import { evaluationSummary, formatEvaluation, formatLoss } from './chess-utils.js';

const PIECE_SUBJECTS = {
  p: 'Пешка',
  n: 'Конь',
  b: 'Слон',
  r: 'Ладья',
  q: 'Ферзь',
  k: 'Король',
};

export function buildExplanation(context) {
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
  const bestSan = bestFeatures?.san || context.bestSan || '—';
  const bestName = bestFeatures ? PIECE_NAMES[bestFeatures.piece] : 'фигура';

  if (forced) {
    paragraphs.push(
      `Лучший ход — ${bestSan}. У стороны был только один законный ход, поэтому движок не сравнивал его с альтернативами.`,
    );
  } else if (isBest) {
    paragraphs.push(
      isUser ? `Вы нашли лучший ход — ${bestSan}.` : `Лучший ход — ${bestSan}; именно он и был сыгран.`,
    );
  } else {
    paragraphs.push(`Лучший ход — ${bestSan}.`);
  }

  if (bestFeatures) {
    const action = describeMove(bestFeatures);
    const effects = describePositionalEffects(bestFeatures);
    const threat = describeThreats(bestFeatures);
    const firstParagraph = [action, effects, threat].filter(Boolean).join(' ');
    if (firstParagraph) paragraphs.push(firstParagraph);
  }

  if (bestScore) {
    const bestEval = formatEvaluation(bestScore, turn);
    const summary = evaluationSummary(bestScore, turn);
    paragraphs.push(
      `Оценка позиции после рекомендованного продолжения — ${bestEval}; ${summary}.`,
    );
  }

  if (bestPvSan.length >= 2) {
    paragraphs.push(
      `Движок на глубине ${depth} рассматривает вариант: ${bestPvSan.slice(0, 8).join(' ')}.`,
    );
  }

  if (!isBest && playedFeatures && !forced) {
    const label = CLASSIFICATION_META[classification]?.label || 'неточность';
    const playedDescription = describeMove(playedFeatures);
    paragraphs.push(
      isUser
        ? `Вы сыграли ${playedFeatures.san}. ${playedDescription}`
        : `Было сыграно ${playedFeatures.san}. ${playedDescription}`,
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
      lossCp > 0
        ? `По расчёту движка ход уступает лучшему примерно на ${lossText}.`
        : 'По расчёту движка разница с лучшим ходом минимальна.';
    paragraphs.push(`${quality} ${lossSentence}`);

    if (afterScore) {
      paragraphs.push(
        `${isUser ? 'После вашего хода' : 'После этого хода'} оценка — ${formatEvaluation(afterScore, afterTurn)}; ${evaluationSummary(afterScore, afterTurn)}.`,
      );
    }

    if (refutation?.san) {
      const line = refutation.pvSan?.length > 1 ? ` (${refutation.pvSan.slice(0, 5).join(' ')})` : '';
      paragraphs.push(`Соперник мог ответить ${refutation.san}${line}.`);
    }
  } else if (isBest && !forced) {
    const lossText = lossCp <= 5 ? 'без потери оценки' : `с минимальной потерей ${formatLoss(lossCp)}`;
    paragraphs.push(
      isUser
        ? `Выбор совпал с рекомендацией движка, ${lossText}.`
        : `Сыгранный ход совпал с рекомендацией движка, ${lossText}.`,
    );
  }

  if (context.truncated) {
    paragraphs.push('Партия разобрана не до конца: достигнут заданный предел числа полуходов.');
  }

  if (paragraphs.length === 1 && bestName) {
    paragraphs.push('Этот ход движок считает наиболее точным в данной позиции.');
  }

  return paragraphs;
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
  return `${PIECE_NAMES[features.piece] || 'фигура'} ${features.san}`;
}

export function pieceGenitive(type) {
  return PIECE_NAMES_GENITIVE[type] || 'фигуры';
}
