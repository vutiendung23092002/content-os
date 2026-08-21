import { describe, expect, it } from "vitest";
import {
  addDays,
  getAdaptiveTimelineTop,
  getDayIndexInWeek,
  getTimelineHourLayouts,
  getTimelineTop,
  getWeekDays,
  isSameDay,
  startOfWeek,
} from "./post-view-model";

describe("post timeline view model", () => {
  it("expands a crowded hour enough to stack cards without overlap", () => {
    const layouts = getTimelineHourLayouts([1, 3, 0], 7);

    expect(layouts[0]).toEqual({ hour: 7, top: 0, height: 68 });
    expect(layouts[1]).toEqual({ hour: 8, top: 68, height: 200 });
    expect(layouts[2]).toEqual({ hour: 9, top: 268, height: 64 });
    expect(
      getAdaptiveTimelineTop(new Date(2026, 7, 21, 8, 30), 7, layouts),
    ).toBe(168);
  });

  it("builds a Monday-to-Sunday week", () => {
    const thursday = new Date(2026, 7, 20, 10, 30);
    const monday = startOfWeek(thursday);
    const days = getWeekDays(monday);

    expect(monday.getDay()).toBe(1);
    expect(monday.getHours()).toBe(0);
    expect(days).toHaveLength(7);
    expect(days[6]?.getDay()).toBe(0);
    expect(isSameDay(addDays(monday, 3), thursday)).toBe(true);
  });

  it("maps a post to the correct day and vertical time", () => {
    const monday = new Date(2026, 7, 17);
    const fridayAt1230 = new Date(2026, 7, 21, 12, 30);

    expect(getDayIndexInWeek(fridayAt1230, monday)).toBe(4);
    expect(getTimelineTop(fridayAt1230)).toBe(800);
    expect(getTimelineTop(fridayAt1230, 7)).toBe(352);
  });
});
