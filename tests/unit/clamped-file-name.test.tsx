import { describe, expect, it } from 'vitest';
import { splitFileNameLines } from '@/pages/Chat/ClampedFileName';

const monoMeasure = (value: string) => Array.from(value).length * 10;

describe('splitFileNameLines', () => {
  it('keeps the first line at full width and only reserves space on the second line', () => {
    const result = splitFileNameLines({
      text: 'ABCDEFGHIJKLMNOP',
      firstLineWidth: 80,
      secondLineWidth: 40,
      measureWidth: monoMeasure,
    });

    expect(result).toEqual({
      firstLine: 'ABCDEFGH',
      secondLine: 'IJKL',
      truncated: true,
    });
  });

  it('does not add a second line when the file name already fits', () => {
    const result = splitFileNameLines({
      text: 'README.md',
      firstLineWidth: 200,
      secondLineWidth: 120,
      measureWidth: monoMeasure,
    });

    expect(result).toEqual({
      firstLine: 'README.md',
      secondLine: '',
      truncated: false,
    });
  });

  it('uses the remaining second-line width when no file-size reservation is needed', () => {
    const result = splitFileNameLines({
      text: 'ABCDEFGHIJKLMN',
      firstLineWidth: 60,
      secondLineWidth: 60,
      measureWidth: monoMeasure,
    });

    expect(result).toEqual({
      firstLine: 'ABCDEF',
      secondLine: 'GHIJKL',
      truncated: true,
    });
  });
});
