const API_BASE = "https://script.google.com/macros/s/AKfycbwv5Db3ePyGuiTDOGFDM8joTprsOmL3xpymGPVOv3ocaPeTb-QTEPySqafNxY_LhJwm/exec";
const DEFAULT_CAPACITY = 20;
const PSYCHO_LINES = [
  "「可能」唔係選項，請揀出席或缺席。",
  "唔好薛定諤出席，隊友會多謝你。",
  "BadYRminton 要清楚答案。"
];

const el = id => document.getElementById(id);
let psychoIdx = 0;

function nextLine(){ return PSYCHO_LINES[psychoIdx++ % PSYCHO_LINES.length]; }

document.querySelectorAll('input[name="status"]').forEach(r => {
  r.addEventListener('change', e => {
    if (e.target.value === 'MAYBE') {
      el('statusWarning').style.display='block';
      el('statusWarning').innerText = nextLine();
      el('rsvpCard').classList.add('shake');
    } else {
      el('statusWarning').style.display='none';
    }
  });
});

el('rsvpForm').addEventListener('submit', e => {
  e.preventDefault();
  const status = document.querySelector('input[name="status"]:checked').value;
  if (status === 'MAYBE') {
    alert('「可能」唔係選項');
    return;
  }
  alert('Demo version – wire API_BASE to enable submit');
});
