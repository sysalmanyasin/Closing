/* ═══════════════════════════════════════════════════════════════
   NTFY LINK — Settings shortcut to the closing-notification topic.

   The whatsapp-notify edge function also publishes every saved
   closing to an ntfy topic. This file only stores that topic name on
   THIS device and opens it (ntfy app first, web page as fallback).

   The topic name is deliberately NOT hardcoded: this repo is public,
   and anyone who knows a public ntfy.sh topic can read it. The name
   is pasted once in Settings and kept in localStorage only.
═══════════════════════════════════════════════════════════════ */

import { repoGetLocal, repoSetLocal, repoRemoveLocal } from './repository.js';
import { showAlert } from './notify.js';

const NTFY_TOPIC_KEY = 'ntfy_closing_topic';
const NTFY_HOST      = 'ntfy.sh';
const TOPIC_RE       = /^[A-Za-z0-9_-]{1,64}$/;

function cleanTopic(raw) {
  /* Accept a bare topic, a https://ntfy.sh/<topic> URL, or ntfy://ntfy.sh/<topic>. */
  let t = (raw || '').trim();
  t = t.replace(/^(https?|ntfy):\/\/[^/]+\//i, '').replace(/\/+$/, '');
  return t;
}

export function ntfyRefreshUI() {
  const input = document.getElementById('ntfy-topic-input');
  const open  = document.getElementById('ntfy-open-row');
  const topic = repoGetLocal(NTFY_TOPIC_KEY) || '';
  if (input) input.value = topic;
  if (open)  open.style.display = topic ? 'flex' : 'none';
}

export function ntfySaveTopic() {
  const input = document.getElementById('ntfy-topic-input');
  const topic = cleanTopic(input?.value);
  if (!topic) { repoRemoveLocal(NTFY_TOPIC_KEY); ntfyRefreshUI(); return; }
  if (!TOPIC_RE.test(topic)) {
    showAlert('Topic can only contain letters, numbers, - and _.');
    return;
  }
  repoSetLocal(NTFY_TOPIC_KEY, topic);
  ntfyRefreshUI();
}

export function ntfyOpenApp() {
  const topic = repoGetLocal(NTFY_TOPIC_KEY);
  if (!topic) { showAlert('Save the ntfy topic first.'); return; }
  window.location.href = `ntfy://${NTFY_HOST}/${topic}`;
}

export function ntfyOpenWeb() {
  const topic = repoGetLocal(NTFY_TOPIC_KEY);
  if (!topic) { showAlert('Save the ntfy topic first.'); return; }
  window.open(`https://${NTFY_HOST}/${topic}`, '_blank', 'noopener');
}
