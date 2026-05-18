export const confirmation_break = (price, open, data, config) => {
  const rejection = data.rejection;
  if (!rejection)
    return {
      label: "Confirmation Break",
      required: "Break Rejection Extreme",
      actual: "No Rejection",
      pass: false,
    };

  const bullish = rejection.type === "bullish" && price > rejection.high;
  const bearish = rejection.type === "bearish" && price < rejection.low;

  return {
    label: "Confirmation Break",
    required: "Break Rejection Extreme",
    actual: bullish ? "Above High" : bearish ? "Below Low" : "No Break",
    pass: bullish || bearish,
  };
};

export const rejection_candle = (price, open, data, config) => {
  const rejection = data.rejection;
  return {
    label: "Rejection Candle",
    required: "True",
    actual: `${!!rejection}`,
    pass: !!rejection,
  };
};

export const structure_shift = (price, open, data, config) => {
  const trend = data.structure?.trend;
  return {
    label: "Structure Shift",
    required: "Trend Changed",
    actual: trend === 1 ? "Bullish" : trend === -1 ? "Bearish" : "Neutral",
    pass: trend !== 0,
  };
};

export const unhealthy_move = (price, open, data, config) => {
  const fvg = data.recentFVG;
  return {
    label: "Unhealthy Move (FVG)",
    required: "True",
    actual: `${!!fvg}`,
    pass: !!fvg,
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
  };
};

export const trend_filter = (price, open, data, config) => {
  const trend = data.structure?.trend;
  return {
    label: "Trend Detected",
    required: "Bullish or Bearish",
    actual: trend === 1 ? "Bullish" : trend === -1 ? "Bearish" : "Neutral",
    pass: trend !== 0,
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
  };
};

export const channel_active = (price, open, data, config) => {
  const active = data.channel?.active;
  return {
    label: "Channel Active",
    required: "True",
    actual: `${active}`,
    pass: !!active,
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
    };

  const bullish = bodyMidpoint > channel.top;
  const bearish = bodyMidpoint < channel.bottom;

  return {
    label: "Strong Close Breakout",
    required: "Outside Channel",
    actual: bullish ? "Above Top" : bearish ? "Below Bottom" : "Inside",
    pass: bullish || bearish,
  };
};

export const wt_oversold = (price, open, data, config) => {
  const val = data.wt?.wt2;
  return {
    label: "WaveTrend Oversold",
    required: "<= -53",
    actual: `${val}`,
    pass: val <= -53,
  };
};

export const wt_overbought = (price, open, data, config) => {
  const val = data.wt?.wt2;
  return {
    label: "WaveTrend Overbought",
    required: ">= 53",
    actual: `${val}`,
    pass: val >= 53,
  };
};

export const wt_cross_up = (price, open, data, config) => {
  const val = data.wtCrossUp;
  return {
    label: "WT Bullish Cross",
    required: "True",
    actual: `${val}`,
    pass: !!val,
  };
};

export const wt_cross_down = (price, open, data, config) => {
  const val = data.wtCrossDown;
  return {
    label: "WT Bearish Cross",
    required: "True",
    actual: `${val}`,
    pass: !!val,
  };
};

export const mfi_bullish = (price, open, data, config) => {
  const val = data.mfi;
  return {
    label: "MFI Bullish Flow",
    required: "> 50",
    actual: `${val}`,
    pass: val > 50,
  };
};

export const mfi_bearish = (price, open, data, config) => {
  const val = data.mfi;
  return {
    label: "MFI Bearish Flow",
    required: "< 50",
    actual: `${val}`,
    pass: val < 50,
  };
};

export const stoch_rsi_oversold = (price, open, data, config) => {
  const val = data.stochRsi?.k;
  return {
    label: "Stoch RSI Oversold",
    required: "< 20",
    actual: `${val}`,
    pass: val < 20,
  };
};

export const stc_bullish = (price, open, data, config) => {
  const val = data.stc;
  return {
    label: "STC Bullish Cycle",
    required: "> 25",
    actual: `${val}`,
    pass: val > 25,
  };
};

export const sommi_diamond_bull = (price, open, data, config) => {
  const val = data.wtCrossUp;
  return {
    label: "Sommi Bullish Diamond (Proxy)",
    required: "True",
    actual: `${val}`,
    pass: !!val,
  };
};
