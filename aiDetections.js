import { PLANS, MONTHS } from './constants';
import { genActual, histSeasonal, attritionRate, fmt } from './dataEngine';

export function runDetections(getD, scId, curM) {
  const sgs = []; let sid = 0;

  PLANS.forEach((plan) => {
    const recent = [];
    for (let m = Math.max(0, curM - 2); m <= curM; m++) {
      const fc = getD(scId, plan.id, m); const act = genActual(plan, m);
      recent.push({ mape: Math.abs(fc.totalVol - act.totalVol) / act.totalVol });
    }
    const avg = recent.reduce((a, r) => a + r.mape, 0) / recent.length;
    if (avg > 0.07) {
      const fc0 = getD(scId, plan.id, curM); const act0 = genActual(plan, curM);
      const dir = fc0.totalVol > act0.totalVol ? "over" : "under";
      const corr = dir === "over" ? -avg * 0.8 : avg * 0.8;
      const plans = [];
      for (let m = curM; m < Math.min(curM + 3, 12); m++) {
        const fc = getD(scId, plan.id, m);
        plans.push({ planId: plan.id, month: m, field: "obInv", currentVal: fc.ob.inv, proposedVal: Math.round(fc.ob.inv * (1 + corr)), reason: `${(corr * 100).toFixed(0)}% inventory adj` });
      }
      sgs.push({ id: `d-${sid++}`, type: "accuracy", title: `${plan.name} — ${dir}-predicting volume by ${(avg * 100).toFixed(0)}%`, verdict: `Avg MAPE ${(avg * 100).toFixed(1)}% over last 3 months. Recommend inventory correction of ${(Math.abs(corr) * 100).toFixed(0)}%.`, plans });
    }
  });

  PLANS.forEach((plan) => {
    const ahtS = []; for (let m = 0; m < 12; m++) { ahtS.push(genActual(plan, m).wtdAht); }
    let streak = 0, maxS = 0, sEnd = 0;
    for (let i = 1; i < ahtS.length; i++) { if (ahtS[i] > ahtS[i-1]) { streak++; if (streak > maxS) { maxS = streak; sEnd = i; } } else streak = 0; }
    if (maxS >= 2 && sEnd >= curM - 1) {
      const avgInc = Math.round((ahtS[sEnd] - ahtS[sEnd - maxS]) / maxS);
      if (avgInc >= 2) {
        const plans = [];
        for (let m = curM; m < Math.min(curM + 3, 12); m++) { const fc = getD(scId, plan.id, m); plans.push({ planId: plan.id, month: m, field: "obAht", currentVal: fc.ob.aht, proposedVal: fc.ob.aht + avgInc, reason: `+${avgInc}s OB AHT trend` }); }
        sgs.push({ id: `d-${sid++}`, type: "aht", title: `${plan.name} — AHT rising ${maxS + 1} consecutive months`, verdict: `Weighted AHT increased ~${avgInc}s/month. Recommend adjusting outbound AHT +${avgInc}s.`, plans });
      }
    }
  });

  PLANS.forEach((plan) => {
    const misses = [];
    for (let m = 0; m < 12; m++) { const fc = getD(scId, plan.id, m); const hist = histSeasonal(plan, m); const ratio = fc.totalVol / hist; if (Math.abs(ratio - 1) > 0.08) misses.push({ m, ratio }); }
    const rel = misses.filter((ms) => ms.m >= curM && ms.m < curM + 6);
    if (rel.length >= 2) {
      const avgR = rel.reduce((a, r) => a + r.ratio, 0) / rel.length;
      const dir = avgR > 1 ? "over" : "under";
      const corr = dir === "over" ? -(avgR - 1) * 0.7 : (1 - avgR) * 0.7;
      const plans = rel.slice(0, 3).map((ms) => { const fc = getD(scId, plan.id, ms.m); return { planId: plan.id, month: ms.m, field: "obInv", currentVal: fc.ob.inv, proposedVal: Math.round(fc.ob.inv * (1 + corr)), reason: `${(corr * 100).toFixed(0)}% seasonal adj` }; });
      sgs.push({ id: `d-${sid++}`, type: "seasonal", title: `${plan.name} — forecast ${dir}-shoots seasonal pattern`, verdict: `Forecast deviates ${(Math.abs(avgR - 1) * 100).toFixed(0)}% from prior year across ${rel.length} months.`, plans });
    }
  });

  PLANS.forEach((plan) => {
    const d = getD(scId, plan.id, curM); const gap = d.variance; const gapPct = Math.abs(gap) / plan.hc;
    if (Math.abs(gap) > 15 || gapPct > 0.10) {
      const dir = gap < 0 ? "under" : "over"; let persist = 0;
      for (let m = curM; m < Math.min(curM + 3, 12); m++) { const dd = getD(scId, plan.id, m); if ((dir === "under" && dd.variance < -10) || (dir === "over" && dd.variance > 15)) persist++; }
      if (persist >= 2) sgs.push({ id: `d-${sid++}`, type: "variance", title: `${plan.name} — ${dir}staffed by ${Math.abs(Math.round(gap))} FTE`, verdict: `HC ${dir === "under" ? "deficit" : "surplus"} of ${Math.abs(Math.round(gap))} FTE (${(gapPct * 100).toFixed(0)}% of HC) persists ${persist}+ months.`, plans: [] });
    }
  });

  const rate = attritionRate(curM);
  if (rate > 0.05) {
    const affected = PLANS.filter((p) => p.hc > 150).slice(0, 3);
    sgs.push({ id: `d-${sid++}`, type: "attrition", title: `Seasonal attrition spike — ${(rate * 100).toFixed(1)}% projected for ${MONTHS[curM]}`, verdict: `Historical pattern shows elevated attrition. ${affected.length} large plans may lose ${Math.round(rate * 100)}% of HC.`, plans: [] });
  }
  return sgs;
}