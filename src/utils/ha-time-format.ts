import type { HomeAssistant } from '../ha/types.js';

/**
 * Whether times should use a 24-hour clock, following the user's Home
 * Assistant profile (Time format): 24 or 12 hours, or what the profile language
 * or the device uses.
 */
export const uses24HourClock = (hass?: HomeAssistant | null): boolean => {
  const format: string | undefined = hass?.locale?.time_format;
  if (format === '24') {
    return true;
  }
  if (format === '12') {
    return false;
  }
  const language = format === 'language' ? hass?.locale?.language : undefined;
  const hourCycle = new Intl.DateTimeFormat(language, {
    hour: 'numeric',
  }).resolvedOptions().hourCycle;
  return hourCycle === 'h23' || hourCycle === 'h24';
};
