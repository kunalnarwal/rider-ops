import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { db, setupNotifications } from "./firebase";
import {
  collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, query, orderBy, serverTimestamp, setDoc,
} from "firebase/firestore";
import {
  Users, CalendarOff, ClipboardCheck, Fuel, Plus, Trash2, AlertTriangle, Clock,
  Package, Gauge, CalendarDays, LogOut, ShieldCheck, Megaphone, Sun, Sunset, Moon,
  Check, X as XIcon, Play, Square, FileText, Bell, BellRing, Pencil, ScanLine, Moon as MoonIcon, Timer, Trophy, Copy,
} from "lucide-react";

// ---------- constants ----------
const REASON_OPTIONS = ["Marriage", "Personal", "Fever", "Other"];
const RATES = [2.5, 2.75];

// Pickup client master and rider-specific priority order.
const PICKUP_CLIENTS = [
  "Agriwise", "Ambit", "AU Small Red", "AU Small Red 2nd Floor",
  "AU Bank Jindal Chowk", "Care Health", "Darcl Rishi Nagar", "Darcl Tilak Bazar",
  "DCB Bank", "Equitas Bank Red Square", "Equitas Bank Jindal Chowk", "Finnova",
  "Grihum Housing", "Indira IVF", "Indostar", "L&T", "Mahindra Housing",
  "Muthoot Homefin", "Premarica", "Rajesh Pruthi", "Shubham Housing", "Tata Aia", "Tata Aia Red Square",
  "Truehome", "Aquadyne", "Astro Praduman", "Gaurija Automation", "Ortho Solution",
  "Sai Courier Point", "United India", "Utsav Engineering"
];
const RIDER_PICKUP_CLIENTS = {
  "Sunil Kumar": ["Agriwise", "Utsav Engineering"],
  "Rajiv Kumar": ["AU Small Red", "AU Small Red 2nd Floor", "Finnova", "L&T", "Indostar", "DCB Bank", "Equitas Bank Red Square", "Care Health", "Darcl Tilak Bazar", "Darcl Rishi Nagar"],
  "Rajeev Kumar": ["AU Small Red", "AU Small Red 2nd Floor", "Finnova", "L&T", "Indostar", "DCB Bank", "Equitas Bank Red Square", "Care Health", "Darcl Tilak Bazar", "Darcl Rishi Nagar", "Tata Aia Red Square"],
  "Suresh Kumar": ["Darcl Tilak Bazar", "Darcl Rishi Nagar", "Care Health", "Rajesh Pruthi"],
  "Vinod Kumar": ["AU Bank Jindal Chowk", "Equitas Bank Jindal Chowk", "Ambit", "Ortho Solution", "Gaurija Automation", "Muthoot Homefin", "Tata Aia", "Premarica", "Indira IVF", "United India", "Rajesh Pruthi"],
  "Sandeep": ["Shubham Housing", "Aquadyne", "Astro Praduman", "Finnova", "DCB Bank", "Indostar", "Tata Aia Red Square"],
  "Abhishek": ["Aquadyne", "Astro Praduman", "Care Health", "Finnova", "Tata Aia Red Square"]
};

// Fixed-date holidays (same every year) + commonly-known 2026 dates for lunar/variable
// festivals. Lunar festival dates shift every year and can be off by a day depending on
// local sighting/almanac — admin can add, edit or remove any of these from the Calendar tab.
function festivalSeedForYear(year) {
  const raw = [
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
  // Fixed, deterministic id per festival so re-running the seed ever overwrites
  // the same document instead of ever creating a duplicate.
  return raw.map((f) => ({ ...f, id: `auto-${f.date}-${f.name.toLowerCase().replace(/[^a-z0-9]+/g,"-")}` }));
}
function vikramSamvat(gregYear, month) { return month < 3 ? gregYear + 56 : gregYear + 57; }
function sakaSamvat(gregYear, month) { return month < 3 ? gregYear - 79 : gregYear - 78; }

// Monthly rider performance score: Delivery 60%, pickup stops 30%, punctuality/leave discipline 10%.
// Only approved rounds count. Pickup is measured by client stops, not parcel quantity, so Rajesh Pruthi
// can contribute at most one stop per round regardless of how many parcels were collected there.
function riderTotalsForMonth(rounds, mk, duty = [], leaves = [], riders = []) {
  const monthRounds = rounds.filter((r) => r.closed && r.approved === "approved" && monthKey(r.date) === mk);
  const byRider = {};
  const ensure = (id) => { if (!byRider[id]) byRider[id] = { riderId:id, out:0, delivered:0, pickupStops:0, punctualDuties:0, totalDuties:0, leaveDays:0 }; return byRider[id]; };
  riders.filter((r) => r.role === "rider").forEach((r) => ensure(r.id));
  monthRounds.forEach((r) => {
    const x = ensure(r.riderId);
    x.out += Math.max(0, Number(r.deliveryCount) || 0);
    x.delivered += Math.max(0, Number(r.deliveredFinal) || 0);
    const details = Array.isArray(r.pickupDetails) ? r.pickupDetails : [];
    // Each client listed is one stop; parcel quantity never multiplies stop credit.
    x.pickupStops += details.filter((p) => (Number(p.count) || 0) > 0).length;
  });
  const monthDuty = duty.filter((d) => monthKey(d.date) === mk);
  monthDuty.forEach((d) => {
    const x = ensure(d.riderId);
    if (d.startTime == null) return;
    x.totalDuties += 1;
    const t = new Date(Number(d.startTime));
    const mins = t.getHours()*60 + t.getMinutes();
    const name = (riders.find(r=>r.id===d.riderId)?.name || "").toLowerCase();
    const cutoff = d.period === "morning" ? 9*60+30 : (name === "rajeev kumar" ? 19*60+30 : 19*60);
    if (mins <= cutoff) x.punctualDuties += 1;
  });
  leaves.filter((l) => l.status === "approved" && monthKey(l.date) === mk).forEach((l) => {
    const x = ensure(l.riderId);
    // Half-day leave counts as half a leave day.
    x.leaveDays += (l.halfDay || l.halfDayPeriod) ? 0.5 : 1;
  });
  const maxPickupStops = Math.max(1, ...Object.values(byRider).map(x=>x.pickupStops));
  const [year, month] = mk.split("-").map(Number);
  const elapsedDays = mk === monthKey(todayISO()) ? new Date(todayISO()+"T00:00:00").getDate() : new Date(year, month, 0).getDate();
  return Object.values(byRider).map((x) => {
    const deliveryPct = x.out > 0 ? x.delivered / x.out * 100 : 0;
    const pickupPct = x.pickupStops / maxPickupStops * 100;
    const punctualPct = x.totalDuties > 0 ? x.punctualDuties / x.totalDuties * 100 : 0;
    const leaveFactor = Math.max(0, 1 - x.leaveDays / Math.max(1, elapsedDays));
    const behaviourPct = punctualPct * leaveFactor;
    const deliveryScore = deliveryPct * 0.60;
    const pickupScore = pickupPct * 0.30;
    const behaviourScore = behaviourPct * 0.10;
    return { ...x, deliveryPct, pickupPct, behaviourPct, deliveryScore, pickupScore, behaviourScore, total: Math.round((deliveryScore+pickupScore+behaviourScore)*100)/100 };
  }).sort((a,b)=>b.total-a.total);
}
function previousMonthKey(mk) {
  const [y, m] = mk.split("-").map(Number);
  const d = new Date(y, m - 2, 1); // m is 1-indexed; m-2 = previous month, 0-indexed
  return monthKey(toLocalISO(d));
}

// Haversine distance in meters between two lat/lng points.
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

// ---------- date helpers ----------
// Build YYYY-MM-DD from local date parts only — never via toISOString(), which converts
// to UTC first and silently shifts the date back a day for any timezone ahead of UTC
// (like India, UTC+5:30) during the early-morning hours.
function toLocalISO(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }
function todayISO() { return toLocalISO(new Date()); }
function addDaysISO(iso, n) { const d = new Date(iso + "T00:00:00"); d.setDate(d.getDate()+n); return toLocalISO(d); }
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

// ---------- generic Firestore hook ----------
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
const setRec = (col, id, data, options) => setDoc(doc(db, col, id), data, options);

const TABS = [
  { id: "home", label: "Home", icon: Clock },
  { id: "leave", label: "Leave", icon: CalendarOff },
  { id: "attendance", label: "Attendance", icon: ClipboardCheck },
  { id: "rounds", label: "Rounds", icon: Package },
  { id: "leaderboard", label: "Leaderboard", icon: Trophy },
  { id: "mileage", label: "Mileage", icon: Gauge },
  { id: "myfuel", label: "My Fuel", icon: Fuel },
  { id: "calendar", label: "Calendar", icon: CalendarDays },
  { id: "panchang", label: "Panchang", icon: MoonIcon },
  { id: "announcements", label: "News", icon: Megaphone },
  { id: "riders", label: "Riders", icon: Users, founderOnly: true },
  { id: "reports", label: "Reports", icon: FileText, adminOnly: true },
  { id: "dutytimes", label: "Duty Times", icon: Clock, adminOnly: true },
  { id: "visits", label: "Recent Visits", icon: Clock, founderOnly: true },
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
  const [adminRequests] = useCollection("adminRequests");
  const [visits] = useCollection("visits", "visitedAtMs");

  // Record one visit per signed-in user per browser tab session.
  useEffect(() => {
    if (!user?.id) return;
    const key = `riderops_visit_logged_${user.id}`;
    try { if (sessionStorage.getItem(key)) return; } catch {}
    addRec("visits", { userId: user.id, userName: user.name || "Unknown", role: user.role || "unknown", visitedAtMs: Date.now(), visitedAt: serverTimestamp(), userAgent: navigator.userAgent || "" })
      .then(() => { try { sessionStorage.setItem(key, "1"); } catch {} })
      .catch((err) => console.error("Could not record app visit", err));
  }, [user?.id]);
  // Client-side fallback: close open duty records at that date's 9:15 PM cutoff.
  // This runs while the app is open and catches up old open records on next visit.
  // A guaranteed background close while all clients are offline requires a scheduled Firebase backend job.
  useEffect(() => {
    const closeExpiredDuty = async () => {
      const now = new Date();
      const today = todayISO();
      for (const d of duty) {
        if (!(d.period === "morning" || d.period === "evening") || !d.startTime || d.endTime || !d.date || d.date > today) continue;
        const cutoff = new Date(`${d.date}T21:15:00`);
        if (now.getTime() < cutoff.getTime()) continue;
        try { await updateRec("duty", d.id, { endTime: cutoff.getTime(), autoClosed: true, autoClosedAtMs: Date.now() }); }
        catch (err) { console.error("Could not auto-close duty", err); }
      }
    };
    closeExpiredDuty();
    const timer = setInterval(closeExpiredDuty, 60000);
    return () => clearInterval(timer);
  }, [duty]);

  const officeSetting = settings.find((s) => s.id === "office" || s.type === "office");

  // seed a founder account if riders collection is totally empty
  useEffect(() => {
    if (!ridersLoading && riders.length === 0) {
      addRec("riders", { name: "Founder", phone: "", role: "founder", pin: "1234" });
    }
  }, [ridersLoading, riders.length]);

  // Pop up any announcements the rider hasn't seen yet, every time the app is opened.
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

  // Seed common Indian + Western festivals for the current year, once — using a fixed
  // doc id per festival so repeated app loads overwrite the same entry instead of
  // ever creating a duplicate.
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current) return;
    seededRef.current = true;
    const year = new Date().getFullYear();
    festivalSeedForYear(year).forEach((f) => {
      const { id, ...rest } = f;
      setRec("holidays", id, { ...rest, seedYear: year, source: "auto" }, { merge: true });
    });
  }, []);

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

  const visibleTabs = TABS.filter((t) => (!t.adminOnly || isAdmin) && (!t.founderOnly || isFounder));

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
        {tab==="home" && <HomeTab user={user} isAdmin={isAdmin} isFounder={isFounder} riders={riders} leaves={leaves} rounds={rounds}
          duty={duty} attendance={attendance} isHoliday={isHoliday} setTab={setTab} riderName={riderName}
          lateNotices={lateNotices} officeSetting={officeSetting}/>}
        {tab==="leave" && <LeaveTab user={user} isAdmin={isAdmin} isFounder={isFounder} riders={riders} leaves={leaves} riderName={riderName} isHoliday={isHoliday}/>}
        {tab==="rounds" && <RoundsTab user={user} isAdmin={isAdmin} isFounder={isFounder} riders={riders} rounds={rounds} riderName={riderName}/>}
        {tab==="mileage" && <MileageTab user={user} isAdmin={isAdmin} riders={riders} odometer={odometer} riderName={riderName}/>}
        {tab==="myfuel" && <MyFuelTab user={user} personalFuel={personalFuel}/>}
        {tab==="attendance" && <AttendanceTab user={user} isAdmin={isAdmin} riders={riders} attendance={attendance} leaves={leaves} duty={duty}/>}
        {tab==="leaderboard" && <LeaderboardTab rounds={rounds} riders={riders} user={user} riderName={riderName} duty={duty} leaves={leaves}/>}
        {tab==="calendar" && <CalendarTab holidays={holidays} leaves={leaves} riders={riders} user={user} isAdmin={isAdmin} riderName={riderName}/>}
        {tab==="panchang" && <PanchangTab/>}
        {tab==="announcements" && <AnnouncementsTab user={user} isAdmin={isAdmin} announcements={announcements}/>}
        {tab==="riders" && isFounder && <RidersTab user={user} riders={riders} isFounder={isFounder} officeSetting={officeSetting} adminRequests={adminRequests}/>}
        {tab==="reports" && isAdmin && <ReportsTab riders={riders} leaves={leaves} rounds={rounds} odometer={odometer}
          adminFuel={adminFuel} personalFuel={personalFuel} attendance={attendance} riderName={riderName} duty={duty}/>}
        {tab==="dutytimes" && isAdmin && <DutyTimesTab riders={riders} duty={duty}/> }
        {tab==="visits" && isFounder && <RecentVisitsTab visits={visits}/> }
      </main>

      {editingProfile && (
        <EditProfileModal user={user} riders={riders} onSave={saveProfile} onClose={()=>setEditingProfile(false)} />
      )}

      {showUnseenAnnouncements && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.75)",display:"flex",alignItems:"center",justifyContent:"center",padding:20,zIndex:70}}>
          <div className="card" style={{maxWidth:360,width:"100%",maxHeight:"88vh",overflowY:"auto",display:"flex",flexDirection:"column",gap:12}}>
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

  const save = () => {
    if (!name.trim()) return;
    const updates = { name: name.trim(), phone: phone.trim() };
    if (pin.trim().length >= 4) updates.pin = pin.trim();
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
        <div>
          <label style={{fontSize:10,color:"#7C8592",textTransform:"uppercase"}}>Your PIN (4+ digits)</label>
          <input value={pin} onChange={(e)=>setPin(e.target.value)} placeholder="Set your own PIN" className="input font-mono" style={{marginTop:4}}/>
          <p style={{fontSize:10,color:"#5B6270",marginTop:4}}>Only you (or Founder) will be able to log into this account with this PIN.</p>
        </div>
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

// ---------------- Login ----------------
function LoginScreen({ riders, onLogin }) {
  const [pinFor, setPinFor] = useState(null);
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");
  const [adminMode, setAdminMode] = useState(false);
  const [founderMode, setFounderMode] = useState(false);
  const [logoTaps, setLogoTaps] = useState(0);
  const { text, Icon, color } = greeting();

  const riderList = riders.filter((r) => r.role === "rider");
  // Founder is deliberately excluded from the visible Admin login list.
  const staffList = riders.filter((r) => r.role === "admin");
  const founderAccount = riders.find((r) => r.role === "founder");

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
        <h1 className="font-display glow" onClick={() => setLogoTaps((n) => { const next = n + 1; if (next >= 5) { setFounderMode(true); setAdminMode(false); setPinFor(null); return 0; } return next; })} style={{fontSize:30,fontWeight:800,color:"#F5A623",cursor:"default",userSelect:"none"}}>RIDER OPS</h1>
        <p style={{fontSize:12,color:"#7C8592",marginTop:4,display:"flex",alignItems:"center",justifyContent:"center",gap:4}}>
          <Icon size={12} style={{color}}/> {text}
        </p>
      </div>

      {!pinFor && !adminMode && !founderMode ? (
        <div style={{maxWidth:360,margin:"0 auto",width:"100%",display:"flex",flexDirection:"column",gap:8}}>
          <p style={{fontSize:11,color:"#7C8592",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:4}}>Choose your name</p>
          {riderList.map((r) => (
            <button key={r.id} onClick={()=>tryLogin(r)} className="card" style={{textAlign:"left",cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center",color:"#EDEAE1"}}>
              <span style={{fontWeight:600,fontSize:14,color:"#EDEAE1"}}>{r.name}</span>
            </button>
          ))}
          <button onClick={()=>setAdminMode(true)} style={{background:"none",border:"none",color:"#5B6270",fontSize:11,marginTop:10,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:4}}>
            <ShieldCheck size={12}/> Admin Login
          </button>
        </div>
      ) : !pinFor && adminMode ? (
        <div style={{maxWidth:360,margin:"0 auto",width:"100%",display:"flex",flexDirection:"column",gap:8}}>
          <p style={{fontSize:11,color:"#7C8592",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:4}}>Admin Login</p>
          {staffList.map((r) => (
            <button key={r.id} onClick={()=>tryLogin(r)} className="card" style={{textAlign:"left",cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center",color:"#EDEAE1"}}>
              <span style={{fontWeight:600,fontSize:14,color:"#EDEAE1"}}>{r.name}</span>
              <span className="badge badge-pending">{r.role}</span>
            </button>
          ))}
          {staffList.length === 0 && <p style={{fontSize:12,color:"#E5484D"}}>No Admin account found. Founder must set an existing account's role to Admin in Riders.</p>}
          <button onClick={()=>setAdminMode(false)} style={{background:"none",border:"none",color:"#7C8592",fontSize:12,marginTop:8,cursor:"pointer"}}>← Back to rider list</button>
        </div>
      ) : !pinFor && founderMode ? (
        <div style={{maxWidth:360,margin:"0 auto",width:"100%",display:"flex",flexDirection:"column",gap:8}}>
          <p style={{fontSize:11,color:"#F5A623",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:4}}>Founder Access</p>
          {founderAccount ? (
            <button onClick={()=>tryLogin(founderAccount)} className="card" style={{textAlign:"left",cursor:"pointer",color:"#EDEAE1"}}>
              <span style={{fontWeight:600,fontSize:14}}>{founderAccount.name}</span>
            </button>
          ) : <p style={{fontSize:12,color:"#E5484D"}}>Founder account not configured.</p>}
          <button onClick={()=>{setFounderMode(false);setLogoTaps(0);}} style={{background:"none",border:"none",color:"#7C8592",fontSize:12,marginTop:8,cursor:"pointer"}}>← Back</button>
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

// ---------------- Home ----------------
function HomeTab({ user, isAdmin, isFounder, riders, leaves, rounds, duty, attendance, isHoliday, setTab, riderName, lateNotices, officeSetting }) {
  const today = todayISO();

  // Congratulate the rider if they won Rider of the Month for the most recently
  // completed month, once, the first time they see it.
  const [showCongrats, setShowCongrats] = useState(false);
  const [congratsMonth, setCongratsMonth] = useState("");
  useEffect(() => {
    if (isAdmin) return;
    const thisMonth = monthKey(today);
    const prevMonth = previousMonthKey(thisMonth);
    const totals = riderTotalsForMonth(rounds, prevMonth);
    const winner = totals[0];
    if (winner && winner.riderId === user.id) {
      const seenKey = `riderops_congrats_${prevMonth}`;
      if (!localStorage.getItem(seenKey)) {
        setCongratsMonth(prevMonth);
        setShowCongrats(true);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rounds.length]);
  const dismissCongrats = () => {
    localStorage.setItem(`riderops_congrats_${congratsMonth}`, "1");
    setShowCongrats(false);
  };
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
  // Show late notices for today as well as tomorrow, so a notice entered yesterday remains visible on the actual late date.
  const visibleLateNotices = lateNotices.filter((n) => n.date === today || n.date === tomorrow0);
  const [notifStatus, setNotifStatus] = useState(
    typeof Notification !== "undefined" ? Notification.permission : "unsupported"
  );
  const enableNotifs = async () => {
    const res = await setupNotifications(user.id);
    setNotifStatus(res.ok ? "granted" : (typeof Notification !== "undefined" ? Notification.permission : "denied"));
  };
  const myMorningDuty = duty.find((d) => d.riderId === user.id && d.date === today && d.period === "morning");
  const myEveningDuty = duty.find((d) => d.riderId === user.id && d.date === today && d.period === "evening");
  const [, forceTick] = useState(0);
  useEffect(() => {
    if ((myMorningDuty && !myMorningDuty.endTime) || (myEveningDuty && !myEveningDuty.endTime)) {
      const t = setInterval(() => forceTick((x) => x + 1), 60000);
      return () => clearInterval(t);
    }
  }, [myMorningDuty, myEveningDuty]);

  const currentHour = new Date().getHours();
  const eveningWindowOpen = currentHour >= 17; // Evening duty opens at 5 PM
  const morningWindowOpen = currentHour < 17;  // Morning duty closes at 5 PM
  const [checkingPeriod, setCheckingPeriod] = useState(null);

  const startDuty = async (period) => {
    setLocError("");
    if (officeSetting?.lat != null) {
      setCheckingLoc(true); setCheckingPeriod(period);
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
    const startedAt = Date.now();
    await addRec("duty", { riderId: user.id, date: today, period, startTime: startedAt, endTime: null });
    const existingAttendance = attendance.find(a => a.riderId === user.id && a.date === today);
    try {
      if (existingAttendance) await updateRec("attendance", existingAttendance.id, { status: "present", markedBy: "duty-in", updatedAtMs: startedAt });
      else await addRec("attendance", { riderId: user.id, date: today, status: "present", markedBy: "duty-in", createdAtMs: startedAt });
    } catch (err) { console.error("Duty IN saved but attendance update failed", err); }
  };
  const endDuty = (dutyDoc) => updateRec("duty", dutyDoc.id, { endTime: Date.now() });

  const myRoundsToday = rounds.filter((r) => r.riderId === user.id && r.date === today);
  const todayDelivered = myRoundsToday.reduce((s, r) => s + (r.closed && r.approved==="approved" ? (r.deliveredFinal ?? 0) : 0), 0);
  const todayPickup = myRoundsToday.reduce((s, r) => s + (r.closed && r.approved==="approved" ? (r.pickupCount ?? 0) : 0), 0);
  const myStatus = attendance.find((a) => a.riderId === user.id && a.date === today)?.status;
  const onLeaveToday = leaves.find((l) => l.riderId === user.id && l.date === today && l.status === "approved");

  const tomorrow = addDaysISO(today, 1);
  // Show approved full-day and half-day leave notices for today and tomorrow to all users.
  const visibleLeaveNotices = leaves
    .filter((l) => (l.date === today || l.date === tomorrow) && l.status === "approved")
    .sort((a, b) => a.date.localeCompare(b.date));

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
          <div className="section-label">Morning Duty</div>
          {onLeaveToday ? (
            <p style={{fontSize:14,color:"#E5484D"}}>You are on leave today.</p>
          ) : myMorningDuty && !myMorningDuty.endTime ? (
            <>
              <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:26,color:"#3DDC97"}}>{fmtHours(Date.now()-myMorningDuty.startTime)}</div>
              <div style={{fontSize:11,color:"#7C8592",marginBottom:10}}>Started at {new Date(myMorningDuty.startTime).toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"})}</div>
              <button onClick={()=>endDuty(myMorningDuty)} className="btn-primary" style={{background:"#E5484D",display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>
                <Square size={14}/> OUT
              </button>
            </>
          ) : myMorningDuty && myMorningDuty.endTime ? (
            <p style={{fontSize:14,color:"#7C8592"}}>Completed — worked {fmtHours(myMorningDuty.endTime-myMorningDuty.startTime)}.</p>
          ) : !morningWindowOpen ? (
            <p style={{fontSize:12,color:"#5B6270"}}>Closed after 5:00 PM.</p>
          ) : (
            <>
              <button onClick={()=>startDuty("morning")} disabled={checkingLoc && checkingPeriod==="morning"} className="btn-primary" style={{display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>
                <Play size={14}/> {checkingLoc && checkingPeriod==="morning" ? "Checking location…" : "Start Morning Duty"}
              </button>
              {checkingPeriod==="morning" && locError && <p style={{fontSize:11,color:"#E5484D",marginTop:8}}>{locError}</p>}
              {officeSetting?.lat != null && <p style={{fontSize:10,color:"#5B6270",marginTop:6}}>Must be within {officeSetting.radius || 200}m of the office.</p>}
            </>
          )}
        </div>
      )}

      {!isAdmin && (
        <div className="card">
          <div className="section-label">Evening Duty</div>
          {onLeaveToday ? (
            <p style={{fontSize:14,color:"#E5484D"}}>You are on leave today.</p>
          ) : myEveningDuty && !myEveningDuty.endTime ? (
            <>
              <div style={{fontFamily:"'IBM Plex Mono',monospace",fontSize:26,color:"#3DDC97"}}>{fmtHours(Date.now()-myEveningDuty.startTime)}</div>
              <div style={{fontSize:11,color:"#7C8592",marginBottom:10}}>Started at {new Date(myEveningDuty.startTime).toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"})}</div>
              <button onClick={()=>endDuty(myEveningDuty)} className="btn-primary" style={{background:"#E5484D",display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>
                <Square size={14}/> OUT
              </button>
            </>
          ) : myEveningDuty && myEveningDuty.endTime ? (
            <p style={{fontSize:14,color:"#7C8592"}}>Completed — worked {fmtHours(myEveningDuty.endTime-myEveningDuty.startTime)}.</p>
          ) : !eveningWindowOpen ? (
            <p style={{fontSize:12,color:"#5B6270"}}>Opens at 5:00 PM.</p>
          ) : (
            <>
              <button onClick={()=>startDuty("evening")} disabled={checkingLoc && checkingPeriod==="evening"} className="btn-primary" style={{display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>
                <Play size={14}/> {checkingLoc && checkingPeriod==="evening" ? "Checking location…" : "Start Evening Duty"}
              </button>
              {checkingPeriod==="evening" && locError && <p style={{fontSize:11,color:"#E5484D",marginTop:8}}>{locError}</p>}
              {officeSetting?.lat != null && <p style={{fontSize:10,color:"#5B6270",marginTop:6}}>Must be within {officeSetting.radius || 200}m of the office.</p>}
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

      {visibleLeaveNotices.length > 0 && (
        <div className="card" role="status" aria-live="polite" style={{
          border:"2px solid #E5484D",
          background:"linear-gradient(135deg, rgba(229,72,77,0.20), rgba(229,72,77,0.07))",
          boxShadow:"0 0 0 2px rgba(229,72,77,0.10), 0 0 16px rgba(229,72,77,0.16)"
        }}>
          <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:8}}>
            <CalendarOff size={17} color="#FF5A61"/>
            <span className="font-display" style={{fontSize:13,fontWeight:800,color:"#FF5A61",letterSpacing:0.5}}>ON LEAVE</span>
          </div>
          {visibleLeaveNotices.map((l) => (
            <div key={l.id} style={{fontSize:13,marginTop:6,padding:"8px 10px",borderRadius:8,background:"rgba(229,72,77,0.10)",border:"1px solid rgba(229,72,77,0.32)"}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,flexWrap:"wrap",marginBottom:4}}>
                <b style={{color:"#FF777C"}}>{riderName(l.riderId)}</b>
                <span style={{fontSize:11,fontWeight:800,color:"#FFFFFF",background:l.date===today?"#C92A32":"#7C3AED",padding:"3px 7px",borderRadius:6}}>{l.date===today?"TODAY":"TOMORROW"} · {fmtDate(l.date)}</span>
              </div>
              <div>{l.halfDay ? "HALF-DAY LEAVE" : "FULL-DAY LEAVE"}{(l.halfDay && (l.fromTime || l.toTime)) ? ` · ${l.fromTime || ""}${l.fromTime && l.toTime ? "–" : ""}${l.toTime || ""}` : ""}</div>
              <div style={{color:"#B9C0CA",marginTop:2}}>{l.customReason || l.reason || "Leave"}</div>
            </div>
          ))}
        </div>
      )}

      {isHoliday(tomorrow) && (
        <div className="card" style={{borderColor:"rgba(138,165,255,0.4)",background:"rgba(138,165,255,0.08)",color:"#8AA5FF",fontSize:13}}>
          Tomorrow ({fmtDate(tomorrow)}) is a holiday.
        </div>
      )}

      {visibleLateNotices.length > 0 && (
        <div className="card" role="alert" aria-live="polite" style={{
          border:"2px solid #E5484D",
          background:"linear-gradient(135deg, rgba(229,72,77,0.22), rgba(229,72,77,0.08))",
          boxShadow:"0 0 0 2px rgba(229,72,77,0.12), 0 0 18px rgba(229,72,77,0.20)",
          animation:"lateNoticePulse 2s ease-in-out infinite"
        }}>
          <style>{`@keyframes lateNoticePulse { 0%,100% { box-shadow: 0 0 0 2px rgba(229,72,77,0.12), 0 0 12px rgba(229,72,77,0.12); } 50% { box-shadow: 0 0 0 4px rgba(229,72,77,0.22), 0 0 20px rgba(229,72,77,0.28); } }`}</style>
          <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:8}}>
            <AlertTriangle size={17} color="#FF5A61"/>
            <span className="font-display" style={{fontSize:13,fontWeight:800,color:"#FF5A61",letterSpacing:0.5}}>LATE ARRIVAL NOTICE</span>
            <span style={{marginLeft:"auto",fontSize:10,fontWeight:800,color:"#FFFFFF",background:"#C92A32",padding:"3px 7px",borderRadius:6}}>NOTICE</span>
          </div>
          {visibleLateNotices.map((n) => (
            <div key={n.id} style={{fontSize:14,marginTop:6,padding:"8px 10px",borderRadius:8,background:"rgba(229,72,77,0.12)",border:"1px solid rgba(229,72,77,0.35)"}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,flexWrap:"wrap",marginBottom:4}}>
                <b style={{color:"#FF777C"}}>{riderName(n.riderId)}</b>
                <div style={{display:"flex",alignItems:"center",gap:6}}>
                  <span style={{fontSize:12,fontWeight:800,color:"#FFFFFF",background:n.date === today ? "#C92A32" : "#7C3AED",padding:"3px 7px",borderRadius:6}}>{n.date === today ? "TODAY" : "TOMORROW"} · {fmtDate(n.date)}</span>
                  {isFounder && <button onClick={async()=>{if(window.confirm(`Delete ${riderName(n.riderId)}'s late arrival notice?`)) await deleteRec("lateNotices",n.id);}} title="Delete late notice" aria-label="Delete late notice" style={{background:"#C92A32",border:"none",borderRadius:6,color:"#fff",padding:"4px 7px",display:"inline-flex",alignItems:"center",cursor:"pointer"}}><Trash2 size={14}/></button>}
                </div>
              </div>
              <b>{n.fromTime} to {n.toTime}</b>
            </div>
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
      {isAdmin && (
        <div className="stat-grid">
          <StatCard label="Pending Approvals" value={rounds.filter(r=>r.closed && r.approved==="pending").length} color="#E5484D"/>
        </div>
      )}

      {isAdmin && (() => {
        const pendingLeaves = leaves.filter((l) => l.status === "pending");
        const pendingRounds = rounds.filter((r) => r.closed && r.approved === "pending");
        const pendingTotal = pendingLeaves.length + pendingRounds.length;
        return (
          <div className="card" style={{borderColor: pendingTotal ? "rgba(245,166,35,0.55)" : "#2A3038"}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,marginBottom:10}}>
              <div className="section-label" style={{marginBottom:0}}>Pending Tasks</div>
              <span className="badge" style={{background:pendingTotal?"rgba(245,166,35,0.16)":"rgba(61,220,151,0.12)",color:pendingTotal?"#F5A623":"#3DDC97"}}>{pendingTotal} pending</span>
            </div>
            {pendingTotal === 0 ? (
              <p style={{fontSize:12,color:"#7C8592",margin:0}}>No pending leave requests or pickup/delivery round approvals.</p>
            ) : (
              <div style={{display:"flex",flexDirection:"column",gap:8}}>
                {pendingLeaves.map((l) => (
                  <button key={`leave-${l.id}`} onClick={()=>setTab("leave")} className="btn-ghost" style={{width:"100%",textAlign:"left",padding:10,display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,borderColor:"rgba(245,166,35,0.25)"}}>
                    <span><b style={{display:"block",fontSize:12,color:"#EDEAE1"}}>Leave request — {riderName(l.riderId)}</b><span style={{fontSize:11,color:"#7C8592"}}>{fmtDate(l.date)} · {l.customReason || l.reason || "Reason not specified"}</span></span>
                    <span style={{fontSize:11,color:"#F5A623",whiteSpace:"nowrap"}}>Review →</span>
                  </button>
                ))}
                {pendingRounds.map((r) => (
                  <button key={`round-${r.id}`} onClick={()=>setTab("rounds")} className="btn-ghost" style={{width:"100%",textAlign:"left",padding:10,display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,borderColor:"rgba(229,72,77,0.25)"}}>
                    <span><b style={{display:"block",fontSize:12,color:"#EDEAE1"}}>Round approval — {riderName(r.riderId)}</b><span style={{fontSize:11,color:"#7C8592"}}>{fmtDate(r.date)} · Delivered: {r.deliveredFinal ?? r.deliveredCount ?? 0} · Pickup: {r.pickupCount ?? 0} · Returned: {r.returnedCount ?? 0}</span></span>
                    <span style={{fontSize:11,color:"#E5484D",whiteSpace:"nowrap"}}>Review →</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })()}

      <button onClick={()=>setTab("leave")} className="btn-ghost" style={{width:"100%",padding:10}}>Go to Leave →</button>

      {showCongrats && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.8)",display:"flex",alignItems:"center",justifyContent:"center",padding:20,zIndex:80}}>
          <div className="card" style={{maxWidth:340,width:"100%",textAlign:"center",display:"flex",flexDirection:"column",gap:12,borderColor:"rgba(245,166,35,0.5)"}}>
            <Trophy size={40} color="#F5A623" style={{margin:"0 auto"}}/>
            <div className="font-display" style={{fontSize:20,fontWeight:800,color:"#F5A623"}}>Congratulations!</div>
            <p style={{fontSize:14,color:"#EDEAE1"}}>
              You were <b>Rider of the Month</b> for {new Date(congratsMonth+"-01T00:00:00").toLocaleDateString("en-IN",{month:"long",year:"numeric"})} — most deliveries & pickups of anyone this month!
            </p>
            <button onClick={dismissCongrats} className="btn-primary">Thank You!</button>
          </div>
        </div>
      )}
    </div>
  );
}
function RecentVisitsTab({ visits = [] }) {
  const recentVisits = [...visits]
    .sort((a, b) => (Number(b.visitedAtMs) || 0) - (Number(a.visitedAtMs) || 0))
    .slice(0, 20);
  return (
    <div className="card">
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,marginBottom:10}}>
        <div className="section-label" style={{marginBottom:0}}>Recent App Visits</div>
        <span className="badge">Last 20</span>
      </div>
      {recentVisits.length === 0 ? <p style={{fontSize:12,color:"#7C8592"}}>No visit history recorded yet. New visits will appear here.</p> :
        recentVisits.map((v) => <div key={v.id} className="list-row" style={{padding:"9px 0"}}>
          <div style={{minWidth:0}}>
            <div style={{fontSize:13,fontWeight:600}}>{v.userName || "Unknown user"} <span style={{fontSize:10,color:"#8AA5FF",textTransform:"uppercase"}}>{v.role || ""}</span></div>
            <div style={{fontSize:11,color:"#7C8592"}}>{v.visitedAtMs ? new Date(v.visitedAtMs).toLocaleString("en-IN", { dateStyle:"medium", timeStyle:"short" }) : "Time unavailable"}</div>
          </div>
        </div>)}
      <p style={{fontSize:10,color:"#7C8592",marginTop:8}}>Records visits from the time this tracking feature is deployed; it cannot recover earlier visits.</p>
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

// ---------------- Leave (with approval workflow) ----------------
function LeaveTab({ user, isAdmin, isFounder, riders, leaves, riderName, isHoliday }) {
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
  const decide = (id, status) => updateRec("leaves", id, { status, decidedBy: user.name, decidedById: user.id, decidedAtMs: Date.now() });
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
        <p style={{fontSize:11,color:"#7C8592"}}>The request remains pending until an Admin or Founder approves or rejects it.</p>
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
                  {l.decidedBy && <div style={{fontSize:10,color:"#8AA5FF",marginTop:3}}>Decision: {l.status} by {l.decidedBy} · {l.decidedAtMs ? new Date(l.decidedAtMs).toLocaleString("en-IN") : "time unavailable"}</div>}
                  {l.halfDay && l.halfDayFrom && (
                    <div style={{fontSize:10,color:"#8AA5FF"}} className="font-mono">{l.halfDayPeriod}: {l.halfDayFrom} – {l.halfDayTo}</div>
                  )}
                </div>
                <div style={{display:"flex",gap:6,flexShrink:0}}>
                  {(isAdmin || isFounder) && l.status==="pending" && (
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

// ---------------- Rounds (delivery/pickup, DRS mandatory, return-adjustment) ----------------
function RoundsTab({ user, isAdmin, isFounder, riders, rounds, riderName }) {
  const [viewRiderId, setViewRiderId] = useState(isAdmin ? (riders.find(r=>r.role==="rider")?.id || "") : user.id);
  const [date, setDate] = useState(todayISO());
  const [drs, setDrs] = useState("");
  const [deliveryCount, setDeliveryCount] = useState("");
  const [weightKg, setWeightKg] = useState(""); // optional total parcel weight for this DRS
  const [closingRound, setClosingRound] = useState(null); // round object being closed
  const [returnedInput, setReturnedInput] = useState("");
  const [undeliveredReason, setUndeliveredReason] = useState("");
  const [rtoDocket, setRtoDocket] = useState("");
  const [rtoServiceType, setRtoServiceType] = useState("normal");
  const [scanTarget, setScanTarget] = useState("drs");
  const [returnDisposition, setReturnDisposition] = useState("undelivered");
  const [pickupWeightKg, setPickupWeightKg] = useState("");
  const [hadReturns, setHadReturns] = useState(null); // true/false
  const [hadPickup, setHadPickup] = useState(null);
  const [pickupInput, setPickupInput] = useState("");
  const [selectedPickupClients, setSelectedPickupClients] = useState([]);
  const [pickupQuantities, setPickupQuantities] = useState({});
  const [showOtherPickupClients, setShowOtherPickupClients] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [showPickupRound, setShowPickupRound] = useState(false);
  const [groupWithRoundId, setGroupWithRoundId] = useState("");
  const [monthDetail, setMonthDetail] = useState("");

  const targetId = isAdmin ? viewRiderId : user.id;
  const myRoundsToday = useMemo(()=> rounds.filter(r=>r.riderId===targetId && r.date===date).sort((a,b)=>a.roundNumber-b.roundNumber), [rounds, targetId, date]);
  const openRounds = myRoundsToday.filter(r=>!r.closed);
  const nextDeliveryNumber = myRoundsToday.filter(r=>r.roundType!=="pickup").reduce((max, r) => Math.max(max, Number(r.roundNumber) || 0), 0) + 1;
  const nextPickupNumber = myRoundsToday.filter(r=>r.roundType==="pickup").reduce((max, r) => Math.max(max, Number(r.roundNumber) || 0), 0) + 1;
  const nextRoundNumber = nextDeliveryNumber;
  const openDeliveryRounds = myRoundsToday.filter(r=>r.roundType!=="pickup" && !r.closed);
  // A DRS is unique: do not allow the same DRS in any existing round, regardless of rider/date/status.
  const normalizedDrs = drs.trim();
  const duplicateDrsRound = normalizedDrs ? rounds.find(r => r.roundType !== "pickup" && String(r.drsNumber || "").trim() === normalizedDrs) : null;
  const isDuplicateDrs = Boolean(duplicateDrsRound);

  const startPickupRound = async () => {
    const pickupDetails = selectedPickupClients.filter(client => client !== "Other").map(client => ({ client, count: Math.max(0, parseInt(pickupQuantities[client], 10) || 0) })).filter(item => item.count > 0);
    if (!pickupDetails.length) { alert("Select at least one pickup client and enter its parcel count."); return; }
    if (pickupWeightKg !== "" && (!Number.isFinite(Number(pickupWeightKg)) || Number(pickupWeightKg) <= 0)) { alert("Enter a valid pickup weight in kg, or leave it blank."); return; }
    await addRec("rounds", { riderId: targetId, date, roundNumber: nextPickupNumber, roundType: "pickup", drsNumber: "", deliveryCount: 0, weightKg: pickupWeightKg === "" ? null : Number(pickupWeightKg), closed: true, approved: "pending", returnedCount: 0, deliveredFinal: 0, pickupCount: pickupDetails.reduce((sum, item) => sum + item.count, 0), pickupDetails, pickupOtherCount: 0, closedBy: user.name, closedById: user.id, closedAtMs: Date.now() });
    setSelectedPickupClients([]); setPickupQuantities({}); setPickupWeightKg(""); setShowOtherPickupClients(false); setShowPickupRound(false);
  };

  const startRound = async () => {
    if (!/^\d{19}$/.test(drs.trim())) { alert("This is not a DRS number. Enter exactly 19 digits."); return; }
    const duplicate = rounds.find(r => r.roundType !== "pickup" && String(r.drsNumber || "").trim() === drs.trim());
    if (duplicate) { alert(`DRS ${drs.trim()} is already added${duplicate.riderId ? " in another round" : ""}. Please scan or enter a different DRS number.`); return; }
    if (!deliveryCount || Number(deliveryCount) <= 0) return;
    if (weightKg !== "" && (!Number.isFinite(Number(weightKg)) || Number(weightKg) <= 0)) { alert("Enter a valid weight in kg, or leave it blank."); return; }
    const selectedTripRound = openDeliveryRounds.find(r=>r.id===groupWithRoundId);
    let tripGroupId = `trip-${targetId}-${date}-${Date.now()}`;
    let nextNum = nextDeliveryNumber;
    if (selectedTripRound) {
      tripGroupId = selectedTripRound.tripGroupId || selectedTripRound.id;
      nextNum = Number(selectedTripRound.roundNumber) || nextDeliveryNumber;
      if (!selectedTripRound.tripGroupId) await updateRec("rounds", selectedTripRound.id, { tripGroupId });
    }
    await addRec("rounds", {
      riderId: targetId, date, roundNumber: nextNum, tripGroupId, drsNumber: drs.trim(), roundType:"delivery",
      deliveryCount: parseInt(deliveryCount,10), weightKg: weightKg === "" ? null : Number(weightKg), closed:false, pickupCount:null, returnedCount:null, deliveredFinal:null,
    });
    setDrs(""); setDeliveryCount(""); setWeightKg(""); setGroupWithRoundId("");
  };

  const openCloseModal = (r) => { setClosingRound(r); setHadReturns(null); setHadPickup(null); setReturnedInput(""); setUndeliveredReason(""); setRtoDocket(""); setRtoServiceType("normal"); setReturnDisposition("undelivered"); setPickupInput(""); setSelectedPickupClients([]); setPickupQuantities({}); setShowOtherPickupClients(false); };
  const confirmClose = async () => {
    if (hadReturns === null || hadPickup === null) return;
    const returnCount = hadReturns ? (parseInt(returnedInput,10) || 0) : 0;
    if (returnCount > 0 && returnDisposition === "rto") { const expected = rtoServiceType === "premium" ? 11 : 14; if (!new RegExp(`^\\d{${expected}}$`).test(rtoDocket.trim())) { alert(`${rtoServiceType === "premium" ? "Premium / Fast Track" : "Normal"} RTO docket must contain exactly ${expected} digits. Scan or enter it again.`); return; } }
    const returned = hadReturns ? (parseInt(returnedInput,10) || 0) : 0;
    const pickupDetails = hadPickup ? selectedPickupClients
      .filter((client) => client !== "Other")
      .map((client) => ({ client, count: Math.max(0, parseInt(pickupQuantities[client], 10) || 0) }))
      .filter((item) => item.count > 0) : [];
    const otherCount = 0;
    const pickup = hadPickup ? pickupDetails.reduce((sum, item) => sum + item.count, 0) : 0;
    if (hadPickup && selectedPickupClients.length === 0) return;
    if (hadPickup && selectedPickupClients.some((client) => (parseInt(pickupQuantities[client], 10) || 0) < 0)) return;
    await updateRec("rounds", closingRound.id, {
      closed: true, approved: "pending", returnedCount: returned, pickupCount: pickup,
      pickupDetails, pickupOtherCount: otherCount,
      deliveredFinal: Math.max(0, closingRound.deliveryCount - returned),
      undeliveredReason: returned > 0 ? undeliveredReason : "",
      returnType: returned > 0 ? returnDisposition : "delivered",
      rtoDocketNumber: returned > 0 && returnDisposition === "rto" ? rtoDocket.trim() : "",
      closedBy: user.name, closedById: user.id, closedAtMs: Date.now(),
    });
    setClosingRound(null);
  };

  // Only admin/founder-APPROVED rounds count toward official totals (prevents fake entries).
  const dayDelivered = myRoundsToday.reduce((s,r)=> s + (r.closed && r.approved==="approved" ? r.deliveredFinal : 0), 0);
  const dayPickup = myRoundsToday.reduce((s,r)=> s + (r.closed && r.approved==="approved" ? (r.pickupCount||0) : 0), 0);
  const dayReturned = myRoundsToday.reduce((s,r)=> s + (r.closed && r.approved==="approved" ? (r.returnedCount||0) : 0), 0);
  const dayPendingCount = myRoundsToday.filter(r=>r.closed && r.approved==="pending").length;

  const thisMonth = monthKey(todayISO());
  const monthRounds = rounds.filter(r=>r.riderId===targetId && monthKey(r.date)===thisMonth && r.closed && r.approved==="approved");
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
      {dayPendingCount > 0 && (
        <p style={{fontSize:11,color:"#F5A623",textAlign:"center"}}>{dayPendingCount} round(s) closed but awaiting Admin/Founder approval — not counted yet.</p>
      )}

      <div className="card" style={{display:"flex",flexDirection:"column",gap:10,borderColor: openRounds.length ? "rgba(245,166,35,0.45)" : undefined}}>
        <div className="section-label">Start Delivery Trip {nextDeliveryNumber}</div>
        {openRounds.length > 0 && <p style={{fontSize:12,color:"#F5A623",margin:0}}>If another DRS belongs to the same physical trip, choose that trip below. It will count as one delivery trip, while each DRS keeps its own parcel and return details.</p>}
        <div style={{display:"flex",gap:8}}>
          <input value={drs} onChange={(e)=>setDrs(e.target.value)} placeholder="DRS Number (mandatory)" className="input" style={{flex:1,borderColor:isDuplicateDrs?"#E5484D":undefined}}/>
          <button onClick={()=>setScanning(true)} className="btn-ghost" style={{display:"flex",alignItems:"center",gap:4,whiteSpace:"nowrap"}}>
            <ScanLine size={14}/> Scan
          </button>
        </div>
        {isDuplicateDrs && <div role="alert" style={{fontSize:12,color:"#E5484D",background:"rgba(229,72,77,0.10)",border:"1px solid rgba(229,72,77,0.45)",borderRadius:8,padding:10}}>DRS already added. This number exists in {duplicateDrsRound.roundType === "pickup" ? "a pickup round" : `Delivery Round ${duplicateDrsRound.roundNumber || ""}`} on {duplicateDrsRound.date || "an earlier date"}. You cannot add it again.</div>}
        {openDeliveryRounds.length>0 && <div style={{display:"flex",flexDirection:"column",gap:5}}><label style={{fontSize:11,color:"#7C8592"}}>Does this DRS belong to an already-started trip?</label><select value={groupWithRoundId} onChange={e=>setGroupWithRoundId(e.target.value)} className="input"><option value="">No — start a new delivery trip</option>{openDeliveryRounds.map(or=><option key={or.id} value={or.id}>Same trip as DRS {or.drsNumber} (Trip {or.roundNumber})</option>)}</select></div>}
        <input type="number" value={deliveryCount} onChange={(e)=>setDeliveryCount(e.target.value)} placeholder="How many parcels are you taking" className="input font-mono"/>
        <input type="number" min="0.1" step="0.1" value={weightKg} onChange={(e)=>setWeightKg(e.target.value)} placeholder="Total parcel weight in kg (optional)" className="input font-mono"/>
        <p style={{fontSize:11,color:"#7C8592",margin:"-4px 0 0"}}>Optional: add the approximate total weight of parcels in this DRS. Leave blank if unknown.</p>
        <button onClick={startRound} disabled={!/^\d{19}$/.test(drs.trim()) || isDuplicateDrs || !deliveryCount || Number(deliveryCount) <= 0} className="btn-primary">{isDuplicateDrs ? "DRS Already Added" : `Start Delivery Trip ${nextDeliveryNumber}`}</button>
      </div>

      <div className="card" style={{display:"flex",flexDirection:"column",gap:10,borderColor:"rgba(245,166,35,0.4)"}}>
        <div className="section-label">Pickup Only</div>
        <p style={{fontSize:12,color:"#7C8592",margin:0}}>Use this when you are only collecting pickups and have no delivery DRS. This creates a separate pickup entry for approval.</p>
        <button onClick={()=>{setSelectedPickupClients([]);setPickupQuantities({});setShowOtherPickupClients(false);setShowPickupRound(true);}} className="btn-primary">Start Pickup Round</button>
      </div>

      <div>
        <div className="section-label">Today's Rounds</div>
        <div className="list-card">
          {myRoundsToday.length===0 ? <div style={{padding:16,fontSize:13,color:"#7C8592"}}>No rounds yet.</div> :
            myRoundsToday.map(r=>(
              <div key={r.id} className="list-row" style={{overflowX:"auto",alignItems:"flex-start",gap:14}}><div style={{minWidth:240,flex:"1 0 240px"}}>
                  <div style={{fontSize:13,fontWeight:600}}>{r.roundType === "pickup" ? `Pickup Round ${r.roundNumber}` : `Delivery Trip ${r.roundNumber} · DRS ${r.drsNumber}`}</div>
                  <div style={{fontSize:11,color:"#7C8592"}} className="font-mono">
                    Out: {r.roundType === "pickup" ? `Pickup parcels: ${r.pickupCount ?? 0}` : r.deliveryCount}{r.weightKg != null ? ` · Weight: ${r.weightKg} kg` : ""} {r.roundType === "pickup" ? "" : (r.closed ? `· Delivered: ${r.deliveredFinal} · Returned: ${r.returnedCount} · Pickup: ${r.pickupCount}` : "· Pending closure")}
                    {r.pickupDetails?.length > 0 && <div style={{fontSize:10,color:"#F5A623",marginTop:3}}>Clients: {r.pickupDetails.map((p)=>`${p.client} (${p.count})`).join(", ")}{r.pickupOtherCount ? `, Other (${r.pickupOtherCount})` : ""}</div>}
                    {r.approvedBy && <div style={{fontSize:10,color:"#8AA5FF",marginTop:3}}>{r.approved} by {r.approvedBy} · {r.approvedAtMs ? new Date(r.approvedAtMs).toLocaleString("en-IN") : "time unavailable"}</div>}
                  </div>
                </div>
                <div style={{display:"flex",alignItems:"center",gap:8,flex:"0 0 auto",minWidth:"max-content",paddingBottom:4}}>
                  {!r.closed && r.roundType !== "pickup" && <>
                    <span className="badge badge-pending">open</span>
                    <button onClick={()=>openCloseModal(r)} className="btn-primary" style={{padding:"5px 8px",fontSize:10}}>Close Round {r.roundNumber}</button>
                  </>}
                  {r.closed && r.approved==="pending" && <span className="badge badge-pending">awaiting approval</span>}
                  {r.closed && r.approved==="approved" && <span className="badge badge-approved">approved</span>}
                  {r.closed && r.approved==="rejected" && <span className="badge badge-rejected">rejected</span>}
                  {isAdmin && r.closed && r.approved==="pending" && (
                    <>
                      <button onClick={()=>updateRec("rounds", r.id, { approved: "approved", approvedBy: user.name, approvedById: user.id, approvedAtMs: Date.now() })} className="btn-ghost" style={{padding:"4px 8px",fontSize:10,borderColor:"#3DDC97",color:"#3DDC97"}}>
                        Approve
                      </button>
                      <button onClick={()=>updateRec("rounds", r.id, { approved: "rejected", approvedBy: user.name, approvedById: user.id, approvedAtMs: Date.now() })} className="btn-ghost" style={{padding:"4px 8px",fontSize:10,borderColor:"#E5484D",color:"#E5484D"}}>
                        Reject
                      </button>
                    </>
                  )}
                  {isFounder && (
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
        <div className="section-label">This Month's Total · Tap for date-wise details</div>
        <div className="stat-grid">
          <button type="button" onClick={()=>setMonthDetail(monthDetail==="delivered"?"":"delivered")} className="card" style={{textAlign:"left",cursor:"pointer",borderColor:monthDetail==="delivered"?"#3DDC97":"#2A3038",color:"inherit"}}>
            <div className="font-mono" style={{fontSize:28,color:"#3DDC97"}}>{monthDelivered}</div><div style={{fontSize:11,color:"#7C8592",textTransform:"uppercase"}}>Total Delivered</div><div style={{fontSize:10,color:"#3DDC97",marginTop:5}}>Tap to view dates ↗</div>
          </button>
          <button type="button" onClick={()=>setMonthDetail(monthDetail==="pickup"?"":"pickup")} className="card" style={{textAlign:"left",cursor:"pointer",borderColor:monthDetail==="pickup"?"#F5A623":"#2A3038",color:"inherit"}}>
            <div className="font-mono" style={{fontSize:28,color:"#F5A623"}}>{monthPickup}</div><div style={{fontSize:11,color:"#7C8592",textTransform:"uppercase"}}>Total Pickup</div><div style={{fontSize:10,color:"#F5A623",marginTop:5}}>Tap to view dates & clients ↗</div>
          </button>
        </div>
        {monthDetail && <div style={{marginTop:12,borderTop:"1px solid #2A3038",paddingTop:10}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,marginBottom:8}}><div className="section-label" style={{margin:0}}>{monthDetail==="delivered"?"Delivered · Date-wise":"Pickup · Date-wise clients"}</div><button type="button" className="btn-ghost" onClick={()=>setMonthDetail("")}>Close</button></div>
          {(() => {
            const daily = {};
            monthRounds.forEach(x=>{ const d=daily[x.date] ||= {date:x.date,delivered:0,pickup:0,clients:{},records:[]}; d.delivered += Number(x.deliveredFinal)||0; d.pickup += Number(x.pickupCount)||0; d.records.push(x); (Array.isArray(x.pickupDetails)?x.pickupDetails:[]).forEach(v=>{d.clients[v.client]=(d.clients[v.client]||0)+(Number(v.count)||0);}); });
            const rows=Object.values(daily).filter(d=>monthDetail==="delivered"?d.delivered>0:d.pickup>0).sort((a,b)=>a.date<b.date?1:-1);
            return rows.length ? rows.map(d=><div key={d.date} style={{padding:"10px 0",borderBottom:"1px solid #252B33"}}>
              <div style={{display:"flex",justifyContent:"space-between",gap:8,fontWeight:700,fontSize:12}}><span>{fmtDate(d.date)}</span><span style={{color:monthDetail==="delivered"?"#9BE7BD":"#F5A623"}}>{monthDetail==="delivered"?`${d.delivered} delivered`:`${d.pickup} pickup parcels`}</span></div>
              {monthDetail==="pickup" && (Object.keys(d.clients).length ? Object.entries(d.clients).map(([client,count])=><div key={client} style={{fontSize:11,color:"#F5A623",marginTop:4}}>{client}: {count} parcels</div>) : <div style={{fontSize:11,color:"#7C8592",marginTop:4}}>Client details not saved for this date.</div>)}
              {monthDetail==="delivered" && <div style={{fontSize:10,color:"#7C8592",marginTop:4}}>{d.records.filter(x=>Number(x.deliveredFinal)>0).map(x=>`DRS ${x.drsNumber||"—"}: ${Number(x.deliveredFinal)||0}`).join(" · ")}</div>}
            </div>) : <div style={{fontSize:12,color:"#7C8592",padding:"8px 0"}}>No approved {monthDetail} records for this month.</div>;
          })()}
        </div>}
      </div>
      </>
      )}

      {showPickupRound && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.78)",display:"flex",alignItems:"center",justifyContent:"center",padding:16,zIndex:60}}>
          <div className="card" style={{maxWidth:440,width:"100%",maxHeight:"88vh",overflowY:"auto",display:"flex",flexDirection:"column",gap:12}}>
            <div className="section-label">Start Pickup Round</div>
            <p style={{fontSize:12,color:"#7C8592",margin:0}}>Select pickup clients and enter parcel counts. This round is separate from delivery rounds.</p>
            {(() => { const assigned = RIDER_PICKUP_CLIENTS[user.name] || []; const otherClients = PICKUP_CLIENTS.filter(client => client !== "Other" && !assigned.includes(client)); const visible = showOtherPickupClients ? [...assigned,...otherClients] : assigned; return <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {visible.map(client => { const selected = selectedPickupClients.includes(client); return <div key={client} style={{border:"1px solid #2A3038",borderRadius:8,padding:8}}><label style={{display:"flex",alignItems:"center",gap:8,fontSize:12}}><input type="checkbox" checked={selected} onChange={e=>setSelectedPickupClients(prev=>e.target.checked?[...prev,client]:prev.filter(x=>x!==client))}/><span style={{fontWeight:assigned.includes(client)?700:400,color:assigned.includes(client)?"#F5A623":"#EDEAE1"}}>{client}</span></label>{selected && <input type="number" min="1" value={pickupQuantities[client]||""} onChange={e=>setPickupQuantities(prev=>({...prev,[client]:e.target.value}))} placeholder="Parcel count" className="input font-mono" style={{marginTop:6}}/>}</div>; })}
              <label style={{display:"flex",alignItems:"center",gap:8,fontSize:12,border:"1px solid #2A3038",borderRadius:8,padding:10}}><input type="checkbox" checked={showOtherPickupClients} onChange={e=>setShowOtherPickupClients(e.target.checked)}/><span style={{fontWeight:700,color:"#F5A623"}}>Other — show all remaining pickup clients</span></label>
            </div>; })()}
            <div style={{fontSize:12,color:"#F5A623"}}>Pickup total: {selectedPickupClients.filter(c=>c!=="Other").reduce((sum,c)=>sum+Math.max(0,parseInt(pickupQuantities[c],10)||0),0)} parcels</div>
            <input type="number" min="0.1" step="0.1" value={pickupWeightKg} onChange={e=>setPickupWeightKg(e.target.value)} placeholder="Total pickup weight in kg (optional)" className="input font-mono"/>
            <button onClick={startPickupRound} className="btn-primary">Submit Pickup Round for Approval</button>
            <button onClick={()=>setShowPickupRound(false)} style={{background:"none",border:"none",color:"#7C8592",fontSize:12,cursor:"pointer"}}>Cancel</button>
          </div>
        </div>
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
            {hadReturns && (<>
              <input type="number" min="0" max={closingRound.deliveryCount} value={returnedInput} onChange={(e)=>setReturnedInput(e.target.value)} placeholder="How many were undelivered / returned" className="input font-mono"/>
              <label style={{fontSize:12,color:"#EDEAE1"}}>Why were these parcels undelivered?</label>
              <select value={undeliveredReason} onChange={e=>setUndeliveredReason(e.target.value)} className="input">
                <option value="">Select reason</option><option value="CX rejected">CX rejected</option><option value="Customer unavailable">Customer unavailable</option><option value="Phone number unavailable">Phone number unavailable</option><option value="Short / incorrect address">Short / incorrect address</option><option value="Other">Other</option>
              </select>
              <label style={{fontSize:12,color:"#EDEAE1"}}>Parcel status</label>
              <select value={returnDisposition} onChange={e=>setReturnDisposition(e.target.value)} className="input"><option value="undelivered">Undelivered / attempt failed</option><option value="rto">RTO</option></select>
              {returnDisposition === "rto" && <>
                <label style={{fontSize:12,color:"#EDEAE1"}}>RTO service type</label>
                <select value={rtoServiceType} onChange={e=>{setRtoServiceType(e.target.value);setRtoDocket("");}} className="input"><option value="normal">Normal — 14 digit docket</option><option value="premium">Premium / Fast Track — 11 digit docket</option></select>
                <label style={{fontSize:12,color:"#EDEAE1"}}>RTO docket number (required, {rtoServiceType === "premium" ? "11" : "14"} digits)</label>
                <div style={{display:"flex",gap:8}}><input inputMode="numeric" value={rtoDocket} onChange={e=>setRtoDocket(e.target.value.replace(/\D/g,"").slice(0,rtoServiceType === "premium" ? 11 : 14))} placeholder={rtoServiceType === "premium" ? "11-digit premium docket" : "14-digit normal docket"} className="input font-mono" style={{flex:1,minWidth:0}}/><button type="button" className="btn-ghost" onClick={()=>{setScanTarget("rto");setScanning(true);}} style={{whiteSpace:"nowrap"}}>Scan docket</button></div>
                <div style={{fontSize:11,color:rtoDocket.length === (rtoServiceType === "premium" ? 11 : 14) ? "#3DDC97" : "#F5A623"}}>{rtoDocket.length}/{rtoServiceType === "premium" ? 11 : 14} digits entered</div>
              </>}
            </>)}

            <p style={{fontSize:13,marginTop:6}}>Did you bring any pickups this round?</p>
            <div style={{display:"flex",gap:8}}>
              <button onClick={()=>setHadPickup(false)} className="btn-ghost" style={{flex:1, borderColor: hadPickup===false?"#3DDC97":"#2A3038", color: hadPickup===false?"#3DDC97":"#7C8592"}}>No</button>
              <button onClick={()=>setHadPickup(true)} className="btn-ghost" style={{flex:1, borderColor: hadPickup===true?"#F5A623":"#2A3038", color: hadPickup===true?"#F5A623":"#7C8592"}}>Yes</button>
            </div>
            {hadPickup && (() => {
              const assigned = RIDER_PICKUP_CLIENTS[user.name] || [];
              const otherClients = PICKUP_CLIENTS.filter((client) => client !== "Other" && !assigned.includes(client));
              const orderedClients = showOtherPickupClients ? [...assigned, ...otherClients] : assigned;
              return (
                <div style={{display:"flex",flexDirection:"column",gap:8,maxHeight:"55vh",overflowY:"auto",overscrollBehavior:"contain",paddingRight:4}}>
                  <p style={{fontSize:11,color:"#7C8592"}}>Your regular pickup clients are shown first. Select each client and enter parcel quantities. Use Other only when you collected from a client not in your regular list.</p>
                  {orderedClients.map((client) => {
                    const selected = selectedPickupClients.includes(client);
                    return (
                      <div key={client} style={{border:"1px solid #2A3038",borderRadius:8,padding:8}}>
                        <label style={{display:"flex",alignItems:"center",gap:8,fontSize:12}}>
                          <input type="checkbox" checked={selected} onChange={(e)=>setSelectedPickupClients((prev)=>e.target.checked ? [...prev,client] : prev.filter((x)=>x!==client))}/>
                          <span style={{fontWeight:assigned.includes(client)?700:400,color:assigned.includes(client)?"#F5A623":"#EDEAE1"}}>{client}</span>
                          {assigned.includes(client) && <span className="badge badge-approved">Assigned</span>}
                        </label>
                        {selected && <input type="number" min="0" value={pickupQuantities[client] || ""} onChange={(e)=>setPickupQuantities((prev)=>({...prev,[client]:e.target.value}))} placeholder={client==="Other"?"Other client parcel count":"Parcel count"} className="input font-mono" style={{marginTop:6}}/>}
                      </div>
                    );
                  })}
                  <div style={{border:"1px solid #2A3038",borderRadius:8,padding:10}}>
                    <label style={{display:"flex",alignItems:"center",gap:8,fontSize:12}}>
                      <input type="checkbox" checked={showOtherPickupClients} onChange={(e)=>{setShowOtherPickupClients(e.target.checked); if(!e.target.checked) setSelectedPickupClients(prev=>prev.filter(c=>!otherClients.includes(c)));}}/>
                      <span style={{fontWeight:700,color:"#F5A623"}}>Other — show all remaining pickup clients</span>
                    </label>
                    {showOtherPickupClients && <p style={{fontSize:10,color:"#7C8592",margin:"6px 0 0"}}>Select the actual client(s) below. Do not enter a parcel count against Other itself.</p>}
                  </div>
                  {showOtherPickupClients && <button type="button" onClick={()=>setShowOtherPickupClients(false)} className="btn-primary" style={{width:"100%",position:"sticky",bottom:0,zIndex:2,boxShadow:"0 -6px 12px rgba(0,0,0,0.25)",marginTop:4}}>Save Other Clients & Return</button>}
                  <div style={{fontSize:12,color:"#F5A623"}}>Pickup parcel total: {selectedPickupClients.filter(client=>client!=="Other").reduce((sum,client)=>sum + Math.max(0,parseInt(pickupQuantities[client],10)||0),0)}</div>
                </div>
              );
            })()}

            <button onClick={confirmClose} disabled={hadReturns===null || hadPickup===null || (hadReturns && Number(returnedInput)>0 && (!undeliveredReason || (returnDisposition === "rto" && !rtoDocket.trim())))} className="btn-primary">Confirm & Close</button>
            <button onClick={()=>setClosingRound(null)} style={{background:"none",border:"none",color:"#7C8592",fontSize:12,cursor:"pointer"}}>Cancel</button>
          </div>
        </div>
      )}

      {scanning && (
        <BarcodeScanModal mode={scanTarget} expectedLength={scanTarget === "rto" ? (rtoServiceType === "premium" ? 11 : 14) : 19} onDetect={(val)=>{ if(scanTarget === "rto") setRtoDocket(val); else setDrs(val); setScanning(false); }} onClose={()=>setScanning(false)} />
      )}
    </div>
  );
}

function BarcodeScanModal({ onDetect, onClose, mode="drs", expectedLength=19 }) {
  const videoRef = useRef(null);
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(true);

  useEffect(() => {
    let stream, raf, stopped = false, detector;
    const stopStream = () => { if (stream) stream.getTracks().forEach((track) => track.stop()); };
    (async () => {
      if (!window.isSecureContext) {
        setError("Camera requires a secure HTTPS connection. Open Rider Ops using its https:// website address.");
        setStarting(false); return;
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        setError("This browser does not provide camera access. Update Chrome or type the 19-digit DRS number manually.");
        setStarting(false); return;
      }
      if (!("BarcodeDetector" in window)) {
        setError("Barcode scanning is not supported by this browser. Type the required number manually, or use an updated Chrome browser.");
        setStarting(false); return;
      }
      try {
        detector = new window.BarcodeDetector();
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
        } catch (firstError) {
          // Some phones fail on the rear-camera constraint; retry with any available camera.
          if (firstError?.name === "NotAllowedError" || firstError?.name === "SecurityError") throw firstError;
          stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        }
        if (stopped) { stopStream(); return; }
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setStarting(false);
        const tick = async () => {
          if (stopped) return;
          try {
            const codes = await detector.detect(videoRef.current);
            if (codes.length > 0) {
              const value = String(codes[0].rawValue || "").trim();
              if (new RegExp(`^\\d{${expectedLength}}$`).test(value)) { onDetect(value); return; }
              setError(mode === "rto" ? `Invalid RTO docket: scan must contain exactly ${expectedLength} digits for the selected service.` : "This is not a DRS number. The scanned code must contain exactly 19 digits. Please scan again or enter it manually.");
              setStarting(false);
              // Keep camera alive so the rider can try scanning another label.
            }
          } catch {}
          raf = requestAnimationFrame(tick);
        };
        tick();
      } catch (e) {
        const name = e?.name || "";
        if (name === "NotAllowedError" || name === "PermissionDeniedError" || name === "SecurityError") {
          setError("Camera permission is blocked. In Chrome, tap the site icon beside the address → Permissions → Camera → Allow, then reload Rider Ops.");
        } else if (name === "NotFoundError" || name === "DevicesNotFoundError") {
          setError("No camera was found on this device. Type the required number manually.");
        } else if (name === "NotReadableError" || name === "TrackStartError") {
          setError("The camera is busy in another app. Close Camera/WhatsApp video, then try again.");
        } else {
          setError("Camera could not start. Check site camera permission, close other apps using the camera, and try again. You can also type the 19-digit DRS number manually.");
        }
        setStarting(false);
      }
    })();
    return () => { stopped = true; if (raf) cancelAnimationFrame(raf); stopStream(); };
  }, [onDetect]);

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.92)",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",zIndex:60,padding:20}}>
      {error ? (
        <div className="card" style={{maxWidth:360,textAlign:"center"}}>
          <p style={{fontSize:13,color:"#E5484D",marginBottom:12}}>{error}</p>
          <button onClick={() => { setError(""); setStarting(true); onClose(); }} className="btn-primary">Close Scanner</button>
        </div>
      ) : (
        <>
          <video ref={videoRef} style={{width:"100%",maxWidth:360,borderRadius:12,background:"#111"}} muted playsInline/>
          <p style={{color:"#B9C0CA",fontSize:12,marginTop:12}}>{starting ? "Starting camera…" : "Point camera at the 19-digit DRS barcode"}</p>
          <button onClick={onClose} className="btn-ghost" style={{marginTop:12}}>Cancel</button>
        </>
      )}
    </div>
  );
}

// ---------------- Mileage (odometer + payment, admin-only amounts) ----------------
function MileageTab({ user, isAdmin, riders, odometer, riderName }) {
  const [viewRiderId, setViewRiderId] = useState(isAdmin ? (riders.find(r=>r.role==="rider")?.id || "") : user.id);
  const [date, setDate] = useState(todayISO());
  const [morning, setMorning] = useState("");
  const [evening, setEvening] = useState("");

  const targetId = isAdmin ? viewRiderId : user.id;
  const canSeeAmounts = isAdmin || !isAdmin; // rider can always see own amounts
  const existing = odometer.find(o=>o.riderId===targetId && o.date===date);

  useEffect(()=>{ setMorning(existing?.morning ?? ""); setEvening(existing?.evening ?? ""); },[date, targetId]); // eslint-disable-line

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

// ---------------- Personal Fuel Log (rider's own ₹ spend) ----------------
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

// ---------------- Calendar (monthly, holidays green, leave days red) ----------------
function LeaderboardTab({ rounds, riders, user, riderName, duty = [], leaves = [] }) {
  const thisMonth = monthKey(todayISO());
  const monthLabel = new Date(todayISO()+"T00:00:00").toLocaleDateString("en-IN",{month:"long",year:"numeric"});
  const current = riderTotalsForMonth(rounds, thisMonth, duty, leaves, riders);

  // Build Hall of Fame: every past month (before this one) that has at least one
  // approved round, with its winner.
  const pastMonthKeys = useMemo(() => {
    const keys = new Set();
    rounds.forEach((r) => { if (r.closed && r.approved==="approved" && monthKey(r.date) < thisMonth) keys.add(monthKey(r.date)); });
    return [...keys].sort((a,b)=> a<b?1:-1);
  }, [rounds, thisMonth]);

  const hallOfFame = pastMonthKeys.map((mk) => {
    const totals = riderTotalsForMonth(rounds, mk, duty, leaves, riders);
    return { month: mk, winner: totals[0] };
  }).filter((h) => h.winner);

  const monthLabelFor = (mk) => new Date(mk+"-01T00:00:00").toLocaleDateString("en-IN",{month:"long",year:"numeric"});

  return (
    <div style={{display:"flex",flexDirection:"column",gap:16}}>
      <div className="card" style={{textAlign:"center"}}>
        <Trophy size={24} color="#F5A623" style={{marginBottom:6}}/>
        <div className="font-display" style={{fontSize:16,fontWeight:700}}>Leaderboard — {monthLabel}</div>
        <p style={{fontSize:11,color:"#7C8592",marginTop:4}}>Overall score: Delivery 60% · Pickup stops 30% · On-time & leave discipline 10%. Only approved rounds count.</p>
      </div>

      <div className="list-card">
        {current.length===0 ? (
          <div style={{padding:16,fontSize:13,color:"#7C8592"}}>No approved rounds yet this month.</div>
        ) : current.map((entry, i) => (
          <div key={entry.riderId} className="list-row" style={entry.riderId===user.id ? {background:"rgba(245,166,35,0.07)"} : {}}>
            <div style={{flex:1,minWidth:0}}>
              <div style={{display:"flex",alignItems:"center",gap:10}}>
                <div className="font-mono" style={{fontSize:14,color:i===0?"#F5A623":"#7C8592",width:20}}>{i===0 ? <Trophy size={16} color="#F5A623"/> : `#${i+1}`}</div>
                <div style={{fontSize:13,fontWeight:600}}>{riderName(entry.riderId)}{entry.riderId===user.id && " (You)"}</div>
              </div>
              <div style={{fontSize:10,color:"#7C8592",marginTop:5,marginLeft:30}}>Delivery {entry.deliveryPct.toFixed(1)}% · Pickup {entry.pickupPct.toFixed(1)}% · Behaviour {entry.behaviourPct.toFixed(1)}%</div>
            </div>
            <div style={{textAlign:"right",marginLeft:8}}><div className="font-mono" style={{fontSize:15,color:"#3DDC97"}}>{entry.total.toFixed(1)}%</div><div style={{fontSize:9,color:"#7C8592"}}>overall</div></div>
          </div>
        ))}
      </div>

      <div>
        <div className="section-label">Hall of Fame — Rider of the Month</div>
        <div className="list-card">
          {hallOfFame.length===0 ? (
            <div style={{padding:16,fontSize:13,color:"#7C8592"}}>No completed months yet.</div>
          ) : hallOfFame.map((h) => (
            <div key={h.month} className="list-row">
              <div>
                <div style={{fontSize:13,fontWeight:600,display:"flex",alignItems:"center",gap:6}}>
                  <Trophy size={13} color="#F5A623"/> {riderName(h.winner.riderId)}
                </div>
                <div style={{fontSize:11,color:"#7C8592"}}>{monthLabelFor(h.month)}</div>
              </div>
              <div className="font-mono" style={{fontSize:13,color:"#3DDC97"}}>{h.winner.total}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function nthWeekdayOfMonth(year, monthIndex, weekday, nth) {
  const first = new Date(year, monthIndex, 1).getDay();
  return 1 + ((weekday - first + 7) % 7) + (nth - 1) * 7;
}
function getDateObservances(iso) {
  const d = new Date(iso + "T00:00:00");
  const y = d.getFullYear(), m = d.getMonth(), day = d.getDate(), dow = d.getDay();
  const fixed = {
    "01-01": ["New Year's Day"], "01-24": ["International Day of Education"],
    "01-26": ["Republic Day (India)"], "02-14": ["Valentine's Day"],
    "03-08": ["International Women's Day"], "03-20": ["International Day of Happiness"],
    "04-07": ["World Health Day"], "04-22": ["Earth Day"],
    "05-01": ["International Workers' Day / Labour Day"], "05-11": ["National Technology Day (India)"],
    "06-05": ["World Environment Day"], "06-21": ["International Yoga Day"],
    "07-11": ["World Population Day"], "08-15": ["Independence Day (India)"],
    "09-05": ["Teachers' Day (India)"], "09-21": ["International Day of Peace"],
    "10-02": ["Gandhi Jayanti", "International Day of Non-Violence"],
    "10-24": ["United Nations Day"], "11-14": ["Children's Day (India)"],
    "12-01": ["World AIDS Day"], "12-10": ["Human Rights Day"], "12-25": ["Christmas Day"],
  };
  const key = `${String(m+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
  const events = [...(fixed[key] || [])];
  if (m === 4 && dow === 0 && day === nthWeekdayOfMonth(y, 4, 0, 2)) events.push("Mother's Day (second Sunday of May)");
  if (m === 5 && dow === 0 && day === nthWeekdayOfMonth(y, 5, 0, 3)) events.push("Father's Day (third Sunday of June)");
  return events;
}
function CalendarTab({ holidays, persistHolidaysApi, leaves, riders, user, isAdmin, riderName }) {
  const [monthOffset, setMonthOffset] = useState(0);
  const [selectedDate, setSelectedDate] = useState(todayISO());
  const [newHolDate, setNewHolDate] = useState(todayISO());
  const [newHolName, setNewHolName] = useState("");
  const [newHolStatus, setNewHolStatus] = useState("holiday");
  const [newHolUntil, setNewHolUntil] = useState("13:00");
  const [editStatus, setEditStatus] = useState({});
  const [editUntil, setEditUntil] = useState({});
  const base = new Date();
  base.setDate(1);
  base.setMonth(base.getMonth() + monthOffset);
  const year = base.getFullYear(), month = base.getMonth();
  const daysInMonth = new Date(year, month+1, 0).getDate();
  const firstDow = new Date(year, month, 1).getDay();
  const monthLabel = base.toLocaleDateString("en-IN",{month:"long",year:"numeric"});
  const monthPrefix = `${year}-${String(month+1).padStart(2,"0")}`;
  const approvedLeaves = leaves.filter(l=>l.status==="approved");
  const days = Array.from({length: daysInMonth}, (_,i)=>i+1);
  const isoFor = (d) => `${year}-${String(month+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
  const myLeaveDays = approvedLeaves.filter(l=>l.riderId===user.id && l.date.startsWith(monthPrefix));
  const monthHolidays = holidays.filter(h=>h.date.startsWith(monthPrefix)).sort((a,b)=>a.date>b.date?1:-1);
  const selectedEvents = holidays.filter(h=>h.date===selectedDate);
  const selectedObservances = getDateObservances(selectedDate);
  const selectedLeave = approvedLeaves.filter(l=>l.date===selectedDate);
  const explicitStatus = selectedEvents.find(h=>h.workStatus)?.workStatus;
  const selectedStatus = explicitStatus || (isSunday(selectedDate) || selectedEvents.length ? "holiday" : "full-day");
  const statusLabel = selectedStatus === "half-day" ? `Working day · Half day${selectedEvents.find(h=>h.workUntil)?.workUntil ? ` · until ${selectedEvents.find(h=>h.workUntil).workUntil}` : ""}` : selectedStatus === "full-day" ? "Working day · Full day" : "Holiday / Non-working day";
  const statusColor = selectedStatus === "holiday" ? "#3DDC97" : selectedStatus === "half-day" ? "#F5A623" : "#8AA5FF";

  const addHoliday = async () => {
    if (!newHolName.trim() || !newHolDate) return;
    await addRec("holidays", { date: newHolDate, name: newHolName.trim(), source: "custom", workStatus: newHolStatus, ...(newHolStatus === "half-day" ? { workUntil: newHolUntil } : {}) });
    setSelectedDate(newHolDate);
    setNewHolName("");
  };
  const removeHoliday = (id) => deleteRec("holidays", id);
  const saveEventStatus = async (h) => {
    const status = editStatus[h.id] ?? h.workStatus ?? "holiday";
    const until = editUntil[h.id] ?? h.workUntil ?? "13:00";
    await updateRec("holidays", h.id, { workStatus: status, ...(status === "half-day" ? { workUntil: until } : { workUntil: "" }) });
  };
  const removeDuplicateHolidays = () => {
    const seen = new Set();
    holidays.forEach((h) => { const key = `${h.date}|${h.name}`; if (seen.has(key)) deleteRec("holidays", h.id); else seen.add(key); });
  };
  const hasDuplicates = useMemo(() => {
    const seen = new Set();
    for (const h of holidays) { const key = `${h.date}|${h.name}`; if (seen.has(key)) return true; seen.add(key); }
    return false;
  }, [holidays]);

  return (
    <div style={{display:"flex",flexDirection:"column",gap:16}}>
      <div className="card" style={{textAlign:"center",padding:"14px 16px",background:"linear-gradient(135deg,rgba(245,166,35,.10),rgba(138,165,255,.06))"}}>
        <div style={{fontSize:11,color:"#9AA3AF",textTransform:"uppercase",letterSpacing:"0.12em",fontWeight:700}}>Today</div>
        <div className="font-display" style={{fontSize:22,fontWeight:800,color:"#F5A623",marginTop:4}}>{fmtDate(todayISO())}</div>
        <div style={{fontSize:12,color:"#9AA3AF",marginTop:5}}>Tap any date to view festivals, observances and work status.</div>
      </div>

      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8}}>
        <button onClick={()=>setMonthOffset(m=>m-1)} className="btn-ghost">← Prev</button>
        <div className="font-display" style={{fontWeight:800,fontSize:18,textAlign:"center"}}>{monthLabel}</div>
        <button onClick={()=>setMonthOffset(m=>m+1)} className="btn-ghost">Next →</button>
      </div>

      <div>
        <div className="cal-grid" style={{marginBottom:8}}>
          {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map((d,i)=><div key={i} style={{textAlign:"center",fontSize:10,fontWeight:800,color:"#9AA3AF",letterSpacing:"0.04em"}}>{d}</div>)}
        </div>
        <div className="cal-grid">
          {Array.from({length:firstDow},(_,i)=><div key={`blank-${i}`}/>) }
          {days.map(d=>{
            const iso = isoFor(d);
            const evs = holidays.filter(h=>h.date===iso);
            const obs = getDateObservances(iso);
            const override = evs.find(h=>h.workStatus)?.workStatus;
            const dayStatus = override || (isSunday(iso)||evs.length ? "holiday" : "full-day");
            const onLeave = approvedLeaves.some(l=>l.date===iso);
            const today = iso === todayISO(), selected = iso === selectedDate;
            const bg = dayStatus === "holiday" ? "rgba(61,220,151,.15)" : dayStatus === "half-day" ? "rgba(245,166,35,.14)" : (evs.length||obs.length) ? "rgba(138,165,255,.10)" : "#101317";
            const border = selected ? "2px solid #F5A623" : onLeave ? "1px solid rgba(229,72,77,.75)" : dayStatus === "holiday" ? "1px solid rgba(61,220,151,.45)" : dayStatus === "half-day" ? "1px solid rgba(245,166,35,.55)" : "1px solid #292E36";
            return <button key={d} type="button" className="cal-cell" onClick={()=>setSelectedDate(iso)} aria-label={`${fmtDate(iso)} details`} title={[...evs.map(h=>h.name),...obs].join(", ")} style={{background:bg,border,borderRadius:10,minHeight:52,color:selected?"#F5A623":dayStatus==="holiday"?"#3DDC97":"#E5E7EB",fontSize:14,fontWeight:today||selected?800:600,position:"relative",cursor:"pointer",boxShadow:selected?"0 0 0 1px rgba(245,166,35,.12)":"none"}}>
              {d}
              {(evs.length>0||obs.length>0) && <span style={{position:"absolute",bottom:5,left:"50%",transform:"translateX(-50%)",width:5,height:5,borderRadius:10,background:dayStatus==="holiday"?"#3DDC97":dayStatus==="half-day"?"#F5A623":"#8AA5FF"}}/>}
              {onLeave && <span style={{position:"absolute",top:4,right:4,width:5,height:5,borderRadius:10,background:"#E5484D"}}/>}
            </button>;
          })}
        </div>
      </div>

      <div style={{display:"flex",gap:12,flexWrap:"wrap",fontSize:11,color:"#9AA3AF"}}>
        <span><span style={{display:"inline-block",width:10,height:10,background:"rgba(61,220,151,.55)",borderRadius:3,marginRight:5}}/>Holiday / non-working</span>
        <span><span style={{display:"inline-block",width:10,height:10,background:"rgba(245,166,35,.55)",borderRadius:3,marginRight:5}}/>Half-day work</span>
        <span><span style={{display:"inline-block",width:10,height:10,background:"rgba(138,165,255,.55)",borderRadius:3,marginRight:5}}/>Observance / working event</span>
        <span><span style={{display:"inline-block",width:10,height:10,background:"rgba(229,72,77,.7)",borderRadius:3,marginRight:5}}/>Rider leave</span>
      </div>

      <div className="card" style={{display:"flex",flexDirection:"column",gap:12,borderColor:selectedStatus==="holiday"?"rgba(61,220,151,.4)":selectedStatus==="half-day"?"rgba(245,166,35,.5)":"rgba(138,165,255,.35)"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:10,flexWrap:"wrap"}}>
          <div>
            <div style={{fontSize:10,color:"#9AA3AF",textTransform:"uppercase",letterSpacing:".1em",fontWeight:800}}>Selected date details</div>
            <div className="font-display" style={{fontSize:20,fontWeight:800,marginTop:4}}>{new Date(selectedDate+"T00:00:00").toLocaleDateString("en-IN",{weekday:"long",day:"numeric",month:"long",year:"numeric"})}</div>
          </div>
          <span style={{fontSize:11,fontWeight:800,color:statusColor,background:`${statusColor}1A`,border:`1px solid ${statusColor}55`,borderRadius:8,padding:"7px 9px"}}>{statusLabel}</span>
        </div>
        {selectedEvents.length>0 || selectedObservances.length>0 ? <div style={{display:"flex",flexDirection:"column",gap:8}}>
          {selectedEvents.map(h=><div key={h.id} style={{background:"#101317",border:"1px solid #292E36",borderRadius:10,padding:11}}><div style={{fontSize:14,fontWeight:800}}>{h.name}</div><div style={{fontSize:11,color:"#9AA3AF",marginTop:3}}>{h.source==="auto"?"Festival / calendar entry":"Added by office"}</div></div>)}
          {selectedObservances.filter(name=>!selectedEvents.some(h=>h.name.toLowerCase()===name.toLowerCase())).map(name=><div key={name} style={{background:"#101317",border:"1px solid #292E36",borderRadius:10,padding:11,fontSize:13,fontWeight:700}}>{name}<div style={{fontSize:10,color:"#9AA3AF",fontWeight:400,marginTop:3}}>Calendar observance</div></div>)}
        </div> : <div style={{fontSize:12,color:"#9AA3AF",background:"#101317",padding:12,borderRadius:10}}>No festival or major observance is listed for this date. It is still a selectable calendar day.</div>}
        {isSunday(selectedDate) && <div style={{fontSize:12,color:"#3DDC97",fontWeight:700}}>Sunday · Weekly off (unless an office working status is set below).</div>}
        {selectedLeave.length>0 && <div style={{fontSize:12,color:"#E57378"}}>Riders on approved leave: {selectedLeave.map(l=>riderName(l.riderId)).join(", ")}</div>}
        {isAdmin && selectedEvents.length>0 && <div style={{display:"flex",flexDirection:"column",gap:10,borderTop:"1px solid #292E36",paddingTop:12}}>
          <div className="section-label">Set office working status for this festival</div>
          {selectedEvents.map(h=><div key={`edit-${h.id}`} style={{display:"flex",flexDirection:"column",gap:7,background:"#101317",padding:10,borderRadius:10}}>
            <div style={{fontSize:12,fontWeight:700}}>{h.name}</div>
            <select className="input" value={editStatus[h.id] ?? h.workStatus ?? "holiday"} onChange={e=>setEditStatus(v=>({...v,[h.id]:e.target.value}))}>
              <option value="holiday">Festival + non-working / holiday</option><option value="full-day">Festival but working · Full day</option><option value="half-day">Festival but working · Half day</option>
            </select>
            {(editStatus[h.id] ?? h.workStatus ?? "holiday")==="half-day" && <input aria-label="Half-day work until" className="input" type="time" value={editUntil[h.id] ?? h.workUntil ?? "13:00"} onChange={e=>setEditUntil(v=>({...v,[h.id]:e.target.value}))}/>}
            <div style={{display:"flex",gap:8}}><button className="btn-primary" onClick={()=>saveEventStatus(h)} style={{flex:1}}>Save work status</button><button onClick={()=>removeHoliday(h.id)} className="btn-ghost" aria-label={`Delete ${h.name}`}><Trash2 size={15}/></button></div>
          </div>)}
        </div>}
      </div>

      <div>
        <div className="section-label">Riders on leave this month</div>
        <div className="list-card">
          {approvedLeaves.filter(l=>l.date.startsWith(monthPrefix)).length===0 ? <div style={{padding:16,fontSize:13,color:"#7C8592"}}>No approved leave this month.</div> : approvedLeaves.filter(l=>l.date.startsWith(monthPrefix)).sort((a,b)=>a.date>b.date?1:-1).map(l=><div key={l.id} className="list-row"><div style={{fontSize:13,fontWeight:600}}>{riderName(l.riderId)}</div><div className="font-mono" style={{fontSize:12,color:"#E5484D"}}>{fmtDate(l.date)}</div></div>)}
        </div>
      </div>
      {myLeaveDays.length>0 && <div><div className="section-label">Your leave this month</div><div className="list-card">{myLeaveDays.map(l=><div key={l.id} className="list-row"><div style={{fontSize:13}}>{l.customReason || l.reason}</div><div className="font-mono" style={{fontSize:12,color:"#E5484D"}}>{fmtDate(l.date)}</div></div>)}</div></div>}

      <div>
        <div className="section-label">Festivals & holidays this month</div>
        <div className="list-card">
          {monthHolidays.length===0 ? <div style={{padding:16,fontSize:13,color:"#7C8592"}}>No festivals listed this month.</div> : monthHolidays.map(h=>{
            const st = h.workStatus || "holiday";
            const stText = st==="half-day" ? `Working half day${h.workUntil?` · until ${h.workUntil}`:""}` : st==="full-day" ? "Working full day" : "Non-working / holiday";
            return <button key={h.id} type="button" onClick={()=>setSelectedDate(h.date)} style={{width:"100%",textAlign:"left",background:selectedDate===h.date?"rgba(245,166,35,.07)":"transparent",border:0,borderBottom:"1px solid #292E36",padding:13,color:"inherit",display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,cursor:"pointer"}}><div style={{minWidth:0}}><div style={{fontSize:13,fontWeight:800}}>{h.name}</div><div style={{fontSize:10,color:st==="holiday"?"#3DDC97":st==="half-day"?"#F5A623":"#8AA5FF",marginTop:4}}>{stText}</div></div><div className="font-mono" style={{fontSize:12,color:"#C5CBD4",whiteSpace:"nowrap"}}>{fmtDate(h.date)}</div></button>;
          })}
        </div>
        <p style={{fontSize:10,color:"#7C8592",marginTop:6,lineHeight:1.5}}>Built-in observances include common international and Indian dates (for example Mother's Day and Father's Day). This is not an exhaustive list of every global observance; lunar festival dates can vary by local calendar.</p>
      </div>

      {isAdmin && hasDuplicates && <button onClick={removeDuplicateHolidays} className="btn-ghost" style={{width:"100%",padding:10,borderColor:"rgba(229,72,77,0.4)",color:"#E5484D"}}>Remove Duplicate Festivals</button>}
      {isAdmin && <div className="card" style={{display:"flex",flexDirection:"column",gap:10}}>
        <div className="section-label">Add festival / observance / office holiday</div>
        <input aria-label="Event date" type="date" value={newHolDate} onChange={e=>setNewHolDate(e.target.value)} className="input font-mono"/>
        <input aria-label="Event name" value={newHolName} onChange={e=>setNewHolName(e.target.value)} placeholder="Name (e.g. Dussehra — Office Working)" className="input"/>
        <select aria-label="Office working status" className="input" value={newHolStatus} onChange={e=>setNewHolStatus(e.target.value)}>
          <option value="holiday">Festival + non-working / holiday</option><option value="full-day">Festival but working · Full day</option><option value="half-day">Festival but working · Half day</option>
        </select>
        {newHolStatus==="half-day" && <input aria-label="Work until time" type="time" className="input" value={newHolUntil} onChange={e=>setNewHolUntil(e.target.value)}/>}
        <button onClick={addHoliday} disabled={!newHolName.trim()||!newHolDate} className="btn-primary">Add event</button>
      </div>}
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
      <div className="card" style={{display:"flex",flexDirection:"column",gap:10}}>
        <div className="section-label">Aaj ka Panchang · {new Date().toLocaleDateString("en-IN",{weekday:"long",day:"numeric",month:"long",year:"numeric"})}</div>
        {todayISO()==="2026-10-14" ? <>
          <div style={{fontSize:20,fontWeight:800,color:"#F5A623"}}>आश्विन शुक्ल चतुर्थी</div>
          <div style={{fontSize:13,color:"#B9C0CA"}}>तिथि: शुक्ल चतुर्थी · नक्षत्र: अनुराधा · योग: आयुष्मान</div>
          <div style={{fontSize:12,color:"#7C8592",lineHeight:1.5}}>चतुर्थी तिथि 15 अक्टूबर को लगभग 1:13 AM तक; नक्षत्र और मुहूर्त स्थान के अनुसार बदल सकते हैं।</div>
        </> : <div style={{fontSize:12,color:"#B9C0CA",lineHeight:1.6}}>आज की सटीक तिथि, नक्षत्र, योग, करण, राहुकाल और मुहूर्त के लिए स्थान-आधारित लाइव पंचांग डेटा चाहिए। गलत तिथि दिखाने से बचने के लिए यहाँ अनुमान नहीं दिखाया जा रहा है।</div>}
        <a href="https://www.drikpanchang.com/panchang/day-panchang.html?geoname-id=2170078" target="_blank" rel="noreferrer" style={{color:"#F5A623",fontSize:12,fontWeight:700}}>पूरा दैनिक पंचांग देखें ↗</a>
      </div>
    </div>
  );
}

// ---------------- Announcements ----------------
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

// ---------------- Riders management (admin, role control founder-only) ----------------
function RidersTab({ user, riders, isFounder, officeSetting, adminRequests }) {
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
  // Admins may request deletion, but only Founder can execute it. Prevent self-delete.
  const requestDelete = async (rider) => {
    if (!user || rider.id === user.id || rider.role === "founder") return;
    await addRec("adminRequests", {
      type: "delete_rider", targetId: rider.id, targetName: rider.name,
      requestedById: user.id, requestedByName: user.name, status: "pending",
      createdAtMs: Date.now()
    });
    alert("Deletion request sent to Founder for approval.");
  };
  const approveDelete = async (req) => {
    if (!isFounder || req.status !== "pending" || !req.targetId) return;
    await deleteRec("riders", req.targetId);
    await updateRec("adminRequests", req.id, { status: "approved", reviewedBy: user.name, reviewedAtMs: Date.now() });
  };
  const rejectDelete = async (req) => {
    if (!isFounder || req.status !== "pending") return;
    await updateRec("adminRequests", req.id, { status: "rejected", reviewedBy: user.name, reviewedAtMs: Date.now() });
  };
  const setRole = (id, role) => updateRec("riders", id, { role, pin: role==="rider" ? "" : "1234" });
  const resetPin = (id) => updateRec("riders", id, { pin: "1234" });

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
        {riders.filter(r => isFounder || r.role !== "founder").map(r=>(
          <div key={r.id} className="list-row">
            <div>
              <div style={{fontSize:13,fontWeight:600,display:"flex",alignItems:"center",gap:6}}>
                {r.name} <span className="badge badge-pending">{r.role}</span>
              </div>
              <div style={{fontSize:11,color:"#7C8592"}} className="font-mono">{r.phone || "No phone added"} · PIN: hidden</div>
            </div>
            <div style={{display:"flex",gap:6,alignItems:"center"}}>
              {isFounder && r.role !== "founder" && (
                <select value={r.role} onChange={(e)=>setRole(r.id, e.target.value)} className="input" style={{width:"auto",padding:"4px 6px",fontSize:11}}>
                  <option value="rider">rider</option>
                  <option value="admin">admin</option>
                </select>
              )}
              {isFounder && r.role !== "founder" && (
                <button onClick={()=>resetPin(r.id)} className="btn-ghost" style={{padding:"4px 8px",fontSize:10}}>Reset PIN</button>
              )}
              {isFounder && r.role !== "founder" && <button onClick={()=>{ if (window.confirm(`Delete ${r.name}? This cannot be undone.`)) deleteRec("riders", r.id); }} style={{background:"none",border:"none",color:"#E5484D",cursor:"pointer"}}><Trash2 size={14}/></button>}
              {!isFounder && r.role !== "founder" && r.id !== user?.id && <button onClick={()=>requestDelete(r)} style={{background:"none",border:"none",color:"#7C8592",cursor:"pointer"}} title="Request Founder approval"><Trash2 size={14}/></button>}
            </div>
          </div>
        ))}
      </div>
      {!isFounder && <p style={{fontSize:11,color:"#7C8592"}}>Admins cannot delete themselves or directly delete riders. Deletion requests require Founder approval.</p>}

      {isFounder && (
        <div className="card" style={{display:"flex",flexDirection:"column",gap:10}}>
          <div className="section-label">Pending Founder Approvals · Rider Deletion</div>
          {adminRequests.filter(q => q.type === "delete_rider" && q.status === "pending").length === 0
            ? <p style={{fontSize:12,color:"#7C8592"}}>No pending deletion requests.</p>
            : adminRequests.filter(q => q.type === "delete_rider" && q.status === "pending").map(req => (
              <div key={req.id} className="list-row" style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8}}>
                <div><div style={{fontSize:13,fontWeight:600}}>{req.targetName}</div><div style={{fontSize:11,color:"#7C8592"}}>Requested by {req.requestedByName}</div></div>
                <div style={{display:"flex",gap:6}}><button className="btn-primary" onClick={()=>approveDelete(req)} style={{padding:"6px 8px",fontSize:11}}>Approve</button><button className="btn-ghost" onClick={()=>rejectDelete(req)} style={{padding:"6px 8px",fontSize:11}}>Reject</button></div>
              </div>
            ))}
        </div>
      )}

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

// ---------------- Reports (admin master view per rider) ----------------
function ReportsTab({ riders, leaves, rounds, odometer, adminFuel, personalFuel, attendance, riderName, duty }) {
  const [riderId, setRiderId] = useState(riders.find(r=>r.role==="rider")?.id || "");
  const r = riders.find(x=>x.id===riderId);
  const thisMonth = monthKey(todayISO());

  const myLeaves = leaves.filter(l=>l.riderId===riderId);
  const myRounds = rounds.filter(x=>x.riderId===riderId && x.closed && x.approved==="approved");
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

  // Daily breakdown for the whole month: delivered packets + morning/evening arrival time per date.
  const dailyBreakdown = useMemo(() => {
    const byDate = {};
    monthRounds.forEach((rd) => {
      byDate[rd.date] = byDate[rd.date] || { date: rd.date, delivered: 0, pickups: 0, undelivered: 0, morningIn: null, morningOut: null, eveningIn: null, eveningOut: null };
      byDate[rd.date].delivered += Number(rd.deliveredFinal) || 0;
      byDate[rd.date].pickups += Number(rd.pickupCount) || 0;
      if (rd.returnType !== "rto") byDate[rd.date].undelivered += Number(rd.returnedCount) || 0;
    });
    myDuty.forEach((d) => {
      byDate[d.date] = byDate[d.date] || { date: d.date, delivered: 0, pickups: 0, undelivered: 0, rounds: [], morningIn: null, morningOut: null, eveningIn: null, eveningOut: null };
      if (d.period === "morning") { byDate[d.date].morningIn = d.startTime; byDate[d.date].morningOut = d.endTime; }
      if (d.period === "evening") { byDate[d.date].eveningIn = d.startTime; byDate[d.date].eveningOut = d.endTime; }
    });
    return Object.values(byDate).sort((a,b)=>a.date<b.date?1:-1);
  }, [monthRounds, myDuty]);
  const monthTotalDelivered = dailyBreakdown.reduce((s,d)=>s+d.delivered,0);
  const monthTotalPickups = dailyBreakdown.reduce((s,d)=>s+d.pickups,0);

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
            <div className="section-label">Daily Summary — {thisMonth}</div><div style={{fontSize:11,color:"#7C8592",marginBottom:8}}>Use the details below for date-wise delivery, pickup, DRS, RTO and undelivered records.</div>
            <div className="list-card">
              {dailyBreakdown.length===0 ? <div style={{padding:16,fontSize:13,color:"#7C8592"}}>No data for this month yet.</div> :
                dailyBreakdown.map(d=>(
                  <div key={d.date} style={{padding:"10px 14px",borderBottom:"1px solid #22272E",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                    <div className="font-mono" style={{fontSize:12}}>{fmtDate(d.date)}</div>
                    <div style={{display:"flex",gap:14,alignItems:"center"}}>
                      <div style={{textAlign:"center"}}>
                        <div className="font-mono" style={{fontSize:13,color:"#3DDC97"}}>{d.delivered}</div>
                        <div style={{fontSize:9,color:"#7C8592"}}>PKTS</div>
                      </div>
                      <div style={{textAlign:"center"}}>
                        <div className="font-mono" style={{fontSize:13,color:"#F472B6"}}>{d.pickups}</div>
                        <div style={{fontSize:9,color:"#7C8592"}}>PICKUPS</div>
                      </div>
                      <div style={{textAlign:"center"}}>
                        <div className="font-mono" style={{fontSize:13,color:"#F5A623"}}>{d.undelivered}</div>
                        <div style={{fontSize:9,color:"#7C8592"}}>UNDELIVERED</div>
                      </div>
                      <div style={{textAlign:"center"}}>
                        <div className="font-mono" style={{fontSize:11,color:d.morningIn && (new Date(Number(d.morningIn)).getHours()*60+new Date(Number(d.morningIn)).getMinutes())>570?"#E5484D":"#9BE7BD",fontWeight:700}}>{d.morningIn ? fmtTime(d.morningIn) : "—"}</div>
                        <div style={{fontSize:9,color:"#3DDC97",fontWeight:800,background:"rgba(61,220,151,.12)",padding:"3px 5px",borderRadius:4}}>MORNING IN</div>
                      </div>
                      <div style={{textAlign:"center"}}>
                        <div className="font-mono" style={{fontSize:11,color:d.eveningIn && (new Date(Number(d.eveningIn)).getHours()*60+new Date(Number(d.eveningIn)).getMinutes())>((String(r?.name||"").trim().toLowerCase()==="rajeev kumar")?1170:1140)?"#E5484D":"#9BE7BD",fontWeight:700}}>{d.eveningIn ? fmtTime(d.eveningIn) : "—"}</div>
                        <div style={{fontSize:9,color:"#3DDC97",fontWeight:800,background:"rgba(61,220,151,.12)",padding:"3px 5px",borderRadius:4}}>EVENING IN</div>
                      </div>
                      <div style={{textAlign:"center"}}>
                        <div className="font-mono" style={{fontSize:10,color:"#E5484D",marginTop:4}}>{fmtTime([d.morningOut,d.eveningOut].filter(Boolean).map(Number).sort((a,b)=>b-a)[0])}</div>
                        <div style={{fontSize:9,color:"#E5484D",fontWeight:800,background:"rgba(229,72,77,.12)",padding:"3px 5px",borderRadius:4}}>OUT TIME</div>
                      </div>
                    </div>
                  </div>
                ))
              }
            </div>
          </div>

          <div className="card" style={{fontSize:11,color:"#7C8592"}}>Attendance IN/OUT timings are shown in the Daily Summary. Full round-wise delivery, pickup clients, RTO and undelivered details are available below.</div>
          <div className="divider" />
          <RoundHistoryTab riders={riders} rounds={rounds}/>

        </>
      )}
    </div>
  );
}

function RoundHistoryTab({ riders, rounds }) {
  const [riderId, setRiderId] = useState(riders.find(r=>r.role==="rider")?.id || "");
  const [month, setMonth] = useState(monthKey(todayISO()));
  const [type, setType] = useState("all");
  const [status, setStatus] = useState("all");
  const [detail, setDetail] = useState("");
  const riderNameFor = id => riders.find(r=>r.id===id)?.name || "Unknown rider";
  const rows = rounds.filter(r => (!riderId || r.riderId===riderId) && monthKey(r.date)===month && (type==="all" || (type==="pickup" ? r.roundType==="pickup" : r.roundType!=="pickup")) && (status==="all" || r.approved===status))
    .sort((a,b)=>(a.date===b.date ? (Number(b.roundNumber)||0)-(Number(a.roundNumber)||0) : (a.date<b.date?1:-1)));
  const approvedRows = rows.filter(r=>r.closed && r.approved==="approved");
  const delivered = approvedRows.reduce((n,r)=>n+(Number(r.deliveredFinal)||0),0);
  const pickup = approvedRows.reduce((n,r)=>n+(Number(r.pickupCount)||0),0);
  const rto = approvedRows.filter(r=>r.returnType==="rto").reduce((n,r)=>n+(Number(r.returnedCount)||0),0);
  const undelivered = approvedRows.filter(r=>(Number(r.returnedCount)||0)>0 && r.returnType!=="rto").reduce((n,r)=>n+(Number(r.returnedCount)||0),0);
  const tripKey = r => r.tripGroupId || `${r.riderId}-${r.date}-legacy-${r.roundNumber || r.id}`;
  const deliveryTrips = new Set(approvedRows.filter(r=>r.roundType!=="pickup").map(tripKey)).size;
  const daily = {};
  approvedRows.forEach(r=>{
    const d=daily[r.date] ||= {date:r.date, delivered:0, pickup:0, returned:0, rto:0, undelivered:0, clients:{}, drs:[], rounds:[]};
    d.delivered += Number(r.deliveredFinal)||0; d.pickup += Number(r.pickupCount)||0; d.returned += Number(r.returnedCount)||0;
    if(r.returnType==="rto") d.rto += Number(r.returnedCount)||0; else if((Number(r.returnedCount)||0)>0) d.undelivered += Number(r.returnedCount)||0;
    if(r.drsNumber) d.drs.push(r.drsNumber);
    d.rounds.push(r);
    (Array.isArray(r.pickupDetails)?r.pickupDetails:[]).forEach(p=>{ d.clients[p.client]=(d.clients[p.client]||0)+(Number(p.count)||0); });
  });
  const dailyRows=Object.values(daily).sort((a,b)=>a.date<b.date?1:-1);
  const clickableStat = (label,value,color,key) => <button onClick={()=>setDetail(detail===key?"":key)} className="card" style={{textAlign:"left",cursor:"pointer",borderColor:detail===key?color:"#2A3038",color:"inherit",minWidth:0}}><div className="font-mono" style={{fontSize:28,color}}>{value}</div><div style={{fontSize:11,color:"#7C8592",textTransform:"uppercase"}}>{label}</div><div style={{fontSize:10,color,marginTop:5}}>Tap to view date-wise details ↗</div></button>;
  const detailLabel = {delivered:"Delivered parcels",pickup:"Pickup parcels by date and client",pickupRounds:"Pickup rounds by date",rto:"RTO parcels",undelivered:"Undelivered parcels"};
  return <div style={{display:"flex",flexDirection:"column",gap:12}}>
    <div className="section-label">Rider performance · Simple daily view</div>
    <select className="input" value={riderId} onChange={e=>setRiderId(e.target.value)}><option value="">All riders</option>{riders.filter(r=>r.role==="rider").map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select>
    <input className="input" type="month" value={month} onChange={e=>setMonth(e.target.value)}/>
    <div style={{display:"flex",gap:8}}><select className="input" value={type} onChange={e=>setType(e.target.value)}><option value="all">All activity</option><option value="delivery">Delivery only</option><option value="pickup">Pickup only</option></select><select className="input" value={status} onChange={e=>setStatus(e.target.value)}><option value="all">All approval statuses</option><option value="pending">Pending approval</option><option value="approved">Approved</option><option value="rejected">Rejected</option></select></div>
    <div className="stat-grid">{clickableStat("Delivery trips",deliveryTrips,"#8AA5FF","trips")}{clickableStat("Pickup rounds",new Set(approvedRows.filter(r=>r.roundType==="pickup").map(r=>`${r.riderId}-${r.date}-${r.roundNumber||r.id}`)).size,"#F5A623","pickupRounds")}{clickableStat("Delivered",delivered,"#3DDC97","delivered")}{clickableStat("Pickup parcels",pickup,"#F5A623","pickup")}{clickableStat("RTO",rto,"#E5484D","rto")}{clickableStat("Undelivered",undelivered,"#F5A623","undelivered")}</div>
    {detail && <div className="card" style={{borderColor:"#F5A623"}}><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8}}><div className="section-label" style={{margin:0}}>{detail==="trips"?"Delivery trips by date":detailLabel[detail]||detail}</div><button className="btn-ghost" onClick={()=>setDetail("")}>Close</button></div>
      {detail==="trips" ? dailyRows.map(d=><div key={d.date} style={{padding:"12px 0",borderBottom:"1px solid #2A3038"}}><div style={{display:"flex",justifyContent:"space-between",gap:8,alignItems:"center",marginBottom:8}}><b>{fmtDate(d.date)}</b><span style={{fontSize:12,color:"#8AA5FF",fontWeight:800}}>{new Set(d.rounds.filter(x=>x.roundType!=="pickup").map(tripKey)).size} delivery trips · {d.drs.length} DRS</span></div>{d.rounds.filter(x=>x.roundType!=="pickup").map(x=><div key={x.id} style={{background:"#171B20",border:"1px solid #2A3038",borderRadius:8,padding:10,marginTop:7}}><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,flexWrap:"wrap"}}><div style={{fontSize:12,fontWeight:900,color:"#F5A623"}}>DRS: {x.drsNumber||"Not recorded"}</div>{x.drsNumber && <button type="button" className="btn-ghost" onClick={async()=>{try{await navigator.clipboard.writeText(String(x.drsNumber));alert("DRS number copied");}catch{alert("Copy unavailable. Please select and copy the DRS number manually.");}}} style={{display:"inline-flex",alignItems:"center",gap:5,padding:"5px 8px",fontSize:10}}><Copy size={13}/> Copy DRS</button>}</div><div style={{fontSize:11,color:"#7C8592",marginTop:6}}>{x.roundType==="pickup"?"Pickup entry":`Delivery Trip ${x.roundNumber||"—"}`} · {x.approved}</div><div style={{display:"grid",gridTemplateColumns:"repeat(2,minmax(0,1fr))",gap:6,marginTop:8}}>{[["Total parcels",Number(x.deliveryCount)||0,"#E5E7EB"],["Delivered",Number(x.deliveredFinal)||0,"#3DDC97"],[x.returnType==="rto"?"RTO":"Undelivered",Number(x.returnedCount)||0,x.returnType==="rto"?"#E5484D":"#F5A623"],["Pickup parcels",Number(x.pickupCount)||0,"#F472B6"]].map(([label,value,color])=><div key={label} style={{background:"#101419",padding:7,borderRadius:6}}><div style={{fontSize:17,fontWeight:900,color}}>{value}</div><div style={{fontSize:9,color:"#7C8592"}}>{label}</div></div>)}</div>{x.returnType==="rto"&&<div style={{fontSize:11,color:"#E5484D",marginTop:6}}>Return type: RTO{x.rtoDocketNumber?` · Docket: ${x.rtoDocketNumber}`:""}</div>}{x.undeliveredReason&&<div style={{fontSize:11,color:"#F5A623",marginTop:5}}>Reason: {x.undeliveredReason}</div>}</div>)}</div>) : detail==="pickupRounds" ? dailyRows.map(d=><div key={d.date} className="list-row"><span>{fmtDate(d.date)}</span><b>{d.rounds.filter(r=>r.roundType==="pickup").length} pickup rounds · {d.pickup} parcels</b></div>) : detail==="pickup" ? dailyRows.filter(d=>d.pickup>0).map(d=><div key={d.date} style={{padding:"10px 0",borderBottom:"1px solid #2A3038"}}><b>{fmtDate(d.date)} · {d.pickup} parcels</b>{Object.entries(d.clients).length ? Object.entries(d.clients).map(([client,count])=><div key={client} style={{fontSize:12,color:"#F472B6",marginTop:4}}>{client}: {count} parcels</div>):<div style={{fontSize:12,color:"#7C8592"}}>Client detail not saved for this record.</div>}</div>) : dailyRows.filter(d=>d[detail]>0).map(d=><div key={d.date} className="list-row"><span>{fmtDate(d.date)}</span><b>{d[detail]} parcels</b></div>)}
      {detail!=="trips" && !(detail==="pickupRounds"?dailyRows.some(d=>d.rounds.some(r=>r.roundType==="pickup")):detail==="pickup"?dailyRows.some(d=>d.pickup>0):dailyRows.some(d=>d[detail]>0)) && <div style={{fontSize:12,color:"#7C8592",paddingTop:10}}>No approved records for this metric in the selected month.</div>}
    </div>}
    <div className="section-label">Date-wise record</div>
    <div className="list-card">{dailyRows.length===0 ? <div style={{padding:16,fontSize:13,color:"#7C8592"}}>No approved round records for these filters.</div> : dailyRows.map(d=><div key={d.date} style={{padding:14,borderBottom:"1px solid #22272E"}}>
      <div style={{fontWeight:800,marginBottom:8}}>{fmtDate(d.date)}</div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(2,minmax(0,1fr))",gap:8}}>{[["Delivered",d.delivered,"#3DDC97"],["Pickup parcels",d.pickup,"#F5A623"],["RTO",d.rto,"#E5484D"],["Undelivered",d.undelivered,"#F5A623"]].map(([label,value,color])=><div key={label} style={{background:"#171B20",padding:9,borderRadius:8}}><div style={{fontSize:19,color}}>{value}</div><div style={{fontSize:10,color:"#7C8592"}}>{label}</div></div>)}</div>
      {Object.keys(d.clients).length>0 && <div style={{marginTop:8,fontSize:12,color:"#F5A623"}}>Pickup clients: {Object.entries(d.clients).map(([c,n])=>`${c} (${n})`).join(" · ")}</div>}
      {d.rounds.map(r=><div key={r.id} style={{marginTop:8,padding:10,borderRadius:8,background:"#171B20",border:"1px solid #2A3038"}}><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,flexWrap:"wrap"}}><div style={{fontSize:12,fontWeight:900,color:r.roundType==="pickup"?"#F472B6":"#F5A623"}}>{r.roundType==="pickup"?`Pickup Round ${r.roundNumber||"—"}`:`Delivery Trip ${r.roundNumber||"—"}`} {r.drsNumber?`· DRS ${r.drsNumber}`:"· No DRS"}</div>{r.drsNumber&&<button type="button" className="btn-ghost" onClick={async()=>{try{await navigator.clipboard.writeText(String(r.drsNumber));alert("DRS number copied");}catch{alert("Copy unavailable. Please select and copy the DRS number manually.");}}} style={{display:"inline-flex",alignItems:"center",gap:5,padding:"5px 8px",fontSize:10}}><Copy size={13}/> Copy</button>}</div><div style={{fontSize:10,color:"#7C8592",marginTop:4}}>{riderNameFor(r.riderId)} · {r.approved}</div><div style={{display:"grid",gridTemplateColumns:"repeat(2,minmax(0,1fr))",gap:6,marginTop:8}}>{[["Total parcels",Number(r.deliveryCount)||0,"#E5E7EB"],["Delivered",Number(r.deliveredFinal)||0,"#3DDC97"],[r.returnType==="rto"?"RTO":"Undelivered",Number(r.returnedCount)||0,r.returnType==="rto"?"#E5484D":"#F5A623"],["Pickup",Number(r.pickupCount)||0,"#F472B6"]].map(([label,value,color])=><div key={label} style={{background:"#101419",padding:7,borderRadius:6}}><div style={{fontSize:16,fontWeight:900,color}}>{value}</div><div style={{fontSize:9,color:"#7C8592"}}>{label}</div></div>)}</div>{r.returnType==="rto"&&<div style={{fontSize:10,color:"#E5484D",marginTop:5}}>RTO docket: {r.rtoDocketNumber||"Not recorded"}</div>}{r.undeliveredReason&&<div style={{fontSize:10,color:"#F5A623",marginTop:5}}>Undelivered reason: {r.undeliveredReason}</div>}</div>)}
    </div>)}</div>
    <div style={{fontSize:11,color:"#7C8592"}}>Only closed and approved records are included in totals. Old records without a trip ID are shown using their saved round numbers; trips cannot be reliably merged retroactively unless their shared trip is recorded.</div>
  </div>;
}

// ---------------- Duty Times (admin date-wise attendance times for all riders) ----------------
function DutyTimesTab({ riders, duty }) {
  const [date, setDate] = useState(todayISO());
  const [showLateArrivals, setShowLateArrivals] = useState(false);
  const riderRows = riders.filter(r => r.role === "rider").map(r => {
    const records = duty.filter(d => d.riderId === r.id && d.date === date);
    const morning = records.filter(d => d.period === "morning").sort((a,b)=>(Number(a.startTime)||0)-(Number(b.startTime)||0))[0];
    const evening = records.filter(d => d.period === "evening").sort((a,b)=>(Number(a.startTime)||0)-(Number(b.startTime)||0))[0];
    const fmt = ts => ts ? new Date(Number(ts)).toLocaleTimeString("en-IN", {hour:"2-digit", minute:"2-digit"}) : "—";
    const minsOf = ts => {
      if (!ts) return null;
      const t = new Date(Number(ts));
      return t.getHours() * 60 + t.getMinutes();
    };
    const name = String(r.name || "").trim().toLowerCase();
    const morningLate = minsOf(morning?.startTime) !== null && minsOf(morning?.startTime) > (9 * 60 + 30);
    const eveningLimit = name === "rajeev kumar" ? (19 * 60 + 30) : (19 * 60);
    const eveningLate = minsOf(evening?.startTime) !== null && minsOf(evening?.startTime) > eveningLimit;
    const outTimes = [...new Set(records.filter(d => d.endTime != null && d.endTime !== "").map(d => Number(d.endTime)).filter(Number.isFinite))].sort((a,b)=>a-b);
    return {
      id:r.id, name:r.name,
      morningIn:fmt(morning?.startTime), eveningIn:fmt(evening?.startTime),
      morningLate, eveningLate,
      outTime: outTimes.length ? fmt(Math.max(...outTimes)) : "—",
      hasIn: Boolean(morning?.startTime || evening?.startTime)
    };
  }).sort((a,b)=>a.name.localeCompare(b.name));
  const timeCard = (label, time, late, color) => {
    const parts = String(time || "—").match(/^(.*?)(?:\s+(am|pm))$/i);
    const clock = parts ? parts[1] : String(time || "—");
    const meridiem = parts ? parts[2].toUpperCase() : "";
    const meridiemColor = meridiem === "AM" ? "#69B7FF" : "#C6A0FF";
    return <div style={{background:"#171B20",padding:"12px 13px",borderRadius:9,minWidth:0,border:"1px solid #252B33"}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,flexWrap:"wrap"}}>
        <div style={{fontSize:11,color,fontWeight:800,display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>{label}{late && <span style={{background:"rgba(229,72,77,0.16)",color:"#E5484D",borderRadius:5,padding:"3px 6px",fontSize:9,letterSpacing:.4}}>LATE</span>}</div>
        <div style={{display:"flex",alignItems:"baseline",gap:7,whiteSpace:"nowrap"}}>
          <span className="font-mono" style={{fontSize:19,fontWeight:800,letterSpacing:.4,color:late?"#E5484D":"#9BE7BD"}}>{clock}</span>
          {meridiem && <span style={{fontSize:11,fontWeight:900,letterSpacing:.7,color:meridiemColor,background:meridiem === "AM" ? "rgba(105,183,255,.13)" : "rgba(198,160,255,.14)",padding:"4px 6px",borderRadius:5}}>{meridiem}</span>}
        </div>
      </div>
    </div>;
  };
  return <div style={{display:"flex",flexDirection:"column",gap:12}}>
    <div className="section-label">Duty Times · All riders</div>
    <div className="card"><label style={{display:"block",fontSize:11,color:"#7C8592",marginBottom:6}}>Select date</label><input type="date" className="input font-mono" value={date} onChange={e=>setDate(e.target.value)}/></div>
    <div className="card" style={{fontSize:12,color:"#7C8592"}}>{fmtDate(date)} · {riderRows.filter(r=>r.hasIn).length} riders have an IN record. Late after 9:30 AM (morning) or 7:00 PM (evening); Rajeev Kumar's evening limit is 7:30 PM.</div>
    <div className="list-card">{riderRows.length===0 ? <div style={{padding:16,color:"#7C8592"}}>No riders found.</div> : riderRows.map(r=><div key={r.id} style={{padding:"12px 14px",borderBottom:"1px solid #22272E"}}>
      <div style={{fontWeight:700,fontSize:14,marginBottom:9}}>{r.name}</div>
      <div style={{display:"flex",flexDirection:"column",gap:8}}>
        {timeCard("MORNING IN",r.morningIn,r.morningLate,"#3DDC97")}
        {timeCard("EVENING IN",r.eveningIn,r.eveningLate,"#3DDC97")}
        {timeCard("OUT TIME",r.outTime,false,"#E5484D")}
      </div>
    </div>)}</div>
    <div style={{fontSize:10,color:"#7C8592"}}>— means no saved time. OUT TIME shows the latest saved OUT time for that rider on the selected date.</div>
    <button type="button" className="card" onClick={()=>setShowLateArrivals(v=>!v)} style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,textAlign:"left",cursor:"pointer",borderColor:showLateArrivals?"#E5484D":"#2A3038",color:"inherit"}}>
      <div><div style={{fontWeight:800,color:"#E5484D"}}>Late Arrivals</div><div style={{fontSize:11,color:"#7C8592",marginTop:4}}>View all dates when riders were late for morning or evening duty</div></div><span style={{color:"#E5484D",fontWeight:800}}>{showLateArrivals?"Hide ▲":"View ▼"}</span>
    </button>
    {showLateArrivals && (()=>{
      const lateRows=[];
      const formatLateTime=ts=>ts?new Date(Number(ts)).toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"}):"—";
      riders.filter(r=>r.role==="rider").forEach(r=>{
        const byDate={};
        duty.filter(d=>d.riderId===r.id && d.startTime && (d.period==="morning"||d.period==="evening")).forEach(d=>{
          const mins=new Date(Number(d.startTime)).getHours()*60+new Date(Number(d.startTime)).getMinutes();
          const isMorningLate=d.period==="morning" && mins>570;
          const isEveningLate=d.period==="evening" && mins>(String(r.name||"").trim().toLowerCase()==="rajeev kumar"?1170:1140);
          if(isMorningLate||isEveningLate) lateRows.push({id:d.id,rider:r.name,date:d.date,period:d.period,time:formatLateTime(d.startTime)});
        });
      });
      lateRows.sort((a,b)=>a.date<b.date?1:a.date>b.date?-1:a.rider.localeCompare(b.rider));
      return <div className="list-card">{lateRows.length===0?<div style={{padding:14,fontSize:12,color:"#7C8592"}}>No late arrivals recorded.</div>:lateRows.map(x=><div key={x.id} className="list-row"><div><div style={{fontSize:12,fontWeight:700}}>{x.rider}</div><div style={{fontSize:11,color:"#7C8592",marginTop:3}}>{fmtDate(x.date)} · {x.period==="morning"?"Morning IN":"Evening IN"}</div></div><div style={{fontSize:13,fontWeight:800,color:"#E5484D"}}>{x.time} · LATE</div></div>)}</div>;
    })()}
  </div>;
}

// ---------------- Attendance (mark + view, daily + monthly) ----------------
function AttendanceTab({ user, isAdmin, riders, attendance, leaves, duty = [] }) {
  const [date, setDate] = useState(todayISO());
  const [expandedRiders, setExpandedRiders] = useState({});
  const visibleRiders = isAdmin ? riders.filter(r=>r.role==="rider") : riders.filter(r=>r.id===user.id);
  const selectedMonth = monthKey(date || todayISO());
  const [year, month] = selectedMonth.split("-").map(Number);
  const daysInMonth = new Date(year, month, 0).getDate();
  const monthDates = Array.from({length:daysInMonth}, (_,i)=>`${selectedMonth}-${String(i+1).padStart(2,"0")}`);

  const statusFor = (riderId, d) => {
    const saved = attendance.find(a=>a.riderId===riderId && a.date===d);
    if (saved) return saved;
    const hasDutyIn = duty.some(x=>x.riderId===riderId && x.date===d && (x.period==="morning" || x.period==="evening") && x.startTime);
    return hasDutyIn ? { status:"present", derivedFromDuty:true } : undefined;
  };
  const onLeave = (riderId, d) => leaves.some(l=>l.riderId===riderId && l.date===d && l.status==="approved");
  const setStatus = async (riderId, status, targetDate=date) => {
    const existing = attendance.find(a=>a.riderId===riderId && a.date===targetDate);
    if (existing) await updateRec("attendance", existing.id, { status });
    else await addRec("attendance", { riderId, date:targetDate, status });
  };
  const STATUS_OPTS = [
    { key:"present", label:"Present", color:"#3DDC97" },
    { key:"late", label:"Late", color:"#F5A623" },
    { key:"absent", label:"Absent", color:"#E5484D" },
  ];
  const minsOf = ts => {
    if (ts === undefined || ts === null || ts === "") return null;
    const n = Number(ts);
    if (!Number.isFinite(n)) return null;
    const t = new Date(n);
    return t.getHours()*60+t.getMinutes();
  };
  const fmtTime = ts => ts ? new Date(Number(ts)).toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"}) : "—";
  const dutyInfoFor = (rider, d) => {
    const records = duty.filter(x=>x.riderId===rider.id && x.date===d);
    const morning = records.filter(x=>x.period==="morning" && x.startTime).sort((a,b)=>Number(a.startTime)-Number(b.startTime))[0];
    const evening = records.filter(x=>x.period==="evening" && x.startTime).sort((a,b)=>Number(a.startTime)-Number(b.startTime))[0];
    const morningLate = minsOf(morning?.startTime)!==null && minsOf(morning?.startTime)>(9*60+30);
    const eveningLimit = String(rider.name||"").trim().toLowerCase()==="rajeev kumar" ? (19*60+30) : (19*60);
    const eveningLate = minsOf(evening?.startTime)!==null && minsOf(evening?.startTime)>eveningLimit;
    return {morning, evening, morningLate, eveningLate};
  };
  const thisMonth = monthKey(todayISO());
  const monthlyCount = (riderId, status) => {
    if (status === "present") {
      const explicit = attendance.filter(a=>a.riderId===riderId && monthKey(a.date)===thisMonth && (a.status==="present" || a.status==="late"));
      const dates = new Set(explicit.map(a=>a.date));
      duty.filter(d=>d.riderId===riderId && monthKey(d.date)===thisMonth && (d.period==="morning" || d.period==="evening") && d.startTime).forEach(d=>{
        const saved = attendance.find(a=>a.riderId===riderId && a.date===d.date);
        if (!saved || saved.status === "present" || saved.status === "late") dates.add(d.date);
      });
      return dates.size;
    }
    return attendance.filter(a=>a.riderId===riderId && monthKey(a.date)===thisMonth && a.status===status).length;
  };
  const statusStyle = status => status==="present" ? {color:"#3DDC97",bg:"rgba(61,220,151,.12)"} : status==="late" ? {color:"#F5A623",bg:"rgba(245,166,35,.12)"} : status==="absent" ? {color:"#E5484D",bg:"rgba(229,72,77,.12)"} : status==="on leave" ? {color:"#A78BFA",bg:"rgba(167,139,250,.12)"} : {color:"#7C8592",bg:"rgba(124,133,146,.12)"};

  return <div style={{display:"flex",flexDirection:"column",gap:16}}>
    <input type="date" value={date} onChange={e=>setDate(e.target.value)} className="input font-mono" />
    <div style={{fontSize:11,color:"#7C8592"}}>Tap a rider's card to see each date of the selected month. Morning late after 9:30 AM; evening late after 7:00 PM (Rajeev Kumar: 7:30 PM). Sundays are shown separately.</div>
    <div className="list-card">
      {visibleRiders.length===0 ? <div style={{padding:16,fontSize:13,color:"#7C8592"}}>No riders found.</div> : visibleRiders.map(r=>{
        const current = statusFor(r.id,date)?.status;
        const leave = onLeave(r.id,date);
        const expanded = Boolean(expandedRiders[r.id]);
        const monthRecords = monthDates.map(d=>{
          const dayObj = new Date(d+"T00:00:00");
          const sunday = dayObj.getDay()===0;
          const statusRecord = statusFor(r.id,d);
          const approvedLeave = onLeave(r.id,d);
          const info = dutyInfoFor(r,d);
          const status = approvedLeave ? "on leave" : statusRecord?.status || (info.morning || info.evening ? "present" : "not marked");
          return {date:d,dayObj,sunday,status,info};
        });
        return <div key={r.id} style={{borderBottom:"1px solid #22272E"}}>
          <button type="button" onClick={()=>setExpandedRiders(prev=>({...prev,[r.id]:!prev[r.id]}))} style={{width:"100%",textAlign:"left",display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,padding:"12px 14px",background:"transparent",border:"none",color:"inherit",cursor:"pointer",flexWrap:"wrap"}}>
            <div style={{minWidth:0,flex:1}}>
              <div style={{fontSize:13,fontWeight:700}}>{r.name}</div>
              <div className="font-mono" style={{fontSize:10,color:"#7C8592",marginTop:5}}>This month — Present: {monthlyCount(r.id,"present")} · Late: {monthlyCount(r.id,"late")} · Absent: {monthlyCount(r.id,"absent")}</div>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
              {leave && <span className="badge badge-rejected">on leave</span>}
              {current && <span className="badge" style={{background:statusStyle(current).bg,color:statusStyle(current).color}}>{current}</span>}
              <span style={{fontSize:11,color:"#7C8592"}}>{expanded ? "Hide details ▲" : "Full details ▼"}</span>
            </div>
          </button>
          {isAdmin && !expanded && <div style={{padding:"0 14px 12px",display:"flex",gap:6}}>{STATUS_OPTS.map(opt=><button key={opt.key} onClick={()=>setStatus(r.id,opt.key)} style={{flex:1,fontSize:11,fontWeight:500,padding:"6px 0",borderRadius:6,border:"1px solid",cursor:"pointer",background:current===opt.key?opt.color+"22":"transparent",borderColor:current===opt.key?opt.color:"#2A3038",color:current===opt.key?opt.color:"#7C8592"}}>{opt.label}</button>)}</div>}
          {expanded && <div style={{padding:"0 12px 12px",display:"flex",flexDirection:"column",gap:8}}>
            <div style={{fontSize:11,fontWeight:800,color:"#7C8592",letterSpacing:.5,marginTop:2}}>{new Date(year,month-1,1).toLocaleDateString("en-IN",{month:"long",year:"numeric"}).toUpperCase()} · DAILY ATTENDANCE</div>
            {monthRecords.map(day=>{
              const info=day.info, sunday=day.sunday, style=statusStyle(day.status);
              return <div key={day.date} style={{padding:10,borderRadius:9,border:sunday?"1px solid rgba(167,139,250,.35)":"1px solid #252B33",background:sunday?"rgba(167,139,250,.08)":"#11151A"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,flexWrap:"wrap",marginBottom:7}}>
                  <div style={{fontSize:12,fontWeight:700}}>{day.dayObj.toLocaleDateString("en-IN",{weekday:"short",day:"2-digit",month:"short"})}</div>
                  <span style={{fontSize:10,fontWeight:800,color:sunday?"#A78BFA":style.color,background:sunday?"rgba(167,139,250,.14)":style.bg,padding:"3px 7px",borderRadius:5}}>{sunday?"SUNDAY":day.status.toUpperCase()}</span>
                </div>
                {!sunday && <div style={{display:"grid",gridTemplateColumns:"repeat(2,minmax(0,1fr))",gap:7}}>
                  <div style={{background:"rgba(61,220,151,.11)",border:"1px solid rgba(61,220,151,.22)",borderRadius:7,padding:8}}><div style={{fontSize:9,color:"#3DDC97",fontWeight:800}}>MORNING IN {info.morningLate && <span style={{color:"#E5484D",marginLeft:4}}>· LATE</span>}</div><div className="font-mono" style={{fontSize:12,marginTop:4,fontWeight:800,color:info.morningLate?"#E5484D":"#9BE7BD"}}>{fmtTime(info.morning?.startTime)}</div></div>
                  <div style={{background:"rgba(61,220,151,.11)",border:"1px solid rgba(61,220,151,.22)",borderRadius:7,padding:8}}><div style={{fontSize:9,color:"#3DDC97",fontWeight:800}}>EVENING IN {info.eveningLate && <span style={{color:"#E5484D",marginLeft:4}}>· LATE</span>}</div><div className="font-mono" style={{fontSize:12,marginTop:4,fontWeight:800,color:info.eveningLate?"#E5484D":"#9BE7BD"}}>{fmtTime(info.evening?.startTime)}</div></div>
                </div>}
                {sunday && <div style={{fontSize:10,color:"#A78BFA"}}>Weekly off · excluded from absent count unless manually marked.</div>}
                {isAdmin && !sunday && <div style={{display:"flex",gap:5,marginTop:8}}>{STATUS_OPTS.map(opt=><button key={opt.key} onClick={()=>setStatus(r.id,opt.key,day.date)} style={{flex:1,fontSize:10,padding:"5px 0",borderRadius:5,border:"1px solid",borderColor:day.status===opt.key?opt.color:"#2A3038",background:day.status===opt.key?opt.color+"22":"transparent",color:day.status===opt.key?opt.color:"#7C8592"}}>{opt.label}</button>)}</div>}
              </div>;
            })}
          </div>}
        </div>;
      })}
    </div>
  </div>;
}

