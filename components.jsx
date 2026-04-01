import React from 'react';
import { C, MONO, PLANS, MONTHS, ISSUE_TYPES, btnBase } from './constants';
import { fmt } from './dataEngine';

export function Sparkline({ data, color = "#0a8fe6", w = 72, h = 20 }) {
  if (!data || data.length < 2) return null;
  const mn = Math.min(...data), mx = Math.max(...data), r = mx - mn || 1;
  const pts = data.map((v, i) => `${(i/(data.length-1))*w},${h-2-((v-mn)/r)*(h-4)}`).join(" ");
  return <svg width={w} height={h}><polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" /></svg>;
}

export function Badge({ type, children }) {
  const cl = { green:{bg:C.greenPale,fg:C.green}, red:{bg:C.redPale,fg:C.red}, amber:{bg:C.amberPale,fg:C.amber}, blue:{bg:C.bluePale,fg:C.blueLt}, purple:{bg:C.purplePale,fg:C.purple} };
  const c = cl[type] || cl.blue;
  return <span style={{ display:"inline-flex", alignItems:"center", gap:4, padding:"2px 8px", borderRadius:4, fontSize:9, fontWeight:700, fontFamily:MONO, background:c.bg, color:c.fg, whiteSpace:"nowrap" }}>{children}</span>;
}

export function Pill({ active, onClick, children }) {
  return <button onClick={onClick} style={{ ...btnBase, padding:"4px 12px", fontSize:10, background:active?C.blue:"transparent", color:active?"#fff":C.text2, border:`1px solid ${active?C.blue:C.border}` }}>{children}</button>;
}

export function AIPanel({ open, onClose, suggestions, checked, onToggle, onApply, applied }) {
  if (!open) return null;
  const total = Object.values(checked).filter(Boolean).length;
  const active = suggestions.filter((s) => !applied.includes(s.id));
  const done = suggestions.filter((s) => applied.includes(s.id));
  return (
    <div style={{ width:370, minWidth:370, background:C.card, borderLeft:`1px solid ${C.border}`, display:"flex", flexDirection:"column", height:"100%" }}>
      <div style={{ padding:"14px 16px", borderBottom:`1px solid ${C.border}`, display:"flex", alignItems:"center", justifyContent:"space-between", background:C.card2 }}>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <div style={{ width:28, height:28, borderRadius:14, background:"linear-gradient(135deg,#8b5cf6,#0a8fe6)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:14 }}>🤖</div>
          <div><div style={{ fontSize:12, fontWeight:700, color:C.text }}>Collections AI Advisor</div><div style={{ fontSize:9, color:C.text3, fontFamily:MONO }}>{suggestions.length} detections · live</div></div>
        </div>
        <button onClick={onClose} style={{ background:"none", border:"none", color:C.text3, cursor:"pointer", fontSize:16 }}>✕</button>
      </div>
      <div style={{ flex:1, overflowY:"auto", padding:"12px" }}>
        {suggestions.length === 0 && <div style={{ textAlign:"center", padding:"40px 20px", color:C.text3 }}><div style={{ fontSize:24, marginBottom:8 }}>✓</div><div style={{ fontSize:12, fontWeight:600 }}>No issues detected</div></div>}
        {active.length > 0 && <div style={{ fontSize:9, fontWeight:700, color:C.text3, fontFamily:MONO, marginBottom:8 }}>ACTIVE ({active.length})</div>}
        {active.map((sg) => {
          const it = ISSUE_TYPES[sg.type];
          return (
            <div key={sg.id} style={{ background:C.card2, border:`1px solid ${C.border}`, borderRadius:8, marginBottom:10, overflow:"hidden" }}>
              <div style={{ padding:"10px 12px", borderBottom:`1px solid ${C.borderLt}` }}>
                <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:4 }}><span style={{ fontSize:14 }}>{it.icon}</span><Badge type={it.bt}>{it.label}</Badge></div>
                <div style={{ fontSize:11, fontWeight:700, color:C.text, lineHeight:1.4 }}>{sg.title}</div>
                <div style={{ fontSize:10, color:C.text2, lineHeight:1.5, marginTop:4 }}>{sg.verdict}</div>
              </div>
              {sg.plans.length > 0 && sg.plans[0].field !== "_info" && (
                <div style={{ padding:"8px 12px" }}>
                  <div style={{ fontSize:9, fontWeight:700, color:C.text3, fontFamily:MONO, marginBottom:6 }}>PROPOSED OVERRIDES</div>
                  {sg.plans.map((p) => {
                    const plan = PLANS.find((pp) => pp.id === p.planId);
                    const key = `${sg.id}|${p.planId}|${p.month}`;
                    return (
                      <label key={key} style={{ display:"flex", alignItems:"center", gap:8, padding:"5px 0", borderBottom:`1px solid ${C.border}`, cursor:"pointer" }}>
                        <input type="checkbox" checked={!!checked[key]} onChange={() => onToggle(key)} style={{ accentColor:C.blueLt, width:14, height:14 }} />
                        <div style={{ flex:1 }}>
                          <div style={{ fontSize:10, fontWeight:600, color:C.text }}>{plan?.name}<span style={{ color:C.text3, fontWeight:400 }}> · {MONTHS[p.month]}</span></div>
                          <div style={{ fontSize:9, color:C.text3, fontFamily:MONO }}>{fmt(p.currentVal)} → <span style={{ color:it.color, fontWeight:700 }}>{fmt(p.proposedVal)}</span> <span style={{ marginLeft:6 }}>{p.reason}</span></div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              )}
              {(sg.plans.length === 0 || sg.plans[0].field === "_info") && <div style={{ padding:"8px 12px", fontSize:10, color:C.text3, fontStyle:"italic" }}>Informational — review staffing plan manually.</div>}
            </div>
          );
        })}
        {done.length > 0 && (<><div style={{ fontSize:9, fontWeight:700, color:C.text3, fontFamily:MONO, marginTop:12, marginBottom:8 }}>APPLIED ({done.length})</div>
          {done.map((sg) => (<div key={sg.id} style={{ background:C.greenPale, border:`1px solid ${C.green}`, borderRadius:8, marginBottom:8, padding:"10px 12px", opacity:0.6 }}><div style={{ display:"flex", alignItems:"center", gap:6 }}><span>{ISSUE_TYPES[sg.type].icon}</span><Badge type="green">Applied ✓</Badge><span style={{ fontSize:10, color:C.text2 }}>{sg.title}</span></div></div>))}</>)}
      </div>
      {total > 0 && (<div style={{ padding:"12px 16px", borderTop:`1px solid ${C.border}`, background:C.card2 }}>
        <button onClick={onApply} style={{ ...btnBase, width:"100%", background:"linear-gradient(135deg,#8b5cf6,#0a8fe6)", color:"#fff", padding:"10px", fontSize:12, borderRadius:6 }}>Apply {total} override{total > 1 ? "s" : ""} → New scenario</button>
      </div>)}
    </div>
  );
}