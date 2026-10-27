import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { analyzeMove, boardFacts, boardMetrics, oppositeColor } from '../src/shared/features.js';
import { START_FEN } from '../src/shared/constants.js';

describe('boardMetrics', () => {
  it('describes the initial position', () => {
    const metrics = boardMetrics(new Chess(START_FEN));
    expect(metrics.turn).toBe('w');
    expect(metrics.material.diff).toBe(0);
    expect(metrics.development).toEqual({ w: 0, b: 0 });
    expect(metrics.mobility).toBe(20);
    expect(metrics.openFiles).toEqual([]);
    expect(metrics.king.w.castled).toBe(false);
    expect(metrics.pawnStructure.w.doubled).toBe(0);
  });

  it('counts vulnerable pieces and king safety', () => {
    const chess = new Chess();
    for (const san of ['e4', 'd5', 'exd5', 'Qxd5', 'Nc3', 'Qa5', 'd4', 'e5']) chess.move(san);
    const metrics = boardMetrics(chess);
    expect(metrics.material.diff).toBe(0);
    expect(metrics.development.w).toBe(1);
    expect(metrics.king.b.shield).toBeGreaterThanOrEqual(0);
  });
});

describe('analyzeMove', () => {
  it('recognises a developing knight move', () => {
    const features = analyzeMove(START_FEN, { from: 'g1', to: 'f3' });
    expect(features.san).toBe('Nf3');
    expect(features.piece).toBe('n');
    expect(features.isDeveloping).toBe(true);
    expect(features.isCapture).toBe(false);
    expect(features.isCheck).toBe(false);
    expect(features.centerSquaresAttacked).toContain('d4');
    expect(features.centerSquaresAttacked).toContain('e5');
  });

  it('recognises a central pawn move', () => {
    const features = analyzeMove(START_FEN, { from: 'e2', to: 'e4' });
    expect(features.san).toBe('e4');
    expect(features.piece).toBe('p');
    expect(features.isDeveloping).toBe(false);
    expect(features.centerSquaresAttacked).toEqual(['d5']);
    expect(features.afterFen).not.toBe(START_FEN);
  });

  it('recognises a capture and en passant', () => {
    const chess = new Chess();
    for (const san of ['e4', 'd5']) chess.move(san);
    const capture = analyzeMove(chess.fen(), { from: 'e4', to: 'd5' });
    expect(capture.isCapture).toBe(true);
    expect(capture.captured).toBe('p');
    expect(capture.flags.includes('c')).toBe(true);

    const epChess = new Chess();
    for (const san of ['e4', 'a6', 'e5', 'd5']) epChess.move(san);
    const enPassant = analyzeMove(epChess.fen(), { from: 'e5', to: 'd6' });
    expect(enPassant.isEnPassant).toBe(true);
    expect(enPassant.isCapture).toBe(true);
    expect(enPassant.captured).toBe('p');
  });

  it('recognises castling and promotion', () => {
    const castleChess = new Chess();
    for (const san of ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5']) castleChess.move(san);
    const castle = analyzeMove(castleChess.fen(), { from: 'e1', to: 'g1' });
    expect(castle.isCastle).toBe(true);
    expect(castle.castleSide).toBe('kingside');

    const promotion = analyzeMove('8/P7/8/8/8/8/8/K6k w - - 0 1', { from: 'a7', to: 'a8', promotion: 'q' });
    expect(promotion.isPromotion).toBe(true);
    expect(promotion.promotion).toBe('q');
  });

  it('marks a move that gives checkmate', () => {
    const chess = new Chess();
    for (const san of ['f3', 'e5', 'g4']) chess.move(san);
    const mate = analyzeMove(chess.fen(), { from: 'd8', to: 'h4' });
    expect(mate.san).toBe('Qh4#');
    expect(mate.isCheck).toBe(true);
    expect(mate.isCheckmate).toBe(true);
  });

  it('returns null for an illegal move', () => {
    expect(analyzeMove(START_FEN, { from: 'e2', to: 'e5' })).toBeNull();
    expect(analyzeMove(START_FEN, {})).toBeNull();
  });
});

describe('helpers', () => {
  it('flips colours and exposes board facts', () => {
    expect(oppositeColor('w')).toBe('b');
    expect(oppositeColor('b')).toBe('w');
    const facts = boardFacts(START_FEN);
    expect(facts.material.diff).toBe(0);
    expect(facts.mobility).toBe(20);
  });
});
