const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const toDateKey = (date: Date) => {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

/**
 * 返回包含首尾两天的本地日历日期范围。
 * 最多展开 732 天，防止异常存档让月历构建无限膨胀。
 */
export const expandCalendarDateRange = (startDate: string, dueDate?: string): string[] => {
  if (!ISO_DATE_RE.test(startDate)) return [];
  if (!dueDate || !ISO_DATE_RE.test(dueDate) || dueDate <= startDate) return [startDate];

  const cursor = new Date(`${startDate}T12:00:00`);
  const end = new Date(`${dueDate}T12:00:00`);
  const result: string[] = [];
  while (cursor <= end && result.length < 732) {
    result.push(toDateKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return result;
};
