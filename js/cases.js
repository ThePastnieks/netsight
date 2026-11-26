// NetSight — cases.
//
// A case is a report that somebody has to decide about. This module owns the
// three things that decision needs, and nothing else:
//
//   severity  how urgent it is, set by the patrol when they accept it
//   verdict   accept or decline, with a reason when declining
//   messages  the conversation between the reporter and the patrol
//
// Declining matters as much as accepting. Half of what gets reported is a bottle,
// a bit of polystyrene, or a legal net somebody did not recognise. Without a
// decline that carries a reason, those pile up forever and the list stops being
// worth opening.

const CaseModule = (function() {
  'use strict';

  const MSG_KEY = 'netsight_case_messages';

  // Four levels, not five. A scale nobody can remember in the rain is worse than
  // a coarse one everybody agrees on.
  const SEVERITY = {
    critical: {
      id: 'critical',
      label: 'Critical',
      short: 'Now',
      tone: 'danger',
      hint: 'Hazard to boats, or gear moving on its own',
      order: 0
    },
    high: {
      id: 'high',
      label: 'High',
      short: 'Today',
      tone: 'warn',
      hint: 'Likely illegal, or a large net',
      order: 1
    },
    medium: {
      id: 'medium',
      label: 'Medium',
      short: 'This week',
      tone: 'info',
      hint: 'Needs checking, nothing urgent',
      order: 2
    },
    low: {
      id: 'low',
      label: 'Low',
      short: 'When passing',
      tone: 'muted',
      hint: 'Minor, or partly gone already',
      order: 3
    }
  };

  const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low'];

  // Reasons to close a report without acting on it. Each one is a thing that
  // actually happens, phrased the way a patrol would say it.
  const DECLINE_REASONS = {
    not_gear: {
      id: 'not_gear',
      label: 'Not fishing gear',
      hint: 'Bottle, rubbish, a branch, a marker'
    },
    legal: {
      id: 'legal',
      label: 'Registered and legal',
      hint: 'The owner has it registered'
    },
    already_gone: {
      id: 'already_gone',
      label: 'Already gone',
      hint: 'Nothing there when we looked'
    },
    duplicate: {
      id: 'duplicate',
      label: 'Already reported',
      hint: 'Same thing, another report'
    },
    outside: {
      id: 'outside',
      label: 'Outside our water',
      hint: 'Someone else looks after it'
    }
  };

  function severityInfo(id) {
    return SEVERITY[id] || null;
  }

  function severityLabel(id) {
    const s = SEVERITY[id];
    return s ? s.label : 'Not set';
  }

  function severityOrder(id) {
    const s = SEVERITY[id];
    return s ? s.order : 99;
  }

  function declineInfo(id) {
    return DECLINE_REASONS[id] || null;
  }

  // ------------------------------------------------------------------ messages

  function readMessages() {
    try {
      const raw = localStorage.getItem(MSG_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (err) {
      console.warn('Could not read messages:', err);
    }
    return [];
  }

  function writeMessages(list) {
    try {
      localStorage.setItem(MSG_KEY, JSON.stringify(list));
    } catch (err) {
      console.warn('Could not save messages:', err);
    }
  }

  function db() {
    if (typeof Auth === 'undefined' || !Auth.isCloud()) return null;
    return Auth.client();
  }

  // Messages for one case, oldest first.
  async function messages(caseId) {
    const client = db();

    if (!client) {
      return readMessages()
        .filter(m => m.caseId === caseId)
        .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    }

    const { data, error } = await client
      .from('case_messages')
      .select('id, case_id, author_name, author_role, body, created_at')
      .eq('case_id', caseId)
      .order('created_at', { ascending: true });

    if (error) {
      console.warn('Could not load messages:', error.message);
      return [];
    }

    return (data || []).map(row => ({
      id: row.id,
      caseId: row.case_id,
      authorName: row.author_name,
      authorRole: row.author_role,
      text: row.body,
      createdAt: row.created_at
    }));
  }

  async function sendMessage(caseId, text, options) {
    const opts = options || {};
    const body = String(text || '').trim();
    if (!body) return { ok: false, message: 'Nothing to send' };
    if (body.length > 1000) return { ok: false, message: 'That is too long' };

    const me = (typeof Auth !== 'undefined' && Auth.current()) || null;
    if (!me) return { ok: false, message: 'Sign in first' };

    const client = db();

    if (!client) {
      const list = readMessages();
      const message = {
        id: 'msg-' + Date.now().toString(36),
        caseId,
        authorName: me.username,
        authorRole: me.role,
        text: body,
        createdAt: new Date().toISOString()
      };
      list.push(message);
      writeMessages(list);
      return { ok: true, message };
    }

    const { data, error } = await client
      .from('case_messages')
      .insert({
        case_id: caseId,
        author_id: me.id,
        author_name: me.username,
        author_role: me.role,
        body
      })
      .select('id, case_id, author_name, author_role, body, created_at')
      .single();

    if (error) return { ok: false, message: error.message };

    return {
      ok: true,
      message: {
        id: data.id,
        caseId: data.case_id,
        authorName: data.author_name,
        authorRole: data.author_role,
        text: data.body,
        createdAt: data.created_at
      }
    };
  }

  async function messageCount(caseId) {
    return (await messages(caseId)).length;
  }

  // -------------------------------------------------------------- decisions

  // Accepting sets the severity and moves the case to `checked` — somebody has
  // taken ownership of it. Declining closes it with a reason.
  async function decide(caseId, decision) {
    const me = (typeof Auth !== 'undefined' && Auth.current()) || null;
    if (!me) return { ok: false, message: 'Sign in first' };

    if (typeof StoreModule === 'undefined') {
      return { ok: false, message: 'Storage not available' };
    }

    const kind = decision && decision.kind;

    if (kind === 'accept') {
      const severity = decision.severity;
      if (!SEVERITY[severity]) return { ok: false, message: 'Pick a severity first' };

      await StoreModule.updateSightingUnified(caseId, {
        status: 'checked',
        severity,
        verdict: 'accepted',
        handled_by: me.username,
        handled_at: new Date().toISOString()
      });

      return { ok: true };
    }

    if (kind === 'decline') {
      const reason = decision.reason;
      if (!DECLINE_REASONS[reason]) return { ok: false, message: 'Pick a reason first' };

      await StoreModule.updateSightingUnified(caseId, {
        status: 'false_alarm',
        verdict: 'declined',
        decline_reason: reason,
        note: decision.note
          ? (decision.note || '')
          : DECLINE_REASONS[reason].label,
        handled_by: me.username,
        handled_at: new Date().toISOString()
      });

      return { ok: true };
    }

    return { ok: false, message: 'Unknown decision' };
  }

  // What the patrol should see on the card, in one line.
  function summary(sighting) {
    if (!sighting) return '';

    if (sighting.verdict === 'declined') {
      const r = declineInfo(sighting.decline_reason);
      return 'Declined — ' + (r ? r.label.toLowerCase() : 'no reason given');
    }

    if (sighting.verdict === 'accepted') {
      return 'Accepted · ' + severityLabel(sighting.severity).toLowerCase();
    }

    return 'Waiting for a decision';
  }

  // Cases that still need somebody. Declined and resolved ones are done.
  function isOpen(sighting) {
    if (!sighting) return false;
    if (sighting.verdict === 'declined') return false;
    return sighting.status !== 'resolved';
  }

  function sortForPatrol(list) {
    return (list || []).slice().sort((a, b) => {
      // Undecided first: they are the work.
      const aDone = a.verdict ? 1 : 0;
      const bDone = b.verdict ? 1 : 0;
      if (aDone !== bDone) return aDone - bDone;

      // Then by severity, then oldest first so nothing starves.
      const sa = severityOrder(a.severity);
      const sb = severityOrder(b.severity);
      if (sa !== sb) return sa - sb;

      return new Date(a.created_at) - new Date(b.created_at);
    });
  }

  return {
    SEVERITY,
    SEVERITY_ORDER,
    DECLINE_REASONS,
    severityInfo,
    severityLabel,
    severityOrder,
    declineInfo,
    messages,
    sendMessage,
    messageCount,
    decide,
    summary,
    isOpen,
    sortForPatrol
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = CaseModule;
} else {
  window.CaseModule = CaseModule;
}
