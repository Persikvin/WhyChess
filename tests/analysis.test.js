import { describe, expect, it } from 'vitest';
import {
  applyUserColor,
  buildMoveReport,
  classifyLoss,
  fenTurn,
  isBlunderOrWorse,
  summarizeAnalysis,
} from '../src/shared/analysis.js';
import { parsePgn, sanListToPgn } from '../src/shared/chess-utils.js';
import { START_FEN } from '../src/shared/constants.js';

function planFrom(sans, startFen = START_FEN) {
  return parsePgn(sanListToPgn(sans, { startFen }));
}

function engineResult(overrides = {}) {
  return {
    score: { type: 'cp', value: 0 },
    bestMove: null,
    pv: [],
    depth: 10,
    ...overrides,
  };
}

describe('classifyLoss', () => {
  it('uses the documented thresholds', () => {
    expect(classifyLoss(0)).toBe('excellent');
    expect(classifyLoss(25)).toBe('excellent');
    expect(classifyLoss(26)).toBe('good');
    expect(classifyLoss(60)).toBe('good');
    expect(classifyLoss(61)).toBe('inaccuracy');
    expect(classifyLoss(120)).toBe('inaccuracy');
    expect(classifyLoss(121)).toBe('mistake');
    expect(classifyLoss(300)).toBe('mistake');
    expect(classifyLoss(301)).toBe('blunder');
  });

  it('gives priority to forced moves and engine-best moves', () => {
    expect(classifyLoss(900, { playedIsBest: true })).toBe('best');
    expect(classifyLoss(900, { forced: true })).toBe('forced');
    expect(classifyLoss(900, { forced: true, playedIsBest: true })).toBe('forced');
  });

  it('detects blunder-sized losses', () => {
    expect(isBlunderOrWorse(300)).toBe(false);
    expect(isBlunderOrWorse(301)).toBe(true);
  });
});

describe('buildMoveReport', () => {
  const plan = planFrom(['e4', 'e5', 'Nf3', 'Nc6']);

  it('describes the played best move in Russian', () => {
    const report = buildMoveReport({
      index: 0,
      move: plan.moves[0],
      beforeResult: engineResult({
        bestMove: 'e2e4',
        score: { type: 'cp', value: 20 },
        pv: ['e2e4', 'e7e5'],
      }),
      afterResult: engineResult({
        bestMove: 'e7e5',
        score: { type: 'cp', value: -20 },
        pv: ['e7e5'],
      }),
      depth: 10,
      userColor: 'w',
    });

    expect(report.classification).toBe('best');
    expect(report.label).toBe('лучший ход');
    expect(report.tone).toBe('best');
    expect(report.isUser).toBe(true);
    expect(report.san).toBe('e4');
    expect(report.uci).toBe('e2e4');
    expect(report.moveNumber).toBe(1);
    expect(report.ply).toBe(1);
    expect(report.sideLabel).toBe('белые');
    expect(report.fenBefore).toBe(plan.moves[0].before);
    expect(report.fenAfter).toBe(plan.moves[0].after);
    expect(report.bestMove).toMatchObject({
      uci: 'e2e4',
      san: 'e4',
      from: 'e2',
      to: 'e4',
      promotion: null,
      pvSan: ['e4', 'e5'],
    });
    expect(report.playedEval.whiteCp).toBe(20);
    expect(report.lossCp).toBe(0);
    expect(report.explanation[0]).toContain('Вы нашли лучший ход — e4');
    expect(report.explanation.join(' ')).toContain('Движок на глубине 10');
    expect(report.refutation).toBeNull();
  });

  it('explains a blunder and shows the refutation', () => {
    const blunderPlan = planFrom(['f3', 'e5']);
    const report = buildMoveReport({
      index: 0,
      move: blunderPlan.moves[0],
      beforeResult: engineResult({
        bestMove: 'e2e4',
        score: { type: 'cp', value: 20 },
        pv: ['e2e4', 'e7e5'],
      }),
      afterResult: engineResult({
        bestMove: 'e7e5',
        score: { type: 'cp', value: 400 },
        pv: ['e7e5', 'g2g4'],
      }),
      depth: 10,
      userColor: 'w',
    });

    expect(report.classification).toBe('blunder');
    expect(report.label).toBe('грубая ошибка');
    expect(report.lossCp).toBe(420);
    expect(report.refutation).toMatchObject({ uci: 'e7e5', san: 'e5' });
    expect(report.refutation.pvSan).toEqual(['e5', 'g4']);
    const text = report.explanation.join(' ');
    expect(text).toContain('Вы сыграли f3');
    expect(text).toContain('Это грубая ошибка');
    expect(text).toContain('Соперник мог ответить e5');
    expect(text).not.toMatch(/зевок|зевнул|слил/i);
  });

  it('keeps neutral wording for the opponent', () => {
    const report = buildMoveReport({
      index: 1,
      move: plan.moves[1],
      beforeResult: engineResult({
        bestMove: 'e7e5',
        score: { type: 'cp', value: 10 },
      }),
      afterResult: engineResult({
        bestMove: 'g1f3',
        score: { type: 'cp', value: 10 },
      }),
      depth: 10,
      userColor: 'w',
    });

    expect(report.isUser).toBe(false);
    expect(report.classification).toBe('best');
    const text = report.explanation.join(' ');
    expect(text).toContain('именно он и был сыгран');
    expect(text).toContain('Сыгранный ход совпал');
    expect(text).not.toContain('Вы ');
  });

  it('marks the only legal move as forced', () => {
    const forcedFen = '8/8/8/8/8/8/1R6/K1k5 b - - 0 1';
    const forcedPlan = planFrom(['Kd1'], forcedFen);
    const report = buildMoveReport({
      index: 0,
      move: forcedPlan.moves[0],
      beforeResult: engineResult({
        bestMove: 'c1d1',
        score: { type: 'cp', value: 0 },
      }),
      afterResult: engineResult({
        bestMove: null,
        score: { type: 'cp', value: -100 },
      }),
      depth: 8,
      userColor: 'b',
    });

    expect(report.classification).toBe('forced');
    expect(report.label).toBe('вынужденный ход');
    expect(report.explanation[0]).toContain('только один законный ход');
    expect(report.bestMove.san).toBe('Kd1');
  });

  it('adds a truncation note to the final move', () => {
    const report = buildMoveReport({
      index: 0,
      move: plan.moves[0],
      beforeResult: engineResult({ bestMove: 'e2e4' }),
      afterResult: engineResult(),
      depth: 10,
      truncated: true,
    });
    expect(report.explanation).toContain(
      'Партия разобрана не до конца: достигнут заданный предел числа полуходов.',
    );
  });
});

describe('applyUserColor', () => {
  const plan = planFrom(['f3', 'e5']);

  function blunderReport(userColor) {
    return buildMoveReport({
      index: 0,
      move: plan.moves[0],
      beforeResult: engineResult({
        bestMove: 'e2e4',
        score: { type: 'cp', value: 20 },
        pv: ['e2e4', 'e7e5'],
      }),
      afterResult: engineResult({
        bestMove: 'e7e5',
        score: { type: 'cp', value: 400 },
        pv: ['e7e5', 'g2g4'],
      }),
      depth: 10,
      userColor,
    });
  }

  it('switches the side and the explanation wording in both directions', () => {
    const asWhite = blunderReport('w');
    expect(asWhite.isUser).toBe(true);
    expect(asWhite.explanation.join(' ')).toContain('Вы сыграли f3');
    expect(asWhite.explanation.join(' ')).toContain('После вашего хода');

    const asBlack = applyUserColor(asWhite, 'b');
    expect(asBlack).not.toBe(asWhite);
    expect(asBlack.isUser).toBe(false);
    expect(asBlack.explanation).toEqual(asWhite.explanationVariants.opponent);
    expect(asBlack.explanation.join(' ')).toContain('Было сыграно f3');
    expect(asBlack.explanation.join(' ')).toContain('После этого хода');
    expect(asBlack.explanation.join(' ')).not.toContain('Вы сыграли');

    const backToWhite = applyUserColor(asBlack, 'w');
    expect(backToWhite.isUser).toBe(true);
    expect(backToWhite.explanation).toEqual(asWhite.explanationVariants.user);
    expect(backToWhite.explanation.join(' ')).toContain('Вы сыграли f3');

    const unknown = applyUserColor(asWhite, null);
    expect(unknown.isUser).toBe(false);
    expect(unknown.explanation).toEqual(asWhite.explanationVariants.opponent);
  });

  it('returns the same report when the side already matches', () => {
    const report = blunderReport('w');
    expect(applyUserColor(report, 'w')).toBe(report);
    expect(applyUserColor(report, 'b')).not.toBe(report);
  });

  it('keeps working with reports that carry no explanation variants', () => {
    const legacy = { color: 'b', isUser: false, explanation: ['Было сыграно e5.'] };
    const updated = applyUserColor(legacy, 'b');
    expect(updated).toEqual({ color: 'b', isUser: true, explanation: ['Было сыграно e5.'] });
  });
});

describe('summarizeAnalysis', () => {
  const moves = [
    { classification: 'best', lossCp: 0, color: 'w' },
    { classification: 'blunder', lossCp: 500, color: 'w' },
    { classification: 'mistake', lossCp: 200, color: 'b' },
    { classification: 'forced', lossCp: 0, color: 'w' },
  ];

  it('counts all moves and the user moves separately', () => {
    const summary = summarizeAnalysis(moves, {
      userColor: 'w',
      totalMoves: 10,
      truncated: true,
      depth: 12,
    });

    expect(summary.analyzedMoves).toBe(4);
    expect(summary.totalMoves).toBe(10);
    expect(summary.truncated).toBe(true);
    expect(summary.depth).toBe(12);
    expect(summary.userColor).toBe('w');
    expect(summary.counts.best).toBe(1);
    expect(summary.counts.blunder).toBe(1);
    expect(summary.counts.mistake).toBe(1);
    expect(summary.counts.forced).toBe(1);
    expect(summary.userCounts.best).toBe(1);
    expect(summary.userCounts.forced).toBe(1);
    expect(summary.errorCount).toBe(2);
    expect(summary.userErrorCount).toBe(1);
    expect(summary.bestCount).toBe(1);
    expect(summary.userBestCount).toBe(1);
    expect(summary.avgLoss).toBe(175);
    expect(summary.userAvgLoss).toBe(167);
    expect(summary.hasErrors).toBe(true);
  });

  it('works without a known user colour', () => {
    const summary = summarizeAnalysis(moves, { depth: 10 });
    expect(summary.userColor).toBeNull();
    expect(summary.userCounts.best).toBe(0);
    expect(summary.userErrorCount).toBe(0);
    expect(summary.userAvgLoss).toBe(0);
  });

  it('handles an empty list', () => {
    const summary = summarizeAnalysis([], { depth: 10, userColor: 'b' });
    expect(summary.analyzedMoves).toBe(0);
    expect(summary.avgLoss).toBe(0);
    expect(summary.hasErrors).toBe(false);
  });
});

describe('fenTurn', () => {
  it('reads the side to move', () => {
    expect(fenTurn(START_FEN)).toBe('w');
    expect(fenTurn('8/8/8/8/8/8/8/K6k b - - 0 1')).toBe('b');
    expect(fenTurn('broken')).toBe('w');
  });
});
