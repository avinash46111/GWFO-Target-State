import { WD } from './constants';

export function sd(id, mi) {
  return ((id.charCodeAt(0) * 31 + id.charCodeAt(id.length - 1) * 17 + mi * 13 + 7) % 100) / 100;
}

export function attritionRate(mi) {
  return 0.04 + 0.02 * Math.sin((mi + 1) * Math.PI / 6);
}

export function genOB(plan, mi) {
  const s = sd(plan.id, mi);
  const late = plan.stage === "Late" ? 1 : 0;
  const seas = 1 + 0.10 * Math.sin((mi - 2) * Math.PI / 6);
  const inv = Math.round((plan.hc * 120 + late * plan.hc * 40) * seas * (0.92 + s * 0.16));
  const tbp = +(0.55 + s * 0.15 + late * 0.10).toFixed(3);
  const intensity = +(1.8 + s * 0.8 + late * 0.4).toFixed(2);
  const connect = +(0.18 + s * 0.10 - late * 0.03).toFixed(3);
  const attempts = Math.round(inv * tbp * intensity * connect);
  const aht = Math.round(180 + s * 60 + late * 45);
  return { inv, tbp, intensity, connect, attempts, aht };
}

export function genIB(plan, mi) {
  const s = sd(plan.id + "IB", mi);
  const late = plan.stage === "Late" ? 1 : 0;
  const seas = 1 + 0.14 * Math.sin((mi - 1) * Math.PI / 5.5);
  const vol = Math.round(plan.hc * 32 * seas * (0.88 + s * 0.18) + late * plan.hc * 8);
  const aht = Math.round(220 + s * 50 + late * 55);
  return { vol, aht };
}

export function genPlanData(plan, mi, scAdj) {
  const ob = genOB(plan, mi);
  const ib = genIB(plan, mi);
  const key = `${plan.id}-${mi}`;
  const a = scAdj[key] || {};
  const obAdj = {
    ...ob, inv: a.obInv ?? ob.inv, tbp: a.obTbp ?? ob.tbp,
    intensity: a.obInt ?? ob.intensity, connect: a.obConn ?? ob.connect,
    aht: a.obAht ?? ob.aht,
  };
  obAdj.attempts = Math.round(obAdj.inv * obAdj.tbp * obAdj.intensity * obAdj.connect);
  const ibAdj = { vol: a.ibVol ?? ib.vol, aht: a.ibAht ?? ib.aht };
  const totalVol = obAdj.attempts + ibAdj.vol;
  const wtdAht = Math.round((obAdj.attempts * obAdj.aht + ibAdj.vol * ibAdj.aht) / totalVol);
  const avail = +(0.72 + sd(plan.id, mi) * 0.06).toFixed(3);
  const occ = +(0.84 + sd(plan.id, mi) * 0.05).toFixed(3);
  const fteReq = +(totalVol * wtdAht / (WD[mi] * 8 * 3600 * avail * occ)).toFixed(1);
  const rpc = +(0.28 + sd(plan.id + "r", mi) * 0.15).toFixed(3);
  const ptp = +(0.15 + sd(plan.id + "p", mi) * 0.12).toFixed(3);
  const variance = +(plan.hc - fteReq).toFixed(1);
  return { ob: obAdj, ib: ibAdj, totalVol, wtdAht, avail, occ, fteReq, rpc, ptp, variance, hc: plan.hc };
}

export function genActual(plan, mi) {
  const ob = genOB(plan, mi);
  const ib = genIB(plan, mi);
  const s = sd(plan.id, mi);
  const planBias = plan.id === "CRD-L" ? -0.08 : plan.id === "RTL-E" ? 0.06 : plan.id === "SS-L" ? -0.05 : (s - 0.5) * 0.04;
  const obAct = { ...ob, attempts: Math.round(ob.attempts * (1 + planBias)) };
  const ibAct = { ...ib, vol: Math.round(ib.vol * (1 + planBias * 0.7)) };
  const ahtDrift = plan.id === "CRD-L" ? (mi * 1.5) : plan.id === "SS-E" ? (mi * 0.8) : 0;
  const totalVol = obAct.attempts + ibAct.vol;
  const wtdAht = Math.round((obAct.attempts * (ob.aht + ahtDrift) + ibAct.vol * (ib.aht + ahtDrift * 0.5)) / totalVol);
  const avail = +(0.72 + sd(plan.id, mi) * 0.06).toFixed(3);
  const occ = +(0.84 + sd(plan.id, mi) * 0.05).toFixed(3);
  const fteReq = +(totalVol * wtdAht / (WD[mi] * 8 * 3600 * avail * occ)).toFixed(1);
  return { totalVol, wtdAht, fteReq, obAttempts: obAct.attempts, ibVol: ibAct.vol };
}

export function histSeasonal(plan, mi) {
  const s = sd(plan.id, (mi + 6) % 12);
  const seas = 1 + 0.15 * Math.sin((mi - 1.5) * Math.PI / 6);
  const ob = genOB(plan, mi);
  const ib = genIB(plan, mi);
  return Math.round((ob.attempts + ib.vol) * seas * (0.93 + s * 0.08));
}

export const fmt = (n) => n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? (n / 1e3).toFixed(1) + "K" : n.toLocaleString();
export const pct = (n) => (n * 100).toFixed(1) + "%";