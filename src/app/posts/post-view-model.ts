export const TIMELINE_HOUR_HEIGHT = 64;
export const TIMELINE_EVENT_HEIGHT = 60;
export const TIMELINE_EVENT_GAP = 6;
export const TIMELINE_HOUR_PADDING = 4;

export type TimelineHourLayout = {
  hour: number;
  top: number;
  height: number;
};

export function getTimelineHourLayouts(
  maximumPostsPerHour: number[],
  startHour: number,
): TimelineHourLayout[] {
  let top = 0;
  return maximumPostsPerHour.map((count, index) => {
    const contentHeight =
      count > 0
        ? TIMELINE_HOUR_PADDING * 2 +
          count * TIMELINE_EVENT_HEIGHT +
          Math.max(0, count - 1) * TIMELINE_EVENT_GAP
        : 0;
    const height = Math.max(TIMELINE_HOUR_HEIGHT, contentHeight);
    const layout = { hour: startHour + index, top, height };
    top += height;
    return layout;
  });
}

export function getAdaptiveTimelineTop(
  value: Date,
  startHour: number,
  layouts: TimelineHourLayout[],
): number {
  const layout = layouts[value.getHours() - startHour];
  if (!layout) return 0;
  return layout.top + (value.getMinutes() / 60) * layout.height;
}

export function startOfWeek(value: Date): Date {
  const result = new Date(value);
  result.setHours(0, 0, 0, 0);
  const day = result.getDay();
  result.setDate(result.getDate() - (day === 0 ? 6 : day - 1));
  return result;
}

export function addDays(value: Date, amount: number): Date {
  const result = new Date(value);
  result.setDate(result.getDate() + amount);
  return result;
}

export function getWeekDays(weekStart: Date): Date[] {
  return Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
}

export function getDayIndexInWeek(value: Date, weekStart: Date): number {
  const target = new Date(value);
  target.setHours(0, 0, 0, 0);
  const start = startOfWeek(weekStart);
  return Math.round((target.getTime() - start.getTime()) / 86_400_000);
}

export function getTimelineTop(value: Date, startHour = 0): number {
  return (
    (value.getHours() + value.getMinutes() / 60 - startHour) *
    TIMELINE_HOUR_HEIGHT
  );
}

export function isSameDay(first: Date, second: Date): boolean {
  return (
    first.getFullYear() === second.getFullYear() &&
    first.getMonth() === second.getMonth() &&
    first.getDate() === second.getDate()
  );
}
