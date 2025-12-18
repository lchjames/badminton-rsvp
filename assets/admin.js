const API_BASE = "https://script.google.com/macros/s/AKfycbwv5Db3ePyGuiTDOGFDM8joTprsOmL3xpymGPVOv3ocaPeTb-QTEPySqafNxY_LhJwm/exec";
const el = id=>document.getElementById(id);

async function apiGet(p){
  const r = await fetch(API_BASE + "?" + new URLSearchParams(p));
  return r.json();
}
async function apiPost(b){
  const r = await fetch(API_BASE,{method:"POST",headers:{"Content-Type":"text/plain"},body:JSON.stringify(b)});
  return r.json();
}

function nextSunday(){
  const d=new Date();const day=d.getDay();
  d.setDate(d.getDate()+((7-day)%7||7));
  return d.toISOString().slice(0,10);
}

el("createNext").onclick = async ()=>{
  const key = el("adminKey").value;
  const venue = el("venue").value;
  const res = await apiPost({
    action:"admin_createSession",
    adminKey:key,
    session:{
      title:"YR Badminton",
      date: nextSunday(),
      start:"17:00",
      end:"19:00",
      venue,
      capacity:20,
      isOpen:true
    },
    openOnly:true
  });
  el("msg").textContent = res.ok ? "已建立" : res.error;
};

async function refresh(){
  const data = await apiGet({action:"sessions"});
  el("sessionTable").innerHTML = data.sessions.map(s=>
    `<div>${s.sessionId} | ${s.date} | ${s.isOpen}</div>`
  ).join("");
}
refresh();
