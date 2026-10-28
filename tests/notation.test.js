import { describe, expect, it } from 'vitest';
import { formatSan } from '../src/shared/notation.js';

describe('formatSan', () => {
  it('names the piece and keeps the move square', () => {
    expect(formatSan('Nf3')).toBe('конь f3');
    expect(formatSan('Qe5')).toBe('ферзь e5');
    expect(formatSan('Kf1')).toBe('король f1');
    expect(formatSan('e4')).toBe('пешка e4');
  });

  it('marks captures without algebraic letters', () => {
    expect(formatSan('Qxe5')).toBe('ферзь × e5');
    expect(formatSan('Nxf3')).toBe('конь × f3');
    expect(formatSan('exd5')).toBe('пешка e × d5');
  });

  it('keeps disambiguation when two pieces can reach the square', () => {
    expect(formatSan('Nbd2')).toBe('конь b–d2');
    expect(formatSan('R1e2')).toBe('ладья 1–e2');
    expect(formatSan('Qh4e1')).toBe('ферзь h4–e1');
    expect(formatSan('Nbxd2')).toBe('конь b × d2');
  });

  it('describes castling, promotion, check and mate', () => {
    expect(formatSan('O-O')).toBe('короткая рокировка');
    expect(formatSan('O-O-O+')).toBe('длинная рокировка, шах');
    expect(formatSan('0-0-0#')).toBe('длинная рокировка, мат');
    expect(formatSan('e8=Q+')).toBe('пешка e8 = ферзь, шах');
    expect(formatSan('exd8=Q#')).toBe('пешка e × d8 = ферзь, мат');
    expect(formatSan('Qh4#')).toBe('ферзь h4, мат');
  });

  it('can capitalise the first word for card headings', () => {
    expect(formatSan('Qxe5', { capitalize: true })).toBe('Ферзь × e5');
    expect(formatSan('O-O', { capitalize: true })).toBe('Короткая рокировка');
    expect(formatSan('e8=Q', { capitalize: true })).toBe('Пешка e8 = ферзь');
  });

  it('stays readable for empty or unknown input', () => {
    expect(formatSan('')).toBe('—');
    expect(formatSan(null)).toBe('—');
    expect(formatSan('e.p.')).toBe('e.p.');
    expect(formatSan('custom', { capitalize: true })).toBe('Custom');
  });
});
