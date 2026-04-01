export const SANS = "'Source Sans 3', system-ui, sans-serif";
export const MONO = "'Source Code Pro', monospace";

export const GROUPS = [
  { id: "CRS", name: "CRS", color: "#0a8fe6" },
  { id: "CARDS", name: "Cards", color: "#8b5cf6" },
  { id: "RETAIL", name: "Retail", color: "#f59e0b" },
  { id: "SS", name: "Shared Services", color: "#10b981" },
];

export const PLANS = [
  { id: "CRS-E", name: "CRS Early", group: "CRS", stage: "Early", hc: 280 },
  { id: "CRS-L", name: "CRS Late", group: "CRS", stage: "Late", hc: 220 },
  { id: "CRD-E", name: "Cards Early", group: "CARDS", stage: "Early", hc: 310 },
  { id: "CRD-L", name: "Cards Late", group: "CARDS", stage: "Late", hc: 240 },
  { id: "RTL-E", name: "Retail Early", group: "RETAIL", stage: "Early", hc: 200 },
  { id: "RTL-L", name: "Retail Late", group: "RETAIL", stage: "Late", hc: 160 },
  { id: "SS-E", name: "SS Early", group: "SS", stage: "Early", hc: 170 },
  { id: "SS-L", name: "SS Late", group: "SS", stage: "Late", hc: 120 },
];

export const MONTHS = [
  "Mar 26","Apr 26","May 26","Jun 26","Jul 26","Aug 26",
  "Sep 26","Oct 26","Nov 26","Dec 26","Jan 27","Feb 27",
];

export const WD = [22,21,22,21,22,23,21,23,20,22,22,20];

export const C = {
  bg:"#0a1628", card:"#111d32", card2:"#162340",
  border:"#1e3050", borderLt:"#253a58",
  blue:"#056dae", blueLt:"#0a8fe6", bluePale:"#0d2a4a",
  green:"#0a8a50", greenPale:"#0a3022",
  red:"#dc2626", redPale:"#3b1010",
  amber:"#d97706", amberPale:"#3b2506",
  text:"#e8edf5", text2:"#8899b0", text3:"#566a85",
  purple:"#8b5cf6", purplePale:"#1e1545",
};

export const ISSUE_TYPES = {
  accuracy: { icon: "◎", color: C.red, label: "Accuracy Drift", bt: "red" },
  aht: { icon: "⏱", color: C.amber, label: "AHT Trend", bt: "amber" },
  seasonal: { icon: "📈", color: C.blueLt, label: "Seasonal Miss", bt: "blue" },
  variance: { icon: "⚠", color: C.purple, label: "HC Variance", bt: "purple" },
  attrition: { icon: "👥", color: C.red, label: "Attrition Risk", bt: "red" },
};

export const btnBase = {
  border:"none", borderRadius:5, cursor:"pointer",
  fontFamily:SANS, fontWeight:600, fontSize:11,
  padding:"6px 14px", transition:"all .15s",
};

export const inputStyle = {
  background:C.card, border:`1px solid ${C.border}`,
  borderRadius:4, padding:"4px 6px", color:C.text,
  fontFamily:MONO, fontSize:11, width:70,
  textAlign:"right", outline:"none",
};