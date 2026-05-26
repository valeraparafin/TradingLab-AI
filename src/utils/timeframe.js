export const timeframeMap = {
  "1m": 1,
  "3m": 3,
  "5m": 5,
  "15m": 15,
  "30m": 30,
  "1H": 60,
  "4H": 240,
  "1D": 1440,
  "1W": 10080,
};

export function timeframeToMinutes(tf) {
  return timeframeMap[tf] || null;
}
