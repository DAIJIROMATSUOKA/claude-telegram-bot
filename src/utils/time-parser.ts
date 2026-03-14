/**
 * Japanese Natural Language Time Parser
 * Parses: 明日8時, 今日15時半, 明後日10:30, 3/15 9時, 月曜8時
 */

export function parseJapaneseTime(input: string): Date | null {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  let targetDate = new Date(jst);
  let timeFound = false;
  let hours = 0;
  let minutes = 0;
  let dateExplicit = false;

  const timePatterns: [RegExp, boolean][] = [
    [/(\d{1,2}):(\d{2})/, false],
    [/(\d{1,2})時(\d{1,2})分/, false],
    [/(\d{1,2})時半/, true],
    [/(\d{1,2})時/, false],
  ];
  for (const [pat, isHalf] of timePatterns) {
    const m = input.match(pat);
    if (m) {
      hours = parseInt(m[1]!);
      minutes = isHalf ? 30 : (m[2] ? parseInt(m[2]) : 0);
      timeFound = true;
      break;
    }
  }
  if (!timeFound) return null;

  if (input.includes('明後日')) {
    targetDate.setUTCDate(targetDate.getUTCDate() + 2);
    dateExplicit = true;
  } else if (input.includes('明日')) {
    targetDate.setUTCDate(targetDate.getUTCDate() + 1);
    dateExplicit = true;
  } else if (input.includes('今日')) {
    dateExplicit = true;
  } else {
    const dateMatch = input.match(/(\d{1,2})\/(\d{1,2})/);
    if (dateMatch) {
      targetDate.setUTCMonth(parseInt(dateMatch[1]!) - 1);
      targetDate.setUTCDate(parseInt(dateMatch[2]!));
      const check = new Date(targetDate);
      check.setUTCHours(hours, minutes, 0, 0);
      if (check < jst) targetDate.setUTCFullYear(targetDate.getUTCFullYear() + 1);
      dateExplicit = true;
    }
  }

  if (!dateExplicit) {
    const dayNames = ['日', '月', '火', '水', '木', '金', '土'];
    const dayMatch = input.match(/(月|火|水|木|金|土|日)曜/);
    if (dayMatch) {
      const targetDay = dayNames.indexOf(dayMatch[1]!);
      if (targetDay >= 0) {
        const currentDay = jst.getUTCDay();
        let diff = targetDay - currentDay;
        if (diff <= 0) diff += 7;
        targetDate.setUTCDate(targetDate.getUTCDate() + diff);
        dateExplicit = true;
      }
    }
  }

  // If no date specified, use today (or tomorrow if time already passed)
  if (!dateExplicit) {
    targetDate.setUTCHours(hours, minutes, 0, 0);
    if (targetDate <= jst) {
      targetDate.setUTCDate(targetDate.getUTCDate() + 1);
    }
    return new Date(targetDate.getTime() - 9 * 60 * 60 * 1000);
  }

  targetDate.setUTCHours(hours, minutes, 0, 0);
  return new Date(targetDate.getTime() - 9 * 60 * 60 * 1000);
}

export function formatJST(date: Date): string {
  const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  const m = jst.getUTCMonth() + 1;
  const d = jst.getUTCDate();
  const h = jst.getUTCHours();
  const min = String(jst.getUTCMinutes()).padStart(2, '0');
  const days = ['日', '月', '火', '水', '木', '金', '土'];
  const dow = days[jst.getUTCDay()];
  return `${m}/${d}(${dow}) ${h}:${min}`;
}
