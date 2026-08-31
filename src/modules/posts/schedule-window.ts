import { z } from "zod";
import { AppError } from "@/lib/errors/app-error";

export const MIN_SCHEDULE_LEAD_MINUTES = 20;
export const MAX_SCHEDULE_AHEAD_DAYS = 29;

export function parseFacebookScheduleTime(value: unknown, now: Date): Date {
  const scheduledFor = new Date(z.iso.datetime({ offset: true }).parse(value));
  if (scheduledFor.getTime() <= now.getTime()) {
    throw new AppError({
      code: "SCHEDULE_TIME_INVALID",
      message: "Thời gian hẹn đăng phải ở tương lai.",
      status: 400,
    });
  }

  const minimum = now.getTime() + MIN_SCHEDULE_LEAD_MINUTES * 60 * 1000;
  const maximum = now.getTime() + MAX_SCHEDULE_AHEAD_DAYS * 24 * 60 * 60 * 1000;
  if (scheduledFor.getTime() < minimum || scheduledFor.getTime() > maximum) {
    throw new AppError({
      code: "SCHEDULE_TIME_OUT_OF_RANGE",
      message:
        "Facebook yêu cầu lịch đăng cách hiện tại ít nhất 20 phút và không quá 29 ngày.",
      status: 400,
    });
  }

  return scheduledFor;
}
