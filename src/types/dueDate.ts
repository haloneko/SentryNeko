/** Date encodings name calendar days; expiry follows the user's local calendar. */
export function localDate(now = new Date()): number {
  return Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 1000;
}

export function isOverdue(dueDate: number | null | undefined, completed: boolean, today: number): boolean {
  return !completed && dueDate != null && dueDate < today;
}
