import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import {
  buildExplanation,
  buildExplanationRich,
  describeMove,
  describePieceShort,
  pieceGenitive,
} from '../src/shared/explain.js';
import { analyzeMove } from '../src/shared/features.js';
import { START_FEN } from '../src/shared/constants.js';

function knightFeatures() {
  return analyzeMove(START_FEN, { from: 'g1', to: 'f3' });
}

function textOf(paragraphs) {
  return paragraphs.join(' ');
}

describe('buildExplanation', () => {
  it('praises the user for finding the engine move', () => {
    const features = knightFeatures();
    const paragraphs = buildExplanation({
      bestFeatures: features,
      playedFeatures: features,
      isBest: true,
      isUser: true,
      classification: 'best',
      lossCp: 0,
      bestScore: { type: 'cp', value: 20 },
      turn: 'w',
      afterScore: { type: 'cp', value: 20 },
      afterTurn: 'b',
      bestPvSan: ['Nf3', 'Nc6'],
      depth: 10,
    });

    const text = textOf(paragraphs);
    expect(paragraphs[0]).toBe('Вы нашли лучший ход — конь f3.');
    expect(text).toContain('Конь с g1 переходит на f3');
    expect(text).toContain('Оценка позиции после рекомендованного продолжения');
    expect(text).toContain('Движок на глубине 10 рассматривает вариант: конь f3 конь c6.');
    expect(text).toContain('Выбор совпал с рекомендацией движка, без потери оценки.');
    expect(text).not.toMatch(/зевок|зевнул|слил|тупо/i);
  });

  it('uses neutral wording when the opponent played the best move', () => {
    const features = analyzeMove(START_FEN, { from: 'e2', to: 'e4' });
    const paragraphs = buildExplanation({
      bestFeatures: features,
      playedFeatures: features,
      isBest: true,
      isUser: false,
      classification: 'best',
      lossCp: 0,
      bestScore: { type: 'cp', value: 30 },
      turn: 'w',
      afterScore: { type: 'cp', value: 30 },
      afterTurn: 'b',
      depth: 10,
    });

    const text = textOf(paragraphs);
    expect(paragraphs[0]).toBe('Лучший ход — пешка e4; именно он и был сыгран.');
    expect(text).toContain('Сыгранный ход совпал с рекомендацией движка');
    expect(text).not.toContain('Вы ');
  });

  it('explains the user blunder without slang', () => {
    const best = knightFeatures();
    const played = analyzeMove(START_FEN, { from: 'f2', to: 'f3' });
    const paragraphs = buildExplanation({
      bestFeatures: best,
      playedFeatures: played,
      isBest: false,
      isUser: true,
      classification: 'blunder',
      lossCp: 420,
      bestScore: { type: 'cp', value: 20 },
      turn: 'w',
      afterScore: { type: 'cp', value: 400 },
      afterTurn: 'b',
      bestPvSan: ['Nf3', 'Nc6'],
      refutation: { san: 'e5', pvSan: ['e5', 'Nf3'] },
      depth: 10,
    });

    const text = textOf(paragraphs);
    expect(paragraphs[0]).toBe('Лучший ход — конь f3.');
    expect(text).toContain('Вы сыграли ход «пешка f3».');
    expect(text).toContain('Это грубая ошибка: последствия для позиции очень серьёзные.');
    expect(text).toContain('уступает лучшему примерно на 4,20 пешки');
    expect(text).toContain('После вашего хода оценка — −4,00');
    expect(text).toContain('Соперник мог ответить: пешка e5 (пешка e5 конь f3).');
    expect(text).not.toMatch(/зевок|зевнул|слил|тупо|косяк/i);
  });

  it('explains a blunder that still leaves the user ahead', () => {
    const best = knightFeatures();
    const played = analyzeMove(START_FEN, { from: 'f2', to: 'f3' });
    const paragraphs = buildExplanation({
      bestFeatures: best,
      playedFeatures: played,
      isBest: false,
      isUser: true,
      classification: 'blunder',
      lossCp: 300,
      bestScore: { type: 'cp', value: 867 },
      turn: 'w',
      afterScore: { type: 'cp', value: -567 },
      afterTurn: 'b',
      depth: 10,
    });

    const text = textOf(paragraphs);
    expect(text).toContain('После вашего хода оценка — +5,67; решающее преимущество белых.');
    expect(text).toContain(
      'Несмотря на потерю, запас преимущества по-прежнему большой, и позиция остаётся в вашу пользу.',
    );
  });

  it('does not add the still-better remark when the move loses the advantage', () => {
    const best = knightFeatures();
    const played = analyzeMove(START_FEN, { from: 'f2', to: 'f3' });
    const paragraphs = buildExplanation({
      bestFeatures: best,
      playedFeatures: played,
      isBest: false,
      isUser: true,
      classification: 'blunder',
      lossCp: 500,
      bestScore: { type: 'cp', value: 20 },
      turn: 'w',
      afterScore: { type: 'cp', value: 480 },
      afterTurn: 'b',
      depth: 10,
    });

    expect(textOf(paragraphs)).not.toContain('Несмотря на потерю');
  });

  it('phrases a loss that runs into mate without broken grammar', () => {
    const best = knightFeatures();
    const played = analyzeMove(START_FEN, { from: 'f2', to: 'f3' });
    const paragraphs = buildExplanation({
      bestFeatures: best,
      playedFeatures: played,
      isBest: false,
      isUser: true,
      classification: 'blunder',
      lossCp: 99990,
      bestScore: { type: 'cp', value: 20 },
      turn: 'w',
      afterScore: { type: 'mate', value: 1 },
      afterTurn: 'b',
      depth: 10,
    });

    const text = textOf(paragraphs);
    expect(text).toContain('По расчёту движка ход ведёт к мату.');
    expect(text).not.toContain('примерно на потеря');
  });

  it('describes an opponent mistake neutrally', () => {
    const best = analyzeMove(START_FEN, { from: 'e2', to: 'e4' });
    const played = analyzeMove(START_FEN, { from: 'a2', to: 'a3' });
    const paragraphs = buildExplanation({
      bestFeatures: best,
      playedFeatures: played,
      isBest: false,
      isUser: false,
      classification: 'mistake',
      lossCp: 150,
      bestScore: { type: 'cp', value: 20 },
      turn: 'w',
      afterScore: { type: 'cp', value: 130 },
      afterTurn: 'b',
      depth: 10,
    });

    const text = textOf(paragraphs);
    expect(text).toContain('Было сыграно: «пешка a3».');
    expect(text).toContain('После этого хода оценка');
    expect(text).not.toContain('Вы сыграли');
    expect(text).not.toContain('После вашего хода');
  });

  it('explains a forced move', () => {
    const forcedFen = '7k/7p/5K2/8/8/8/8/8 b - - 0 1';
    const features = analyzeMove(forcedFen, { from: 'h7', to: 'h6' });
    const paragraphs = buildExplanation({
      bestFeatures: features,
      playedFeatures: features,
      forced: true,
      isBest: true,
      isUser: true,
      classification: 'forced',
      lossCp: 0,
      bestScore: { type: 'cp', value: 0 },
      turn: 'b',
      afterScore: { type: 'cp', value: -100 },
      afterTurn: 'w',
      depth: 8,
    });

    expect(paragraphs[0]).toContain('только один законный ход');
    expect(textOf(paragraphs)).toContain('Оценка позиции после рекомендованного продолжения');
  });

  it('reports truncation and survives missing move features', () => {
    const paragraphs = buildExplanation({
      bestFeatures: null,
      playedFeatures: null,
      isBest: true,
      classification: 'best',
      lossCp: 0,
      depth: 10,
      truncated: true,
    });

    const text = textOf(paragraphs);
    expect(text).toContain('Лучший ход — —');
    expect(text).toContain('Партия разобрана не до конца');
  });

  it('adds a generic sentence when nothing else can be said', () => {
    const paragraphs = buildExplanation({
      bestFeatures: null,
      forced: true,
      classification: 'forced',
      lossCp: 0,
      depth: 10,
    });
    expect(textOf(paragraphs)).toContain('Этот ход движок считает наиболее точным');
  });
});

describe('buildExplanationRich', () => {
  it('marks the best-move label bold and colours the move for its side', () => {
    const features = knightFeatures();
    const paragraphs = buildExplanationRich({
      bestFeatures: features,
      playedFeatures: features,
      isBest: true,
      isUser: true,
      classification: 'best',
      lossCp: 0,
      bestScore: { type: 'cp', value: 20 },
      turn: 'w',
      afterScore: { type: 'cp', value: 20 },
      afterTurn: 'b',
      bestPvSan: ['Nf3', 'Nc6'],
      depth: 10,
    });

    const first = paragraphs[0];
    expect(first.find((token) => token.bold)?.text).toBe('Вы нашли лучший ход');
    expect(first.filter((token) => token.move)).toEqual([{ text: 'конь f3', move: 'w' }]);
  });

  it('alternates the move colours in the engine line', () => {
    const features = knightFeatures();
    const paragraphs = buildExplanationRich({
      bestFeatures: features,
      playedFeatures: features,
      isBest: true,
      classification: 'best',
      lossCp: 0,
      bestScore: { type: 'cp', value: 20 },
      turn: 'w',
      afterScore: { type: 'cp', value: 20 },
      afterTurn: 'b',
      bestPvSan: ['Nf3', 'Nc6', 'Bb5'],
      depth: 10,
    });

    const line = paragraphs.find((paragraph) => paragraph[0].text.startsWith('Движок'));
    expect(line.filter((token) => token.move).map((token) => [token.text, token.move])).toEqual([
      ['конь f3', 'w'],
      ['конь c6', 'b'],
      ['слон b5', 'w'],
    ]);
  });

  it('binds the played-move label and colours the played move', () => {
    const best = knightFeatures();
    const played = analyzeMove(START_FEN, { from: 'f2', to: 'f3' });
    const paragraphs = buildExplanationRich({
      bestFeatures: best,
      playedFeatures: played,
      isBest: false,
      isUser: true,
      classification: 'blunder',
      lossCp: 420,
      bestScore: { type: 'cp', value: 20 },
      turn: 'w',
      afterScore: { type: 'cp', value: 400 },
      afterTurn: 'b',
      refutation: { san: 'e5', pvSan: ['e5', 'Nf3'] },
      depth: 10,
    });

    const playedParagraph = paragraphs.find((paragraph) =>
      paragraph.some((token) => token.text === 'Вы сыграли ход'),
    );
    expect(playedParagraph.find((token) => token.bold)?.text).toBe('Вы сыграли ход');
    expect(playedParagraph.filter((token) => token.move)).toEqual([
      { text: 'пешка f3', move: 'w' },
    ]);

    const refutation = paragraphs.find((paragraph) =>
      paragraph[0].text.startsWith('Соперник'),
    );
    expect(refutation.filter((token) => token.move).map((token) => [token.text, token.move])).toEqual([
      ['пешка e5', 'b'],
      ['пешка e5', 'b'],
      ['конь f3', 'w'],
    ]);
  });

  it('marks the opponent wording bold for moves of the other side', () => {
    const best = knightFeatures();
    const played = analyzeMove(START_FEN, { from: 'f2', to: 'f3' });
    const paragraphs = buildExplanationRich({
      bestFeatures: best,
      playedFeatures: played,
      isBest: false,
      isUser: false,
      classification: 'mistake',
      lossCp: 200,
      bestScore: { type: 'cp', value: 20 },
      turn: 'w',
      afterScore: { type: 'cp', value: 250 },
      afterTurn: 'b',
      depth: 10,
    });

    const playedParagraph = paragraphs.find((paragraph) =>
      paragraph.some((token) => token.text === 'Было сыграно'),
    );
    expect(playedParagraph.find((token) => token.bold)?.text).toBe('Было сыграно');
    expect(playedParagraph.find((token) => token.move)?.move).toBe('w');
  });

  it('keeps the plain text identical to buildExplanation', () => {
    const features = knightFeatures();
    const context = {
      bestFeatures: features,
      playedFeatures: features,
      isBest: true,
      isUser: true,
      classification: 'best',
      lossCp: 0,
      bestScore: { type: 'cp', value: 20 },
      turn: 'w',
      afterScore: { type: 'cp', value: 20 },
      afterTurn: 'b',
      bestPvSan: ['Nf3', 'Nc6'],
      depth: 10,
    };

    const plain = buildExplanation(context);
    const rich = buildExplanationRich(context);
    expect(rich.map((paragraph) => paragraph.map((token) => token.text).join(''))).toEqual(plain);
  });
});

describe('describeMove', () => {
  it('describes development and central pawn moves', () => {
    expect(describeMove(knightFeatures())).toContain('развитие фигуры');
    expect(describeMove(analyzeMove(START_FEN, { from: 'e2', to: 'e4' }))).toContain(
      'берёт под контроль',
    );
  });

  it('keeps the description of a weak pawn move neutral', () => {
    const description = describeMove(analyzeMove(START_FEN, { from: 'f2', to: 'f3' }));
    expect(description).toContain('берёт под контроль e4');
    expect(description).not.toContain('усиливает');
    expect(description).not.toContain('более активную');
  });

  it('describes captures', () => {
    const chess = new Chess();
    chess.move('e4');
    chess.move('d5');
    const capture = analyzeMove(chess.fen(), { from: 'e4', to: 'd5' });
    expect(describeMove(capture)).toContain('Пешка с e4 забирает пешку на d5.');
  });

  it('describes castling', () => {
    const chess = new Chess();
    for (const san of ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5']) chess.move(san);
    const castle = analyzeMove(chess.fen(), { from: 'e1', to: 'g1' });
    const description = describeMove(castle);
    expect(description).toContain('Рокировка в короткую сторону');
    expect(description).toContain('короля на g1');
    expect(description).toContain('ладью с h1 на f1');
  });

  it('describes promotion and en passant', () => {
    const promotion = analyzeMove('8/P7/8/8/8/8/8/K6k w - - 0 1', {
      from: 'a7',
      to: 'a8',
      promotion: 'q',
    });
    expect(describeMove(promotion)).toContain('превращается в ферзя');

    const chess = new Chess();
    for (const san of ['e4', 'a6', 'e5', 'd5']) chess.move(san);
    const enPassant = analyzeMove(chess.fen(), { from: 'e5', to: 'd6' });
    expect(describeMove(enPassant)).toContain('забирает пешку на d5 на проходе');
  });

  it('describes check and checkmate', () => {
    const chess = new Chess();
    for (const san of ['f3', 'e5', 'g4']) chess.move(san);
    const mate = analyzeMove(chess.fen(), { from: 'd8', to: 'h4' });
    const description = describeMove(mate);
    expect(description).toContain('Это мат');
    expect(description).not.toContain('Ход даёт шах и заставляет');
  });

  it('returns an empty string for missing features', () => {
    expect(describeMove(null)).toBe('');
  });
});

describe('short descriptions', () => {
  it('names pieces and moves', () => {
    expect(describePieceShort(knightFeatures())).toBe('Конь f3');
    expect(describePieceShort(null)).toBe('фигура');
    expect(pieceGenitive('q')).toBe('ферзя');
    expect(pieceGenitive('unknown')).toBe('фигуры');
  });
});
