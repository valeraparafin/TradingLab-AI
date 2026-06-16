# PnL Campaign — «100%+ за 2 года» (Spec 5)

**Date:** 2026-06-11
**Branch:** `feat/htf-filter` (или новая ветка `feat/pnl-campaign` на исполнении)
**Status:** design — awaiting user review before plan
**Язык спека:** русский (рабочий язык проекта в этой кампании); код/идентификаторы — английский.

## 1. Постановка и факты

Лучший существующий бэктест даёт **+10.13% net за 2 года** (run id 127: SMC XRPUSDT 1H,
169 сделок, WR 42%, MaxDD 3.4%). Пользователь требует ≥ **+100%** на том же горизонте.

Ключевой установленный факт (из `backtest.db`, 214 прогонов): **PnL% в текущем движке
измеряет в основном сайзинг, а не качество стратегии.** Лучшая ячейка гонялась при
`riskPerTrade = 0.1` (10% капитала на сделку) **без компаундинга** — сайзинг в
`RiskPolicy` берётся от статичного `g.portfolioValue`, не от текущего equity. Потолок
такой конфигурации ≈ +100% даже при WR 100%. Доказательство линейности — группа
`smc_sizing` (та же стратегия, тот же набор сделок): rpt 0.2 → +12.4% (DD 7.4%);
rpt 0.3 → +18.6% (DD 10.5%); rpt 0.5 → +31.0% (DD 15.7%).

Грубая оценка: сделки ячейки id 127 при rpt=1.0 с компаундингом ≈ +150–160% net,
MaxDD ≈ 25–35%. Цель арифметически достижима; кампания должна подтвердить это честно
и, по возможности, улучшить сам край (edge).

## 2. Цель и критерий успеха (заморожено)

- **Период:** 2024-06-01 → 2026-06-08. **Train** = 2024-06-01 → 2025-06-01.
  **Test** = 2025-06-01 → 2026-06-08.
- **Успех:** на полном периоде net PnL ≥ **+100%** И test-окно **положительно**
  (net PnL > 0 при ≥ 20 сделках в test — защита от вырожденных «побед» на 3 сделках),
  при MaxDD полного периода ≤ **30%**.
- **Дисциплина против курвфиттинга:** вся оптимизация — только на train-окне.
  Test запускается **по одному разу** максимум на **2** замороженных кандидата.
  Повторная оптимизация после взгляда на test запрещена; если оба кандидата
  провалились — кампания отчитывается лучшим честным результатом.
- **Плечо: lev = 1 (спот) во всех экспериментах.** В этом движке нотионал не зависит
  от плеча (плечо лишь делит маржу), поэтому lev > 1 добавляет только funding-расходы
  и риск ликвидации — для максимизации PnL строго вредно.
- **Принятый риск:** test-год может провалить цель. Тогда результат кампании — знание,
  а не цифра. Бэктест ≠ форвард-доходность; гарантий нет.

## 3. Фаза 1 — движок: режим компаундинга

### Изменения
1. **`src/agents/RiskPolicy.js`** — новый guardrail `sizingMode: 'fixed' | 'compound'`
   (default `'fixed'`). Строка сайзинга меняется с
   `const sizeUSD = Math.min((g.portfolioValue || 0) * (g.riskPerTrade || 0), g.maxTradeSizeUSD ?? Infinity);`
   на базу `const base = (g.sizingMode === 'compound' && ctx.equity != null) ? ctx.equity : (g.portfolioValue || 0);`
   `const sizeUSD = Math.min(base * (g.riskPerTrade || 0), g.maxTradeSizeUSD ?? Infinity);`
   Кап `maxTradeSizeUSD` действует в обоих режимах.
2. **`src/backtest/simulator.js`** — в шаге 4 (decide) добавить
   `if (guardrails.sizingMode === 'compound') portfolio.equity = equity;`
   Оба существующих пути (spot и futures без флага) остаются байт-идентичными.
3. **CLI** — флаг `--sizing compound` в `backtest/run-backtest.js` (в `buildGuardrails`:
   `sizingMode: args.sizing === 'compound' ? 'compound' : 'fixed'`) и прокидка в
   `backtest/run-matrix.js` (риск-шаблоны матрицы получают тот же ключ).

### Безопасность лайва
`RiskPolicy` — общий код, но `sizingMode` никогда не выставляется конфигами стратегий
и `resolveConfig` его не производит; default `'fixed'` = поведение до изменения.
Тот же паттерн, что `minRiskRewardRatio` (Spec 2) и HTF-гейт (Spec 4).

### Тесты
`tests/test_sizing_mode.mjs`: (а) fixed → размер не меняется при изменении equity
(байт-идентичность старому поведению); (б) compound → размер растёт/сжимается с
equity; (в) compound при отсутствии ctx.equity → фоллбэк на portfolioValue;
(г) maxTradeSizeUSD каппирует оба режима. Плюс зелёная регрессия
`tests/test_simulator.js` и остальных сьютов.

## 4. Фаза 2 — калибровка экспозиции (train)

Матричные прогоны на train-окне, lev=1, компаундинг ON:

```
node backtest/run-matrix.js --risks pnl_rpt025,pnl_rpt050,pnl_rpt075,pnl_rpt100 \
  --logics SMC --symbols XRPUSDT,SOLUSDT,BTCUSDT --tfs 1H --sizing compound \
  --from 2024-06-01 --to 2025-06-01 --group pnl_p2_sizing [--htf]
```

Грид: `riskPerTrade` ∈ {0.25, 0.5, 0.75, 1.0} — четыре новых риск-шаблона
`templates/risk/pnl_rpt025.json` … `pnl_rpt100.json` (SL/TP лучших ячеек: XRP 3%/6%,
BTC 5%/15% — берём 3%/6% как общий старт, BTC-вариант проверяется в Фазе 3 гридом);
HTF-гейт on/off для каждой ячейки.

**Выбор:** максимальный rpt, при котором train-MaxDD ≤ **20%** (запас к лимиту 30%,
т.к. test всегда хуже train). Выход фазы: таблица в research-ноте + выбранная база.

## 5. Фаза 3 — edge-эксперименты (train, по одному, «плато не пик»)

Каждый рычаг — opt-in, default = текущее поведение. Принимается, только если улучшает
train-PnL и/или снижает train-DD на **плато** (соседние значения параметров тоже
улучшают); одиночный пик = шум = отбрасываем.

### (a) ATR-стопы
- **`src/indicators/technical.js`** — добавить `Technicals.atr(candles, period)`
  (Wilder: TR = max(h−l, |h−pc|, |l−pc|), сглаживание как в ADX; период default 14).
  Сейчас ATR в кодовой базе нет.
- **`src/core/pipeline.js`** — если `account.guardrails.stopMode === 'atr'`, посчитать
  `Technicals.atr(ctx.candles, guardrails.atrPeriod || 14)` и передать в
  `RiskPolicy.evaluate` через ctx (`atr: <значение>`). Флаг выключен → пайплайн
  байт-идентичен (лайв не затронут).
- **`src/agents/RiskPolicy.js`** — guardrail `stopMode: 'percent' | 'atr' | 'structural'`
  (default `'percent'`). При `'atr'` и валидном `ctx.atr > 0`:
  `slPrice = entry ∓ atrSL×ATR`, `tpPrice = entry ± atrTP×ATR` (зеркально по side);
  guardrails `atrSL` (default 2), `atrTP` (default 4). При невалидном ATR — фоллбэк
  на percent-режим.
- CLI: `--stopMode atr --atrPeriod 14 --atrSL 2 --atrTP 4`.
- Грид: atrSL {1.5, 2, 3} × atrTP {3, 4, 6}.

### (b) Структурный SL
- При `stopMode: 'structural'`: `slPrice = ctx.invalidation` (свинг-уровень SMC, уже
  прокинут в Spec 2), если он на правильной стороне (BUY: invalidation < entry;
  SELL: invalidation > entry); `tpPrice = entry ± structuralRR × |entry − slPrice|`
  (guardrail `structuralRR`, default 2). Невалидный/отсутствующий invalidation —
  фоллбэк на percent.
- CLI: `--stopMode structural --structuralRR 2`. Грид structuralRR {1.5, 2, 3}.

### (c) Безубыток (только симулятор)
- **`src/backtest/simulator.js`** — опция `p.exitPolicy = { breakevenR: number }`
  (отсутствует → поведение не меняется). Определение R = |entryPrice − начальный
  slPrice|. В конце обработки бара (после шага 3, если позиция жива): если
  favorable excursion бара достигла `entry ± breakevenR×R` (BUY: `bar.high >= entry + breakevenR*R`),
  то `slPrice` переносится на `entryPrice` **со следующего бара** (никакой внутрибарной
  двусмысленности; перенос ровно один раз, только в сторону профита:
  BUY `slPrice = max(slPrice, entryPrice)`, SELL — `min`).
- CLI: `--breakevenR 1`. Грид breakevenR {0.5, 1, 1.5}.
- Лайв не видит этот код вообще (живёт только в `simulate`).

### Тесты Фазы 3
`tests/test_atr.mjs` (значения Wilder на известном ряде, недостаток данных → null/[]);
`tests/test_stop_modes.mjs` (atr-цены зеркальны по side; structural берёт invalidation,
RR-таргет корректен; оба фоллбэка на percent); `tests/test_breakeven.mjs` (переносится
один раз, только в плюс, эффективен со следующего бара; без exitPolicy — байт-идентичность).

## 6. Фаза 4 — заморозка и слепой тест

1. По train-результатам зафиксировать ≤ 2 конфига-кандидата (полный набор guardrails
   + флагов, записанный в research-ноту ДО запуска test).
2. Прогнать каждый: (а) полный период 2024-06-01→2026-06-08, (б) только test-окно.
3. Отчёт (research-нота `docs/research/<дата-запуска>-pnl-campaign.md`, дата подставляется в день прогона): PnL% полный /
   train / test, MaxDD, сделки, WR, profit factor — против бейслайна +10.13%.
   Вердикт по критерию §2 прямым текстом, включая провал, если он случился.

## 7. Вне объёма

Новая логика стратегии; портфельный режим (несколько символов в одном equity);
walk-forward; включение `sizingMode`/`stopMode`/`exitPolicy` в лайв-конфиги;
BREAKOUT-домер; изменение фронтенда/сервера.

## 8. Риски

| Риск | Митигция |
|---|---|
| Test-год проваливает цель | Честный отчёт; критерий и лимит «2 кандидата» заморожены заранее |
| Курвфиттинг внутри train | «Плато не пик», грубые гриды, по одному рычагу за раз |
| Случайно задеть лайв | Все режимы default-off; регрессия всех сьютов; live-конфиги не трогаем |
| Compound + просадка → рост эффективной экспозиции при fixed | Именно поэтому фиксим компаундинг ДО калибровки экспозиции |
| DD-оценка по close-точкам equity-кривой занижает внутрибарную просадку | Принимаем как ограничение движка; фиксируем в отчёте |
