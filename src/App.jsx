import { useState, useEffect, useMemo, useCallback } from "react";
import { db, setupNotifications } from "./firebase";
import {
  collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, query, orderBy, serverTimestamp,
} from "firebase/firestore";
import {
  Users, CalendarOff, ClipboardCheck, Fuel, Plus, Trash2, AlertTriangle, Clock,
  Package, Gauge, CalendarDays, LogOut, ShieldCheck, Megaphone, Sun, Sunset, Moon,
  Check, X as XIcon, Play, Square, FileText, Bell, BellRing,
} from "lucide-react";

const REASON_OPTIONS = ["Marriage", "Personal", "Fever", "Other"];
const RATES = [2.5, 2.75];

function todayISO() { const d = new Date(); d.setHours(0,0,0,0); return d.toISOString().slice(0,10); }
function addDaysISO(iso, n) { const d = new Date(iso + "T00:00:00"); d.setDate(d.getDate()+n); return d.toISOString().slice(0,10); }
function fmtDate(iso) { const d = new Date(iso + "T00:00:00"); return d.toLocaleDateString("en-IN",{weekday:"short",day:"2-digit",month:"short"}); }
function monthKey(iso) { return iso.slice(0,7); }
function isSunday(iso) { return new Date(iso + "T00:00:00").getDay() === 0; }
function greeting() {
  const h = new Date().getHours();
  if (h < 12) return { text: "Good Morning", Icon: Sun, color: "#F5A623" };
  if (h < 17) return { text: "Good Afternoon", Icon: Sunset, color: "#F5A623" };
  return { text: "Good Evening", Icon: Moon, color: "#8AA5FF" };
}
function fmtHours(ms) {
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60), m = totalMin % 60;
  return `${h}h ${m}m`;
}

function useCollection(name, sortField) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const q = sortField ? query(collection(db, name), orderBy(sortField, "desc")) : collection(db, name);
    const unsub = onSnapshot(q, (snap) => {
      setData(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setLoading(false);
    }, (err) => { console.error(name, err); setLoading(false); });
    return unsub;
  }, [name, sortField]);
  return [data, loading];
}
const addRec = (col, data) => addDoc(collection(db, col), data);
const updateRec = (col, id, data) => updateDoc(doc(db, col, id), data);
const deleteRec = (col, id) => deleteDoc(doc(db, col, id));

const TABS = [
  { id: "home", label: "Home", icon: Clock },
  { id: "leave", label: "Chutti", icon: CalendarOff },
  { id: "rounds", label: "Rounds", icon: Package },
  { id: "mileage", label: "Mileage", icon: Gauge },
  { id: "myfuel", label: "My Fuel", icon: Fuel },
  { id: "attendance", label: "Attendance", icon: ClipboardCheck },
  { id: "calendar", label: "Calendar", icon: CalendarDays },
  { id: "announcements", label: "News", icon: Megaphone },
  { id: "adminfuel", label: "Company Fuel", icon: Fuel, adminOnly: true },
  { id: "riders", label: "Riders", icon: Users, adminOnly: true },
  { id: "reports", label: "Reports", icon: FileText, adminOnly: true },
];

export default function App() {
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem("riderops_user") || "null"); } catch { return null; }
  });
  const [tab, setTab] = useState("home");

  const [riders, ridersLoading] = useCollection("riders");
  const [leaves] = useCollection("leaves");
  const [attendance] = useCollection("attendance");
  const [rounds] = useCollection("rounds");
  const [odometer] = useCollection("odometer");
  const [personalFuel] = useCollection("personalFuel");
  const [adminFuel] = useCollection("adminFuel");
  const [holidays] = useCollection("holidays");
  const [announcements] = useCollection("announcements", "createdAtMs");
  const [duty] = useCollection("duty");

  useEffect(() => {
    if (!ridersLoading && riders.length === 0) {
      addRec("riders", { name: "Founder", phone: "", role: "founder", pin: "1234" });
    }
  }, [ridersLoading, riders.length]);

  const login = (u) => {
    setUser(u);
    localStorage.setItem("riderops_user", JSON.stringify(u));
  };
  const logout = () => { setUser(null); localStorage.removeItem("riderops_user"); };

  const riderName = (id) => riders.find((r) => r.id === id)?.name || "Unknown";
  const isHoliday = (iso) => isSunday(iso) || holidays.some((h) => h.date === iso);
  const isAdmin = user?.role === "admin" || user?.role === "founder";
  const isFounder = user?.role === "founder";

  if (ridersLoading) {
    return <div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",color:"#7C8592"}} className="font-mono">Connecting to server…</div>;
  }
  if (!user) {
    return <LoginScreen riders={riders} onLogin={login} />;
  }

  const visibleTabs = TABS.filter((t) => !t.adminOnly || isAdmin);

  return (
    <div>
      <header className="app-header">
        <div style={{padding:"14px 16px 10px"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8}}>
            <div style={{minWidth:0}}>
              <h1 className="font-display glow" style={{fontSize:24,fontWeight:800,color:"#F5A623",lineHeight:1}}>RIDER OPS</h1>
              <GreetingLine user={user} />
            </div>
            <button onClick={logout} className="btn-ghost" style={{display:"flex",alignItems:"center",gap:4}}>
              <LogOut size={12}/> Switch
            </button>
          </div>
        </div>
        <nav className="tabs">
          {visibleTabs.map((t) => {
            const Icon = t.icon;
            return (
              <button key={t.id} onClick={()=>setTab(t.id)} className={`tab-btn ${tab===t.id?"active":""}`}>
                <Icon size={14} strokeWidth={2.2}/>{t.label}
              </button>
            );
          })}
        </nav>
      </header>

      <main style={{padding:"16px",paddingBottom:40,maxWidth:640,margin:"0 auto"}}>
        {tab==="home" && <HomeTab user={user} isAdmin={isAdmin} riders={riders} leaves={leaves} rounds={rounds}
          duty={duty} attendance={attendance} isHoliday={isHoliday} setTab={setTab} riderName={riderName}/>}
        {tab==="leave" && <LeaveTab user={user} isAdmin={isAdmin} riders={riders} leaves={leaves} riderName={riderName} isHoliday={isHoliday}/>}
        {tab==="rounds" && <RoundsTab user={user} isAdmin={isAdmin} riders={riders} rounds={rounds} riderName={riderName}/>}
        {tab==="mileage" && <MileageTab user={user} isAdmin={isAdmin} riders={riders} odometer={odometer} riderName={riderName}/>}
        {tab==="myfuel" && <MyFuelTab user={user} personalFuel={personalFuel}/>}
        {tab==="attendance" && <AttendanceTab user={user} isAdmin={isAdmin} riders={riders} attendance={attendance} leaves={leaves}/>}
        {tab==="calendar" && <CalendarTab holidays={holidays} leaves={leaves} riders={riders} user={user} isAdmin={isAdmin} riderName={riderName}/>}
        {tab==="announcements" && <AnnouncementsTab user={user} isAdmin={isAdmin} announcements={announcements}/>}
        {tab==="adminfuel" && isAdmin && <AdminFuelTab riders={riders} adminFuel={adminFuel} riderName={riderName}/>}
        {tab==="riders" && isAdmin && <RidersTab riders={riders} isFounder={isFounder}/>}
        {tab==="reports" && isAdmin && <ReportsTab riders={riders} leaves={leaves} rounds={rounds} odometer={odometer}
          adminFuel={adminFuel} personalFuel={personalFuel} attendance={attendance} riderName={riderName}/>}
      </main>
    </div>
  );
}

function GreetingLine({ user }) {
  const { text, Icon, color } = greeting();
  return (
    <p style={{fontSize:11,color:"#B9C0CA",marginTop:4,display:"flex",alignItems:"center",gap:4}}>
      <Icon size={12} style={{color}}/> {text}, <span style={{fontWeight:600,color:"#EDEAE1"}}>{user.name}</span>
      {user.role !== "rider" && (
        <span className="badge" style={{background:"rgba(138,165,255,0.15)",color:"#8AA5FF",display:"flex",alignItems:"center",gap:3}}>
          <ShieldCheck size={9}/> {user.role}
        </span>
      )}
    </p>
  );
}

function LoginScreen({ riders, onLogin }) {
  const [pinFor, setPinFor] = useState(null);
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");
  const { text, Icon, color } = greeting();

  const tryLogin = (r) => {
    if (r.role === "rider") { onLogin({ id: r.id, name: r.name, role: r.role }); return; }
    setPinFor(r); setPin(""); setErr("");
  };
  const confirmPin = () => {
    if (pin === (pinFor.pin || "1234")) onLogin({ id: pinFor.id, name: pinFor.name, role: pinFor.role });
    else setErr("Galat PIN.");
  };

  return (
    <div style={{minHeight:"100vh",display:"flex",flexDirection:"column",justifyContent:"center",padding:"0 20px"}}>
      <div style={{textAlign:"center",marginBottom:24}}>
        <h1 className="font-display glow" style={{fontSize:30,fontWeight:800,color:"#F5A623"}}>RIDER OPS</h1>
        <p style={{fontSize:12,color:"#7C8592",marginTop:4,display:"flex",alignItems:"center",justifyContent:"center",gap:4}}>
          <Icon size={12} style={{color}}/> {text}
        </p>
      </div>

      {!pinFor ? (
        <div style={{maxWidth:360,margin:"0 auto",width:"100%",display:"flex",flexDirection:"column",gap:8}}>
          <p style={{fontSize:11,color:"#7C8592",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:4}}>Apna naam chuno</p>
          {riders.map((r) => (
            <button key={r.id} onClick={()=>tryLogin(r)} className="card" style={{textAlign:"left",cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <span style={{fontWeight:600,fontSize:14}}>{r.name}</span>
              {r.role !== "rider" && <span className="badge badge-pending">{r.role}</span>}
            </button>
          ))}
        </div>
      ) : (
        <div style={{maxWidth:360,margin:"0 auto",width:"100%",display:"flex",flexDirection:"column",gap:10}}>
          <p style={{fontSize:11,color:"#7C8592",textTransform:"uppercase",letterSpacing:"0.08em"}}>PIN for {pinFor.name}</p>
          <input type="password" value={pin} onChange={(e)=>{setPin(e.target.value);setErr("");}} placeholder="PIN"
            className="input font-mono" style={{textAlign:"center",letterSpacing:"0.3em"}}/>
          {err && <p style={{fontSize:11,color:"#E5484D"}}>{err}</p>}
          <button onClick={confirmPin} className="btn-primary">Login</button>
          <button onClick={()=>setPinFor(null)} style={{background:"none",border:"none",color:"#7C8592",fontSize:12,cursor:"pointer"}}>← Wapas</button>
        </div>
      )}
    </div>
  );
}

function HomeTab({ user, isAdmin, riders, leaves, rounds, duty, attendance, isHoliday, setTab, riderName }) {
  const today = todayISO();
  const [notifStatus, setNotifStatus] = useState(
    typeof Notification !== "undefined" ? Notification.permission : "unsupported"
  );
  const enableNotifs = async () => {
    const res = await setupNotifications(user.id);
    setNotifStatus(res.ok ? "granted" : (typeof Notification !== "undefined" ? Notification.permission : "denied"));
  };
  const myDuty = duty.find((d) => d.riderId === user.id && d.date === today);
  const [, forceTick] = useState(0);
  useEffect(() => {
    if (myDuty && !myDuty.endTime) {
      const t = setInterval(() => forceTick((x) => x + 1), 60000);
      return () => clearInterval(t);
    }
  }, [myDuty]);

  const startDuty = () => addRec("duty", { riderId: user.id, date: today, startTime: Date.now(), endTime: null });
  const endDuty = () => updateRec("duty", myDuty.id, { endTime: Date.now() });

  const myRoundsToday = rounds.filter((r) => r.riderId === user.id && r.date === today);
  const todayDelivered = myRoundsToday.reduce((s, r) => s + (r.deliveredFinal ?? r.deliveryCount ?? 0), 0);
  const todayPickup = myRoundsToday.reduce((s, r) => s + (r.pickupCount ?? 0), 0);
  const myStatus = attendance.find((a) => a.riderId === user.id && a.date === today)?.status;
  const onLeaveToday = leaves.find((l) => l.riderId === user.id && l.date === today && l.status === "approved");

  const tomorrow = addDaysISO(today, 1);
  const leavesTomorrow = leaves.filter((l) => l.date === tomorrow && l.status === "approved");

  return (
    <div style={{display:"flex",flexDirection:"column",gap:16}}>
      {notifStatus !== "granted" && notifStatus !== "unsupported" && (
        <button onClick={enableNotifs} className="card" style={{display:"flex",alignItems:"center",gap:10,cursor:"pointer",border:"1px solid rgba(245,166,35,0.4)",background:"rgba(245,166,35,0.08)",width:"100%",textAlign:"left"}}>
          <Bell size={18} color="#F5A623"/>
          <div>
            <div style={{fontSize:13,fontWeight:600,color:"#F5A623"}}>Notifications On Karo</div>
            <div style={{fontSize:11,color:"#B9C0CA"}}>Chutti reminder seedha phone pe pane ke liye tap karo.</div>
          </div>
        </button>
      )}
      {notifStatus === "granted" && (
        <div className="card" style={{display:"flex",alignItems:"center",gap:8,fontSize:12,color:"#3DDC97"}}>
          <BellRing size={15}/> Notifications ON hain.
        </div>
      )}
      {!isAdmin && (
        <div className="card">
          <div className="section-label">Duty Status</div>
          {onLeaveToday ? (
            <p style={{fontSize:14,color:"#E5484D"}}>Aap aaj chutti par hain.</p>
          ) : myDuty && !myDuty.endTime ? (
            <>
              <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:28,color:"#3DDC97"}}>{fmtHours(Date.now()-myDuty.startTime)}</div>
              <div style={{fontSize:11,color:"#7C8592",marginBottom:10}}>duty pe ho since {new Date(myDuty.startTime).toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"})}</div>
              <button onClick={endDuty} className="btn-primary" style={{background:"#E5484D",display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>
                <Square size={14}/> End Duty
              </button>
            </>
          ) : myDuty && myDuty.endTime ? (
            <p style={{fontSize:14,color:"#7C8592"}}>Aaj duty complete — {fmtHours(myDuty.endTime-myDuty.startTime)} kaam kiya.</p>
          ) : (
            <button onClick={startDuty} className="btn-primary" style={{display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>
              <Play size={14}/> Start Duty
            </button>
          )}
        </div>
      )}

      <div className="stat-grid">
        <StatCard label="Today Delivered" value={todayDelivered} color="#3DDC97"/>
        <StatCard label="Today Pickup" value={todayPickup} color="#F5A623"/>
      </div>

      {myStatus && (
        <div className="card" style={{fontSize:13}}>
          Aaj ka attendance: <span className="badge" style={{background: myStatus==="present"?"rgba(61,220,151,0.15)":myStatus==="late"?"rgba(245,166,35,0.15)":"rgba(229,72,77,0.15)", color: myStatus==="present"?"#3DDC97":myStatus==="late"?"#F5A623":"#E5484D"}}>{myStatus}</span>
        </div>
      )}

      {leavesTomorrow.length > 0 && (
        <div className="card" style={{borderColor:"rgba(245,166,35,0.4)",background:"rgba(245,166,35,0.08)"}}>
          <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:8}}>
            <AlertTriangle size={15} color="#F5A623"/>
            <span className="font-display" style={{fontSize:13,fontWeight:700,color:"#F5A623"}}>REMINDER — KAL CHUTTI PE</span>
          </div>
          {leavesTomorrow.map((l) => (
            <div key={l.id} style={{fontSize:13}}><b>{riderName(l.riderId)}</b> — {l.customReason || l.reason}</div>
          ))}
        </div>
      )}

      {isHoliday(tomorrow) && (
        <div className="card" style={{borderColor:"rgba(138,165,255,0.4)",background:"rgba(138,165,255,0.08)",color:"#8AA5FF",fontSize:13}}>
          Kal ({fmtDate(tomorrow)}) holiday hai.
        </div>
      )}

      {isAdmin && (
        <div className="stat-grid">
          <StatCard label="Total Riders" value={riders.filter(r=>r.role==="rider").length} color="#3DDC97"/>
          <StatCard label="Pending Leaves" value={leaves.filter(l=>l.status==="pending").length} color="#F5A623"/>
        </div>
      )}

      <button onClick={()=>setTab("leave")} className="btn-ghost" style={{width:"100%",padding:10}}>Go to Chutti / Leave →</button>
    </div>
  );
}
function StatCard({ label, value, color }) {
  return (
    <div className="card">
      <div className="font-mono" style={{fontSize:24,color}}>{value}</div>
      <div style={{fontSize:11,color:"#7C8592",textTransform:"uppercase",letterSpacing:"0.05em",marginTop:2}}>{label}</div>
    </div>
  );
}

function LeaveTab({ user, isAdmin, riders, leaves, riderName, isHoliday }) {
  const [date, setDate] = useState(todayISO());
  const [reason, setReason] = useState(REASON_OPTIONS[0]);
  const [customReason, setCustomReason] = useState("");
  const [halfDay, setHalfDay] = useState(false);

  const submit = async () => {
    if (reason === "Other" && !customReason.trim()) return;
    await addRec("leaves", {
      riderId: user.id, date, reason, customReason: reason==="Other"?customReason.trim():"",
      halfDay, status: "pending", createdAtMs: Date.now(),
    });
    setCustomReason(""); setHalfDay(false);
  };
  const decide = (id, status) => updateRec("leaves", id, { status, decidedBy: user.name });
  const remove = (id) => deleteRec("leaves", id);

  const sorted = [...leaves].sort((a,b)=> (a.date > b.date ? 1 : -1)).reverse();
  const badgeClass = (s) => s==="approved"?"badge-approved":s==="rejected"?"badge-rejected":"badge-pending";

  return (
    <div style={{display:"flex",flexDirection:"column",gap:16}}>
      <div className="card" style={{display:"flex",flexDirection:"column",gap:10}}>
        <div className="section-label">Chutti Request Bhejo</div>
        <input type="date" value={date} min={todayISO()} onChange={(e)=>setDate(e.target.value)} className="input font-mono"/>
        {isHoliday(date) && <p style={{fontSize:11,color:"#8AA5FF"}}>Yeh date pehle se holiday hai.</p>}
        <select value={reason} onChange={(e)=>setReason(e.target.value)} className="input">
          {REASON_OPTIONS.map(r=><option key={r} value={r}>{r}</option>)}
        </select>
        {reason==="Other" && <input value={customReason} onChange={(e)=>setCustomReason(e.target.value)} placeholder="Apna reason likho" className="input"/>}
        <label style={{display:"flex",alignItems:"center",gap:8,fontSize:13,color:"#B9C0CA"}}>
          <input type="checkbox" checked={halfDay} onChange={(e)=>setHalfDay(e.target.checked)}/> Half-day / late aayega
        </label>
        <button onClick={submit} disabled={reason==="Other" && !customReason.trim()} className="btn-primary" style={{display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>
          <Plus size={15}/> Request Bhejo
        </button>
