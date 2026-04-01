import { useState, useMemo, useCallback, useEffect } from "react";
import React from "react";
import { SANS, MONO, GROUPS, PLANS, MONTHS, WD, C, btnBase, inputStyle } from "./constants";
import { genPlanData, attritionRate, fmt, pct } from "./dataEngine";
import { runDetections } from "./aiDetections";
import { Sparkline, Badge, Pill, AIPanel } from "./components";

export default function App() {
  const [month, setMonth] = useState(0);
  const [scenarios, setScenarios] = useState([{ id:"base", name:"Base", color:C.blueLt, adj:{} }]);
  const [activeSc, setActiveSc] = useState("base");
  const [expanded, setExpanded] = useState({});
  const [editCell, setEditCell] = useState(null);
  const [showNewSc, setShowNewSc] = useState(false);
  const [newScName, setNewScName] = useState("");
  const [newScFrom, setNewScFrom] = useState("base");
  const [view, setView] = useState("plan");
  const [compareSc, setCompareSc] = useState(null);
  const [sortCol, setSortCol] = useState(null);
  const [sortDir, setSortDir] = useState("asc");
  const [aiOpen, setAiOpen] = useState(false);
  const [checked, setChecked] = useState({});
  const [applied, setApplied] = useState([]);
  const [autoOpened, setAutoOpened] = useState(false);
  const scColors = ["#0a8fe6","#8b5cf6","#f59e0b","#10b981","#ef4444"];

  const getD = useCallback((scId, planId, mi) => {
    const plan = PLANS.find((p) => p.id === planId);
    const sc = scenarios.find((s) => s.id === scId);
    return genPlanData(plan, mi, sc?.adj || {});
  }, [scenarios]);

  const aiSuggestions = useMemo(() => runDetections(getD, activeSc, month), [getD, activeSc, month]);
  useEffect(() => { if (!autoOpened && aiSuggestions.length > 0) { const t = setTimeout(() => { setAiOpen(true); setAutoOpened(true); }, 800); return () => clearTimeout(t); } }, [autoOpened, aiSuggestions]);
  useEffect(() => { const valid = new Set(); aiSuggestions.forEach((sg) => sg.plans.forEach((p) => valid.add(`${sg.id}|${p.planId}|${p.month}`))); setChecked((prev) => { const n = {}; Object.entries(prev).forEach(([k, v]) => { if (valid.has(k)) n[k] = v; }); return n; }); }, [aiSuggestions]);

  const rows = useMemo(() => PLANS.map((plan) => {
    const d = getD(activeSc, plan.id, month);
    const sparkVol = MONTHS.map((_, mi) => getD(activeSc, plan.id, mi).totalVol);
    const sparkFte = MONTHS.map((_, mi) => getD(activeSc, plan.id, mi).fteReq);
    const comp = compareSc ? getD(compareSc, plan.id, month) : null;
    const grp = GROUPS.find((g) => g.id === plan.group);
    return { ...plan, ...d, sparkVol, sparkFte, comp, grpColor: grp?.color };
  }), [month, activeSc, getD, compareSc]);

  const sorted = useMemo(() => { if (!sortCol) return rows; return [...rows].sort((a, b) => { let va = a[sortCol], vb = b[sortCol]; if (typeof va === "string") return sortDir === "asc" ? va.localeCompare(vb) : vb.localeCompare(va); return sortDir === "asc" ? va - vb : vb - va; }); }, [rows, sortCol, sortDir]);
  const totals = useMemo(() => { const t = { vol:0, fteReq:0, hc:0, variance:0 }; rows.forEach((r) => { t.vol += r.totalVol; t.fteReq += r.fteReq; t.hc += r.hc; t.variance += r.variance; }); return t; }, [rows]);
  const monthlyTotals = useMemo(() => MONTHS.map((_, mi) => { let vol=0, fte=0, hc=0; PLANS.forEach((p) => { const d = getD(activeSc, p.id, mi); vol += d.totalVol; fte += d.fteReq; hc += p.hc; }); const comp = compareSc ? PLANS.reduce((a, p) => { const d = getD(compareSc, p.id, mi); return { fte: a.fte + d.fteReq }; }, { fte: 0 }) : null; return { month: MONTHS[mi], vol, fteReq: +fte.toFixed(1), hc, variance: +(hc - fte).toFixed(1), comp }; }), [activeSc, getD, compareSc]);

  function handleOverride(planId, field, value) { const key = `${planId}-${month}`; const num = parseFloat(value); if (isNaN(num)) return; setScenarios((prev) => prev.map((s) => { if (s.id !== activeSc) return s; const adj = { ...s.adj }; if (!adj[key]) adj[key] = {}; adj[key] = { ...adj[key], [field]: field === "obTbp" || field === "obConn" ? num / 100 : Math.round(num) }; return { ...s, adj }; })); setEditCell(null); }
  function createSc() { if (!newScName.trim()) return; const from = scenarios.find((s) => s.id === newScFrom); const id = "sc-" + Date.now(); setScenarios((prev) => [...prev, { id, name: newScName.trim(), color: scColors[prev.length % scColors.length], adj: { ...(from?.adj || {}) } }]); setActiveSc(id); setShowNewSc(false); setNewScName(""); }
  function deleteSc(id) { if (id === "base") return; setScenarios((prev) => prev.filter((s) => s.id !== id)); if (activeSc === id) setActiveSc("base"); if (compareSc === id) setCompareSc(null); }
  function handleSort(col) { if (sortCol === col) setSortDir((d) => d === "asc" ? "desc" : "asc"); else { setSortCol(col); setSortDir("asc"); } }
  function toggleExp(id) { setExpanded((prev) => ({ ...prev, [id]: !prev[id] })); }
  function applyAI() { const adj = {}; const ids = new Set(); Object.entries(checked).forEach(([key, val]) => { if (!val) return; const parts = key.match(/^(.+?)\|(.+?)\|(\d+)$/); if (!parts) return; const [, sid, pid, mi] = parts; ids.add(sid); const sg = aiSuggestions.find((s) => s.id === sid); const po = sg?.plans.find((p) => p.planId === pid && p.month === parseInt(mi)); if (!po || po.field === "_info") return; const k = `${pid}-${mi}`; if (!adj[k]) adj[k] = {}; adj[k][po.field] = po.proposedVal; }); const id = "ai-" + Date.now(); setScenarios((prev) => [...prev, { id, name: "AI Adjusted " + prev.length, color: C.purple, adj }]); setActiveSc(id); setApplied((prev) => [...prev, ...Array.from(ids)]); setChecked({}); }

  const unapplied = aiSuggestions.filter((s) => !applied.includes(s.id)).length;
  const th = { padding:"7px 10px", textAlign:"right", fontSize:9, fontWeight:700, fontFamily:MONO, color:C.text2, borderBottom:`1px solid ${C.border}`, background:C.card2, position:"sticky", top:0, whiteSpace:"nowrap", cursor:"pointer", userSelect:"none" };
  const td = { padding:"6px 10px", textAlign:"right", fontSize:11, fontFamily:MONO, color:C.text, borderBottom:`1px solid ${C.border}`, whiteSpace:"nowrap" };
  const tdSub = { ...td, fontSize:10, color:C.text2, background:"rgba(10,143,230,0.03)" };
  const SH = ({ col, children, style: s }) => <th onClick={() => handleSort(col)} style={{ ...th, ...s }}>{children}{sortCol === col && <span style={{ marginLeft:3, fontSize:7 }}>{sortDir === "asc" ? "▲" : "▼"}</span>}</th>;

  function ECell({ planId, field, val, display, st }) {
    const isEd = editCell === `${planId}-${field}-${month}`;
    if (isEd) return <td style={{ ...st, padding:0 }}><input autoFocus defaultValue={field === "obTbp" || field === "obConn" ? (val * 100).toFixed(1) : val} style={{ ...inputStyle, width:"100%", borderRadius:0, border:`2px solid ${C.blueLt}`, padding:"5px" }} onBlur={(e) => handleOverride(planId, field, e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") handleOverride(planId, field, e.target.value); if (e.key === "Escape") setEditCell(null); }} /></td>;
    return <td style={{ ...st, cursor:"pointer" }} onDoubleClick={() => setEditCell(`${planId}-${field}-${month}`)}>{display ?? val}</td>;
  }

  return (
    <div style={{ fontFamily:SANS, background:C.bg, color:C.text, height:"100vh", display:"flex", flexDirection:"column", overflow:"hidden" }}>
      <div style={{ background:C.card, borderBottom:`1px solid ${C.border}`, padding:"12px 20px", display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:8, flexShrink:0 }}>
        <div style={{ display:"flex", alignItems:"center", gap:12 }}>
          <span style={{ fontSize:18, fontWeight:300, color:C.blueLt, letterSpacing:1 }}>citi</span>
          <div style={{ width:1, height:20, background:C.border }} />
          <span style={{ fontSize:13, fontWeight:700 }}>Collections Forecasting</span>
          <Badge type="amber">Step 3 of 4</Badge><Badge type="blue">Mar 2026 cycle</Badge>
        </div>
        <div style={{ display:"flex", gap:8, alignItems:"center" }}>
          <span style={{ fontSize:10, color:C.text3, fontFamily:MONO }}>USPB · COLLECTIONS · IB+OB</span>
          <button onClick={() => setAiOpen(!aiOpen)} style={{ ...btnBase, padding:"6px 12px", background:aiOpen?"linear-gradient(135deg,#8b5cf6,#0a8fe6)":C.card2, color:aiOpen?"#fff":C.text2, border:`1px solid ${aiOpen?C.purple:C.border}`, position:"relative", display:"flex", alignItems:"center", gap:6 }}>
            🤖 AI Advisor
            {!aiOpen && unapplied > 0 && <span style={{ position:"absolute", top:-6, right:-6, width:18, height:18, borderRadius:9, background:C.red, color:"#fff", fontSize:9, fontWeight:700, display:"flex", alignItems:"center", justifyContent:"center" }}>{unapplied}</span>}
          </button>
        </div>
      </div>
      <div style={{ flex:1, display:"flex", overflow:"hidden" }}>
        <div style={{ flex:1, overflow:"auto", padding:"16px 20px", display:"flex", flexDirection:"column", gap:14 }}>
          <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:8, padding:"12px 16px" }}>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:8 }}>
              <div style={{ display:"flex", alignItems:"center", gap:6, flexWrap:"wrap" }}>
                <span style={{ fontSize:10, fontWeight:700, color:C.text2, fontFamily:MONO }}>SCENARIOS</span>
                {scenarios.map((sc) => (<div key={sc.id} style={{ display:"flex", alignItems:"center" }}><Pill active={activeSc === sc.id} onClick={() => setActiveSc(sc.id)}><span style={{ display:"inline-block", width:6, height:6, borderRadius:3, background:sc.color, marginRight:4 }} />{sc.name}{sc.id !== "base" && Object.keys(sc.adj).length > 0 && <span style={{ marginLeft:4, fontSize:8, opacity:0.6 }}>({Object.keys(sc.adj).length})</span>}</Pill>{sc.id !== "base" && <button onClick={() => deleteSc(sc.id)} style={{ background:"none", border:"none", color:C.text3, cursor:"pointer", fontSize:12, padding:"0 4px" }}>×</button>}</div>))}
                <button onClick={() => setShowNewSc(!showNewSc)} style={{ ...btnBase, padding:"4px 10px", fontSize:10, background:"transparent", color:C.blueLt, border:`1px dashed ${C.border}` }}>+ New</button>
              </div>
              <div style={{ display:"flex", alignItems:"center", gap:6 }}><span style={{ fontSize:10, color:C.text3 }}>Compare:</span><select value={compareSc || ""} onChange={(e) => setCompareSc(e.target.value || null)} style={{ background:C.card2, border:`1px solid ${C.border}`, borderRadius:4, padding:"3px 8px", color:C.text2, fontSize:10, fontFamily:MONO }}><option value="">None</option>{scenarios.filter((s) => s.id !== activeSc).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
            </div>
            {showNewSc && (<div style={{ marginTop:10, padding:10, background:C.card2, borderRadius:6, display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}><input value={newScName} onChange={(e) => setNewScName(e.target.value)} placeholder="Scenario name" style={{ ...inputStyle, width:160, textAlign:"left" }} onKeyDown={(e) => { if (e.key === "Enter") createSc(); }} /><span style={{ fontSize:10, color:C.text3 }}>Clone from:</span><select value={newScFrom} onChange={(e) => setNewScFrom(e.target.value)} style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:4, padding:"3px 8px", color:C.text2, fontSize:10, fontFamily:MONO }}>{scenarios.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select><button onClick={createSc} style={{ ...btnBase, background:C.blue, color:"#fff" }}>Create</button><button onClick={() => setShowNewSc(false)} style={{ ...btnBase, background:"transparent", color:C.text3 }}>Cancel</button></div>)}
          </div>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:8 }}>
            <div style={{ display:"flex", alignItems:"center", gap:8 }}>
              <div style={{ display:"flex", border:`1px solid ${C.border}`, borderRadius:6, overflow:"hidden" }}><Pill active={view === "plan"} onClick={() => setView("plan")}>By Plan</Pill><Pill active={view === "monthly"} onClick={() => setView("monthly")}>Monthly Total</Pill></div>
              {view === "plan" && <select value={month} onChange={(e) => setMonth(+e.target.value)} style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:6, padding:"6px 12px", color:C.text, fontSize:11, fontFamily:SANS, fontWeight:600 }}>{MONTHS.map((m, i) => <option key={i} value={i}>{m}</option>)}</select>}
            </div>
            <div style={{ display:"flex", gap:6, alignItems:"center" }}><span style={{ fontSize:9, color:C.text3, fontFamily:MONO }}>Click ▶ expand IB/OB · Dbl-click edit</span><button style={{ ...btnBase, background:C.card, color:C.text2, border:`1px solid ${C.border}` }}>↓ Export</button></div>
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(130px, 1fr))", gap:10 }}>
            {[{l:"Total Volume",v:fmt(totals.vol),c:C.text},{l:"Total FTE Req",v:totals.fteReq.toFixed(0),c:C.red},{l:"Total HC",v:totals.hc.toLocaleString(),c:C.blueLt},{l:"Net Variance",v:(totals.variance>=0?"+":"")+totals.variance.toFixed(0),c:totals.variance>=0?C.green:C.red},{l:"Attrition Rate",v:pct(attritionRate(month)),c:attritionRate(month)>0.05?C.red:C.text}].map((c, i) => (<div key={i} style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:8, padding:"10px 14px" }}><div style={{ fontSize:9, fontWeight:700, fontFamily:MONO, color:C.text3, marginBottom:4 }}>{c.l}</div><div style={{ fontSize:18, fontWeight:700, fontFamily:MONO, color:c.c }}>{c.v}</div><div style={{ fontSize:9, color:C.text3, marginTop:2 }}>{MONTHS[month]}</div></div>))}
          </div>
          {view === "plan" && (
            <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:8, overflow:"hidden" }}>
              <div style={{ padding:"12px 16px", borderBottom:`1px solid ${C.border}` }}><div style={{ fontSize:13, fontWeight:700 }}>Plan-level forecast — {MONTHS[month]}</div><div style={{ fontSize:10, color:C.text3, marginTop:2 }}>OB Vol = Inventory × TBP% × Intensity × Connect Rate · {WD[month]} working days</div></div>
              <div style={{ overflowX:"auto" }}>
                <table style={{ width:"100%", borderCollapse:"collapse" }}>
                  <thead><tr><th style={{ ...th, textAlign:"left", minWidth:200 }}>Plan</th><SH col="hc">HC</SH><SH col="totalVol">Total Vol</SH><th style={th}>Trend</th><SH col="wtdAht">AHT</SH><SH col="fteReq">FTE Req</SH><SH col="variance">HC Var</SH><SH col="rpc">RPC%</SH><SH col="ptp">PTP%</SH>{compareSc && <th style={{ ...th, color:C.purple }}>Δ FTE</th>}</tr></thead>
                  <tbody>
                    {sorted.map((r) => {
                      const vc = r.variance >= 0 ? C.green : C.red;
                      const cd = r.comp ? (r.fteReq - r.comp.fteReq).toFixed(1) : null;
                      const isExp = !!expanded[r.id];
                      return (
                        <React.Fragment key={r.id}>
                          <tr onMouseEnter={(e) => e.currentTarget.style.background = C.card2} onMouseLeave={(e) => e.currentTarget.style.background = ""}>
                            <td style={{ ...td, textAlign:"left", fontFamily:SANS, fontWeight:600, minWidth:200 }}>
                              <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                                <button onClick={() => toggleExp(r.id)} style={{ background:"none", border:"none", color:C.text3, cursor:"pointer", fontSize:10, padding:0, width:16, transform:isExp?"rotate(90deg)":"none", transition:"transform .15s" }}>▶</button>
                                <div><div style={{ display:"flex", alignItems:"center", gap:6 }}><span style={{ width:8, height:8, borderRadius:4, background:r.grpColor, display:"inline-block" }} />{r.name}</div><div style={{ fontSize:9, color:C.text3, fontWeight:400, marginLeft:14 }}>{r.group} · {r.stage}</div></div>
                              </div>
                            </td>
                            <td style={{ ...td, color:C.blueLt, fontWeight:600 }}>{r.hc}</td>
                            <td style={{ ...td, fontWeight:600 }}>{fmt(r.totalVol)}</td>
                            <td style={td}><Sparkline data={r.sparkVol} /></td>
                            <td style={td}>{r.wtdAht}s</td>
                            <td style={{ ...td, fontWeight:700 }}>{r.fteReq}</td>
                            <td style={{ ...td, fontWeight:700, color:vc }}>{r.variance >= 0 ? "+" : ""}{r.variance}</td>
                            <td style={{ ...td, color:C.green }}>{pct(r.rpc)}</td>
                            <td style={{ ...td, color:C.amber }}>{pct(r.ptp)}</td>
                            {compareSc && <td style={{ ...td, color:cd > 0 ? C.red : cd < 0 ? C.green : C.text3, fontWeight:600 }}>{cd > 0 ? "+" : ""}{cd}</td>}
                          </tr>
                          {isExp && (<>
                            <tr style={{ background:"rgba(10,143,230,0.03)" }}>
                              <td style={{ ...tdSub, textAlign:"left", paddingLeft:42, fontFamily:SANS }}><span style={{ color:C.blueLt, fontWeight:600, fontSize:9, fontFamily:MONO }}>OUTBOUND</span></td>
                              <td style={tdSub} />
                              <ECell planId={r.id} field="obInv" val={r.ob.inv} display={fmt(r.ob.inv)} st={{ ...tdSub, fontSize:10 }} />
                              <td style={{ ...tdSub, fontSize:9, color:C.text3 }}>TBP {pct(r.ob.tbp)} · Int {r.ob.intensity} · CR {pct(r.ob.connect)}</td>
                              <ECell planId={r.id} field="obAht" val={r.ob.aht} display={r.ob.aht + "s"} st={tdSub} />
                              <td style={{ ...tdSub, fontWeight:600 }}>{fmt(r.ob.attempts)}</td>
                              <td colSpan={3 + (compareSc ? 1 : 0)} style={tdSub} />
                            </tr>
                            <tr style={{ background:"rgba(10,143,230,0.03)" }}>
                              <td style={{ ...tdSub, textAlign:"left", paddingLeft:42, fontFamily:SANS }}><span style={{ color:C.amber, fontWeight:600, fontSize:9, fontFamily:MONO }}>INBOUND</span></td>
                              <td style={tdSub} />
                              <ECell planId={r.id} field="ibVol" val={r.ib.vol} display={fmt(r.ib.vol)} st={tdSub} />
                              <td style={{ ...tdSub, fontSize:9, color:C.text3, fontStyle:"italic" }}>seasonal pattern</td>
                              <ECell planId={r.id} field="ibAht" val={r.ib.aht} display={r.ib.aht + "s"} st={tdSub} />
                              <td style={{ ...tdSub, fontWeight:600 }}>{fmt(r.ib.vol)}</td>
                              <td colSpan={3 + (compareSc ? 1 : 0)} style={tdSub} />
                            </tr>
                          </>)}
                        </React.Fragment>
                      );
                    })}
                    <tr style={{ background:C.card2 }}>
                      <td style={{ ...td, textAlign:"left", fontFamily:SANS, fontWeight:700 }}>TOTAL</td>
                      <td style={{ ...td, fontWeight:700, color:C.blueLt }}>{totals.hc}</td>
                      <td style={{ ...td, fontWeight:700 }}>{fmt(totals.vol)}</td>
                      <td style={td} /><td style={td} />
                      <td style={{ ...td, fontWeight:700 }}>{totals.fteReq.toFixed(0)}</td>
                      <td style={{ ...td, fontWeight:700, color:totals.variance >= 0 ? C.green : C.red }}>{totals.variance >= 0 ? "+" : ""}{totals.variance.toFixed(0)}</td>
                      <td style={td} /><td style={td} />{compareSc && <td style={td} />}
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {view === "monthly" && (
            <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:8, overflow:"hidden" }}>
              <div style={{ padding:"12px 16px", borderBottom:`1px solid ${C.border}` }}><div style={{ fontSize:13, fontWeight:700 }}>12-month forecast — Mar 2026 to Feb 2027</div><div style={{ fontSize:10, color:C.text3, marginTop:2 }}>All 8 plans · {scenarios.find((s) => s.id === activeSc)?.name}</div></div>
              <div style={{ overflowX:"auto" }}>
                <table style={{ width:"100%", borderCollapse:"collapse" }}>
                  <thead><tr><th style={{ ...th, textAlign:"left" }}>Month</th><th style={th}>WD</th><th style={th}>Volume</th><th style={th}>FTE Req</th><th style={th}>HC</th><th style={th}>Variance</th><th style={th}>Attrition</th>{compareSc && <th style={{ ...th, color:C.purple }}>Δ FTE</th>}</tr></thead>
                  <tbody>{monthlyTotals.map((r, i) => {
                    const vc = r.variance >= 0 ? C.green : C.red; const cd = r.comp ? (r.fteReq - r.comp.fte).toFixed(1) : null;
                    const isMax = r.fteReq === Math.max(...monthlyTotals.map((m) => m.fteReq)); const attr = attritionRate(i);
                    return (<tr key={i} style={{ background:isMax?"rgba(220,38,38,0.06)":undefined, cursor:"pointer" }} onClick={() => { setMonth(i); setView("plan"); }} onMouseEnter={(e) => { if (!isMax) e.currentTarget.style.background = C.card2; }} onMouseLeave={(e) => { if (!isMax) e.currentTarget.style.background = ""; }}>
                      <td style={{ ...td, textAlign:"left", fontFamily:SANS, fontWeight:600 }}>{r.month} {isMax && <Badge type="red">Peak</Badge>}</td>
                      <td style={{ ...td, color:C.text3 }}>{WD[i]}</td><td style={td}>{fmt(r.vol)}</td><td style={{ ...td, fontWeight:700 }}>{r.fteReq}</td><td style={{ ...td, color:C.blueLt }}>{r.hc}</td>
                      <td style={{ ...td, fontWeight:700, color:vc }}>{r.variance >= 0 ? "+" : ""}{r.variance}</td><td style={{ ...td, color:attr > 0.05 ? C.red : C.text3 }}>{pct(attr)}</td>
                      {compareSc && <td style={{ ...td, color:cd > 0 ? C.red : cd < 0 ? C.green : C.text3, fontWeight:600 }}>{cd > 0 ? "+" : ""}{cd}</td>}
                    </tr>);
                  })}</tbody>
                </table>
              </div>
              <div style={{ padding:"10px 16px", borderTop:`1px solid ${C.border}`, fontSize:10, color:C.text3 }}>Click any month to drill into plan view</div>
            </div>
          )}
          <div style={{ display:"flex", gap:8, justifyContent:"flex-end" }}>
            <button style={{ ...btnBase, background:C.card, color:C.text2, border:`1px solid ${C.border}` }}>↓ Export to PAW</button>
            <button style={{ ...btnBase, background:C.green, color:"#fff" }}>✓ Approve & proceed to Staffing</button>
          </div>
        </div>
        <AIPanel open={aiOpen} onClose={() => setAiOpen(false)} suggestions={aiSuggestions} checked={checked} onToggle={(k) => setChecked((p) => ({ ...p, [k]: !p[k] }))} onApply={applyAI} applied={applied} />
      </div>
    </div>
  );
}