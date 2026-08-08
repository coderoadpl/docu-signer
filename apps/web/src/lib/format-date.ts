const pad = (value: number): string => String(value).padStart(2, '0');

export const formatPolishDate = (value: string): string => {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (dateOnly) return `${dateOnly[3]}.${dateOnly[2]}.${dateOnly[1]}`;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}`;
};
