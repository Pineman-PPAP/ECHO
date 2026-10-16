import { describe, expect, it } from 'vitest';
import { readFlags } from '../src/app/flags';

describe('readFlags', () => {
  it('parses flags with safe defaults', () => {
    expect(readFlags('')).toEqual({ sim: false, debug: false, level: 0, skipCal: false });
    expect(readFlags('?sim=1&debug=true&level=2&skipcal=1')).toEqual({ sim: true, debug: true, level: 2, skipCal: true });
    expect(readFlags('?level=-3').level).toBe(0);
    expect(readFlags('?level=abc').level).toBe(0);
  });
});
