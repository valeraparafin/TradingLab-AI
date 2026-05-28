export const ob_entry = (price, open, data, config) => {
  const inOB = data.obs?.some(
    (ob) => price >= ob.range.bottom && price <= ob.range.top,
  );
  return {
    label: "Order Block Entry",
    required: "Price in OB",
    actual: `${inOB}`,
    pass: !!inOB,
    score: !!inOB ? 1.0 : 0.0,
  };
};

export const confirmation_break = (price, open, data, config) => {
  const rejection = data.rejection;
  if (!rejection)
    return {
      label: "Confirmation Break",
      required: "Break Rejection Extreme",
      actual: "No Rejection",
      pass: false,
      score: 0.0,
    };

  const bullish = rejection.type === "bullish" && price > rejection.high;
  const bearish = rejection.type === "bearish" && price < rejection.low;

  return {
    label: "Confirmation Break",
    required: "Break Rejection Extreme",
    actual: bullish ? "Above High" : bearish ? "Below Low" : "No Break",
    pass: bullish || bearish,
    score: bullish || bearish ? 1.0 : 0.0,
  };
};

export const rejection_candle = (price, open, data, config) => {
  const rejection = data.rejection;
  return {
    label: "Rejection Candle",
    required: "True",
    actual: `${!!rejection}`,
    pass: !!rejection,
    score: !!rejection ? 1.0 : 0.0,
  };
};

export const structure_shift = (price, open, data, config) => {
  const trend = data.structure?.trend;
  return {
    label: "Structure Shift",
    required: "Trend Changed",
    actual: trend === 1 ? "Bullish" : trend === -1 ? "Bearish" : "Neutral",
    pass: trend !== 0,
    score: trend !== 0 ? 1.0 : 0.5,
  };
};

export const unhealthy_move = (price, open, data, config) => {
  const fvg = data.recentFVG;
  return {
    label: "Unhealthy Move (FVG)",
    required: "True",
    actual: `${!!fvg}`,
    pass: !!fvg,
    score: !!fvg ? 1.0 : 0.0,
  };
};

export const htf_location = (price, open, data, config) => {
  // Simplified for now: assume pass if we are in the loop,
  // but in real implementation this would check against 15m zones.
  return {
    label: "HTF Location",
    required: "In 15m Zone",
    actual: "Manual/Proxy",
    pass: true,
    score: 1.0,
  };
};

export const trend_filter = (price, open, data, config) => {
  const trend = data.structure?.trend;
  return {
    label: "Trend Detected",
    required: "Bullish or Bearish",
    actual: trend === 1 ? "Bullish" : trend === -1 ? "Bearish" : "Neutral",
    pass: trend !== 0,
    score: trend !== 0 ? 1.0 : 0.5,
  };
};

export const zone_filter = (price, open, data, config) => {
  const inOB = data.obs?.some(
    (ob) => price >= ob.range.bottom && price <= ob.range.top,
  );
  const inFVG = data.fvgs?.some(
    (fvg) => price >= fvg.bottom && price <= fvg.top,
  );
  return {
    label: "Price in OB or FVG",
    required: "True",
    actual: `${inOB || inFVG}`,
    pass: inOB || inFVG,
    score: inOB || inFVG ? 1.0 : 0.0,
  };
};

export const channel_active = (price, open, data, config) => {
  const active = data.channel?.active;
  return {
    label: "Channel Active",
    required: "True",
    actual: `${active}`,
    pass: !!active,
    score: !!active ? 1.0 : 0.0,
  };
};

export const strong_close = (price, open, data, config) => {
  const bodyMidpoint = (open + price) / 2;
  const channel = data.channel;
  if (!channel)
    return {
      label: "Channel Data",
      required: "Exists",
      actual: "Missing",
      pass: false,
      score: 0.0,
    };

  const bullish = bodyMidpoint > channel.top;
  const bearish = bodyMidpoint < channel.bottom;

  return {
    label: "Strong Close Breakout",
    required: "Outside Channel",
    actual: bullish ? "Above Top" : bearish ? "Below Bottom" : "Inside",
    pass: bullish || bearish,
    score: bullish || bearish ? 1.0 : 0.0,
  };
};

export const wt_oversold = (price, open, data, config) => {
  const val = data.wt?.wt2;
  const threshold = -53;
  const buffer = 20;
  const pass = val <= threshold;
  const score = pass ? 1.0 : Math.max(0, 1 - (val - threshold) / buffer);
  return {
    label: "WaveTrend Oversold",
    required: "<= -53",
    actual: `${val}`,
    pass: pass,
    score: score,
  };
};

export const wt_overbought = (price, open, data, config) => {
  const val = data.wt?.wt2;
  const threshold = 53;
  const buffer = 20;
  const pass = val >= threshold;
  const score = pass ? 1.0 : Math.max(0, 1 - (threshold - val) / buffer);
  return {
    label: "WaveTrend Overbought",
    required: ">= 53",
    actual: `${val}`,
    pass: pass,
    score: score,
  };
};

export const wt_cross_up = (price, open, data, config) => {
  const val = data.wtCrossUp;
  return {
    label: "WT Bullish Cross",
    required: "True",
    actual: `${val}`,
    pass: !!val,
    score: !!val ? 1.0 : 0.0,
  };
};

export const wt_cross_down = (price, open, data, config) => {
  const val = data.wtCrossDown;
  return {
    label: "WT Bearish Cross",
    required: "True",
    actual: `${val}`,
    pass: !!val,
    score: !!val ? 1.0 : 0.0,
  };
};

export const mfi_bullish = (price, open, data, config) => {
  const val = data.mfi;
  const threshold = 50;
  const buffer = 20;
  const pass = val > threshold;
  const score = pass ? 1.0 : Math.max(0, 1 - (threshold - val) / buffer);
  return {
    label: "MFI Bullish Flow",
    required: "> 50",
    actual: `${val}`,
    pass: pass,
    score: score,
  };
};

export const mfi_bearish = (price, open, data, config) => {
  const val = data.mfi;
  const threshold = 50;
  const buffer = 20;
  const pass = val < threshold;
  const score = pass ? 1.0 : Math.max(0, 1 - (val - threshold) / buffer);
  return {
    label: "MFI Bearish Flow",
    required: "< 50",
    actual: `${val}`,
    pass: pass,
    score: score,
  };
};

export const stoch_rsi_oversold = (price, open, data, config) => {
  const val = data.stochRsi?.k;
  const threshold = 20;
  const buffer = 20;
  const pass = val < threshold;
  const score = pass ? 1.0 : Math.max(0, 1 - (val - threshold) / buffer);
  return {
    label: "Stoch RSI Oversold",
    required: "< 20",
    actual: `${val}`,
    pass: pass,
    score: score,
  };
};

export const stc_bullish = (price, open, data, config) => {
  const val = data.stc;
  const threshold = 25;
  const buffer = 20;
  const pass = val > threshold;
  const score = pass ? 1.0 : Math.max(0, 1 - (threshold - val) / buffer);
  return {
    label: "STC Bullish Cycle",
    required: "> 25",
    actual: `${val}`,
    pass: pass,
    score: score,
  };
};

export const sommi_diamond_bull = (price, open, data, config) => {
  const val = data.wtCrossUp;
  return {
    label: "Sommi Bullish Diamond (Proxy)",
    required: "True",
    actual: `${val}`,
    pass: !!val,
    score: !!val ? 1.0 : 0.0,
  };
};

export const momentum_shift = (price, open, data, config) => {
  const { wt, wtCrossUp, wtCrossDown } = data;
  const side = config.side;
  const mode = config.mode || "balanced";

  let pass = false;
  let actual = "none";

  // For aggressive mode, we allow a wider window for the crossover
  const wtThresholdLong = mode === "aggressive" ? -40 : -53;
  const wtThresholdShort = mode === "aggressive" ? 40 : 53;

  if (side === "LONG") {
    pass = wtCrossUp && wt?.wt2 <= wtThresholdLong;
    actual = pass ? "bullish_shift" : (wtCrossUp ? "crossover_not_extreme" : "no_crossover");
  } else if (side === "SHORT") {
    pass = wtCrossDown && wt?.wt2 >= wtThresholdShort;
    actual = pass ? "bearish_shift" : (wtCrossDown ? "crossover_not_extreme" : "no_crossover");
  }

  return {
    label: "Momentum Shift",
    required: `Crossover in Zone (${mode === "aggressive" ? "Wide" : "Extreme"})`,
    actual: actual,
    pass: pass,
    score: pass ? 1.0 : 0.0,
  };
};
