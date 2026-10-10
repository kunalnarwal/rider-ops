import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { db, setupNotifications } from "./firebase";
import {
  collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, query, orderBy, serverTimestamp, setDoc,
} from "firebase/firestore";
import {
  Users, CalendarOff, ClipboardCheck, Fuel, Plus, Trash2, AlertTriangle, Clock,
  Package, Gauge, CalendarDays, LogOut, ShieldCheck, Megaphone, Sun, Sunset, Moon,
  Check, X as XIcon, Play, Square, FileText, Bell, BellRing, Pencil, ScanLine, Moon as MoonIcon, Timer,
} from "lucide-react";

const REASON_OPTIONS = ["Marriage", "Personal", "Fever", "Other"];
const RATES = [2.5, 2.75];

function festivalSeedForYear(year) {
  return [
    { date: `${year}-01-01`, name: "New Year's Day" },
    { date: `${year}-01-14`, name: "Makar Sankranti / Pongal" },
    { date: `${year}-01-26`, name: "Republic Day" },
    { date: `${year}-02-15`, name: "Maha Shivratri" },
    { date: `${year}-03-04`, name: "Holi" },
    { date: `${year}-03-20`, name: "Eid-ul-Fitr" },
    { date: `${year}-03-26`, name: "Ram Navami" },
    { date: `${year}-03-29`, name: "Gudi Padwa / Ugadi (Hindu Nav Varsh)" },
    { date: `${year}-04-03`, name: "Good Friday" },
    { date: `${year}-04-14`, name: "Dr. Ambedkar Jayanti" },
    { date: `${year}-05-01`, name: "Labour Day" },
    { date: `${year}-05-27`, name: "Eid-ul-Adha (Bakrid)" },
    { date: `${year}-06-16`, name: "Muharram" },
    { date: `${year}-08-15`, name: "Independence Day" },
    { date: `${year}-08-28`, name: "Raksha Bandhan" },
    { date: `${year}-09-04`, name: "Janmashtami" },
    { date: `${year}-09-14`, name: "Ganesh Chaturthi" },
    { date: `${year}-10-02`, name: "Gandhi Jayanti" },
    { date: `${year}-10-11`, name: "Navratri Begins" },
    { date: `${year}-10-20`, name: "Dussehra" },
    { date: `${year}-11-08`, name: "Diwali" },
    { date: `${year}-11-10`, name: "Bhai Dooj" },
    { date: `${year}-11-24`, name: "Guru Nanak Jayanti" },
    { date: `${year}-12-25`, name: "Christmas" },
  ];
}
function vikramSamvat(gregYear, month) { return month < 3 ? gregYear + 56 : gregYear + 57; }
function sakaSamvat(gregYear, month) { return month < 3 ? gregYear - 79 : gregYear - 78; }

function distanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}
function getCurrentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error("Geolocation not supported")); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => reject(err),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  });
}

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
const setRec = (col, id, data) => setDoc(doc(db, col, id), data);

const TABS = [
  { id: "home", label: "Home", icon: Clock },
  { id: "leave", label: "Leave", icon: CalendarOff },
  { id: "rounds", label: "Rounds", icon: Package },
  { id: "mileage", label: "Mileage", icon: Gauge },
  { id: "myfuel", label: "My Fuel", icon: Fuel },
  { id: "attendance", label: "Attendance", icon: ClipboardCheck },
  { id: "calendar", label: "Calendar", icon: CalendarDays },
  { id: "panchang", label: "Panchang", icon: MoonIcon },
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
  const [editingProfile, setEditingProfile] = useState(false);
  const [showUnseenAnnouncements, setShowUnseenAnnouncements] = useState(false);
  const [unseenList, setUnseenList] = useState([]);

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
  const [lateNotices] = useCollection("lateNotices");
  const [settings] = useCollection("settings");
  const officeSetting = settings.find((s) => s.id === "office" || s.type === "office");

  useEffect(() => {
    if (!ridersLoading && riders.length === 0) {
      addRec("riders", { name: "Founder", phone: "", role: "founder", pin: "1234" });
    }
  }, [ridersLoading, riders.length]);

  useEffect(() => {
    if (!user || announcements.length === 0) return;
    const lastSeen = Number(localStorage.getItem("riderops_lastSeenAnn") || 0);
    const unseen = announcements.filter((a) => (a.createdAtMs || 0) > lastSeen);
    if (unseen.length > 0) {
      setUnseenList(unseen);
      setShowUnseenAnnouncements(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, announcements.length]);

  const dismissAnnouncements = () => {
    const latest = Math.max(0, ...announcements.map((a) => a.createdAtMs || 0));
    localStorage.setItem("riderops_lastSeenAnn", String(latest));
    setShowUnseenAnnouncements(false);
  };

  useEffect(() => {
    const year = new Date().getFullYear();
    const alreadySeeded = holidays.some((h) => h.seedYear === year);
    if (!alreadySeeded && holidays.length >= 0) {
      const existingDates = new Set(holidays.map((h) => h.date));
      const toAdd = festivalSeedForYear(year).filter((f) => !existingDates.has(f.date));
      toAdd.forEach((f) => addRec("holidays", { ...f, seedYear: year, source: "auto" }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holidays.length]);

  const login = (u) => {
    setUser(u);
    localStorage.setItem("riderops_user", JSON.stringify(u));
  };
  const logout = () => { setUser(null); localStorage.removeItem("riderops_user"); };
  const saveProfile = async (updates) => {
    await updateRec("riders", user.id, updates);
    const newUser = { ...user, name: updates.name ?? user.name };
    setUser(newUser);
    localStorage.setItem("riderops_user", JSON.stringify(newUser));
    setEditingProfile(false);
  };

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
            <div style={{display:"flex",gap:6,flexShrink:0}}>
              <button onClick={()=>setEditingProfile(true)} className="btn-ghost" style={{display:"flex",alignItems:"center",gap:4}}>
                <Pencil size={12}/> Edit
              </button>
              <button onClick={logout} className="btn-ghost" style={{display:"flex",alignItems:"center",gap:4}}>
                <LogOut size={12}/> Switch
              </button>
            </div>
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
          duty={duty} attendance={attendance} isHoliday={isHoliday} setTab={setTab} riderName={riderName}
          lateNotices={lateNotices} officeSetting={officeSetting}/>}
        {tab==="leave" && <LeaveTab user={user} isAdmin={isAdmin} riders={riders} leaves={leaves} riderName={riderName} isHoliday={isHoliday}/>}
        {tab==="rounds" && <RoundsTab user={user} isAdmin={isAdmin} riders={riders} rounds={rounds} riderName={riderName}/>}
        {tab==="mileage" && <MileageTab user={user} isAdmin={isAdmin} riders={riders} odometer={odometer} riderName={riderName}/>}
        {tab==="myfuel" && <MyFuelTab user={user} personalFuel={personalFuel}/>}
        {tab==="attendance" && <AttendanceTab user={user} isAdmin={isAdmin} riders={riders} attendance={attendance} leaves={leaves}/>}
        {tab==="calendar" && <CalendarTab holidays={holidays} leaves={leaves} riders={riders} user={user} isAdmin={isAdmin} riderName={riderName}/>}
        {tab==="panchang" && <PanchangTab/>}
        {tab==="announcements" && <AnnouncementsTab user={user} isAdmin={isAdmin} announcements={announcements}/>}
        {tab==="adminfuel" && isAdmin && <AdminFuelTab riders={riders} adminFuel={adminFuel} riderName={riderName}/>}
        {tab==="riders" && isAdmin && <RidersTab riders={riders} isFounder={isFounder} officeSetting={officeSetting}/>}
        {tab==="reports" && isAdmin && <ReportsTab riders={riders} leaves={leaves} rounds={rounds} odometer={odometer}
          adminFuel={adminFuel} personalFuel={personalFuel} attendance={attendance} riderName={riderName} duty={duty}/>}
      </main>

      {editingProfile && (
        <EditProfileModal user={user} riders={riders} onSave={saveProfile} onClose={()=>setEditingProfile(false)} />
      )}

      {showUnseenAnnouncements && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.75)",display:"flex",alignItems:"center",justifyContent:"center",padding:20,zIndex:70}}>
          <div className="card" style={{maxWidth:360,width:"100%",display:"flex",flexDirection:"column",gap:12}}>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <Megaphone size={18} color="#F5A623"/>
              <div className="font-display" style={{fontSize:16,fontWeight:700,color:"#F5A623"}}>
                New Announcement{unseenList.length>1?"s":""}
              </div>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:10,maxHeight:300,overflowY:"auto"}}>
              {unseenList.map((a)=>(
                <div key={a.id} style={{background:"#101317",border:"1px solid #2A3038",borderRadius:8,padding:10}}>
                  <div style={{fontSize:13}}>{a.text}</div>
                  <div style={{fontSize:10,color:"#5B6270",marginTop:4}} className="font-mono">— {a.createdBy} · {new Date(a.createdAtMs).toLocaleDateString("en-IN")}</div>
                </div>
              ))}
            </div>
            <button onClick={dismissAnnouncements} className="btn-primary">Got It</button>
          </div>
        </div>
      )}
    </div>
  );
}

function EditProfileModal({ user, riders, onSave, onClose }) {
  const me = riders.find((r) => r.id === user.id);
  const [name, setName] = useState(me?.name || user.name);
  const [phone, setPhone] = useState(me?.phone || "");
  const [pin, setPin] = useState(me?.pin || "");
  const isPrivileged = user.role === "admin" || user.role === "founder";

  const save = () => {
    if (!name.trim()) return;
    const updates = { name: name.trim(), phone: phone.trim() };
    if (isPrivileged) updates.pin = pin.trim() || "1234";
    onSave(updates);
  };

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.7)",display:"flex",alignItems:"center",justifyContent:"center",padding:20,zIndex:50}}>
      <div className="card" style={{maxWidth:360,width:"100%",display:"flex",flexDirection:"column",gap:12}}>
        <div className="section-label">Edit Profile</div>
        <div>
          <label style={{fontSize:10,color:"#7C8592",textTransform:"uppercase"}}>Name</label>
          <input value={name} onChange={(e)=>setName(e.target.value)} className="input" style={{marginTop:4}}/>
        </div>
        <div>
          <label style={{fontSize:10,color:"#7C8592",textTransform:"uppercase"}}>Phone (optional)</label>
          <input value={phone} onChange={(e)=>setPhone(e.target.value)} className="input font-mono" style={{marginTop:4}}/>
        </div>
        {isPrivileged && (
          <div>
            <label style={{fontSize:10,color:"#7C8592",textTransform:"uppercase"}}>PIN</label>
            <input value={pin} onChange={(e)=>setPin(e.target.value)} placeholder="1234" className="input font-mono" style={{marginTop:4}}/>
          </div>
        )}
        <button onClick={save} disabled={!name.trim()} className="btn-primary">Save Changes</button>
        <button onClick={onClose} style={{background:"none",border:"none",color:"#7C8592",fontSize:12,cursor:"pointer"}}>Cancel</button>
      </div>
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
    setPinFor(r); setPin(""); setErr("");
  };
  const confirmPin = () => {
    if (pin === (pinFor.pin || "1234")) onLogin({ id: pinFor.id, name: pinFor.name, role: pinFor.role });
    else setErr("Incorrect PIN.");
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
          <p style={{fontSize:11,color:"#7C8592",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:4}}>Choose your name</p>
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
          <button onClick={()=>setPinFor(null)} style={{background:"none",border:"none",color:"#7C8592",fontSize:12,cursor:"pointer"}}>← Back</button>
        </div>
      )}
    </div>
  );
}

function HomeTab({ user, isAdmin, riders, leaves, rounds, duty, attendance, isHoliday, setTab, riderName, lateNotices, officeSetting }) {
  const today = todayISO();
  const [locError, setLocError] = useState("");
  const [checkingLoc, setCheckingLoc] = useState(false);
  const tomorrow0 = addDaysISO(today, 1);
  const [showLateForm, setShowLateForm] = useState(false);
  const [lateDate, setLateDate] = useState(tomorrow0);
  const [lateFrom, setLateFrom] = useState("");
  const [lateTo, setLateTo] = useState("");
  const submitLate = async () => {
    if (!lateFrom || !lateTo) return;
    await addRec("lateNotices", { riderId: user.id, date: lateDate, fromTime: lateFrom, toTime: lateTo, createdAtMs: Date.now() });
    setShowLateForm(false); setLateFrom(""); setLateTo("");
  };
  const lateTomorrow = lateNotices.filter((n) => n.date === tomorrow0);
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

  const startDuty = async () => {
    setLocError("");
    if (officeSetting?.lat != null) {
      setCheckingLoc(true);
      try {
        const pos = await getCurrentPosition();
        const dist = distanceMeters(pos.lat, pos.lng, officeSetting.lat, officeSetting.lng);
        const radius = officeSetting.radius || 200;
        if (dist > radius) {
          setCheckingLoc(false);
          setLocError(`You're ${Math.round(dist)}m from the office — must be within ${radius}m to start duty.`);
          return;
        }
      } catch (e) {
        setCheckingLoc(false);
        setLocError("Couldn't verify your location. Please enable location access and try again.");
        return;
      }
      setCheckingLoc(false);
    }
    addRec("duty", { riderId: user.id, date: today, startTime: Date.now(), endTime: null });
  };
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
            <div style={{fontSize:13,fontWeight:600,color:"#F5A623"}}>Enable Notifications</div>
            <div style={{fontSize:11,color:"#B9C0CA"}}>Tap to get leave reminders directly on your phone.</div>
          </div>
        </button>
      )}
      {notifStatus === "granted" && (
        <div className="card" style={{display:"flex",alignItems:"center",gap:8,fontSize:12,color:"#3DDC97"}}>
          <BellRing size={15}/> Notifications are ON.
        </div>
      )}
      {!isAdmin && (
        <div className="card">
          <div className="section-label">Duty Status</div>
          {onLeaveToday ? (
            <p style={{fontSize:14,color:"#E5484D"}}>You are on leave today.</p>
          ) : myDuty && !myDuty.endTime ? (
            <>
              <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:28,color:"#3DDC97"}}>{fmtHours(Date.now()-myDuty.startTime)}</div>
              <div style={{fontSize:11,color:"#7C8592",marginBottom:10}}>On duty since {new Date(myDuty.startTime).toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"})}</div>
              <button onClick={endDuty} className="btn-primary" style={{background:"#E5484D",display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>
                <Square size={14}/> End Duty
              </button>
            </>
          ) : myDuty && myDuty.endTime ? (
            <p style={{fontSize:14,color:"#7C8592"}}>Duty completed today — worked {fmtHours(myDuty.endTime-myDuty.startTime)}.</p>
          ) : (
            <>
              <button onClick={startDuty} disabled={checkingLoc} className="btn-primary" style={{display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>
                <Play size={14}/> {checkingLoc ? "Checking location…" : "Start Duty"}
              </button>
              {locError && <p style={{fontSize:11,color:"#E5484D",marginTop:8}}>{locError}</p>}
              {officeSetting?.lat != null && <p style={{fontSize:10,color:"#5B6270",marginTop:6}}>Must be within {officeSetting.radius || 200}m of the office to start duty.</p>}
            </>
          )}
        </div>
      )}

      <div className="stat-grid">
        <StatCard label="Today Delivered" value={todayDelivered} color="#3DDC97"/>
        <StatCard label="Today Pickup" value={todayPickup} color="#F5A623"/>
      </div>

      {myStatus && (
        <div className="card" style={{fontSize:13}}>
          Today's attendance: <span className="badge" style={{background: myStatus==="present"?"rgba(61,220,151,0.15)":myStatus==="late"?"rgba(245,166,35,0.15)":"rgba(229,72,77,0.15)", color: myStatus==="present"?"#3DDC97":myStatus==="late"?"#F5A623":"#E5484D"}}>{myStatus}</span>
        </div>
      )}

      {leavesTomorrow.length > 0 && (
        <div className="card" style={{borderColor:"rgba(245,166,35,0.4)",background:"rgba(245,166,35,0.08)"}}>
          <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:8}}>
            <AlertTriangle size={15} color="#F5A623"/>
            <span className="font-display" style={{fontSize:13,fontWeight:700,color:"#F5A623"}}>REMINDER — ON LEAVE TOMORROW</span>
          </div>
          {leavesTomorrow.map((l) => (
            <div key={l.id} style={{fontSize:13}}><b>{riderName(l.riderId)}</b> — {l.customReason || l.reason}</div>
          ))}
        </div>
      )}

      {isHoliday(tomorrow) && (
        <div className="card" style={{borderColor:"rgba(138,165,255,0.4)",background:"rgba(138,165,255,0.08)",color:"#8AA5FF",fontSize:13}}>
          Tomorrow ({fmtDate(tomorrow)}) is a holiday.
        </div>
      )}

      {lateTomorrow.length > 0 && (
        <div className="card" style={{borderColor:"rgba(138,165,255,0.4)",background:"rgba(138,165,255,0.08)"}}>
          <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:8}}>
            <Timer size={15} color="#8AA5FF"/>
            <span className="font-display" style={{fontSize:13,fontWeight:700,color:"#8AA5FF"}}>LATE TOMORROW</span>
          </div>
          {lateTomorrow.map((n) => (
            <div key={n.id} style={{fontSize:13}}><b>{riderName(n.riderId)}</b> — {n.fromTime} to {n.toTime}</div>
          ))}
        </div>
      )}

      {!isAdmin && !showLateForm && (
        <button onClick={()=>setShowLateForm(true)} className="btn-ghost" style={{width:"100%",padding:10,display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>
          <Timer size={14}/> I'll Be Late Tomorrow
        </button>
      )}
      {showLateForm && (
        <div className="card" style={{display:"flex",flexDirection:"column",gap:10}}>
          <div className="section-label">Report Late Arrival</div>
          <input type="date" value={lateDate} min={today} onChange={(e)=>setLateDate(e.target.value)} className="input font-mono"/>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            <div>
              <label style={{fontSize:10,color:"#7C8592",textTransform:"uppercase"}}>From</label>
              <input type="time" value={lateFrom} onChange={(e)=>setLateFrom(e.target.value)} className="input font-mono" style={{marginTop:4}}/>
            </div>
            <div>
              <label style={{fontSize:10,color:"#7C8592",textTransform:"uppercase"}}>To</label>
              <input type="time" value={lateTo} onChange={(e)=>setLateTo(e.target.value)} className="input font-mono" style={{marginTop:4}}/>
            </div>
          </div>
          <button onClick={submitLate} disabled={!lateFrom||!lateTo} className="btn-primary">Submit — Visible to All Riders</button>
          <button onClick={()=>setShowLateForm(false)} style={{background:"none",border:"none",color:"#7C8592",fontSize:12,cursor:"pointer"}}>Cancel</button>
        </div>
      )}

      {isAdmin && (
        <div className="stat-grid">
          <StatCard label="Total Riders" value={riders.filter(r=>r.role==="rider").length} color="#3DDC97"/>
          <StatCard label="Pending Leaves" value={leaves.filter(l=>l.status==="pending").length} color="#F5A623"/>
        </div>
      )}

      <button onClick={()=>setTab("leave")} className="btn-ghost" style={{width:"100%",padding:10}}>Go to Leave →</button>
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
  const [halfDayPeriod, setHalfDayPeriod] = useState("Morning");
  const [halfDayFrom, setHalfDayFrom] = useState("");
  const [halfDayTo, setHalfDayTo] = useState("");

  const submit = async () => {
    if (reason === "Other" && !customReason.trim()) return;
    await addRec("leaves", {
      riderId: user.id, date, reason, customReason: reason==="Other"?customReason.trim():"",
      halfDay, halfDayPeriod: halfDay?halfDayPeriod:"", halfDayFrom: halfDay?halfDayFrom:"", halfDayTo: halfDay?halfDayTo:"",
      status: "pending", createdAtMs: Date.now(),
    });
    setCustomReason(""); setHalfDay(false); setHalfDayFrom(""); setHalfDayTo("");
  };
  const decide = (id, status) => updateRec("leaves", id, { status, decidedBy: user.name });
  const remove = (id) => deleteRec("leaves", id);

  const sorted = [...leaves].sort((a,b)=> (a.date > b.date ? 1 : -1)).reverse();
  const badgeClass = (s) => s==="approved"?"badge-approved":s==="rejected"?"badge-rejected":"badge-pending";

  return (
    <div style={{display:"flex",flexDirection:"column",gap:16}}>
      <div className="card" style={{display:"flex",flexDirection:"column",gap:10}}>
        <div className="section-label">Submit Leave Request</div>
        <input type="date" value={date} min={todayISO()} onChange={(e)=>setDate(e.target.value)} className="input font-mono"/>
        {isHoliday(date) && <p style={{fontSize:11,color:"#8AA5FF"}}>This date is already a holiday.</p>}
        <select value={reason} onChange={(e)=>setReason(e.target.value)} className="input">
          {REASON_OPTIONS.map(r=><option key={r} value={r}>{r}</option>)}
        </select>
        {reason==="Other" && <input value={customReason} onChange={(e)=>setCustomReason(e.target.value)} placeholder="Enter your reason" className="input"/>}
        <label style={{display:"flex",alignItems:"center",gap:8,fontSize:13,color:"#B9C0CA"}}>
          <input type="checkbox" checked={halfDay} onChange={(e)=>setHalfDay(e.target.checked)}/> Half-day (specify time below)
        </label>
        {halfDay && (
          <div style={{display:"flex",flexDirection:"column",gap:8,paddingLeft:4,borderLeft:"2px solid #2A3038"}}>
            <select value={halfDayPeriod} onChange={(e)=>setHalfDayPeriod(e.target.value)} className="input">
              <option value="Morning">Morning</option>
              <option value="Evening">Evening</option>
            </select>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
              <div>
                <label style={{fontSize:10,color:"#7C8592",textTransform:"uppercase"}}>From</label>
                <input type="time" value={halfDayFrom} onChange={(e)=>setHalfDayFrom(e.target.value)} className="input font-mono" style={{marginTop:4}}/>
              </div>
              <div>
                <label style={{fontSize:10,color:"#7C8592",textTransform:"uppercase"}}>To</label>
                <input type="time" value={halfDayTo} onChange={(e)=>setHalfDayTo(e.target.value)} className="input font-mono" style={{marginTop:4}}/>
              </div>
            </div>
          </div>
        )}
        <button onClick={submit} disabled={reason==="Other" && !customReason.trim()} className="btn-primary" style={{display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>
          <Plus size={15}/> Submit Request
        </button>
        <p style={{fontSize:11,color:"#7C8592"}}>The request will show as "pending" to everyone until admin approves or rejects it.</p>
      </div>

      <div>
        <div className="section-label">All Leave Requests</div>
        <div className="list-card">
          {sorted.length===0 ? <div style={{padding:16,fontSize:13,color:"#7C8592"}}>No leave records yet.</div> :
            sorted.map((l)=>(
              <div key={l.id} className="list-row">
                <div style={{minWidth:0}}>
                  <div style={{fontSize:13,fontWeight:600,display:"flex",alignItems:"center",gap:6}}>
                    {riderName(l.riderId)}
                    <span className={`badge ${badgeClass(l.status)}`}>{l.status}</span>
                    {l.halfDay && <span className="badge badge-pending">half-day</span>}
                  </div>
                  <div style={{fontSize:11,color:"#7C8592"}}>{fmtDate(l.date)} · {l.customReason || l.reason}</div>
                  {l.halfDay && l.halfDayFrom && (
                    <div style={{fontSize:10,color:"#8AA5FF"}} className="font-mono">{l.halfDayPeriod}: {l.halfDayFrom} – {l.halfDayTo}</div>
                  )}
                </div>
                <div style={{display:"flex",gap:6,flexShrink:0}}>
                  {isAdmin && l.status==="pending" && (
                    <>
                      <button onClick={()=>decide(l.id,"approved")} style={{background:"none",border:"none",color:"#3DDC97",cursor:"pointer"}}><Check size={16}/></button>
                      <button onClick={()=>decide(l.id,"rejected")} style={{background:"none",border:"none",color:"#E5484D",cursor:"pointer"}}><XIcon size={16}/></button>
                    </>
                  )}
                  {(isAdmin || l.riderId===user.id) && (
                    <button onClick={()=>remove(l.id)} style={{background:"none",border:"none",color:"#7C8592",cursor:"pointer"}}><Trash2 size={14}/></button>
                  )}
                </div>
              </div>
            ))
          }
        </div>
      </div>
    </div>
  );
}

function RoundsTab({ user, isAdmin, riders, rounds, riderName }) {
  const [viewRiderId, setViewRiderId] = useState(isAdmin ? (riders.find(r=>r.role==="rider")?.id || "") : user.id);
  const [date, setDate] = useState(todayISO());
  const [drs, setDrs] = useState("");
  const [deliveryCount, setDeliveryCount] = useState("");
  const [closingRound, setClosingRound] = useState(null);
  const [returnedInput, setReturnedInput] = useState("");
  const [hadReturns, setHadReturns] = useState(null);
  const [hadPickup, setHadPickup] = useState(null);
  const [pickupInput, setPickupInput] = useState("");
  const [scanning, setScanning] = useState(false);

  const targetId = isAdmin ? viewRiderId : user.id;
  const myRoundsToday = useMemo(()=> rounds.filter(r=>r.riderId===targetId && r.date===date).sort((a,b)=>a.roundNumber-b.roundNumber), [rounds, targetId, date]);
  const openRound = myRoundsToday.find(r=>!r.closed);
  const canAddNew = !openRound;

  const startRound = async () => {
    if (!drs.trim() || !deliveryCount) return;
    const nextNum = myRoundsToday.length + 1;
    await addRec("rounds", {
      riderId: targetId, date, roundNumber: nextNum, drsNumber: drs.trim(),
      deliveryCount: parseInt(deliveryCount,10), closed:false, pickupCount:null, returnedCount:null, deliveredFinal:null,
    });
    setDrs(""); setDeliveryCount("");
  };

  const openCloseModal = (r) => { setClosingRound(r); setHadReturns(null); setHadPickup(null); setReturnedInput(""); setPickupInput(""); };
  const confirmClose = async () => {
    if (hadReturns === null || hadPickup === null) return;
    const returned = hadReturns ? (parseInt(returnedInput,10) || 0) : 0;
    const pickup = hadPickup ? (parseInt(pickupInput,10) || 0) : 0;
    await updateRec("rounds", closingRound.id, {
      closed: true, returnedCount: returned, pickupCount: pickup,
      deliveredFinal: Math.max(0, closingRound.deliveryCount - returned),
    });
    setClosingRound(null);
  };

  const dayDelivered = myRoundsToday.reduce((s,r)=> s + (r.closed ? r.deliveredFinal : 0), 0);
  const dayPickup = myRoundsToday.reduce((s,r)=> s + (r.closed ? (r.pickupCount||0) : 0), 0);
  const dayReturned = myRoundsToday.reduce((s,r)=> s + (r.closed ? (r.returnedCount||0) : 0), 0);

  const thisMonth = monthKey(todayISO());
  const monthRounds = rounds.filter(r=>r.riderId===targetId && monthKey(r.date)===thisMonth && r.closed);
  const monthDelivered = monthRounds.reduce((s,r)=>s+r.deliveredFinal,0);
  const monthPickup = monthRounds.reduce((s,r)=>s+(r.pickupCount||0),0);

  return (
    <div style={{display:"flex",flexDirection:"column",gap:16}}>
      {isAdmin && (
        <select value={viewRiderId} onChange={(e)=>setViewRiderId(e.target.value)} className="input">
          <option value="">Select rider</option>
          {riders.filter(r=>r.role==="rider").map(r=><option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
      )}

      {targetId && (
      <>
      <input type="date" value={date} onChange={(e)=>setDate(e.target.value)} className="input font-mono"/>

      <div className="stat-grid-3">
        <StatCard label="Today Delivered" value={dayDelivered} color="#3DDC97"/>
        <StatCard label="Today Pickup" value={dayPickup} color="#F5A623"/>
        <StatCard label="Today Returned" value={dayReturned} color="#E5484D"/>
      </div>

      {canAddNew ? (
        <div className="card" style={{display:"flex",flexDirection:"column",gap:10}}>
          <div className="section-label">Start Round {myRoundsToday.length+1}</div>
          <div style={{display:"flex",gap:8}}>
            <input value={drs} onChange={(e)=>setDrs(e.target.value)} placeholder="DRS Number (mandatory)" className="input" style={{flex:1}}/>
            <button onClick={()=>setScanning(true)} className="btn-ghost" style={{display:"flex",alignItems:"center",gap:4,whiteSpace:"nowrap"}}>
              <ScanLine size={14}/> Scan
            </button>
          </div>
          <input type="number" value={deliveryCount} onChange={(e)=>setDeliveryCount(e.target.value)} placeholder="How many parcels are you taking" className="input font-mono"/>
          <button onClick={startRound} disabled={!drs.trim() || !deliveryCount} className="btn-primary">Start Round</button>
        </div>
      ) : (
        <div className="card" style={{borderColor:"rgba(245,166,35,0.4)",background:"rgba(245,166,35,0.08)"}}>
          <p style={{fontSize:13,marginBottom:10}}>Round {openRound.roundNumber} is not closed yet — DRS {openRound.drsNumber}, took {openRound.deliveryCount} parcels. Close it before starting the next round.</p>
          <button onClick={()=>openCloseModal(openRound)} className="btn-primary">Close Round {openRound.roundNumber}</button>
        </div>
      )}

      <div>
        <div className="section-label">Today's Rounds</div>
        <div className="list-card">
          {myRoundsToday.length===0 ? <div style={{padding:16,fontSize:13,color:"#7C8592"}}>No rounds yet.</div> :
            myRoundsToday.map(r=>(
              <div key={r.id} className="list-row">
                <div>
                  <div style={{fontSize:13,fontWeight:600}}>Round {r.roundNumber} · DRS {r.drsNumber}</div>
                  <div style={{fontSize:11,color:"#7C8592"}} className="font-mono">
                    Out: {r.deliveryCount} {r.closed ? `· Delivered: ${r.deliveredFinal} · Returned: ${r.returnedCount} · Pickup: ${r.pickupCount}` : "· Pending closure"}
                  </div>
                </div>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  {!r.closed && <span className="badge badge-pending">open</span>}
                  {isAdmin && (
                    <button onClick={()=>deleteRec("rounds", r.id)} style={{background:"none",border:"none",color:"#7C8592",cursor:"pointer"}}>
                      <Trash2 size={13}/>
                    </button>
                  )}
                </div>
              </div>
            ))
          }
        </div>
      </div>

      <div className="card">
        <div className="section-label">This Month's Total</div>
        <div className="stat-grid">
          <StatCard label="Total Delivered" value={monthDelivered} color="#3DDC97"/>
          <StatCard label="Total Pickup" value={monthPickup} color="#F5A623"/>
        </div>
      </div>
      </>
      )}

      {closingRound && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.7)",display:"flex",alignItems:"center",justifyContent:"center",padding:20,zIndex:50}}>
          <div className="card" style={{maxWidth:360,width:"100%",display:"flex",flexDirection:"column",gap:12}}>
            <div className="section-label">Close Round {closingRound.roundNumber}</div>

            <p style={{fontSize:13}}>Were all {closingRound.deliveryCount} parcels delivered, or were some returned?</p>
            <div style={{display:"flex",gap:8}}>
              <button onClick={()=>setHadReturns(false)} className="btn-ghost" style={{flex:1, borderColor: hadReturns===false?"#3DDC97":"#2A3038", color: hadReturns===false?"#3DDC97":"#7C8592"}}>All Delivered</button>
              <button onClick={()=>setHadReturns(true)} className="btn-ghost" style={{flex:1, borderColor: hadReturns===true?"#E5484D":"#2A3038", color: hadReturns===true?"#E5484D":"#7C8592"}}>Some Returned</button>
            </div>
            {hadReturns && (
              <input type="number" value={returnedInput} onChange={(e)=>setReturnedInput(e.target.value)} placeholder="How many were returned" className="input font-mono"/>
            )}

            <p style={{fontSize:13,marginTop:6}}>Did you bring any pickups this round?</p>
            <div style={{display:"flex",gap:8}}>
              <button onClick={()=>setHadPickup(false)} className="btn-ghost" style={{flex:1, borderColor: hadPickup===false?"#3DDC97":"#2A3038", color: hadPickup===false?"#3DDC97":"#7C8592"}}>No</button>
              <button onClick={()=>setHadPickup(true)} className="btn-ghost" style={{flex:1, borderColor: hadPickup===true?"#F5A623":"#2A3038", color: hadPickup===true?"#F5A623":"#7C8592"}}>Yes</button>
            </div>
            {hadPickup && (
              <input type="number" value={pickupInput} onChange={(e)=>setPickupInput(e.target.value)} placeholder="How many pickups did you bring" className="input font-mono"/>
            )}

            <button onClick={confirmClose} disabled={hadReturns===null || hadPickup===null} className="btn-primary">Confirm & Close</button>
            <button onClick={()=>setClosingRound(null)} style={{background:"none",border:"none",color:"#7C8592",fontSize:12,cursor:"pointer"}}>Cancel</button>
          </div>
        </div>
      )}

      {scanning && (
        <BarcodeScanModal onDetect={(val)=>{ setDrs(val); setScanning(false); }} onClose={()=>setScanning(false)} />
      )}
    </div>
  );
}

function BarcodeScanModal({ onDetect, onClose }) {
  const videoRef = useRef(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let stream, raf, stopped = false, detector;
    (async () => {
      if (!("BarcodeDetector" in window)) {
        setError("Barcode scanning isn't supported on this browser/device. Please type the DRS number manually.");
        return;
      }
      try {
        detector = new window.BarcodeDetector();
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (stopped) { stream.getTracks().forEach(t=>t.stop()); return; }
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        const tick = async () => {
          if (stopped) return;
          try {
            const codes = await detector.detect(videoRef.current);
            if (codes.length > 0) { onDetect(codes[0].rawValue); return; }
          } catch {}
          raf = requestAnimationFrame(tick);
        };
        tick();
      } catch (e) {
        setError("Camera access denied or unavailable. Please type the DRS number manually.");
      }
    })();
    return () => { stopped = true; if (raf) cancelAnimationFrame(raf); if (stream) stream.getTracks().forEach(t=>t.stop()); };
  }, []);

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.92)",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",zIndex:60,padding:20}}>
      {error ? (
        <div className="card" style={{maxWidth:320,textAlign:"center"}}>
          <p style={{fontSize:13,color:"#E5484D",marginBottom:12}}>{error}</p>
          <button onClick={onClose} className="btn-primary">Close</button>
        </div>
      ) : (
        <>
          <video ref={videoRef} style={{width:"100%",maxWidth:360,borderRadius:12}} muted playsInline/>
          <p style={{color:"#B9C0CA",fontSize:12,marginTop:12}}>Point camera at the barcode</p>
          <button onClick={onClose} className="btn-ghost" style={{marginTop:12}}>Cancel</button>
        </>
      )}
    </div>
  );
}

function MileageTab({ user, isAdmin, riders, odometer, riderName }) {
  const [viewRiderId, setViewRiderId] = useState(isAdmin ? (riders.find(r=>r.role==="rider")?.id || "") : user.id);
  const [date, setDate] = useState(todayISO());
  const [morning, setMorning] = useState("");
  const [evening, setEvening] = useState("");

  const targetId = isAdmin ? viewRiderId : user.id;
  const existing = odometer.find(o=>o.riderId===targetId && o.date===date);

  useEffect(()=>{ setMorning(existing?.morning ?? ""); setEvening(existing?.evening ?? ""); },[date, targetId]);

  const save = async () => {
    if (!targetId) return;
    const data = { riderId: targetId, date, morning: morning===""?null:parseFloat(morning), evening: evening===""?null:parseFloat(evening) };
    if (existing) await updateRec("odometer", existing.id, data);
    else await addRec("odometer", data);
  };

  const kmFor = (o) => (o?.morning!=null && o?.evening!=null) ? Math.max(0, o.evening-o.morning) : null;
  const logs = useMemo(()=>odometer.filter(o=>o.riderId===targetId).sort((a,b)=>a.date<b.date?1:-1),[odometer,targetId]);
  const monthLogs = logs.filter(o=>monthKey(o.date)===monthKey(todayISO()));
  const monthKm = monthLogs.reduce((s,o)=>s+(kmFor(o)||0),0);
  const todayKm = kmFor({morning: morning===""?null:parseFloat(morning), evening: evening===""?null:parseFloat(evening)});

  return (
    <div style={{display:"flex",flexDirection:"column",gap:16}}>
      {isAdmin && (
        <select value={viewRiderId} onChange={(e)=>setViewRiderId(e.target.value)} className="input">
          <option value="">Select rider</option>
          {riders.filter(r=>r.role==="rider").map(r=><option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
      )}
      {targetId && (
      <>
      <div className="card" style={{display:"flex",flexDirection:"column",gap:10}}>
        <div className="section-label">Odometer Reading</div>
        <input type="date" value={date} onChange={(e)=>setDate(e.target.value)} className="input font-mono"/>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          <div>
            <label style={{fontSize:10,color:"#7C8592",textTransform:"uppercase"}}>Morning</label>
            <input type="number" value={morning} onChange={(e)=>setMorning(e.target.value)} placeholder="km" className="input font-mono" style={{marginTop:4}}/>
          </div>
          <div>
            <label style={{fontSize:10,color:"#7C8592",textTransform:"uppercase"}}>Evening</label>
            <input type="number" value={evening} onChange={(e)=>setEvening(e.target.value)} placeholder="km" className="input font-mono" style={{marginTop:4}}/>
          </div>
        </div>
        <button onClick={save} className="btn-primary">Save Reading</button>
        {todayKm!=null && (
          <div style={{textAlign:"center",paddingTop:4}}>
            <div className="font-mono" style={{fontSize:22,color:"#3DDC97"}}>{todayKm} km</div>
            <div style={{fontSize:11,color:"#7C8592"}}>₹{(todayKm*2.5).toFixed(0)} @2.5/km · ₹{(todayKm*2.75).toFixed(0)} @2.75/km</div>
          </div>
        )}
      </div>

      <div className="card">
        <div className="section-label">This Month's Total</div>
        <div className="stat-grid-3">
          <div><div className="font-mono" style={{fontSize:20}}>{monthKm.toFixed(1)}</div><div style={{fontSize:10,color:"#7C8592"}}>TOTAL KM</div></div>
          <div><div className="font-mono" style={{fontSize:20,color:"#F5A623"}}>₹{(monthKm*2.5).toFixed(0)}</div><div style={{fontSize:10,color:"#7C8592"}}>@2.5/KM</div></div>
          <div><div className="font-mono" style={{fontSize:20,color:"#3DDC97"}}>₹{(monthKm*2.75).toFixed(0)}</div><div style={{fontSize:10,color:"#7C8592"}}>@2.75/KM</div></div>
        </div>
      </div>

      <div className="list-card">
        {logs.length===0 ? <div style={{padding:16,fontSize:13,color:"#7C8592"}}>No readings yet.</div> :
          logs.slice(0,15).map(o=>{
            const km = kmFor(o);
            return (
              <div key={o.date} className="list-row">
                <div><div style={{fontSize:13,fontWeight:600}} className="font-mono">{fmtDate(o.date)}</div><div style={{fontSize:11,color:"#7C8592"}} className="font-mono">{o.morning??"—"} → {o.evening??"—"}</div></div>
                <div style={{textAlign:"right"}}>
                  {km!=null ? <><div className="font-mono" style={{fontSize:13,color:"#3DDC97"}}>{km} km</div><div style={{fontSize:10,color:"#7C8592"}}>₹{(km*2.5).toFixed(0)} / ₹{(km*2.75).toFixed(0)}</div></> : <span style={{fontSize:11,color:"#7C8592"}}>Pending</span>}
                </div>
              </div>
            );
          })
        }
      </div>
      </>
      )}
    </div>
  );
}

function MyFuelTab({ user, personalFuel }) {
  const [date, setDate] = useState(todayISO());
  const [amount, setAmount] = useState("");

  const myLogs = useMemo(()=>personalFuel.filter(f=>f.riderId===user.id).sort((a,b)=>a.date<b.date?1:-1),[personalFuel,user.id]);
  const submit = async () => {
    if (!amount) return;
    await addRec("personalFuel", { riderId: user.id, date, amount: parseFloat(amount) });
    setAmount("");
  };
  const remove = (id) => deleteRec("personalFuel", id);

  const todayTotal = myLogs.filter(f=>f.date===todayISO()).reduce((s,f)=>s+f.amount,0);
  const monthTotal = myLogs.filter(f=>monthKey(f.date)===monthKey(todayISO())).reduce((s,f)=>s+f.amount,0);

  return (
    <div style={{display:"flex",flexDirection:"column",gap:16}}>
      <div className="stat-grid">
        <StatCard label="Today Spend" value={`₹${todayTotal.toFixed(0)}`} color="#F5A623"/>
        <StatCard label="Month Spend" value={`₹${monthTotal.toFixed(0)}`} color="#3DDC97"/>
      </div>
      <div className="card" style={{display:"flex",flexDirection:"column",gap:10}}>
        <div className="section-label">Today's Fuel Fill-up</div>
        <input type="date" value={date} onChange={(e)=>setDate(e.target.value)} className="input font-mono"/>
        <input type="number" value={amount} onChange={(e)=>setAmount(e.target.value)} placeholder="How much in rupees" className="input font-mono"/>
        <button onClick={submit} disabled={!amount} className="btn-primary">Save</button>
        <p style={{fontSize:11,color:"#7C8592"}}>This is your personal record only, visible only to you.</p>
      </div>
      <div className="list-card">
        {myLogs.length===0 ? <div style={{padding:16,fontSize:13,color:"#7C8592"}}>No entries yet.</div> :
          myLogs.map(f=>(
            <div key={f.id} className="list-row">
              <div style={{fontSize:13}} className="font-mono">{fmtDate(f.date)}</div>
              <div style={{display:"flex",alignItems:"center",gap:10}}>
                <span className="font-mono" style={{fontSize:13,color:"#F5A623"}}>₹{f.amount}</span>
                <button onClick={()=>remove(f.id)} style={{background:"none",border:"none",color:"#7C8592",cursor:"pointer"}}><Trash2 size={14}/></button>
              </div>
            </div>
          ))
        }
      </div>
    </div>
  );
}

function CalendarTab({ holidays, leaves, riders, user, isAdmin, riderName }) {
  const [monthOffset, setMonthOffset] = useState(0);
  const [newHolDate, setNewHolDate] = useState(todayISO());
  const [newHolName, setNewHolName] = useState("");
  const base = new Date();
  base.setMonth(base.getMonth() + monthOffset);
  const year = base.getFullYear(), month = base.getMonth();
  const daysInMonth = new Date(year, month+1, 0).getDate();
  const firstDow = new Date(year, month, 1).getDay();
  const monthLabel = base.toLocaleDateString("en-IN",{month:"long",year:"numeric"});

  const approvedLeaves = leaves.filter(l=>l.status==="approved");
  const cellsBefore = Array.from({length: firstDow});
  const days = Array.from({length: daysInMonth}, (_,i)=>i+1);

  const isoFor = (d) => `${year}-${String(month+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;

  const myLeaveDays = approvedLeaves.filter(l=>l.riderId===user.id && l.date.startsWith(`${year}-${String(month+1).padStart(2,"0")}`));

  const monthHolidays = holidays.filter(h=>h.date.startsWith(`${year}-${String(month+1).padStart(2,"0")}`)).sort((a,b)=>a.date>b.date?1:-1);

  const addHoliday = async () => {
    if (!newHolName.trim()) return;
    await addRec("holidays", { date: newHolDate, name: newHolName.trim(), source: "custom" });
    setNewHolName("");
  };
  const removeHoliday = (id) => deleteRec("holidays", id);

  return (
    <div style={{display:"flex",flexDirection:"column",gap:16}}>
      <div className="card" style={{textAlign:"center",padding:"10px 14px"}}>
        <div style={{fontSize:10,color:"#7C8592",textTransform:"uppercase",letterSpacing:"0.08em"}}>Today</div>
        <div className="font-display" style={{fontSize:18,fontWeight:700,color:"#F5A623"}}>{fmtDate(todayISO())}</div>
      </div>

      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <button onClick={()=>setMonthOffset(m=>m-1)} className="btn-ghost">← Prev</button>
        <div className="font-display" style={{fontWeight:700,fontSize:16}}>{monthLabel}</div>
        <button onClick={()=>setMonthOffset(m=>m+1)} className="btn-ghost">Next →</button>
      </div>

      <div>
        <div className="cal-grid" style={{marginBottom:4}}>
          {["S","M","T","W","T","F","S"].map((d,i)=><div key={i} style={{textAlign:"center",fontSize:10,color:"#7C8592"}}>{d}</div>)}
        </div>
        <div className="cal-grid">
          {cellsBefore.map((_,i)=><div key={"b"+i}/>)}
          {days.map(d=>{
            const iso = isoFor(d);
            const holiday = isSunday(iso) || holidays.some(h=>h.date===iso);
            const onLeave = approvedLeaves.some(l=>l.date===iso);
            const today = iso === todayISO();
            let cls = "cal-cell";
            if (holiday) cls += " holiday";
            if (onLeave) cls += " leave";
            if (today) cls += " today";
            return <div key={d} className={cls} title={holiday?"Holiday":onLeave?"Rider on leave":""}>{d}</div>;
          })}
        </div>
      </div>

      <div style={{display:"flex",gap:14,fontSize:11,color:"#7C8592"}}>
        <span><span style={{display:"inline-block",width:10,height:10,background:"rgba(61,220,151,0.4)",borderRadius:3,marginRight:4}}/>Holiday</span>
        <span><span style={{display:"inline-block",width:10,height:10,background:"rgba(229,72,77,0.4)",borderRadius:3,marginRight:4}}/>Rider on leave</span>
      </div>

      <div>
        <div className="section-label">Riders On Leave This Month</div>
        <div className="list-card">
          {approvedLeaves.filter(l=>l.date.startsWith(`${year}-${String(month+1).padStart(2,"0")}`)).length===0 ? (
            <div style={{padding:16,fontSize:13,color:"#7C8592"}}>No approved leave this month.</div>
          ) : approvedLeaves.filter(l=>l.date.startsWith(`${year}-${String(month+1).padStart(2,"0")}`)).sort((a,b)=>a.date>b.date?1:-1).map(l=>(
            <div key={l.id} className="list-row">
              <div style={{fontSize:13,fontWeight:600}}>{riderName(l.riderId)}</div>
              <div className="font-mono" style={{fontSize:12,color:"#E5484D"}}>{fmtDate(l.date)}</div>
            </div>
          ))}
        </div>
      </div>

      {myLeaveDays.length > 0 && (
        <div>
          <div className="section-label">Your Leave This Month</div>
          <div className="list-card">
            {myLeaveDays.map(l=>(
              <div key={l.id} className="list-row">
                <div style={{fontSize:13}}>{l.customReason || l.reason}</div>
                <div className="font-mono" style={{fontSize:12,color:"#E5484D"}}>{fmtDate(l.date)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <div className="section-label">Festivals & Holidays This Month</div>
        <div className="list-card">
          {monthHolidays.length===0 ? <div style={{padding:16,fontSize:13,color:"#7C8592"}}>No festivals listed this month.</div> :
            monthHolidays.map(h=>(
              <div key={h.id} className="list-row">
                <div style={{fontSize:13}}>{h.name}</div>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <span className="font-mono" style={{fontSize:12,color:"#3DDC97"}}>{fmtDate(h.date)}</span>
                  {isAdmin && <button onClick={()=>removeHoliday(h.id)} style={{background:"none",border:"none",color:"#7C8592",cursor:"pointer"}}><Trash2 size={13}/></button>}
                </div>
              </div>
            ))
          }
        </div>
        <p style={{fontSize:10,color:"#5B6270",marginTop:6}}>Lunar festival dates (Holi, Diwali, Eid etc.) are approximate — admin can edit or add dates below.</p>
      </div>

      {isAdmin && (
        <div className="card" style={{display:"flex",flexDirection:"column",gap:10}}>
          <div className="section-label">Add Festival / Holiday</div>
          <input type="date" value={newHolDate} onChange={(e)=>setNewHolDate(e.target.value)} className="input font-mono"/>
          <input value={newHolName} onChange={(e)=>setNewHolName(e.target.value)} placeholder="Name (e.g. Diwali, Office Closed)" className="input"/>
          <button onClick={addHoliday} disabled={!newHolName.trim()} className="btn-primary">Add Holiday</button>
        </div>
      )}
    </div>
  );
}

function PanchangTab() {
  const today = new Date();
  const vs = vikramSamvat(today.getFullYear(), today.getMonth());
  const ss = sakaSamvat(today.getFullYear(), today.getMonth());
  return (
    <div style={{display:"flex",flexDirection:"column",gap:16}}>
      <div className="card" style={{textAlign:"center"}}>
        <MoonIcon size={22} color="#8AA5FF" style={{marginBottom:6}}/>
        <div className="font-display" style={{fontSize:16,fontWeight:700}}>Hindu Calendar Year</div>
        <div style={{display:"flex",justifyContent:"center",gap:24,marginTop:10}}>
          <div>
            <div className="font-mono" style={{fontSize:22,color:"#F5A623"}}>{vs}</div>
            <div style={{fontSize:10,color:"#7C8592"}}>VIKRAM SAMVAT</div>
          </div>
          <div>
            <div className="font-mono" style={{fontSize:22,color:"#3DDC97"}}>{ss}</div>
            <div style={{fontSize:10,color:"#7C8592"}}>SAKA SAMVAT</div>
          </div>
        </div>
      </div>
      <div className="card" style={{fontSize:12,color:"#B9C0CA",lineHeight:1.6}}>
        Exact daily tithi, nakshatra and muhurat need precise lunar-position data from a
        dedicated panchang source, so this app doesn't calculate them. Major Hindu festival
        dates (Diwali, Holi, Navratri, Hindu Nav Varsh, etc.) are listed on the Calendar tab
        instead — check a local panchang or app for exact daily tithi.
      </div>
    </div>
  );
}

function AnnouncementsTab({ user, isAdmin, announcements }) {
  const [text, setText] = useState("");
  const submit = async () => {
    if (!text.trim()) return;
    await addRec("announcements", { text: text.trim(), createdBy: user.name, createdAtMs: Date.now() });
    setText("");
  };
  const remove = (id) => deleteRec("announcements", id);

  return (
    <div style={{display:"flex",flexDirection:"column",gap:16}}>
      {isAdmin && (
        <div className="card" style={{display:"flex",flexDirection:"column",gap:10}}>
          <div className="section-label">New Announcement</div>
          <textarea value={text} onChange={(e)=>setText(e.target.value)} rows={3} placeholder="Write a message..." className="input" style={{resize:"none"}}/>
          <button onClick={submit} disabled={!text.trim()} className="btn-primary" style={{display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>
            <Megaphone size={15}/> Post
          </button>
        </div>
      )}
      <div className="list-card">
        {announcements.length===0 ? <div style={{padding:16,fontSize:13,color:"#7C8592"}}>No announcements yet.</div> :
          announcements.map(a=>(
            <div key={a.id} className="list-row" style={{alignItems:"flex-start"}}>
              <div>
                <div style={{fontSize:13}}>{a.text}</div>
                <div style={{fontSize:10,color:"#5B6270",marginTop:4}} className="font-mono">— {a.createdBy} · {new Date(a.createdAtMs).toLocaleDateString("en-IN")}</div>
              </div>
              {isAdmin && <button onClick={()=>remove(a.id)} style={{background:"none",border:"none",color:"#7C8592",cursor:"pointer",flexShrink:0}}><Trash2 size={14}/></button>}
            </div>
          ))
        }
      </div>
    </div>
  );
}

function RidersTab({ riders, isFounder, officeSetting }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [pin, setPin] = useState("");
  const [radius, setRadius] = useState(officeSetting?.radius || 200);
  const [settingLoc, setSettingLoc] = useState(false);
  const [locMsg, setLocMsg] = useState("");

  const addRider = async () => {
    if (!name.trim() || pin.trim().length < 4) return;
    await addRec("riders", { name: name.trim(), phone: phone.trim(), role: "rider", pin: pin.trim() });
    setName(""); setPhone(""); setPin("");
  };

  const setOfficeHere = async () => {
    setSettingLoc(true); setLocMsg("");
    try {
      const pos = await getCurrentPosition();
      await setRec("settings", "office", { type: "office", lat: pos.lat, lng: pos.lng, radius: Number(radius) || 200 });
      setLocMsg("Office location saved at your current spot.");
    } catch {
      setLocMsg("Couldn't get your location — check location permission.");
    }
    setSettingLoc(false);
  };
  const remove = (id) => deleteRec("riders", id);
  const setRole = (id, role) => updateRec("riders", id, { role, pin: role==="rider" ? "" : "1234" });

  return (
    <div style={{display:"flex",flexDirection:"column",gap:16}}>
      {isFounder && (
        <div className="card" style={{display:"flex",flexDirection:"column",gap:10}}>
          <div className="section-label">Add New Rider</div>
          <input value={name} onChange={(e)=>setName(e.target.value)} placeholder="Rider's name" className="input"/>
          <input value={phone} onChange={(e)=>setPhone(e.target.value)} placeholder="Phone (optional)" className="input font-mono"/>
          <input value={pin} onChange={(e)=>setPin(e.target.value)} placeholder="4-digit PIN for this rider" className="input font-mono"/>
          <button onClick={addRider} disabled={!name.trim() || pin.trim().length<4} className="btn-primary" style={{display:"flex",alignItems:"center",justifyContent:"center",gap:6}}><Plus size={15}/> Add Rider</button>
          <p style={{fontSize:11,color:"#7C8592"}}>Rider logs in with their name + this PIN — only they (or Admin/Founder) can access their account.</p>
        </div>
      )}
      <div className="list-card">
        {riders.map(r=>(
          <div key={r.id} className="list-row">
            <div>
              <div style={{fontSize:13,fontWeight:600,display:"flex",alignItems:"center",gap:6}}>
                {r.name} <span className="badge badge-pending">{r.role}</span>
              </div>
              <div style={{fontSize:11,color:"#7C8592"}} className="font-mono">{r.phone || "—"} · PIN: {r.pin || "—"}</div>
            </div>
            <div style={{display:"flex",gap:6,alignItems:"center"}}>
              {isFounder && r.role !== "founder" && (
                <select value={r.role} onChange={(e)=>setRole(r.id, e.target.value)} className="input" style={{width:"auto",padding:"4px 6px",fontSize:11}}>
                  <option value="rider">rider</option>
                  <option value="admin">admin</option>
                </select>
              )}
              {r.role !== "founder" && <button onClick={()=>remove(r.id)} style={{background:"none",border:"none",color:"#7C8592",cursor:"pointer"}}><Trash2 size={14}/></button>}
            </div>
          </div>
        ))}
      </div>
      {!isFounder && <p style={{fontSize:11,color:"#7C8592"}}>Only the Founder can change roles or add riders.</p>}

      {isFounder && (
        <div className="card" style={{display:"flex",flexDirection:"column",gap:10}}>
          <div className="section-label">Office Location (for attendance geofence)</div>
          {officeSetting?.lat != null && (
            <p style={{fontSize:12,color:"#3DDC97"}}>Office set · radius {officeSetting.radius || 200}m</p>
          )}
          <div>
            <label style={{fontSize:10,color:"#7C8592",textTransform:"uppercase"}}>Radius (meters)</label>
            <input type="number" value={radius} onChange={(e)=>setRadius(e.target.value)} className="input font-mono" style={{marginTop:4}}/>
          </div>
          <button onClick={setOfficeHere} disabled={settingLoc} className="btn-primary">
            {settingLoc ? "Getting location…" : "Set Office to My Current Location"}
          </button>
          {locMsg && <p style={{fontSize:11,color:"#B9C0CA"}}>{locMsg}</p>}
          <p style={{fontSize:10,color:"#5B6270"}}>Stand at the office, then tap the button above. Riders will only be able to Start Duty within this radius.</p>
        </div>
      )}
    </div>
  );
}

function ReportsTab({ riders, leaves, rounds, odometer, adminFuel, personalFuel, attendance, riderName, duty }) {
  const [riderId, setRiderId] = useState(riders.find(r=>r.role==="rider")?.id || "");
  const r = riders.find(x=>x.id===riderId);
  const thisMonth = monthKey(todayISO());

  const myLeaves = leaves.filter(l=>l.riderId===riderId);
  const myRounds = rounds.filter(x=>x.riderId===riderId && x.closed);
  const monthRounds = myRounds.filter(x=>monthKey(x.date)===thisMonth);
  const myOdo = odometer.filter(o=>o.riderId===riderId);
  const monthOdo = myOdo.filter(o=>monthKey(o.date)===thisMonth);
  const monthKm = monthOdo.reduce((s,o)=> s + (o.morning!=null && o.evening!=null ? Math.max(0,o.evening-o.morning) : 0), 0);
  const myPersonalFuel = personalFuel.filter(f=>f.riderId===riderId);
  const monthPersonalFuel = myPersonalFuel.filter(f=>monthKey(f.date)===thisMonth).reduce((s,f)=>s+f.amount,0);
  const myAdminFuel = adminFuel.filter(f=>f.riderId===riderId);
  const monthAdminFuel = myAdminFuel.filter(f=>monthKey(f.date)===thisMonth).reduce((s,f)=>s+f.amount,0);
  const myAttendance = attendance.filter(a=>a.riderId===riderId);
  const monthAttendance = myAttendance.filter(a=>monthKey(a.date)===thisMonth);
  const presentCount = monthAttendance.filter(a=>a.status==="present").length;
  const myDuty = duty.filter(d=>d.riderId===riderId && monthKey(d.date)===thisMonth).sort((a,b)=>a.date<b.date?1:-1);
  const fmtTime = (ts) => ts ? new Date(ts).toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"}) : "—";

  return (
    <div style={{display:"flex",flexDirection:"column",gap:16}}>
      <select value={riderId} onChange={(e)=>setRiderId(e.target.value)} className="input">
        <option value="">Select rider</option>
        {riders.filter(x=>x.role==="rider").map(x=><option key={x.id} value={x.id}>{x.name}</option>)}
      </select>

      {r && (
        <>
          <div className="card">
            <div className="section-label">{r.name} — This Month's Summary</div>
            <div className="stat-grid">
              <StatCard label="Deliveries" value={monthRounds.reduce((s,x)=>s+x.deliveredFinal,0)} color="#3DDC97"/>
              <StatCard label="Pickups" value={monthRounds.reduce((s,x)=>s+(x.pickupCount||0),0)} color="#F5A623"/>
              <StatCard label="KM Driven" value={monthKm.toFixed(1)} color="#8AA5FF"/>
              <StatCard label="Present Days" value={presentCount} color="#3DDC97"/>
            </div>
          </div>

          <div className="card">
            <div className="section-label">Payment Estimate ({thisMonth})</div>
            <div className="stat-grid">
              <div><div className="font-mono" style={{fontSize:18,color:"#F5A623"}}>₹{(monthKm*2.5).toFixed(0)}</div><div style={{fontSize:10,color:"#7C8592"}}>@2.5/KM</div></div>
              <div><div className="font-mono" style={{fontSize:18,color:"#3DDC97"}}>₹{(monthKm*2.75).toFixed(0)}</div><div style={{fontSize:10,color:"#7C8592"}}>@2.75/KM</div></div>
            </div>
          </div>

          <div className="card">
            <div className="section-label">Fuel ({thisMonth})</div>
            <div className="stat-grid">
              <div><div className="font-mono" style={{fontSize:18}}>₹{monthPersonalFuel.toFixed(0)}</div><div style={{fontSize:10,color:"#7C8592"}}>Rider's own record</div></div>
              <div><div className="font-mono" style={{fontSize:18}}>₹{monthAdminFuel.toFixed(0)}</div><div style={{fontSize:10,color:"#7C8592"}}>Company fuel log</div></div>
            </div>
          </div>

          <div>
            <div className="section-label">Leave History</div>
            <div className="list-card">
              {myLeaves.length===0 ? <div style={{padding:16,fontSize:13,color:"#7C8592"}}>No leave records.</div> :
                myLeaves.sort((a,b)=>a.date<b.date?1:-1).map(l=>(
                  <div key={l.id} className="list-row">
                    <div style={{fontSize:13}}>{fmtDate(l.date)} · {l.customReason||l.reason}</div>
                    <span className={`badge ${l.status==="approved"?"badge-approved":l.status==="rejected"?"badge-rejected":"badge-pending"}`}>{l.status}</span>
                  </div>
                ))
              }
            </div>
          </div>

          <div>
            <div className="section-label">Duty Times (this month)</div>
            <div className="list-card">
              {myDuty.length===0 ? <div style={{padding:16,fontSize:13,color:"#7C8592"}}>No duty records.</div> :
                myDuty.map(d=>(
                  <div key={d.id} className="list-row">
                    <div style={{fontSize:12}} className="font-mono">{fmtDate(d.date)}</div>
                    <div style={{fontSize:12}} className="font-mono">In: {fmtTime(d.startTime)} · Out: {fmtTime(d.endTime)}</div>
                  </div>
                ))
              }
            </div>
          </div>

          <div>
            <div className="section-label">DRS / Round History (this month)</div>
            <div className="list-card">
              {monthRounds.length===0 ? <div style={{padding:16,fontSize:13,color:"#7C8592"}}>No round records.</div> :
                monthRounds.sort((a,b)=>a.date<b.date?1:-1).map(round=>(
                  <div key={round.id} className="list-row">
                    <div style={{fontSize:12}} className="font-mono">{fmtDate(round.date)} · R{round.roundNumber} · DRS {round.drsNumber}</div>
                    <div style={{fontSize:12}} className="font-mono">D:{round.deliveredFinal} P:{round.pickupCount} Ret:{round.returnedCount}</div>
                  </div>
                ))
              }
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function AttendanceTab({ user, isAdmin, riders, attendance, leaves }) {
  const [date, setDate] = useState(todayISO());
  const visibleRiders = isAdmin ? riders.filter(r=>r.role==="rider") : riders.filter(r=>r.id===user.id);

  const statusFor = (riderId, d) => attendance.find(a=>a.riderId===riderId && a.date===d);
  const onLeave = (riderId, d) => leaves.some(l=>l.riderId===riderId && l.date===d && l.status==="approved");
  const setStatus = async (riderId, status) => {
    const existing = statusFor(riderId, date);
    if (existing) await updateRec("attendance", existing.id, { status });
    else await addRec("attendance", { riderId, date, status });
  };
  const STATUS_OPTS = [
    { key:"present", label:"Present", color:"#3DDC97" },
    { key:"late", label:"Late", color:"#F5A623" },
    { key:"absent", label:"Absent", color:"#E5484D" },
  ];

  const thisMonth = monthKey(todayISO());
  const monthlyCount = (riderId, status) => attendance.filter(a=>a.riderId===riderId && monthKey(a.date)===thisMonth && a.status===status).length;

  return (
    <div style={{display:"flex",flexDirection:"column",gap:16}}>
      <input type="date" value={date} onChange={(e)=>setDate(e.target.value)} className="input font-mono"/>
      <div className="list-card">
        {visibleRiders.length===0 ? <div style={{padding:16,fontSize:13,color:"#7C8592"}}>No riders found.</div> :
          visibleRiders.map(r=>{
            const current = statusFor(r.id, date)?.status;
            const leave = onLeave(r.id, date);
            return (
              <div key={r.id} style={{padding:"10px 14px",borderBottom:"1px solid #22272E"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                  <span style={{fontSize:13,fontWeight:600}}>{r.name}</span>
                  {leave && <span className="badge badge-rejected">on leave</span>}
                </div>
                {isAdmin ? (
                  <div style={{display:"flex",gap:6}}>
                    {STATUS_OPTS.map(opt=>(
                      <button key={opt.key} onClick={()=>setStatus(r.id, opt.key)}
                        style={{flex:1,fontSize:11,fontWeight:500,padding:"6px 0",borderRadius:6,border:"1px solid",cursor:"pointer",
                          background: current===opt.key ? opt.color+"22" : "transparent",
                          borderColor: current===opt.key ? opt.color : "#2A3038",
                          color: current===opt.key ? opt.color : "#7C8592"}}>
                        {opt.label}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div style={{fontSize:12}}>
                    {current ? <span className="badge" style={{background: current==="present"?"rgba(61,220,151,0.15)":current==="late"?"rgba(245,166,35,0.15)":"rgba(229,72,77,0.15)", color: current==="present"?"#3DDC97":current==="late"?"#F5A623":"#E5484D"}}>{current}</span> : <span style={{color:"#7C8592"}}>Not marked yet</span>}
                  </div>
                )}
                <div style={{fontSize:10,color:"#5B6270",marginTop:6}} className="font-mono">
                  This month — Present: {monthlyCount(r.id,"present")} · Late: {monthlyCount(r.id,"late")} · Absent: {monthlyCount(r.id,"absent")}
                </div>
              </div>
            );
          })
        }
      </div>
    </div>
  );
}

function AdminFuelTab({ riders, adminFuel, riderName }) {
  const [riderId, setRiderId] = useState("");
  const [date, setDate] = useState(todayISO());
  const [liters, setLiters] = useState("");
  const [amount, setAmount] = useState("");
  const [odo, setOdo] = useState("");

  const submit = async () => {
    if (!riderId || !liters || !amount) return;
    await addRec("adminFuel", { riderId, date, liters: parseFloat(liters), amount: parseFloat(amount), odometer: odo?parseFloat(odo):null });
    setLiters(""); setAmount(""); setOdo("");
  };
  const remove = (id) => deleteRec("adminFuel", id);
  const totalSpend = adminFuel.reduce((s,f)=>s+f.amount,0);
  const totalLiters = adminFuel.reduce((s,f)=>s+f.liters,0);

  return (
    <div style={{display:"flex",flexDirection:"column",gap:16}}>
      <div className="stat-grid">
        <StatCard label="Total Spend" value={`₹${totalSpend.toFixed(0)}`} color="#F5A623"/>
        <StatCard label="Total Liters" value={totalLiters.toFixed(1)} color="#3DDC97"/>
      </div>
      <div className="card" style={{display:"flex",flexDirection:"column",gap:10}}>
        <div className="section-label">Company Fuel Entry (Admin Only)</div>
        <select value={riderId} onChange={(e)=>setRiderId(e.target.value)} className="input">
          <option value="">Select rider</option>
          {riders.filter(r=>r.role==="rider").map(r=><option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
        <input type="date" value={date} onChange={(e)=>setDate(e.target.value)} className="input font-mono"/>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          <input type="number" value={liters} onChange={(e)=>setLiters(e.target.value)} placeholder="Liters" className="input font-mono"/>
          <input type="number" value={amount} onChange={(e)=>setAmount(e.target.value)} placeholder="Amount ₹" className="input font-mono"/>
        </div>
        <input type="number" value={odo} onChange={(e)=>setOdo(e.target.value)} placeholder="Odometer (optional)" className="input font-mono"/>
        <button onClick={submit} disabled={!riderId||!liters||!amount} className="btn-primary">Save Entry</button>
      </div>
      <div className="list-card">
        {adminFuel.length===0 ? <div style={{padding:16,fontSize:13,color:"#7C8592"}}>No entries yet.</div> :
          adminFuel.map(f=>(
            <div key={f.id} className="list-row">
              <div>
                <div style={{fontSize:13,fontWeight:600}}>{riderName(f.riderId)}</div>
                <div style={{fontSize:11,color:"#7C8592"}} className="font-mono">{fmtDate(f.date)} · {f.liters}L · ₹{f.amount}{f.odometer?` · ${f.odometer}km`:""}</div>
              </div>
              <button onClick={()=>remove(f.id)} style={{background:"none",border:"none",color:"#7C8592",cursor:"pointer"}}><Trash2 size={14}/></button>
            </div>
          ))
        }
      </div>
    </div>
  );
}
