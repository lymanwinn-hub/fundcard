import { useState, useEffect, useRef, useCallback } from "react";

// ═══════════════════════════════════════════════════════════════════════════
// SUPABASE CONFIG — replace these two lines with your own values
// Found at: supabase.com > your project > Settings > API
// ═══════════════════════════════════════════════════════════════════════════
const SUPABASE_URL     = "https://qkjhuisquibnejprloip.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFramh1aXNxdWlibmVqcHJsb2lwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcwMjI4MzEsImV4cCI6MjA5MjU5ODgzMX0.ppHab7C5YDhS1ZjM6n2nnuX81KYMqoefoaTCoIWK7ew";

// ── Supabase REST client ──────────────────────────────────────────────────────
async function sb(path, opts = {}) {
  const url = `${SUPABASE_URL}/rest/v1/${path}`;
  const res = await fetch(url, {
    method: opts.method || "GET",
    headers: {
      "apikey": SUPABASE_ANON_KEY,
      "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
      "Prefer": opts.prefer || "return=representation",
      ...(opts.headers || {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 204 || res.status === 201 && opts.prefer === "return=minimal") return null;
  const text = await res.text();
  if (!res.ok) throw new Error(`DB error ${res.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

const DB = {
  get:        (t, q="")    => sb(`${t}?${q}`),
  insert:     (t, row)     => sb(t, { method:"POST", body: row }),
  insertMany: (t, rows)    => sb(t, { method:"POST", body: rows }),
  update:     (t, q, row)  => sb(`${t}?${q}`, { method:"PATCH", body: row, prefer:"return=minimal" }),
  upsert:     (t, row)     => sb(t, { method:"POST", body: row, prefer:"resolution=merge-duplicates,return=representation" }),
  del:        (t, q)       => sb(`${t}?${q}`, { method:"DELETE", prefer:"return=minimal" }),
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function randId(len=8) {
  const c = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i=0;i<len;i++) { if(len===8&&i===4) s+="-"; s+=c[Math.floor(Math.random()*c.length)]; }
  return s;
}
function simpleHash(s) {
  let h=0; for(let i=0;i<s.length;i++) h=Math.imul(31,h)+s.charCodeAt(i)|0; return String(h);
}
function toBase64(file) {
  return new Promise((res,rej)=>{ const r=new FileReader(); r.onload=e=>res(e.target.result); r.onerror=rej; r.readAsDataURL(file); });
}

const DEFAULT_PERMISSIONS = { canManageDeals:true, canGenerateCards:true, canViewIssued:true, canViewStats:true };
const DEAL_COLORS  = ["#f97316","#ef4444","#f59e0b","#22c55e","#16a34a","#14b8a6","#0891b2","#3b82f6","#6366f1","#9333ea","#ec4899","#e11d48","#0d9488","#65a30d","#a16207","#475569"];
const CATEGORIES   = ["Food","Coffee","Drinks","Dessert","Beauty","Auto","Fitness","Shopping","Entertainment","Pets","Gifts","Services","Health","Education","Other"];
const BRAND_COLORS = ["#f59e0b","#ef4444","#f97316","#22c55e","#3b82f6","#6366f1","#9333ea","#ec4899","#14b8a6","#ffffff","#94a3b8","#334155"];
const BG_COLORS    = ["#0f2444","#0f172a","#1a0533","#0d2010","#1e1515","#0a1628","#1a2744","#0d1b2a","#1c1c1c","#162035","#1a0a0a","#0f0f23"];
const SECURITY_QUESTIONS = [
  "What was the name of your first pet?",
  "What city were you born in?",
  "What was your childhood nickname?",
  "What is your mother's maiden name?",
  "What was the make of your first car?",
];

// ── Data loader — fetches everything and shapes it for the UI ─────────────────
async function loadAppData() {
  const [teamsRaw, dealsRaw, cardsRaw, redemptionsRaw, settingsRaw] = await Promise.all([
    DB.get("teams","select=*&order=created_at.asc"),
    DB.get("deals","select=*&order=team_id.asc,sort_order.asc,id.asc"),
    DB.get("cards","select=*&order=created_at.asc"),
    DB.get("redemptions","select=card_id,deal_id"),
    DB.get("settings","select=*"),
  ]);

  // Redemption counts per card per deal
  const redemptionMap = {};
  for (const r of (redemptionsRaw||[])) {
    if (!redemptionMap[r.card_id]) redemptionMap[r.card_id]={};
    redemptionMap[r.card_id][r.deal_id] = (redemptionMap[r.card_id][r.deal_id]||0)+1;
  }

  const teams = {};
  for (const t of (teamsRaw||[])) {
    teams[t.id] = {
      id:t.id, name:t.name, branding:t.branding||{},
      adminUser:t.admin_user, adminPin:t.admin_pin,
      permissions:{ ...DEFAULT_PERMISSIONS, ...(t.permissions||{}) },
      deals:[], cards:{},
      createdAt: new Date(t.created_at).getTime(),
    };
  }
  for (const d of (dealsRaw||[])) {
    if (!teams[d.team_id]) continue;
    teams[d.team_id].deals.push({
      id:d.id, merchant:d.merchant, offer:d.offer, notes:d.notes,
      category:d.category, color:d.color, logo:d.logo, limit:d.limit_per_card,
      locationMode:d.location_mode, address:d.address, locations:d.locations||[],
      sortOrder:d.sort_order,
    });
  }
  for (const c of (cardsRaw||[])) {
    if (!teams[c.team_id]) continue;
    teams[c.team_id].cards[c.id] = {
      id:c.id, teamId:c.team_id,
      createdAt: new Date(c.created_at).getTime(),
      redemptions: redemptionMap[c.id]||{},
    };
  }

  const superAdminPin = (settingsRaw||[]).find(s=>s.key==="super_admin_pin")?.value || "1234";
  return { teams, superAdminPin };
}

// ═══════════════════════════════════════════════════════════════════════════
// SHARED UI PRIMITIVES
// ═══════════════════════════════════════════════════════════════════════════
function Inp({ label, value, onChange, placeholder, type="text", mono=false, hint }) {
  return (
    <div style={{marginBottom:14}}>
      {label && <label style={{fontSize:11,color:"#64748b",display:"block",marginBottom:5}}>{label}</label>}
      <input type={type} value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder}
        style={{width:"100%",background:"#1e293b",border:"1px solid #334155",borderRadius:8,
          padding:"10px 12px",color:"white",fontSize:14,outline:"none",
          fontFamily:mono?"monospace":"inherit",letterSpacing:mono?2:"normal"}}/>
      {hint && <div style={{fontSize:10,color:"#475569",marginTop:4}}>{hint}</div>}
    </div>
  );
}
function Btn({ children, onClick, color="#f59e0b", textColor="#0f172a", disabled=false }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{padding:"12px 20px",
      background:disabled?"#1e293b":color, border:"none", borderRadius:9,
      color:disabled?"#475569":textColor, fontSize:14, fontWeight:700,
      cursor:disabled?"default":"pointer", width:"100%"}}>{children}</button>
  );
}
function ImgUploader({ img, onChange, size=64, radius=12, label="Logo" }) {
  const ref=useRef();
  async function handle(file) { if(!file||!file.type.startsWith("image/")) return; onChange(await toBase64(file)); }
  return (
    <div onClick={()=>ref.current.click()} onDragOver={e=>e.preventDefault()}
      onDrop={e=>{e.preventDefault();handle(e.dataTransfer.files[0]);}}
      style={{width:size,height:size,borderRadius:radius,cursor:"pointer",
        border:`2px dashed ${img?"transparent":"#334155"}`,background:img?"transparent":"#1e293b",
        display:"flex",alignItems:"center",justifyContent:"center",overflow:"hidden",flexShrink:0,position:"relative"}}>
      {img?<img src={img} style={{width:"100%",height:"100%",objectFit:"cover"}}/>
        :<div style={{textAlign:"center"}}><div style={{fontSize:size>50?22:14}}>🖼</div><div style={{fontSize:9,color:"#475569",marginTop:2}}>{label}</div></div>}
      {img&&(<div style={{position:"absolute",inset:0,background:"rgba(0,0,0,0.6)",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",opacity:0,transition:"opacity 0.2s"}}
        onMouseEnter={e=>e.currentTarget.style.opacity=1} onMouseLeave={e=>e.currentTarget.style.opacity=0}>
        <div style={{fontSize:11,color:"white"}}>Change</div>
        <div onClick={e=>{e.stopPropagation();onChange(null);}} style={{fontSize:10,color:"#ef4444",marginTop:4,cursor:"pointer"}}>Remove</div>
      </div>)}
      <input ref={ref} type="file" accept="image/*" style={{display:"none"}} onChange={e=>handle(e.target.files[0])}/>
    </div>
  );
}
function ColorRow({ label, value, onChange, colors }) {
  return (
    <div style={{marginBottom:16}}>
      <div style={{fontSize:11,color:"#64748b",marginBottom:8}}>{label}</div>
      <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>
        {colors.map(c=><div key={c} onClick={()=>onChange(c)} style={{width:26,height:26,borderRadius:8,background:c,cursor:"pointer",border:`3px solid ${value===c?"white":"transparent"}`,transition:"all 0.12s"}}/>)}
        <input type="color" value={value} onChange={e=>onChange(e.target.value)} style={{width:26,height:26,borderRadius:6,border:"1px solid #334155",background:"transparent",cursor:"pointer",padding:0}}/>
      </div>
    </div>
  );
}
function Toggle({ on, onChange, label, sub }) {
  return (
    <div onClick={()=>onChange(!on)} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 14px",background:"#0f172a",borderRadius:10,cursor:"pointer",marginBottom:8,border:`1px solid ${on?"#3b82f633":"#1e293b"}`}}>
      <div>
        <div style={{fontSize:13,color:"white",fontWeight:600}}>{label}</div>
        {sub&&<div style={{fontSize:11,color:"#475569",marginTop:2}}>{sub}</div>}
      </div>
      <div style={{width:44,height:24,borderRadius:12,background:on?"#3b82f6":"#334155",position:"relative",transition:"background 0.2s",flexShrink:0,marginLeft:12}}>
        <div style={{position:"absolute",top:2,left:on?22:2,width:20,height:20,borderRadius:"50%",background:"white",transition:"left 0.2s"}}/>
      </div>
    </div>
  );
}
function InlineConfirm({ message, onConfirm, onCancel, confirmLabel="Yes, Delete" }) {
  return (
    <div style={{background:"#2d0a0a",border:"1px solid #ef444466",borderRadius:10,padding:"12px 16px",marginBottom:12}}>
      <div style={{fontSize:13,color:"#fca5a5",fontWeight:600,marginBottom:10}}>{message}</div>
      <div style={{display:"flex",gap:8}}>
        <button onClick={onCancel} style={{flex:1,padding:"9px",background:"#1e293b",border:"1px solid #334155",borderRadius:8,color:"#94a3b8",fontSize:13,cursor:"pointer"}}>Cancel</button>
        <button onClick={onConfirm} style={{flex:1,padding:"9px",background:"#ef4444",border:"none",borderRadius:8,color:"white",fontSize:13,fontWeight:700,cursor:"pointer"}}>{confirmLabel}</button>
      </div>
    </div>
  );
}
function Confetti({ onDone }) {
  const pieces=Array.from({length:26},(_,i)=>({key:i,x:Math.random()*100,color:["#f59e0b","#3b82f6","#22c55e","#ec4899","#f97316","#a78bfa"][i%6],delay:Math.random()*0.35,size:5+Math.random()*7}));
  useEffect(()=>{const t=setTimeout(onDone,1600);return()=>clearTimeout(t);},[]);
  return (<div style={{position:"fixed",inset:0,pointerEvents:"none",zIndex:999}}>
    {pieces.map(p=><div key={p.key} style={{position:"absolute",left:`${p.x}%`,top:"35%",width:p.size,height:p.size,borderRadius:2,background:p.color,animation:`cfFall 1.4s ${p.delay}s ease-in forwards`}}/>)}
    <style>{`@keyframes cfFall{0%{transform:translateY(0) rotate(0);opacity:1}100%{transform:translateY(280px) rotate(420deg);opacity:0}}`}</style>
  </div>);
}
function Spinner() {
  return (<div style={{display:"flex",justifyContent:"center",padding:40}}>
    <div style={{width:32,height:32,borderRadius:"50%",border:"3px solid #334155",borderTopColor:"#f59e0b",animation:"spin 0.8s linear infinite"}}/>
    <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
  </div>);
}
function CustomerPinPad({ value, onChange, onComplete, shake }) {
  const keys=["1","2","3","4","5","6","7","8","9","","0","X"];
  return (<div>
    <div style={{display:"flex",gap:14,justifyContent:"center",marginBottom:20,animation:shake?"shakePIN 0.55s ease":"none"}}>
      {[0,1,2,3].map(i=><div key={i} style={{width:18,height:18,borderRadius:"50%",background:i<value.length?"#f59e0b":"transparent",border:`2px solid ${i<value.length?"#f59e0b":"#334155"}`,transition:"all 0.15s"}}/>)}
    </div>
    <div style={{display:"grid",gridTemplateColumns:"repeat(3,68px)",gap:8,justifyContent:"center"}}>
      {keys.map((d,i)=><button key={i} onClick={()=>{
        if(d==="X"){onChange(value.slice(0,-1));}
        else if(d!==""&&value.length<4){const next=value+d;onChange(next);if(next.length===4&&onComplete)onComplete(next);}
      }} style={{width:68,height:68,borderRadius:12,background:d===""?"transparent":"#1e293b",border:d===""?"none":"1px solid #334155",color:"white",fontSize:d==="X"?16:20,fontWeight:600,cursor:d===""?"default":"pointer"}}>{d==="X"?"⌫":d}</button>)}
    </div>
    <style>{`@keyframes shakePIN{0%,100%{transform:translateX(0)}20%{transform:translateX(-8px)}40%{transform:translateX(8px)}60%{transform:translateX(-6px)}80%{transform:translateX(6px)}}`}</style>
  </div>);
}

// ═══════════════════════════════════════════════════════════════════════════
// DEAL EDITOR
// ═══════════════════════════════════════════════════════════════════════════
function DealEditor({ deal, teamId, onSave, onCancel, onDelete, isNew }) {
  const [form,setForm]=useState(deal||{merchant:"",offer:"",notes:"",limit:null,category:"Food",logo:null,color:"#f97316",locationMode:"single",address:"",locations:[]});
  const [confirmDelete,setConfirmDelete]=useState(false);
  const [saving,setSaving]=useState(false);
  const [newLoc,setNewLoc]=useState("");
  const set=(k,v)=>setForm(f=>({...f,[k]:v}));
  const valid=form.merchant.trim()&&form.offer.trim();

  async function save() {
    if(!valid||saving) return;
    setSaving(true);
    try {
      const row = {
        team_id:teamId, merchant:form.merchant, offer:form.offer, notes:form.notes||"",
        category:form.category, color:form.color, logo:form.logo||null,
        limit_per_card:form.limit, location_mode:form.locationMode||"single",
        address:form.address||"", locations:form.locations||[],
        sort_order: form.sortOrder||0,
      };
      if(isNew) {
        const [created]=await DB.insert("deals",row);
        onSave({...form,id:created.id});
      } else {
        await DB.update("deals",`id=eq.${form.id}`,row);
        onSave(form);
      }
    } catch(e){console.error(e);}
    setSaving(false);
  }

  async function doDelete() {
    await DB.del("deals",`id=eq.${deal.id}`);
    onDelete(deal.id);
  }

  function addLoc(){if(!newLoc.trim())return;set("locations",[...(form.locations||[]),newLoc.trim()]);setNewLoc("");}

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.9)",display:"flex",alignItems:"flex-end",justifyContent:"center",zIndex:300}}
      onClick={e=>e.target===e.currentTarget&&onCancel()}>
      <div style={{background:"#0f1e35",borderRadius:"20px 20px 0 0",width:"100%",maxWidth:540,padding:"22px 20px 36px",border:"1px solid #1e3a5f",borderBottom:"none",maxHeight:"92vh",overflowY:"auto"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
          <div style={{fontSize:17,fontWeight:800,color:"white"}}>{isNew?"Add New Deal":"Edit Deal"}</div>
          <button onClick={onCancel} style={{background:"transparent",border:"none",color:"#475569",fontSize:24,cursor:"pointer"}}>×</button>
        </div>
        <div style={{display:"flex",gap:14,alignItems:"flex-start",marginBottom:18}}>
          <ImgUploader img={form.logo} onChange={v=>set("logo",v)} size={68} radius={12}/>
          <div style={{flex:1}}>
            <div style={{fontSize:11,color:"#64748b",marginBottom:8}}>ACCENT COLOR</div>
            <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
              {DEAL_COLORS.map(c=><div key={c} onClick={()=>set("color",c)} style={{width:22,height:22,borderRadius:6,background:c,cursor:"pointer",border:`2px solid ${form.color===c?"white":"transparent"}`}}/>)}
            </div>
          </div>
        </div>
        {[{label:"MERCHANT / BUSINESS NAME",key:"merchant",ph:"e.g. Pizza Palace"},
          {label:"DEAL OFFER",key:"offer",ph:"e.g. Buy 1 Get 1 Free Pizza"},
          {label:"FINE PRINT / NOTES (optional)",key:"notes",ph:"e.g. Dine-in only. Expires Dec 2025."}
        ].map(f=>(
          <div key={f.key} style={{marginBottom:13}}>
            <label style={{fontSize:11,color:"#64748b",display:"block",marginBottom:5}}>{f.label}</label>
            <input value={form[f.key]||""} onChange={e=>set(f.key,e.target.value)} placeholder={f.ph}
              style={{width:"100%",background:"#1e293b",border:"1px solid #334155",borderRadius:8,padding:"10px 12px",color:"white",fontSize:14,outline:"none"}}/>
          </div>
        ))}
        <div style={{marginBottom:13}}>
          <label style={{fontSize:11,color:"#64748b",display:"block",marginBottom:8}}>LOCATION</label>
          <div style={{display:"flex",gap:6,marginBottom:10}}>
            {[["single","One Location"],["multiple","Multi-Location"],["alllocations","All Locations"]].map(([m,lbl])=>(
              <button key={m} onClick={()=>set("locationMode",m)} style={{flex:1,padding:"8px 4px",borderRadius:8,border:"none",cursor:"pointer",fontSize:11,fontWeight:600,background:(form.locationMode||"single")===m?"#3b82f6":"#1e293b",color:(form.locationMode||"single")===m?"white":"#64748b"}}>{lbl}</button>
            ))}
          </div>
          {(form.locationMode||"single")==="single"&&<input value={form.address||""} onChange={e=>set("address",e.target.value)} placeholder="e.g. 123 Main St, Springfield" style={{width:"100%",background:"#1e293b",border:"1px solid #334155",borderRadius:8,padding:"10px 12px",color:"white",fontSize:13,outline:"none"}}/>}
          {form.locationMode==="multiple"&&(<div>
            <div style={{display:"flex",gap:6,marginBottom:8}}>
              <input value={newLoc} onChange={e=>setNewLoc(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addLoc()} placeholder="Add address, press Enter" style={{flex:1,background:"#1e293b",border:"1px solid #334155",borderRadius:8,padding:"9px 12px",color:"white",fontSize:13,outline:"none"}}/>
              <button onClick={addLoc} style={{padding:"9px 14px",background:"#3b82f6",border:"none",borderRadius:8,color:"white",fontSize:14,fontWeight:700,cursor:"pointer"}}>+</button>
            </div>
            {(form.locations||[]).map((loc,i)=><div key={i} style={{display:"flex",alignItems:"center",gap:8,marginBottom:5,background:"#1e293b",borderRadius:7,padding:"7px 10px"}}><div style={{fontSize:11,color:"#94a3b8",flex:1}}>📍 {loc}</div><button onClick={()=>set("locations",form.locations.filter((_,j)=>j!==i))} style={{background:"transparent",border:"none",color:"#ef4444",cursor:"pointer",fontSize:16}}>×</button></div>)}
            {!(form.locations||[]).length&&<div style={{fontSize:11,color:"#475569",fontStyle:"italic"}}>No locations added yet</div>}
          </div>)}
          {form.locationMode==="alllocations"&&<div style={{background:"#1e293b",borderRadius:8,padding:"10px 12px",fontSize:12,color:"#22c55e"}}>✓ Valid at all {form.merchant||"merchant"} locations</div>}
        </div>
        <div style={{marginBottom:13}}>
          <label style={{fontSize:11,color:"#64748b",display:"block",marginBottom:5}}>CATEGORY</label>
          <select value={form.category} onChange={e=>set("category",e.target.value)} style={{width:"100%",background:"#1e293b",border:"1px solid #334155",borderRadius:8,padding:"10px 12px",color:"white",fontSize:14,outline:"none"}}>
            {CATEGORIES.map(c=><option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div style={{marginBottom:20}}>
          <label style={{fontSize:11,color:"#64748b",display:"block",marginBottom:5}}>REDEMPTION LIMIT PER CARD</label>
          <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
            {[null,1,2,3,5,10].map(n=><button key={String(n)} onClick={()=>set("limit",n)} style={{flex:"1 0 auto",padding:"9px 10px",borderRadius:8,border:"none",cursor:"pointer",fontSize:13,fontWeight:600,background:form.limit===n?(n===null?"#22c55e":"#f59e0b"):"#1e293b",color:form.limit===n?"#0f172a":"#64748b"}}>{n===null?"∞ Unlimited":`${n}×`}</button>)}
          </div>
        </div>
        <div style={{marginBottom:20}}>
          <div style={{fontSize:11,color:"#64748b",marginBottom:8}}>PREVIEW</div>
          <DealCard deal={form} used={0} preview/>
        </div>
        {confirmDelete&&<InlineConfirm message={`Remove "${form.merchant}" from all cards?`} onConfirm={doDelete} onCancel={()=>setConfirmDelete(false)}/>}
        <div style={{display:"flex",gap:8}}>
          {!isNew&&!confirmDelete&&<button onClick={()=>setConfirmDelete(true)} style={{padding:"12px 16px",background:"transparent",border:"1px solid #ef444444",borderRadius:10,color:"#ef4444",fontSize:13,cursor:"pointer"}}>Delete</button>}
          <button onClick={onCancel} style={{flex:1,padding:"12px",background:"#1e293b",border:"1px solid #334155",borderRadius:10,color:"#64748b",fontSize:14,cursor:"pointer"}}>Cancel</button>
          <button onClick={save} disabled={!valid||saving} style={{flex:2,padding:"12px",background:valid&&!saving?"#f59e0b":"#1e293b",border:"none",borderRadius:10,color:valid&&!saving?"#0f172a":"#475569",fontSize:14,fontWeight:800,cursor:valid&&!saving?"pointer":"default"}}>
            {saving?"Saving...":(isNew?"Add Deal ★":"Save Changes")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// DEAL CARD (customer-facing)
// ═══════════════════════════════════════════════════════════════════════════
function DealCard({ deal, used=0, onRedeem, confirmMode, setConfirmMode, preview=false }) {
  const maxed=deal.limit!=null&&used>=deal.limit;
  const color=deal.color||"#3b82f6";
  const isConfirm=confirmMode===deal.id;
  const remaining=deal.limit!=null?deal.limit-used:null;
  function openMaps(addr){window.open(`https://maps.apple.com/?q=${encodeURIComponent(addr)}`,"_blank");}
  return (
    <div style={{background:maxed?"#0c1422":"linear-gradient(135deg,#1a2744 0%,#162035 100%)",border:`1px solid ${maxed?"#1e293b":color+"55"}`,borderRadius:14,padding:"14px 16px",opacity:maxed?0.42:1,transition:"all 0.2s",position:"relative",overflow:"hidden",display:"flex",gap:12,alignItems:"flex-start"}}>
      {!maxed&&<div style={{position:"absolute",top:0,left:0,bottom:0,width:3,background:color,borderRadius:"14px 0 0 14px"}}/>}
      {deal.logo?<img src={deal.logo} style={{width:46,height:46,borderRadius:10,objectFit:"cover",flexShrink:0}}/>
        :<div style={{width:46,height:46,borderRadius:10,background:color+"22",display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,flexShrink:0}}>🏪</div>}
      <div style={{flex:1,minWidth:0}}>
        <div style={{fontSize:10,color,fontWeight:700,letterSpacing:1.5,marginBottom:3}}>{deal.category}</div>
        <div style={{fontSize:15,fontWeight:700,color:maxed?"#334155":"white",lineHeight:1.3,marginBottom:2}}>{deal.offer||"Your offer"}</div>
        <div style={{fontSize:12,color:"#64748b"}}>{deal.merchant||"Merchant"}</div>
        {(deal.locationMode==="single"||!deal.locationMode)&&deal.address&&<div onClick={()=>openMaps(deal.address)} style={{fontSize:11,color:"#3b82f6",marginTop:4,cursor:"pointer",display:"flex",gap:3}}><span>📍</span><span style={{textDecoration:"underline"}}>{deal.address}</span></div>}
        {deal.locationMode==="multiple"&&(deal.locations||[]).length>0&&<div style={{marginTop:5}}><div style={{fontSize:10,color:"#475569",marginBottom:2}}>📍 Multiple locations:</div>{deal.locations.map((loc,i)=><div key={i} onClick={()=>openMaps(loc)} style={{fontSize:11,color:"#3b82f6",paddingLeft:14,lineHeight:1.7,cursor:"pointer",textDecoration:"underline"}}>{loc}</div>)}</div>}
        {deal.locationMode==="alllocations"&&<div style={{fontSize:11,color:"#22c55e",marginTop:4}}>📍 Valid at all locations</div>}
        {deal.notes&&<div style={{fontSize:11,color:"#475569",marginTop:4,fontStyle:"italic"}}>{deal.notes}</div>}
        {!preview&&(
          <div style={{marginTop:10,display:"flex",alignItems:"center",justifyContent:"space-between",gap:8}}>
            <div style={{fontSize:10,fontWeight:700,color:maxed?"#ef4444":remaining===1?"#f59e0b":deal.limit!=null?"#94a3b8":"#22c55e"}}>
              {maxed?"✗ REDEEMED":deal.limit!=null?`${remaining} use${remaining!==1?"s":""} left`:"∞ UNLIMITED"}
            </div>
            {!maxed&&!isConfirm&&<button onClick={()=>setConfirmMode(deal.id)} style={{background:color,border:"none",borderRadius:8,padding:"7px 16px",color:"white",fontSize:12,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap"}}>Redeem →</button>}
            {!maxed&&isConfirm&&<div style={{display:"flex",gap:6}}>
              <button onClick={()=>setConfirmMode(null)} style={{background:"transparent",border:"1px solid #334155",borderRadius:8,padding:"6px 12px",color:"#64748b",fontSize:12,cursor:"pointer"}}>Cancel</button>
              <button onClick={()=>{onRedeem(deal.id);setConfirmMode(null);}} style={{background:"#22c55e",border:"none",borderRadius:8,padding:"6px 14px",color:"white",fontSize:12,fontWeight:700,cursor:"pointer"}}>✓ Confirm</button>
            </div>}
          </div>
        )}
        {preview&&<div style={{marginTop:8,fontSize:10,color:deal.limit!=null?"#f59e0b":"#22c55e"}}>{deal.limit!=null?`${deal.limit}× limit per card`:"∞ Unlimited"}</div>}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// DEAL LIST (drag-to-reorder)
// ═══════════════════════════════════════════════════════════════════════════
function DealList({ deals, onReorder, onEdit, onAdd }) {
  const [dragging,setDragging]=useState(null);
  const [over,setOver]=useState(null);
  const dragItem=useRef(null); const dragOverItem=useRef(null); const rowRefs=useRef([]);
  function dragStart(e,i){dragItem.current=i;setDragging(i);e.dataTransfer.effectAllowed="move";}
  function dragEnter(i){dragOverItem.current=i;setOver(i);}
  function dragEnd(){
    const[f,t]=[dragItem.current,dragOverItem.current];
    if(f!=null&&t!=null&&f!==t){const a=[...deals];const[m]=a.splice(f,1);a.splice(t,0,m);onReorder(a);}
    setDragging(null);setOver(null);dragItem.current=dragOverItem.current=null;
  }
  function touchStart(e,i){dragItem.current=i;setDragging(i);}
  function touchMove(e){const y=e.touches[0].clientY;rowRefs.current.forEach((el,i)=>{if(!el)return;const r=el.getBoundingClientRect();if(y>=r.top&&y<=r.bottom){dragOverItem.current=i;setOver(i);}});}
  function touchEnd(){
    const[f,t]=[dragItem.current,dragOverItem.current];
    if(f!=null&&t!=null&&f!==t){const a=[...deals];const[m]=a.splice(f,1);a.splice(t,0,m);onReorder(a);}
    setDragging(null);setOver(null);dragItem.current=dragOverItem.current=null;
  }
  return (<div>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
      <div style={{fontSize:11,color:"#475569"}}>{deals.length} DEAL{deals.length!==1?"S":""} · drag ☰ to reorder</div>
      <button onClick={onAdd} style={{padding:"8px 16px",background:"#f59e0b",border:"none",borderRadius:8,color:"#0f172a",fontSize:13,fontWeight:800,cursor:"pointer"}}>+ Add Deal</button>
    </div>
    {deals.length===0&&<div style={{textAlign:"center",padding:"48px 20px",background:"#1e293b",borderRadius:14,border:"1px dashed #334155"}}>
      <div style={{fontSize:36,marginBottom:10}}>🏪</div>
      <div style={{fontSize:15,color:"white",fontWeight:700,marginBottom:6}}>No deals yet</div>
      <div style={{fontSize:13,color:"#475569",marginBottom:18}}>Add your first merchant deal to get started</div>
      <button onClick={onAdd} style={{padding:"11px 24px",background:"#f59e0b",border:"none",borderRadius:10,color:"#0f172a",fontSize:14,fontWeight:800,cursor:"pointer"}}>+ Add First Deal</button>
    </div>}
    <div style={{display:"flex",flexDirection:"column",gap:6}}>
      {deals.map((deal,idx)=>(
        <div key={deal.id} ref={el=>rowRefs.current[idx]=el} draggable
          onDragStart={e=>dragStart(e,idx)} onDragEnter={()=>dragEnter(idx)} onDragOver={e=>e.preventDefault()} onDragEnd={dragEnd}
          onTouchStart={e=>touchStart(e,idx)} onTouchMove={touchMove} onTouchEnd={touchEnd}
          style={{display:"flex",alignItems:"center",gap:8,background:over===idx&&dragging!==idx?"#1e3a5f":"#1e293b",borderRadius:12,padding:"10px 12px",border:`1px solid ${over===idx&&dragging!==idx?"#3b82f6":"#334155"}`,opacity:dragging===idx?0.4:1,transition:"all 0.15s",cursor:"grab"}}>
          <div style={{color:"#334155",fontSize:16,userSelect:"none",flexShrink:0}}>☰</div>
          {deal.logo?<img src={deal.logo} style={{width:38,height:38,borderRadius:8,objectFit:"cover",flexShrink:0}}/>
            :<div style={{width:38,height:38,borderRadius:8,background:(deal.color||"#3b82f6")+"22",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,flexShrink:0}}>🏪</div>}
          <div style={{flex:1,minWidth:0}} onClick={()=>onEdit(deal)}>
            <div style={{fontSize:13,fontWeight:700,color:"white",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{deal.offer}</div>
            <div style={{fontSize:11,color:"#64748b",marginTop:1}}>{deal.merchant} · {deal.category}</div>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
            <div style={{fontSize:10,fontWeight:700,color:deal.limit!=null?"#f59e0b":"#22c55e",background:(deal.limit!=null?"#f59e0b":"#22c55e")+"18",padding:"3px 8px",borderRadius:20}}>{deal.limit!=null?`${deal.limit}× limit`:"∞"}</div>
            <button onClick={()=>onEdit(deal)} style={{background:"transparent",border:"1px solid #334155",borderRadius:6,padding:"4px 10px",color:"#64748b",fontSize:11,cursor:"pointer"}}>Edit</button>
          </div>
        </div>
      ))}
    </div>
  </div>);
}

// ═══════════════════════════════════════════════════════════════════════════
// BRANDING EDITOR
// ═══════════════════════════════════════════════════════════════════════════
function BrandingEditor({ team, onChange }) {
  const b=team.branding||{}; const set=(k,v)=>onChange({...b,[k]:v});
  const primary=b.primaryColor||"#f59e0b"; const bgTop=b.cardBgTop||"#0f2444"; const bgBot=b.cardBgBottom||"#1a3a6e";
  return (<div>
    <div style={{marginBottom:20}}>
      <div style={{fontSize:11,color:"#64748b",marginBottom:8}}>CARD PREVIEW</div>
      <div style={{background:`linear-gradient(135deg,${bgTop} 0%,${bgBot} 100%)`,borderRadius:16,padding:"18px 20px",border:`1px solid ${primary}44`,position:"relative",overflow:"hidden"}}>
        <div style={{position:"absolute",top:-30,right:-30,width:110,height:110,background:`radial-gradient(circle,${primary}33 0%,transparent 70%)`,borderRadius:"50%"}}/>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
          <div>
            <div style={{fontSize:11,color:primary,fontWeight:700,letterSpacing:3,marginBottom:4}}>★ FUNDRAISER DISCOUNT CARD</div>
            <div style={{fontSize:19,fontWeight:800,color:"white"}}>{team.name||<span style={{color:"#334155"}}>Team Name</span>}</div>
            <div style={{fontFamily:"monospace",fontSize:12,color:"#475569",marginTop:6,letterSpacing:2}}>XXXX-XXXX</div>
          </div>
          {b.logo?<img src={b.logo} style={{width:56,height:56,borderRadius:12,objectFit:"cover",border:`2px solid ${primary}44`}}/>
            :<div style={{width:56,height:56,borderRadius:12,background:"#ffffff11",border:"2px dashed #334155",display:"flex",alignItems:"center",justifyContent:"center",fontSize:22}}>🏷</div>}
        </div>
      </div>
    </div>
    <div style={{marginBottom:16}}>
      <label style={{fontSize:11,color:"#64748b",display:"block",marginBottom:8}}>TEAM LOGO</label>
      <div style={{display:"flex",alignItems:"center",gap:14}}>
        <ImgUploader img={b.logo} onChange={v=>set("logo",v)} size={72} radius={14}/>
        <div style={{fontSize:12,color:"#475569",lineHeight:1.6}}>Tap to upload your logo.<br/>PNG or JPG recommended.</div>
      </div>
    </div>
    <ColorRow label="PRIMARY / ACCENT COLOR" value={primary} onChange={v=>set("primaryColor",v)} colors={BRAND_COLORS}/>
    <ColorRow label="CARD BACKGROUND — TOP" value={bgTop} onChange={v=>set("cardBgTop",v)} colors={BG_COLORS}/>
    <ColorRow label="CARD BACKGROUND — BOTTOM" value={bgBot} onChange={v=>set("cardBgBottom",v)} colors={BG_COLORS}/>
  </div>);
}

// ═══════════════════════════════════════════════════════════════════════════
// TEAM SETTINGS
// ═══════════════════════════════════════════════════════════════════════════
function TeamSettings({ team, onSave }) {
  const [name,setName]=useState(team.name);
  const [adminUser,setAdminUser]=useState(team.adminUser||"");
  const [adminPin,setAdminPin]=useState(team.adminPin||"");
  const [perms,setPerms]=useState({...DEFAULT_PERMISSIONS,...(team.permissions||{})});
  const [saving,setSaving]=useState(false); const [saved,setSaved]=useState(false);
  function togglePerm(k){setPerms(p=>({...p,[k]:!p[k]}));}
  async function save(){
    setSaving(true);
    await DB.update("teams",`id=eq.${team.id}`,{name,admin_user:adminUser.trim().toLowerCase(),admin_pin:adminPin,permissions:perms});
    onSave({...team,name,adminUser:adminUser.trim().toLowerCase(),adminPin,permissions:perms});
    setSaving(false); setSaved(true); setTimeout(()=>setSaved(false),2000);
  }
  return (<div style={{display:"flex",flexDirection:"column",gap:14}}>
    <div style={{background:"#1e293b",borderRadius:12,padding:"16px"}}>
      <div style={{fontSize:14,fontWeight:700,color:"white",marginBottom:14}}>Team Info</div>
      <Inp label="TEAM NAME" value={name} onChange={setName} placeholder="e.g. Roosevelt Varsity Soccer"/>
    </div>
    <div style={{background:"#1e293b",borderRadius:12,padding:"16px"}}>
      <div style={{fontSize:14,fontWeight:700,color:"white",marginBottom:4}}>Coach Login</div>
      <div style={{fontSize:11,color:"#475569",marginBottom:14}}>Coach can log in to manage this team only</div>
      <Inp label="USERNAME" value={adminUser} onChange={setAdminUser} placeholder="e.g. coach_rivera"/>
      <Inp label="PIN (4 digits)" value={adminPin} onChange={v=>setAdminPin(v.replace(/[^0-9]/g,"").slice(0,4))} placeholder="4-digit PIN" type="password" mono/>
      {adminUser&&adminPin.length===4&&<div style={{fontSize:11,color:"#64748b",marginTop:8,background:"#0f172a",borderRadius:8,padding:"8px 12px"}}>Coach logs in as: <strong style={{color:"#f59e0b"}}>{adminUser}</strong></div>}
    </div>
    <div style={{background:"#1e293b",borderRadius:12,padding:"16px"}}>
      <div style={{fontSize:14,fontWeight:700,color:"white",marginBottom:4}}>Coach Permissions</div>
      <div style={{fontSize:11,color:"#475569",marginBottom:14}}>Control what this coach can do</div>
      <Toggle on={perms.canManageDeals}   onChange={()=>togglePerm("canManageDeals")}   label="Manage Deals"     sub="Add, edit, reorder and delete deals"/>
      <Toggle on={perms.canGenerateCards} onChange={()=>togglePerm("canGenerateCards")} label="Generate Cards"   sub="Issue new card batches for this team"/>
      <Toggle on={perms.canViewIssued}    onChange={()=>togglePerm("canViewIssued")}    label="View Issued Cards" sub="See the list of issued card IDs and export QRs"/>
      <Toggle on={perms.canViewStats}     onChange={()=>togglePerm("canViewStats")}     label="View Stats"       sub="See redemption analytics for their team"/>
    </div>
    <button onClick={save} disabled={saving} style={{padding:"13px",background:saved?"#22c55e":"#f59e0b",border:"none",borderRadius:10,color:"#0f172a",fontSize:15,fontWeight:800,cursor:"pointer"}}>
      {saving?"Saving...":(saved?"✓ Saved!":"Save Team Settings")}
    </button>
  </div>);
}

// ═══════════════════════════════════════════════════════════════════════════
// TEAM PANEL (shared by super admin + coach)
// ═══════════════════════════════════════════════════════════════════════════
function TeamPanel({ team, onTeamUpdate, isSuperAdmin }) {
  const [tab,setTab]=useState("deals");
  const [editing,setEditing]=useState(null);
  const [count,setCount]=useState(25);
  const [copied,setCopied]=useState(null);
  const [confirmClear,setConfirmClear]=useState(false);
  const [exporting,setExporting]=useState(false);
  const [exportProgress,setExportProgress]=useState(0);
  const [baseUrl,setBaseUrl]=useState(()=>window.location.origin+window.location.pathname);

  const cards=Object.values(team.cards||{});
  const totalRedeem=cards.reduce((s,c)=>s+Object.values(c.redemptions||{}).reduce((a,b)=>a+b,0),0);
  const perms={...DEFAULT_PERMISSIONS,...(team.permissions||{})};
  const TABS=isSuperAdmin
    ?["deals","branding","generate","issued","stats","settings"]
    :[
      ...(perms.canManageDeals?["deals"]:[]),
      ...(perms.canGenerateCards?["generate"]:[]),
      ...(perms.canViewIssued?["issued"]:[]),
      ...(perms.canViewStats?["stats"]:[]),
    ];

  // keep tab valid
  useEffect(()=>{if(!TABS.includes(tab)&&TABS.length>0)setTab(TABS[0]);},[team.id]);

  async function saveDeal(form) {
    const deals = editing==="new"
      ? [...team.deals, form]
      : team.deals.map(d=>d.id===form.id?form:d);
    onTeamUpdate({...team,deals});
    setEditing(null);
  }
  function deleteDeal(id){onTeamUpdate({...team,deals:team.deals.filter(d=>d.id!==id)});setEditing(null);}

  async function reorderDeals(newDeals) {
    onTeamUpdate({...team,deals:newDeals});
    // persist sort order
    await Promise.all(newDeals.map((d,i)=>DB.update("deals",`id=eq.${d.id}`,{sort_order:i})));
  }

  async function generateCards() {
    const newCards={};
    for(let i=0;i<count;i++){
      const id=randId(8);
      await DB.insert("cards",{id,team_id:team.id});
      newCards[id]={id,teamId:team.id,createdAt:Date.now(),redemptions:{}};
    }
    onTeamUpdate({...team,cards:{...team.cards,...newCards}});
    setTab("issued");
  }

  async function clearCards(){
    await DB.del("cards",`team_id=eq.${team.id}`);
    onTeamUpdate({...team,cards:{}});
    setConfirmClear(false);
  }

  function copyLink(id){
    navigator.clipboard.writeText(`${baseUrl}?card=${id}`).catch(()=>{});
    setCopied(id);setTimeout(()=>setCopied(null),2000);
  }

  // QR Export
  function generateQRCanvas(url,teamName,cardId){
    const SIZE=200; const canvas=document.createElement("canvas"); canvas.width=SIZE; canvas.height=SIZE;
    const ctx=canvas.getContext("2d");
    return new Promise(resolve=>{
      const img=new Image(); img.crossOrigin="anonymous";
      img.onload=()=>{
        ctx.fillStyle="#ffffff"; ctx.fillRect(0,0,SIZE,SIZE);
        ctx.drawImage(img,20,8,160,140);
        ctx.fillStyle="#111111"; ctx.font="bold 13px monospace"; ctx.textAlign="center";
        ctx.fillText(cardId,SIZE/2,162);
        ctx.fillStyle="#555555"; ctx.font="11px Arial,sans-serif";
        ctx.fillText(teamName.length>28?teamName.slice(0,26)+"...":teamName,SIZE/2,180);
        resolve(canvas);
      };
      img.onerror=()=>{ctx.fillStyle="#ffffff";ctx.fillRect(0,0,SIZE,SIZE);ctx.fillStyle="#111";ctx.font="bold 12px monospace";ctx.textAlign="center";ctx.fillText(cardId,SIZE/2,SIZE/2);resolve(canvas);};
      img.src="https://api.qrserver.com/v1/create-qr-code/?size=160x160&data="+encodeURIComponent(url)+"&format=png&margin=0";
    });
  }
  function loadJSZip(){return new Promise((res,rej)=>{if(window.JSZip){res(window.JSZip);return;}const s=document.createElement("script");s.src="https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";s.onload=()=>res(window.JSZip);s.onerror=rej;document.head.appendChild(s);});}
  async function exportQRs(){
    if(!cards.length)return; setExporting(true); setExportProgress(0);
    try{
      const JSZip=await loadJSZip(); const zip=new JSZip();
      const folderName=(team.name||"team").replace(/\s+/g,"_");
      const folder=zip.folder(folderName);
      const csvRows=["Card ID,Team,URL,Times Redeemed"];
      for(let i=0;i<cards.length;i++){
        const card=cards[i]; const url=baseUrl+"?card="+card.id;
        const used=Object.values(card.redemptions||{}).reduce((s,v)=>s+v,0);
        csvRows.push(card.id+',"'+(team.name||"").replace(/"/g,"'")+'",'+ url+","+used);
        const canvas=await generateQRCanvas(url,team.name||"Fundraiser",card.id);
        const blob=await new Promise(r=>canvas.toBlob(r,"image/jpeg",0.92));
        folder.file(card.id+".jpg",blob);
        setExportProgress(Math.round(((i+1)/cards.length)*100));
        if(i%5===0)await new Promise(r=>setTimeout(r,0));
      }
      folder.file("cards.csv",csvRows.join("\n"));
      const zipBlob=await zip.generateAsync({type:"blob"});
      const a=document.createElement("a"); a.href=URL.createObjectURL(zipBlob); a.download=folderName+"_QR_codes.zip"; a.click(); URL.revokeObjectURL(a.href);
    }catch(e){console.error("Export error:",e);}
    setExporting(false); setExportProgress(0);
  }

  const dealStats=team.deals.map(d=>({...d,total:cards.reduce((s,c)=>s+(c.redemptions?.[d.id]||0),0)})).sort((a,b)=>b.total-a.total);
  const maxStat=Math.max(1,...dealStats.map(d=>d.total));

  return (<div>
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginBottom:20}}>
      {[{l:"Cards",v:cards.length,c:"#3b82f6"},{l:"Redemptions",v:totalRedeem,c:"#22c55e"},{l:"Deals",v:team.deals.length,c:"#f59e0b"}].map(s=>(
        <div key={s.l} style={{background:"#1e293b",borderRadius:10,padding:"12px 14px",border:`1px solid ${s.c}22`}}>
          <div style={{fontSize:24,fontWeight:800,color:s.c,fontFamily:"monospace"}}>{s.v}</div>
          <div style={{fontSize:10,color:"#475569",marginTop:2}}>{s.l}</div>
        </div>
      ))}
    </div>
    <div style={{display:"flex",gap:4,marginBottom:18,overflowX:"auto",paddingBottom:2}}>
      {TABS.map(t=><button key={t} onClick={()=>setTab(t)} style={{padding:"7px 13px",borderRadius:6,border:"none",cursor:"pointer",whiteSpace:"nowrap",background:tab===t?"#3b82f6":"#1e293b",color:tab===t?"white":"#64748b",fontSize:12,fontWeight:600,textTransform:"capitalize"}}>{t}</button>)}
    </div>

    {tab==="deals"&&(isSuperAdmin||perms.canManageDeals)&&(<>
      <DealList deals={team.deals} onReorder={reorderDeals} onEdit={setEditing} onAdd={()=>setEditing("new")}/>
      {editing&&<DealEditor deal={editing==="new"?null:editing} teamId={team.id} isNew={editing==="new"} onSave={saveDeal} onCancel={()=>setEditing(null)} onDelete={deleteDeal}/>}
    </>)}

    {tab==="branding"&&isSuperAdmin&&<BrandingEditor team={team} onChange={async b=>{
      await DB.update("teams",`id=eq.${team.id}`,{branding:b});
      onTeamUpdate({...team,branding:b});
    }}/>}

    {tab==="generate"&&(isSuperAdmin||perms.canGenerateCards)&&(<div style={{display:"flex",flexDirection:"column",gap:14}}>
      {team.deals.length===0&&<div style={{background:"#1c2a1c",border:"1px solid #22c55e44",borderRadius:10,padding:"12px 16px",fontSize:12,color:"#86efac"}}>⚠ Add some deals first before generating cards.</div>}
      <div>
        <label style={{fontSize:11,color:"#64748b",display:"block",marginBottom:6}}>NUMBER OF CARDS</label>
        <input type="number" min={1} max={5000} value={count} onChange={e=>setCount(parseInt(e.target.value)||1)}
          style={{width:"100%",background:"#1e293b",border:"1px solid #334155",borderRadius:8,padding:"10px 12px",color:"white",fontSize:14,outline:"none"}}/>
      </div>
      <button onClick={generateCards} style={{padding:"13px",background:"#f59e0b",border:"none",borderRadius:10,color:"#0f172a",fontSize:15,fontWeight:800,cursor:"pointer"}}>Generate {count} Cards ★</button>
    </div>)}

    {tab==="issued"&&(isSuperAdmin||perms.canViewIssued)&&(<div>
      <div style={{background:"#1e293b",borderRadius:10,padding:"12px 14px",marginBottom:14,border:"1px solid #334155"}}>
        <div style={{fontSize:11,color:"#64748b",marginBottom:6}}>BASE URL FOR QR CODES</div>
        <input value={baseUrl} onChange={e=>setBaseUrl(e.target.value)} style={{width:"100%",background:"#0f172a",border:"1px solid #334155",borderRadius:7,padding:"8px 10px",color:"#f59e0b",fontSize:11,fontFamily:"monospace",outline:"none"}}/>
        <div style={{fontSize:10,color:"#475569",marginTop:4}}>Update this to your live URL before exporting</div>
      </div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
        <div style={{fontSize:11,color:"#64748b"}}>{cards.length} CARDS ISSUED</div>
        <div style={{display:"flex",gap:6}}>
          {cards.length>0&&!exporting&&<button onClick={exportQRs} style={{background:"#3b82f6",border:"none",borderRadius:6,padding:"5px 12px",color:"white",fontSize:11,fontWeight:700,cursor:"pointer"}}>📦 Export QR + CSV</button>}
          {cards.length>0&&!confirmClear&&<button onClick={()=>setConfirmClear(true)} style={{background:"transparent",border:"1px solid #ef444433",borderRadius:6,padding:"5px 12px",color:"#ef4444",fontSize:11,cursor:"pointer"}}>Clear All</button>}
        </div>
      </div>
      {exporting&&<div style={{background:"#1e293b",borderRadius:10,padding:"14px 16px",marginBottom:14}}>
        <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>
          <div style={{fontSize:13,color:"white",fontWeight:600}}>Generating QR codes...</div>
          <div style={{fontSize:13,color:"#f59e0b",fontWeight:700}}>{exportProgress}%</div>
        </div>
        <div style={{height:6,background:"#334155",borderRadius:4,overflow:"hidden"}}><div style={{height:"100%",background:"#3b82f6",borderRadius:4,width:exportProgress+"%",transition:"width 0.3s"}}/></div>
        <div style={{fontSize:11,color:"#475569",marginTop:8}}>Building ZIP — do not close this tab.</div>
      </div>}
      {confirmClear&&<InlineConfirm message={`Delete all ${cards.length} cards?`} onConfirm={clearCards} onCancel={()=>setConfirmClear(false)}/>}
      {cards.length===0?<div style={{color:"#475569",textAlign:"center",padding:40}}>No cards yet.</div>
        :<div style={{display:"flex",flexDirection:"column",gap:6,maxHeight:440,overflowY:"auto"}}>
          {cards.slice().reverse().map(card=>{
            const used=Object.values(card.redemptions||{}).reduce((s,v)=>s+v,0);
            return (<div key={card.id} style={{background:"#1e293b",borderRadius:8,padding:"10px 14px",display:"flex",justifyContent:"space-between",alignItems:"center",border:"1px solid #334155"}}>
              <div>
                <span style={{fontFamily:"monospace",fontSize:13,color:"#f59e0b"}}>{card.id}</span>
                <span style={{fontSize:11,color:"#475569",marginLeft:8}}>{new Date(card.createdAt).toLocaleDateString()}</span>
              </div>
              <div style={{display:"flex",gap:8,alignItems:"center"}}>
                <span style={{fontSize:11,color:used>0?"#22c55e":"#475569"}}>{used} redeemed</span>
                <button onClick={()=>copyLink(card.id)} style={{background:copied===card.id?"#22c55e22":"#0f172a",border:`1px solid ${copied===card.id?"#22c55e":"#334155"}`,borderRadius:6,padding:"4px 10px",fontSize:10,color:copied===card.id?"#22c55e":"#64748b",cursor:"pointer"}}>{copied===card.id?"✓ Copied":"Copy Link"}</button>
              </div>
            </div>);
          })}
        </div>}
    </div>)}

    {tab==="stats"&&(isSuperAdmin||perms.canViewStats)&&(<div>
      <div style={{fontSize:11,color:"#64748b",marginBottom:12}}>REDEMPTIONS PER DEAL</div>
      {dealStats.length===0?<div style={{color:"#475569",textAlign:"center",padding:40}}>No deals or redemptions yet.</div>
        :dealStats.map(d=>(
          <div key={d.id} style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
            {d.logo?<img src={d.logo} style={{width:24,height:24,borderRadius:5,objectFit:"cover",flexShrink:0}}/>:<div style={{width:24,height:24,borderRadius:5,background:(d.color||"#3b82f6")+"33",flexShrink:0}}/>}
            <div style={{width:110,fontSize:11,color:"#94a3b8",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",flexShrink:0}}>{d.merchant}</div>
            <div style={{flex:1,height:16,background:"#1e293b",borderRadius:4,overflow:"hidden"}}><div style={{height:"100%",borderRadius:4,width:`${(d.total/maxStat)*100}%`,background:d.color||"#3b82f6",transition:"width 0.5s"}}/></div>
            <div style={{width:20,fontSize:11,color:"#64748b",textAlign:"right"}}>{d.total}</div>
            {d.limit!=null&&<div style={{fontSize:10,color:"#f59e0b",width:36}}>max {d.limit}×</div>}
          </div>
        ))}
    </div>)}

    {tab==="settings"&&isSuperAdmin&&<TeamSettings team={team} onSave={onTeamUpdate}/>}
  </div>);
}

// ═══════════════════════════════════════════════════════════════════════════
// SUPER ADMIN VIEW
// ═══════════════════════════════════════════════════════════════════════════
function SuperAdminView({ data, onDataChange, onLock }) {
  const [view,setView]=useState("teams");
  const [newTeamName,setNewTeamName]=useState("");
  const [confirmDelete,setConfirmDelete]=useState(null);
  const [superPin,setSuperPin]=useState(""); const [pinMsg,setPinMsg]=useState("");
  const teams=Object.values(data.teams);

  async function addTeam(){
    if(!newTeamName.trim())return;
    const id=randId(6);
    const t={id,name:newTeamName.trim(),branding:{},admin_user:"",admin_pin:"",permissions:{...DEFAULT_PERMISSIONS}};
    await DB.insert("teams",t);
    onDataChange({...data,teams:{...data.teams,[id]:{id,name:t.name,branding:{},adminUser:"",adminPin:"",permissions:{...DEFAULT_PERMISSIONS},deals:{},cards:{},createdAt:Date.now()}}});
    setNewTeamName(""); setView(id);
  }

  async function deleteTeam(id){
    await DB.del("teams",`id=eq.${id}`);
    const{[id]:_,...rest}=data.teams;
    onDataChange({...data,teams:rest});
    setConfirmDelete(null); setView("teams");
  }

  async function saveSuperPin(){
    if(!/^\d{4}$/.test(superPin)){setPinMsg("Must be 4 digits");return;}
    await DB.upsert("settings",{key:"super_admin_pin",value:superPin});
    onDataChange({...data,superAdminPin:superPin});
    setPinMsg("✓ PIN updated!"); setSuperPin(""); setTimeout(()=>setPinMsg(""),2500);
  }

  const activeTeam=view!=="teams"&&view!=="settings"?data.teams[view]:null;

  // Activated card count
  const totalCards=Object.values(data.teams).reduce((s,t)=>s+Object.keys(t.cards||{}).length,0);

  return (<div>
    <div style={{display:"flex",gap:8,marginBottom:20,alignItems:"center"}}>
      {view!=="teams"&&<button onClick={()=>setView("teams")} style={{background:"transparent",border:"none",color:"#64748b",fontSize:13,cursor:"pointer",padding:0}}>← All Teams</button>}
      {view==="teams"&&<div style={{fontSize:16,fontWeight:800,color:"white",flex:1}}>All Teams</div>}
      {activeTeam&&<div style={{fontSize:16,fontWeight:800,color:"white",flex:1}}>{activeTeam.name||"Unnamed Team"}</div>}
      <button onClick={()=>setView(view==="settings"?"teams":"settings")} style={{padding:"6px 12px",borderRadius:8,border:"1px solid #334155",background:"transparent",color:"#64748b",fontSize:11,cursor:"pointer"}}>⚙ Settings</button>
      <button onClick={onLock} style={{padding:"6px 12px",borderRadius:8,border:"1px solid #334155",background:"transparent",color:"#475569",fontSize:11,cursor:"pointer"}}>🔒 Lock</button>
    </div>

    {view==="teams"&&(<div>
      <div style={{display:"flex",gap:8,marginBottom:16}}>
        <input value={newTeamName} onChange={e=>setNewTeamName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addTeam()} placeholder="New team name…"
          style={{flex:1,background:"#1e293b",border:"1px solid #334155",borderRadius:8,padding:"10px 12px",color:"white",fontSize:14,outline:"none"}}/>
        <button onClick={addTeam} style={{padding:"10px 18px",background:"#f59e0b",border:"none",borderRadius:8,color:"#0f172a",fontSize:14,fontWeight:800,cursor:"pointer"}}>+ Add Team</button>
      </div>
      {teams.length===0&&<div style={{textAlign:"center",padding:"48px 20px",background:"#1e293b",borderRadius:14,border:"1px dashed #334155"}}>
        <div style={{fontSize:36,marginBottom:10}}>🏆</div>
        <div style={{fontSize:15,color:"white",fontWeight:700,marginBottom:6}}>No teams yet</div>
        <div style={{fontSize:13,color:"#475569"}}>Add your first team above to get started</div>
      </div>}
      <div style={{display:"flex",flexDirection:"column",gap:8}}>
        {teams.map(t=>{
          const cardCount=Object.keys(t.cards||{}).length;
          const dealCount=(t.deals||[]).length;
          const redeemCount=Object.values(t.cards||{}).reduce((s,c)=>s+Object.values(c.redemptions||{}).reduce((a,b)=>a+b,0),0);
          const primary=t.branding?.primaryColor||"#f59e0b";
          return (<div key={t.id} style={{background:"#1e293b",borderRadius:12,padding:"14px 16px",border:`1px solid ${primary}33`,cursor:"pointer"}} onClick={()=>setView(t.id)}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
              <div style={{display:"flex",gap:12,alignItems:"center"}}>
                {t.branding?.logo?<img src={t.branding.logo} style={{width:40,height:40,borderRadius:10,objectFit:"cover"}}/>
                  :<div style={{width:40,height:40,borderRadius:10,background:primary+"22",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18}}>🏆</div>}
                <div>
                  <div style={{fontSize:15,fontWeight:700,color:"white"}}>{t.name||"Unnamed Team"}</div>
                  {t.adminUser&&<div style={{fontSize:11,color:"#475569",marginTop:1}}>Coach: {t.adminUser}</div>}
                </div>
              </div>
              <div style={{fontSize:11,color:"#64748b"}}>→</div>
            </div>
            <div style={{display:"flex",gap:16,marginTop:12}}>
              {[{l:"Cards",v:cardCount,c:"#3b82f6"},{l:"Deals",v:dealCount,c:"#f59e0b"},{l:"Redeemed",v:redeemCount,c:"#22c55e"}].map(s=>(
                <div key={s.l}><div style={{fontSize:18,fontWeight:800,color:s.c,fontFamily:"monospace"}}>{s.v}</div><div style={{fontSize:9,color:"#475569"}}>{s.l}</div></div>
              ))}
            </div>
            {confirmDelete===t.id&&<div onClick={e=>e.stopPropagation()}><InlineConfirm message={`Delete team "${t.name}" and all its data?`} onConfirm={()=>deleteTeam(t.id)} onCancel={()=>setConfirmDelete(null)} confirmLabel="Yes, Delete Team"/></div>}
            {confirmDelete!==t.id&&<button onClick={e=>{e.stopPropagation();setConfirmDelete(t.id);}} style={{marginTop:10,background:"transparent",border:"none",color:"#475569",fontSize:11,cursor:"pointer",padding:0}}>Delete team</button>}
          </div>);
        })}
      </div>
    </div>)}

    {activeTeam&&<TeamPanel team={activeTeam} isSuperAdmin={true} onTeamUpdate={updated=>onDataChange({...data,teams:{...data.teams,[updated.id]:updated}})}/>}

    {view==="settings"&&(<div style={{display:"flex",flexDirection:"column",gap:16}}>
      <div style={{background:"#1e293b",borderRadius:12,padding:"16px"}}>
        <div style={{fontSize:14,fontWeight:700,color:"white",marginBottom:4}}>Super Admin PIN</div>
        <div style={{fontSize:11,color:"#475569",marginBottom:12}}>Used for the main admin login (username: admin)</div>
        <input type="password" inputMode="numeric" maxLength={4} value={superPin} onChange={e=>setSuperPin(e.target.value.replace(/[^0-9]/g,"").slice(0,4))} placeholder="New 4-digit PIN"
          style={{width:"100%",background:"#0f172a",border:"1px solid #334155",borderRadius:8,padding:"10px 12px",color:"white",fontSize:20,fontFamily:"monospace",letterSpacing:8,outline:"none",marginBottom:10}}/>
        <button onClick={saveSuperPin} style={{padding:"9px 20px",background:superPin.length===4?"#22c55e":"#1e293b",border:"none",borderRadius:8,color:superPin.length===4?"#0f172a":"#475569",fontSize:13,fontWeight:700,cursor:superPin.length===4?"pointer":"default"}}>Update PIN</button>
        {pinMsg&&<div style={{fontSize:12,marginTop:8,color:pinMsg.startsWith("✓")?"#22c55e":"#ef4444"}}>{pinMsg}</div>}
      </div>
    </div>)}
  </div>);
}

// ═══════════════════════════════════════════════════════════════════════════
// ADMIN LOGIN GATE
// ═══════════════════════════════════════════════════════════════════════════
function AdminLoginGate({ data, onLogin }) {
  const [username,setUsername]=useState(""); const [pin,setPin]=useState(""); const [err,setErr]=useState(""); const [shake,setShake]=useState(false);
  const totalCards=Object.values(data.teams||{}).reduce((s,t)=>s+Object.keys(t.cards||{}).length,0);
  const teamCount=Object.keys(data.teams||{}).length;

  function attempt(currentPin){
    const p=currentPin!==undefined?currentPin:pin; const u=username.trim().toLowerCase();
    if(u==="admin"&&p===(data.superAdminPin||"1234")){onLogin({role:"super"});return;}
    const team=Object.values(data.teams||{}).find(t=>t.adminUser&&t.adminUser.toLowerCase()===u&&t.adminPin===p);
    if(team){onLogin({role:"team",teamId:team.id});return;}
    setErr("Invalid username or PIN"); setShake(true); setPin(""); setTimeout(()=>setShake(false),600);
  }

  return (<div style={{textAlign:"center",padding:"30px 0 20px"}}>
    <div style={{fontSize:40,marginBottom:10}}>🔐</div>
    <div style={{fontSize:22,fontWeight:800,color:"white",marginBottom:4}}>Admin Login</div>
    <div style={{fontSize:12,color:"#475569",marginBottom:20}}>Super admin or team coach access</div>
    <div style={{display:"flex",gap:10,marginBottom:24,justifyContent:"center"}}>
      {[{l:"Teams",v:teamCount,c:"#f59e0b"},{l:"Total Cards",v:totalCards,c:"#3b82f6"}].map(s=>(
        <div key={s.l} style={{background:"#1e293b",borderRadius:10,padding:"10px 20px",border:`1px solid ${s.c}22`,minWidth:90}}>
          <div style={{fontSize:22,fontWeight:800,color:s.c,fontFamily:"monospace"}}>{s.v}</div>
          <div style={{fontSize:9,color:"#475569",marginTop:2}}>{s.l}</div>
        </div>
      ))}
    </div>
    <input value={username} onChange={e=>{setUsername(e.target.value);setErr("");}} placeholder="Username"
      style={{width:"100%",background:"#1e293b",border:"1px solid #334155",borderRadius:10,padding:"12px 16px",color:"white",fontSize:15,outline:"none",marginBottom:20,textAlign:"center"}}/>
    <div style={{fontSize:11,color:"#64748b",marginBottom:8}}>PIN</div>
    <CustomerPinPad value={pin} onChange={v=>{setPin(v);setErr("");}} onComplete={next=>username.trim()&&attempt(next)} shake={shake}/>
    <div style={{marginTop:4}}><Btn onClick={()=>attempt()} color="#f59e0b">Sign In →</Btn></div>
    {err&&<div style={{color:"#ef4444",fontSize:12,marginTop:14}}>{err}</div>}
    <div style={{marginTop:18,fontSize:11,color:"#1e3a5f"}}>Default: admin / 1234</div>
  </div>);
}

// ═══════════════════════════════════════════════════════════════════════════
// CUSTOMER AUTH (email + PIN + forgot PIN)
// ═══════════════════════════════════════════════════════════════════════════
function CustomerAuth({ data, setData, onLogin, prefillCardId="" }) {
  const [screen,setScreen]=useState("login");
  const [email,setEmail]=useState(""); const [pin,setPin]=useState("");
  const [cardId,setCardId]=useState(prefillCardId);
  const [secQ,setSecQ]=useState(SECURITY_QUESTIONS[0]); const [secA,setSecA]=useState("");
  const [shake,setShake]=useState(false); const [err,setErr]=useState("");
  const [resetInput,setResetInput]=useState(""); const [newPin,setNewPin]=useState("");
  const [loading,setLoading]=useState(false);

  function findCard(id){
    const upper=id.toUpperCase().trim();
    for(const team of Object.values(data.teams)){if(team.cards?.[upper])return{card:team.cards[upper],teamId:team.id,cardId:upper};}
    return null;
  }

  async function register(){
    setErr(""); if(!email.trim()){setErr("Email required");return;} if(pin.length!==4){setErr("Please enter a 4-digit PIN");return;} if(!secA.trim()){setErr("Security answer required");return;}
    setLoading(true);
    try {
      const key=email.trim().toLowerCase();
      // Check if exists
      const existing=await DB.get("customers",`email=eq.${encodeURIComponent(key)}&select=email`);
      if(existing&&existing.length>0){setErr("Account already exists — please log in");setLoading(false);return;}
      const cardCheck=cardId.trim()?findCard(cardId):null;
      if(cardId.trim()&&!cardCheck){setErr("Card ID not found");setLoading(false);return;}
      await DB.insert("customers",{email:key,pin_hash:simpleHash(pin),security_question:secQ,security_answer_hash:simpleHash(secA.trim().toLowerCase())});
      if(cardCheck) await DB.insert("customer_cards",{email:key,card_id:cardCheck.cardId});
      onLogin({email:key});
    } catch(e){setErr("Registration failed — try again");}
    setLoading(false);
  }

  async function doLogin(currentPin){
    setErr(""); const p=currentPin!==undefined?currentPin:pin; const key=email.trim().toLowerCase();
    setLoading(true);
    try {
      const rows=await DB.get("customers",`email=eq.${encodeURIComponent(key)}&select=email,pin_hash`);
      if(!rows||!rows.length||rows[0].pin_hash!==simpleHash(p)){
        setErr("Invalid email or PIN"); setShake(true); setPin(""); setTimeout(()=>setShake(false),600); setLoading(false); return;
      }
      if(prefillCardId){
        const check=findCard(prefillCardId);
        if(check){
          try{await DB.insert("customer_cards",{email:key,card_id:check.cardId});}catch(e){}
        }
      }
      onLogin({email:key});
    } catch(e){setErr("Login failed — try again");}
    setLoading(false);
  }

  async function startReset(){
    setErr(""); if(!email.trim()){setErr("Enter your email first");return;}
    const rows=await DB.get("customers",`email=eq.${encodeURIComponent(email.trim().toLowerCase())}&select=email`);
    if(!rows||!rows.length){setErr("No account found with that email");return;}
    setScreen("reset-method");
  }

  async function verifyCard(){
    setErr(""); const key=email.trim().toLowerCase();
    const rows=await DB.get("customer_cards",`email=eq.${encodeURIComponent(key)}&card_id=eq.${resetInput.toUpperCase().trim()}&select=card_id`);
    if(!rows||!rows.length){setErr("Card not found on this account");return;}
    setScreen("reset-newpin");
  }

  async function verifyQuestion(){
    setErr(""); const key=email.trim().toLowerCase();
    const rows=await DB.get("customers",`email=eq.${encodeURIComponent(key)}&select=security_answer_hash`);
    if(!rows||!rows.length||rows[0].security_answer_hash!==simpleHash(resetInput.trim().toLowerCase())){setErr("Incorrect answer");return;}
    setScreen("reset-newpin");
  }

  async function doReset(completedPin){
    const p=completedPin||newPin; if(p.length!==4)return;
    await DB.update("customers",`email=eq.${encodeURIComponent(email.trim().toLowerCase())}`,{pin_hash:simpleHash(p)});
    setScreen("login"); setPin(""); setNewPin(""); setResetInput(""); setErr("");
  }

  function Hdr({title,sub,back}){return(<div style={{textAlign:"center",marginBottom:24}}>
    {back&&<button onClick={back} style={{background:"transparent",border:"none",color:"#475569",fontSize:12,cursor:"pointer",display:"block",marginBottom:12,padding:0}}>← Back</button>}
    <div style={{fontSize:40,marginBottom:8}}>🎟</div>
    <div style={{fontSize:20,fontWeight:800,color:"white",marginBottom:4}}>{title}</div>
    <div style={{fontSize:13,color:"#64748b"}}>{sub}</div>
  </div>);}

  if(screen==="login") return (<div style={{padding:"20px 0"}}>
    <Hdr title="Welcome Back" sub="Log in to view your discount cards"/>
    <Inp label="EMAIL" value={email} onChange={v=>{setEmail(v);setErr("");}} placeholder="you@email.com" type="email"/>
    <div style={{fontSize:11,color:"#64748b",marginBottom:12,textAlign:"center"}}>4-DIGIT PIN</div>
    <CustomerPinPad value={pin} onChange={v=>{setPin(v);setErr("");}} onComplete={doLogin} shake={shake}/>
    {err&&<div style={{color:"#ef4444",fontSize:12,margin:"10px 0",textAlign:"center"}}>{err}</div>}
    <div style={{marginTop:16}}><Btn onClick={()=>doLogin()} color="#f59e0b" disabled={loading}>{loading?"Logging in...":"Log In"}</Btn></div>
    <div style={{textAlign:"center",marginTop:14,display:"flex",flexDirection:"column",gap:8}}>
      <button onClick={startReset} style={{background:"transparent",border:"none",color:"#64748b",fontSize:12,cursor:"pointer",textDecoration:"underline"}}>Forgot PIN?</button>
      <button onClick={()=>{setScreen("register");setErr("");setPin("");}} style={{background:"transparent",border:"none",color:"#3b82f6",fontSize:13,cursor:"pointer",textDecoration:"underline"}}>No account? Create one</button>
    </div>
  </div>);

  if(screen==="register") return (<div style={{padding:"20px 0"}}>
    <Hdr title="Create Account" sub="Register to save your card to your account" back={()=>{setScreen("login");setErr("");setPin("");}}/>
    <Inp label="EMAIL" value={email} onChange={v=>{setEmail(v);setErr("");}} placeholder="you@email.com" type="email"/>
    <Inp label="CARD ID (optional — add later)" value={cardId} onChange={v=>{setCardId(v.toUpperCase());setErr("");}} placeholder="ABCD-1234" mono/>
    <div style={{marginBottom:14}}>
      <label style={{fontSize:11,color:"#64748b",display:"block",marginBottom:6}}>SECURITY QUESTION</label>
      <select value={secQ} onChange={e=>setSecQ(e.target.value)} style={{width:"100%",background:"#1e293b",border:"1px solid #334155",borderRadius:8,padding:"10px 12px",color:"white",fontSize:13,outline:"none"}}>
        {SECURITY_QUESTIONS.map(q=><option key={q} value={q}>{q}</option>)}
      </select>
    </div>
    <Inp label="YOUR ANSWER (used to recover PIN)" value={secA} onChange={v=>{setSecA(v);setErr("");}} placeholder="Answer (not case sensitive)"/>
    <div style={{fontSize:11,color:"#64748b",marginBottom:12,textAlign:"center"}}>CHOOSE A 4-DIGIT PIN</div>
    <CustomerPinPad value={pin} onChange={v=>{setPin(v);setErr("");}} shake={false}/>
    {err&&<div style={{color:"#ef4444",fontSize:12,margin:"10px 0",textAlign:"center"}}>{err}</div>}
    <div style={{marginTop:8}}><Btn onClick={register} color="#f59e0b" disabled={loading}>{loading?"Creating account...":"Create Account"}</Btn></div>
  </div>);

  if(screen==="reset-method") return (<div style={{padding:"20px 0"}}>
    <Hdr title="Reset PIN" sub={"Recovering account for "+email} back={()=>{setScreen("login");setErr("");}}/>
    <div style={{display:"flex",flexDirection:"column",gap:10}}>
      <button onClick={()=>{setScreen("reset-card");setResetInput("");setErr("");}} style={{background:"#1e293b",border:"1px solid #3b82f644",borderRadius:12,padding:"16px",textAlign:"left",cursor:"pointer"}}>
        <div style={{fontSize:14,color:"white",fontWeight:700,marginBottom:4}}>🎟 Verify with Card ID</div>
        <div style={{fontSize:12,color:"#64748b"}}>Enter a card ID linked to your account</div>
      </button>
      <button onClick={()=>{setScreen("reset-question");setResetInput("");setErr("");}} style={{background:"#1e293b",border:"1px solid #f59e0b44",borderRadius:12,padding:"16px",textAlign:"left",cursor:"pointer"}}>
        <div style={{fontSize:14,color:"white",fontWeight:700,marginBottom:4}}>🔒 Answer Security Question</div>
        <div style={{fontSize:12,color:"#64748b"}}>Answer the question you set when registering</div>
      </button>
    </div>
  </div>);

  if(screen==="reset-card") return (<div style={{padding:"20px 0"}}>
    <Hdr title="Verify with Card" sub="Enter a card ID linked to your account" back={()=>{setScreen("reset-method");setErr("");}}/>
    <Inp label="CARD ID" value={resetInput} onChange={v=>{setResetInput(v.toUpperCase());setErr("");}} placeholder="ABCD-1234" mono/>
    {err&&<div style={{color:"#ef4444",fontSize:12,marginBottom:12}}>{err}</div>}
    <Btn onClick={verifyCard} color="#f59e0b">Verify Card</Btn>
  </div>);

  if(screen==="reset-question") {
    const c=data;
    return (<div style={{padding:"20px 0"}}>
      <Hdr title="Security Question" sub="Answer to verify your identity" back={()=>{setScreen("reset-method");setErr("");}}/>
      <QuestionDisplay email={email}/>
      <Inp label="YOUR ANSWER" value={resetInput} onChange={v=>{setResetInput(v);setErr("");}} placeholder="Your answer"/>
      {err&&<div style={{color:"#ef4444",fontSize:12,marginBottom:12}}>{err}</div>}
      <Btn onClick={verifyQuestion} color="#f59e0b">Verify Answer</Btn>
    </div>);
  }

  if(screen==="reset-newpin") return (<div style={{padding:"20px 0"}}>
    <Hdr title="Set New PIN" sub="Choose a new 4-digit PIN"/>
    <CustomerPinPad value={newPin} onChange={v=>{setNewPin(v);setErr("");}} onComplete={doReset} shake={false}/>
    {err&&<div style={{color:"#ef4444",fontSize:12,margin:"10px 0",textAlign:"center"}}>{err}</div>}
    <div style={{marginTop:8}}><Btn onClick={()=>doReset()} color="#f59e0b" disabled={newPin.length!==4}>Set New PIN</Btn></div>
  </div>);

  return null;
}

// Async question fetcher for reset flow
function QuestionDisplay({ email }) {
  const [q,setQ]=useState("Loading...");
  useEffect(()=>{
    DB.get("customers",`email=eq.${encodeURIComponent(email.trim().toLowerCase())}&select=security_question`)
      .then(rows=>{if(rows&&rows.length)setQ(rows[0].security_question||"No security question set");})
      .catch(()=>setQ("Could not load question"));
  },[email]);
  return <div style={{background:"#1e293b",borderRadius:10,padding:"14px 16px",marginBottom:16,fontSize:13,color:"#94a3b8",fontStyle:"italic"}}>{q}</div>;
}

// ═══════════════════════════════════════════════════════════════════════════
// CUSTOMER WALLET
// ═══════════════════════════════════════════════════════════════════════════
function CustomerWallet({ data, customerEmail, onLogout }) {
  const [activeCardId,setActiveCardId]=useState(null);
  const [myCardIds,setMyCardIds]=useState(null); // null = loading
  const [addCardInput,setAddCardInput]=useState(""); const [addCardErr,setAddCardErr]=useState("");
  const [filter,setFilter]=useState("All"); const [confirmMode,setConfirmMode]=useState(null);
  const [confetti,setConfetti]=useState(false); const [lastRedeemed,setLastRedeemed]=useState(null);
  const [redemptions,setRedemptions]=useState({}); // live redemption state

  useEffect(()=>{
    DB.get("customer_cards",`email=eq.${encodeURIComponent(customerEmail)}&select=card_id`)
      .then(rows=>setMyCardIds((rows||[]).map(r=>r.card_id)))
      .catch(()=>setMyCardIds([]));
  },[customerEmail]);

  function findCard(id){
    const upper=id.toUpperCase().trim();
    for(const team of Object.values(data.teams)){if(team.cards?.[upper])return{card:team.cards[upper],team,cardId:upper};}
    return null;
  }

  async function addCard(){
    setAddCardErr("");
    const result=findCard(addCardInput);
    if(!result){setAddCardErr("Card not found — check the ID and try again");return;}
    if(myCardIds.includes(result.cardId)){setAddCardErr("Card already in your wallet");return;}
    try{
      await DB.insert("customer_cards",{email:customerEmail,card_id:result.cardId});
      setMyCardIds([...myCardIds,result.cardId]); setAddCardInput("");
      setActiveCardId(result.cardId);
    }catch(e){setAddCardErr("Could not add card — try again");}
  }

  async function redeem(dealId,cardId,team){
    const deal=team.deals.find(d=>d.id===dealId);
    const used=(redemptions[cardId]||{})[dealId]||team.cards[cardId]?.redemptions?.[dealId]||0;
    if(deal.limit!=null&&used>=deal.limit)return;
    await DB.insert("redemptions",{card_id:cardId,deal_id:dealId});
    setRedemptions(r=>({...r,[cardId]:{...(r[cardId]||{}),[dealId]:(r[cardId]?.[dealId]||used)+1}}));
    setLastRedeemed(deal.merchant); setConfetti(true);
  }

  function getUsed(cardId,dealId,team){
    const live=(redemptions[cardId]||{})[dealId];
    if(live!=null)return live;
    return team.cards[cardId]?.redemptions?.[dealId]||0;
  }

  if(myCardIds===null)return <Spinner/>;

  const myCards=myCardIds.map(cid=>findCard(cid)).filter(Boolean);

  if(activeCardId){
    const found=myCards.find(c=>c.cardId===activeCardId);
    if(!found){setActiveCardId(null);return null;}
    const{card,team}=found;
    const b=team.branding||{}; const primary=b.primaryColor||"#f59e0b"; const bgTop=b.cardBgTop||"#0f2444"; const bgBot=b.cardBgBottom||"#1a3a6e";
    const deals=team.deals||[];
    const categories=["All",...Array.from(new Set(deals.map(d=>d.category)))];
    const visible=deals.filter(d=>filter==="All"||d.category===filter);
    const totalUsed=deals.reduce((s,d)=>s+getUsed(activeCardId,d.id,team),0);
    const totalAvail=deals.filter(d=>!(d.limit!=null&&getUsed(activeCardId,d.id,team)>=d.limit)).length;
    return (<div>
      {confetti&&<Confetti onDone={()=>setConfetti(false)}/>}
      <button onClick={()=>{setActiveCardId(null);setFilter("All");}} style={{background:"transparent",border:"none",color:"#475569",fontSize:12,cursor:"pointer",marginBottom:14,padding:0}}>← My Cards</button>
      <div style={{background:`linear-gradient(135deg,${bgTop} 0%,${bgBot} 100%)`,borderRadius:16,padding:"18px 20px",marginBottom:20,border:`1px solid ${primary}44`,position:"relative",overflow:"hidden"}}>
        <div style={{position:"absolute",top:-30,right:-30,width:130,height:130,background:`radial-gradient(circle,${primary}22 0%,transparent 70%)`,borderRadius:"50%"}}/>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
          <div style={{flex:1}}>
            <div style={{fontSize:11,color:primary,fontWeight:700,letterSpacing:3,marginBottom:4}}>★ FUNDRAISER DISCOUNT CARD</div>
            <div style={{fontSize:20,fontWeight:800,color:"white"}}>{team.name}</div>
            <div style={{fontFamily:"monospace",fontSize:12,color:"#64748b",marginTop:6,letterSpacing:2}}>{activeCardId}</div>
            <div style={{display:"flex",gap:16,marginTop:12}}>
              <div><div style={{fontSize:20,fontWeight:800,color:"#22c55e"}}>{totalAvail}</div><div style={{fontSize:9,color:"#64748b"}}>DEALS LEFT</div></div>
              <div><div style={{fontSize:20,fontWeight:800,color:primary}}>{totalUsed}</div><div style={{fontSize:9,color:"#64748b"}}>REDEEMED</div></div>
              <div><div style={{fontSize:20,fontWeight:800,color:"#3b82f6"}}>{deals.length}</div><div style={{fontSize:9,color:"#64748b"}}>TOTAL</div></div>
            </div>
          </div>
          {b.logo&&<img src={b.logo} style={{width:58,height:58,borderRadius:14,objectFit:"cover",border:`2px solid ${primary}55`,flexShrink:0}}/>}
        </div>
      </div>
      {lastRedeemed&&<div style={{background:"#14532d",border:"1px solid #16a34a",borderRadius:10,padding:"10px 16px",marginBottom:14,fontSize:13,color:"#86efac",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <span>✓ Redeemed at <strong>{lastRedeemed}</strong></span>
        <button onClick={()=>setLastRedeemed(null)} style={{background:"transparent",border:"none",color:"#16a34a",cursor:"pointer",fontSize:18}}>×</button>
      </div>}
      {categories.length>1&&<div style={{display:"flex",gap:6,overflowX:"auto",paddingBottom:6,marginBottom:14}}>
        {categories.map(cat=><button key={cat} onClick={()=>setFilter(cat)} style={{whiteSpace:"nowrap",padding:"6px 14px",borderRadius:20,border:"none",cursor:"pointer",fontSize:11,fontWeight:700,flexShrink:0,background:filter===cat?primary:"#1e293b",color:filter===cat?"#0f172a":"#64748b"}}>{cat}</button>)}
      </div>}
      {deals.length===0?<div style={{textAlign:"center",padding:"40px 20px",color:"#475569"}}>No deals added yet. Check back soon!</div>
        :<div style={{display:"flex",flexDirection:"column",gap:10}}>
          {visible.map(deal=><DealCard key={deal.id} deal={deal} used={getUsed(activeCardId,deal.id,team)} onRedeem={id=>redeem(id,activeCardId,team)} confirmMode={confirmMode} setConfirmMode={setConfirmMode}/>)}
        </div>}
    </div>);
  }

  return (<div>
    {confetti&&<Confetti onDone={()=>setConfetti(false)}/>}
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
      <div><div style={{fontSize:20,fontWeight:800,color:"white"}}>My Cards</div><div style={{fontSize:12,color:"#475569"}}>{customerEmail}</div></div>
      <button onClick={onLogout} style={{padding:"6px 14px",borderRadius:8,border:"1px solid #334155",background:"transparent",color:"#64748b",fontSize:11,cursor:"pointer"}}>Log Out</button>
    </div>
    {myCards.length===0&&<div style={{textAlign:"center",padding:"36px 20px",background:"#1e293b",borderRadius:14,border:"1px dashed #334155",marginBottom:20}}>
      <div style={{fontSize:36,marginBottom:10}}>🎟️</div>
      <div style={{fontSize:15,color:"white",fontWeight:700,marginBottom:6}}>No cards yet</div>
      <div style={{fontSize:13,color:"#475569"}}>Add a card ID below to get started</div>
    </div>}
    <div style={{display:"flex",flexDirection:"column",gap:10,marginBottom:24}}>
      {myCards.map(({cardId,card,team})=>{
        const b=team.branding||{}; const primary=b.primaryColor||"#f59e0b"; const bgTop=b.cardBgTop||"#0f2444"; const bgBot=b.cardBgBottom||"#1a3a6e";
        const totalUsed=team.deals.reduce((s,d)=>s+getUsed(cardId,d.id,team),0);
        const avail=(team.deals||[]).filter(d=>!(d.limit!=null&&getUsed(cardId,d.id,team)>=d.limit)).length;
        return (<div key={cardId} onClick={()=>setActiveCardId(cardId)} style={{background:`linear-gradient(135deg,${bgTop} 0%,${bgBot} 100%)`,borderRadius:14,padding:"16px 18px",cursor:"pointer",border:`1px solid ${primary}44`,position:"relative",overflow:"hidden"}}>
          <div style={{position:"absolute",top:-20,right:-20,width:80,height:80,background:`radial-gradient(circle,${primary}22 0%,transparent 70%)`,borderRadius:"50%"}}/>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
            <div>
              <div style={{fontSize:10,color:primary,fontWeight:700,letterSpacing:2,marginBottom:3}}>★ FUNDRAISER CARD</div>
              <div style={{fontSize:16,fontWeight:800,color:"white"}}>{team.name}</div>
              <div style={{fontFamily:"monospace",fontSize:11,color:"#64748b",marginTop:4,letterSpacing:2}}>{cardId}</div>
            </div>
            {b.logo&&<img src={b.logo} style={{width:44,height:44,borderRadius:10,objectFit:"cover",border:`2px solid ${primary}44`}}/>}
          </div>
          <div style={{display:"flex",gap:16,marginTop:12}}>
            <div><div style={{fontSize:16,fontWeight:800,color:"#22c55e"}}>{avail}</div><div style={{fontSize:9,color:"#64748b"}}>DEALS LEFT</div></div>
            <div><div style={{fontSize:16,fontWeight:800,color:primary}}>{totalUsed}</div><div style={{fontSize:9,color:"#64748b"}}>REDEEMED</div></div>
            <div><div style={{fontSize:16,fontWeight:800,color:"#3b82f6"}}>{(team.deals||[]).length}</div><div style={{fontSize:9,color:"#64748b"}}>DEALS</div></div>
          </div>
          <div style={{position:"absolute",right:16,bottom:14,fontSize:12,color:primary}}>Tap to open →</div>
        </div>);
      })}
    </div>
    <div style={{background:"#1e293b",borderRadius:12,padding:"16px"}}>
      <div style={{fontSize:13,fontWeight:700,color:"white",marginBottom:10}}>Add Another Card</div>
      <div style={{display:"flex",gap:8}}>
        <input value={addCardInput} onChange={e=>{setAddCardInput(e.target.value.toUpperCase());setAddCardErr("");}} onKeyDown={e=>e.key==="Enter"&&addCard()} placeholder="Card ID (ABCD-1234)"
          style={{flex:1,background:"#0f172a",border:"1px solid #334155",borderRadius:8,padding:"10px 12px",color:"white",fontSize:14,fontFamily:"monospace",letterSpacing:2,outline:"none"}}/>
        <button onClick={addCard} style={{padding:"10px 16px",background:"#f59e0b",border:"none",borderRadius:8,color:"#0f172a",fontSize:14,fontWeight:800,cursor:"pointer"}}>Add</button>
      </div>
      {addCardErr&&<div style={{color:"#ef4444",fontSize:12,marginTop:8}}>{addCardErr}</div>}
    </div>
    <div style={{marginTop:20,background:"#1e293b",borderRadius:12,padding:"14px 16px",fontSize:12,color:"#64748b",lineHeight:1.8}}>
      <strong style={{color:"#94a3b8"}}>💡 Save to your phone</strong><br/>
      Tap <strong style={{color:"white"}}>Share → Add to Home Screen</strong> in Safari or Chrome. Your wallet lives on your home screen.
    </div>
  </div>);
}

// ═══════════════════════════════════════════════════════════════════════════
// ROOT APP
// ═══════════════════════════════════════════════════════════════════════════
export default function App() {
  const [data,setData]=useState(null); // null = loading
  const [loadErr,setLoadErr]=useState(null);
  const [screen,setScreen]=useState("wallet");
  const [adminSession,setAdminSession]=useState(null);
  const [customerSession,setCustomerSession]=useState(null);
  const [urlCardId,setUrlCardId]=useState(null);

  useEffect(()=>{
    const p=new URLSearchParams(window.location.search); const c=p.get("card"); if(c)setUrlCardId(c.toUpperCase());
    loadAppData().then(setData).catch(e=>{console.error(e);setLoadErr("Could not connect to database. Check your Supabase URL and key.");});
  },[]);

  if(loadErr) return (<div style={{minHeight:"100vh",background:"#0a1628",display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
    <div style={{background:"#1e293b",borderRadius:14,padding:"24px",maxWidth:400,textAlign:"center"}}>
      <div style={{fontSize:32,marginBottom:12}}>⚠️</div>
      <div style={{fontSize:16,color:"white",fontWeight:700,marginBottom:8}}>Connection Error</div>
      <div style={{fontSize:13,color:"#64748b",marginBottom:16}}>{loadErr}</div>
      <div style={{fontSize:11,color:"#475569"}}>Open this file and replace SUPABASE_URL and SUPABASE_ANON_KEY at the top with your values from supabase.com</div>
    </div>
  </div>);

  if(!data) return (<div style={{minHeight:"100vh",background:"#0a1628",display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:16}}>
    <Spinner/><div style={{fontSize:14,color:"#475569"}}>Loading FundCard...</div>
  </div>);

  const primary=(adminSession?.role==="team"?data.teams[adminSession.teamId]?.branding?.primaryColor:null)||"#f59e0b";
  const teamAdminTeam=adminSession?.role==="team"?data.teams[adminSession.teamId]:null;

  return (<div style={{minHeight:"100vh",background:"#0a1628",color:"white",fontFamily:"'Segoe UI',system-ui,sans-serif"}}>
    <style>{`*{box-sizing:border-box}::-webkit-scrollbar{width:4px}::-webkit-scrollbar-track{background:#0a1628}::-webkit-scrollbar-thumb{background:#334155;border-radius:4px}input::placeholder,textarea::placeholder{color:#334155}select option{background:#1e293b}`}</style>

    {/* Top bar */}
    <div style={{background:"#0a1628",borderBottom:"1px solid #1e293b",padding:"13px 20px",display:"flex",justifyContent:"space-between",alignItems:"center",position:"sticky",top:0,zIndex:10}}>
      <div style={{display:"flex",alignItems:"center",gap:8}}>
        {data.teams&&Object.values(data.teams)[0]?.branding?.logo
          ?<img src={Object.values(data.teams)[0].branding.logo} style={{width:28,height:28,borderRadius:6,objectFit:"cover"}}/>
          :<span style={{fontSize:18,color:primary}}>★</span>}
        <span style={{fontSize:15,fontWeight:800,color:"white"}}>FundCard</span>
      </div>
      <div style={{display:"flex",gap:6}}>
        <button onClick={()=>setScreen("wallet")} style={{padding:"6px 14px",borderRadius:20,border:"none",cursor:"pointer",fontSize:12,fontWeight:600,background:screen==="wallet"?primary:"#1e293b",color:screen==="wallet"?"#0f172a":"#64748b"}}>🎟 My Cards</button>
        <button onClick={()=>setScreen("admin")} style={{padding:"6px 14px",borderRadius:20,border:"none",cursor:"pointer",fontSize:12,fontWeight:600,background:screen==="admin"?"#3b82f6":"#1e293b",color:screen==="admin"?"white":"#64748b"}}>⚙ Admin</button>
      </div>
    </div>

    <div style={{maxWidth:560,margin:"0 auto",padding:"20px 16px 60px"}}>
      {screen==="wallet"&&(
        customerSession
          ?<CustomerWallet data={data} customerEmail={customerSession.email} onLogout={()=>setCustomerSession(null)}/>
          :<CustomerAuth data={data} setData={setData} prefillCardId={urlCardId||""} onLogin={s=>{setCustomerSession(s);setUrlCardId(null);}}/>
      )}
      {screen==="admin"&&(
        !adminSession
          ?<AdminLoginGate data={data} onLogin={s=>setAdminSession(s)}/>
          :adminSession.role==="super"
            ?<SuperAdminView data={data} onDataChange={setData} onLock={()=>setAdminSession(null)}/>
            :teamAdminTeam
              ?<div>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
                  <div><div style={{fontSize:16,fontWeight:800,color:"white"}}>{teamAdminTeam.name}</div><div style={{fontSize:11,color:"#475569"}}>Coach admin</div></div>
                  <button onClick={()=>setAdminSession(null)} style={{padding:"6px 12px",borderRadius:8,border:"1px solid #334155",background:"transparent",color:"#475569",fontSize:11,cursor:"pointer"}}>🔒 Lock</button>
                </div>
                <TeamPanel team={teamAdminTeam} isSuperAdmin={false} onTeamUpdate={updated=>setData({...data,teams:{...data.teams,[updated.id]:updated}})}/>
              </div>
              :<div style={{color:"#ef4444",padding:40,textAlign:"center"}}>Team not found.</div>
      )}
    </div>

    {/* Footer */}
    <div style={{textAlign:"center",padding:"12px 20px 24px",borderTop:"1px solid #1e293b"}}>
      <div style={{fontSize:11,color:"#334155",letterSpacing:1}}>Powered by <span style={{color:"#475569",fontWeight:700}}>L1quid Studios</span></div>
    </div>
  </div>);
}
