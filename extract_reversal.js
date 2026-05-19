import fs from 'fs';
const path = 'C:\\Users\\iparafin\\.claude\\projects\\C--Git-claude-tradingview-mcp-trading\\2e5cf3f2-debc-4da4-987f-b37bf52f57eb.jsonl';

const file = fs.readFileSync(path, 'utf8');
const lines = file.split('\n');

for (const line of lines) {
  if (!line.trim()) continue;
  try {
    const json = JSON.parse(line);
    const content = JSON.stringify(json);
    if (content.includes('executeReversal')) {
      console.log('--- Found match ---');
      console.log(content);
    }
  } catch (e) {
  }
}
