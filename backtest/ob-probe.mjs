// Smoke-test: does signed order-flow imbalance (OFI) predict the NEXT interval's return?
// Input: raw last_trades JSON dumps (T-Bank read-only MCP overflow files).
// One in-sample 36-min SBER slice — a signal-existence probe, NOT validation.
import fs from 'node:fs';

const FILES = process.argv.slice(2);
if (!FILES.length) { console.error('usage: node ob-probe.mjs <dump1.txt> ...'); process.exit(1); }

// --- load + merge + sort ---
const trades = [];
for (const f of FILES) {
  const d = JSON.parse(fs.readFileSync(f, 'utf8'));
  for (const t of d.trades) {
    trades.push({
      ts: Date.parse(t.time),
      p: +t.price.value,
      q: +t.quantity,
      s: t.direction === 'TRADE_DIRECTION_BUY' ? 1 : -1, // aggressor sign
    });
  }
}
trades.sort((a, b) => a.ts - b.ts);
const span = (trades.at(-1).ts - trades[0].ts) / 60000;
console.log(`trades=${trades.length}  span=${span.toFixed(1)}min  rate=${(trades.length/span/60).toFixed(1)}/s`);

function pearson(x, y) {
  const n = x.length; let sx=0,sy=0,sxx=0,syy=0,sxy=0;
  for (let i=0;i<n;i++){sx+=x[i];sy+=y[i];sxx+=x[i]*x[i];syy+=y[i]*y[i];sxy+=x[i]*y[i];}
  const cov=sxy-sx*sy/n, vx=sxx-sx*sx/n, vy=syy-sy*sy/n;
  return cov/Math.sqrt(vx*vy||1);
}

function probe(binMs) {
  const t0 = trades[0].ts;
  const bins = new Map(); // idx -> {sv, tv, pv, v}
  for (const t of trades) {
    const k = Math.floor((t.ts - t0) / binMs);
    let b = bins.get(k);
    if (!b) { b = { sv:0, tv:0, pv:0, v:0 }; bins.set(k, b); }
    b.sv += t.s * t.q;       // signed volume
    b.tv += t.q;             // total volume
    b.pv += t.p * t.q;       // price*vol for vwap
    b.v  += t.q;
  }
  const keys = [...bins.keys()].sort((a,b)=>a-b);
  const ofi=[], vwap=[];
  for (const k of keys) { const b=bins.get(k); ofi.push(b.sv/b.tv); vwap.push(b.pv/b.v); }
  // next-bin return in bps (only over contiguous bins)
  const ofiX=[], retNext=[], retNow=[];
  for (let i=0;i+1<keys.length;i++){
    if (keys[i+1] !== keys[i]+1) continue; // require adjacency
    const r = (vwap[i+1]-vwap[i])/vwap[i]*1e4;
    ofiX.push(ofi[i]); retNext.push(r);
  }
  for (let i=1;i<keys.length;i++){
    if (keys[i] !== keys[i-1]+1) continue;
    retNow.push((vwap[i]-vwap[i-1])/vwap[i-1]*1e4);
  }
  // sign accuracy: does sign(OFI[t]) match sign(ret[t+1])?
  let hit=0, tot=0;
  for (let i=0;i<ofiX.length;i++){ if (Math.abs(ofiX[i])<1e-9||Math.abs(retNext[i])<1e-9) continue; tot++; if (Math.sign(ofiX[i])===Math.sign(retNext[i])) hit++; }
  // conditional mean next-return by OFI tercile
  const order=[...ofiX.keys()].sort((a,b)=>ofiX[a]-ofiX[b]);
  const third=Math.floor(order.length/3);
  const lowIdx=order.slice(0,third), hiIdx=order.slice(-third);
  const mean=a=>a.reduce((s,i)=>s+retNext[i],0)/(a.length||1);
  const corr=pearson(ofiX, retNext);
  // return autocorrelation (trend vs mean-revert at this horizon)
  const ac = pearson(retNow.slice(0,-1), retNow.slice(1));
  console.log(`\n[bin=${binMs/1000}s] bins=${keys.length} pairs=${ofiX.length}`);
  console.log(`  corr(OFI_t, ret_{t+1}) = ${corr.toFixed(3)}`);
  console.log(`  sign-accuracy          = ${(hit/tot*100).toFixed(1)}%  (n=${tot}, coin=50%)`);
  console.log(`  next-ret | OFI low3rd  = ${mean(lowIdx).toFixed(2)} bps`);
  console.log(`  next-ret | OFI high3rd = ${mean(hiIdx).toFixed(2)} bps`);
  console.log(`  spread(high-low)       = ${(mean(hiIdx)-mean(lowIdx)).toFixed(2)} bps  (cost wall ~15)`);
  console.log(`  ret autocorr(t,t+1)    = ${ac.toFixed(3)}  (+trend / -revert)`);
}

for (const s of [2, 5, 10, 30]) probe(s*1000);

// --- persistence test: does CUMULATIVE flow over a window predict a clearing move? ---
// At 10s granularity: signal = sum OFI*vol over last K bins, target = return over next K bins.
function persist(binMs, K) {
  const t0 = trades[0].ts;
  const bins = new Map();
  for (const t of trades) {
    const k = Math.floor((t.ts - t0) / binMs);
    let b = bins.get(k); if (!b) { b={sv:0,tv:0,pv:0,v:0}; bins.set(k,b); }
    b.sv+=t.s*t.q; b.tv+=t.q; b.pv+=t.p*t.q; b.v+=t.q;
  }
  const keys=[...bins.keys()].sort((a,b)=>a-b);
  const sig=[], fwd=[];
  for (let i=K;i+K<keys.length;i++){
    // require contiguity across the whole window
    let ok=true; for(let j=i-K;j<i+K;j++){ if(!bins.has(j)) {ok=false;break;} } if(!ok) continue;
    let csv=0,ctv=0; for(let j=i-K;j<i;j++){const b=bins.get(j); csv+=b.sv; ctv+=b.tv;}
    const cum = csv/(ctv||1);
    const pNow=bins.get(i-1), pFwd=bins.get(i+K-1);
    const vNow=pNow.pv/pNow.v, vFwd=pFwd.pv/pFwd.v;
    sig.push(cum); fwd.push((vFwd-vNow)/vNow*1e4);
  }
  const order=[...sig.keys()].sort((a,b)=>sig[a]-sig[b]);
  const third=Math.floor(order.length/3);
  const mean=a=>a.reduce((s,i)=>s+fwd[i],0)/(a.length||1);
  const lo=mean(order.slice(0,third)), hi=mean(order.slice(-third));
  let hit=0,tot=0; for(let i=0;i<sig.length;i++){if(Math.abs(sig[i])<1e-9||Math.abs(fwd[i])<1e-9)continue;tot++;if(Math.sign(sig[i])===Math.sign(fwd[i]))hit++;}
  console.log(`\n[persist bin=${binMs/1000}s K=${K} → ${binMs*K/1000}s window] n=${sig.length}`);
  console.log(`  corr=${pearson(sig,fwd).toFixed(3)}  sign-acc=${(hit/tot*100).toFixed(1)}%`);
  console.log(`  fwd | low3rd=${lo.toFixed(2)}  high3rd=${hi.toFixed(2)}  spread=${(hi-lo).toFixed(2)} bps (wall ~15)`);
}
persist(10000, 3);   // 30s flow -> 30s fwd
persist(10000, 6);   // 60s flow -> 60s fwd
persist(10000, 12);  // 120s flow -> 120s fwd
persist(30000, 4);   // 120s flow -> 120s fwd

