const SLOT_HOURS = [10, 14, 16];

function isWeekend(d: Date) {
  const day = d.getDay();
  return day === 0 || day === 6;
}

function nextBusinessDay(from: Date): Date {
  const d = new Date(from);
  do {
    d.setDate(d.getDate() + 1);
  } while (isWeekend(d));
  return d;
}

function atHour(d: Date, hour: number): Date {
  const copy = new Date(d);
  copy.setHours(hour, 0, 0, 0);
  return copy;
}

/**
 * Returns 3 upcoming candidate slots as ISO strings, spread over the next
 * 3 business days at rotating times (10am / 2pm / 4pm). Deterministic given
 * the current time — good enough for a demo, easy to swap for a real
 * availability query later.
 */
export function generateProposedSlots(now: Date = new Date()): string[] {
  const slots: Date[] = [];
  let cursor = new Date(now);
  for (let i = 0; i < 3; i++) {
    cursor = nextBusinessDay(cursor);
    slots.push(atHour(cursor, SLOT_HOURS[i % SLOT_HOURS.length]));
  }
  return slots.map((d) => d.toISOString());
}

export function formatSlotLabel(iso: string): string {
  const d = new Date(iso);
  const dayLabel = d.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
  const timeLabel = d.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
  return `${dayLabel} ${timeLabel}`;
}
