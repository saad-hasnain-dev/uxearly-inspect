'use strict';
const ALL = { origins: ['<all_urls>'] };
const $ = (id) => document.getElementById(id);

const DBG = { permissions: ['debugger'] };
async function refreshDbg() {
  const granted = await chrome.permissions.contains(DBG);
  $('dstate').textContent = granted ? 'On' : 'Off';
  $('dstate').className = 'pill' + (granted ? ' on' : '');
  $('dgrant').hidden = granted;
  $('drevoke').hidden = !granted;
}
$('dgrant').addEventListener('click', async () => { try { await chrome.permissions.request(DBG); } finally { refreshDbg(); } });
$('drevoke').addEventListener('click', async () => { try { await chrome.permissions.remove(DBG); } finally { refreshDbg(); } });

async function refresh() {
  const granted = await chrome.permissions.contains(ALL);
  $('state').textContent = granted ? 'On' : 'Off';
  $('state').className = 'pill' + (granted ? ' on' : '');
  $('grant').hidden = granted;
  $('revoke').hidden = !granted;
}

// chrome.permissions.request must run inside a user gesture
$('grant').addEventListener('click', async () => { try { await chrome.permissions.request(ALL); } finally { refresh(); } });
$('revoke').addEventListener('click', async () => { try { await chrome.permissions.remove(ALL); } finally { refresh(); } });
$('shortcuts').addEventListener('click', (e) => { e.preventDefault(); chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }); });

$('ver').textContent = 'v' + chrome.runtime.getManifest().version;
chrome.commands.getAll((cmds) => {
  const c = cmds.find((x) => x.name === '_execute_action');
  if (c && c.shortcut) $('shortcut').textContent = c.shortcut;
});
const refreshAll = () => { refresh(); refreshDbg(); };
chrome.permissions.onAdded.addListener(refreshAll);
chrome.permissions.onRemoved.addListener(refreshAll);
refreshAll();
if (location.hash === '#capture') { const el = $('capture'); el.classList.add('focus'); el.scrollIntoView({ block: 'center' }); }
if (location.hash === '#welcome') { $('welcome').hidden = false; }
