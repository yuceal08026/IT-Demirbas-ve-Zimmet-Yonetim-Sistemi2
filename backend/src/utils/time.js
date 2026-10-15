const UNITS = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };

/** "8h", "30m", "7d" veya saniye cinsinden sayı → milisaniye. JWT süresiyle cookie süresini eşler. */
export function parseDurationMs(value) {
  if (typeof value === 'number') return value * 1000;
  const match = /^(\d+)\s*([smhd])?$/i.exec(String(value).trim());
  if (!match) throw new Error(`Geçersiz süre: ${value}`);
  return Number(match[1]) * UNITS[(match[2] || 's').toLowerCase()];
}
