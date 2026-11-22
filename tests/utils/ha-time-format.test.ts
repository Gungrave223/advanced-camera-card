import { describe, expect, it } from 'vitest';
import type { HomeAssistant } from '../../src/ha/types.js';
import { uses24HourClock } from '../../src/utils/ha-time-format.js';

const hassWith = (time_format: string, language = 'en'): HomeAssistant =>
  ({ locale: { language, number_format: 'language', time_format } }) as unknown as HomeAssistant;

describe('uses24HourClock', () => {
  it('should follow an explicit 24 hour setting', () => {
    expect(uses24HourClock(hassWith('24'))).toBe(true);
  });

  it('should follow an explicit 12 hour setting', () => {
    expect(uses24HourClock(hassWith('12'))).toBe(false);
  });

  it('should follow the profile language', () => {
    expect(uses24HourClock(hassWith('language', 'de'))).toBe(true);
    expect(uses24HourClock(hassWith('language', 'en-US'))).toBe(false);
  });

  it('should fall back to the device without hass', () => {
    const device = new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions()
      .hourCycle;
    expect(uses24HourClock(null)).toBe(device === 'h23' || device === 'h24');
  });
});
