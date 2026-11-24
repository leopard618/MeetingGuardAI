/**
 * M14 guest page (no sign-in, no app): accept, decline or propose another time for a meeting.
 * The link is https://<host>/g#t=<token>&l=<language>; the token stays in the fragment, so it
 * never reaches a server log or a Referer. The page calls two public callables (guestView,
 * guestRespond, functions/src/guests) with the plain callable protocol. It shows only what the
 * server returns (title, time, zone, organizer name). All text is set with textContent.
 * A random id kept in this browser lets the same guest change the answer later.
 */
const FUNCTIONS_BASE = 'https://us-central1-meetingguard-ai-app.cloudfunctions.net';
const LANGUAGES = ['en', 'es', 'pt', 'fr', 'de'];

const TEXT = {
  en: {
    loading: 'Loading the invitation...',
    from: '{name} invites you',
    fromUnknown: 'You are invited',
    zone: 'Times are shown in your time zone ({zone}). The organizer is in {owner}.',
    accept: 'Accept',
    decline: 'Decline',
    propose: 'Propose another time',
    proposeLabel: 'Your proposed start',
    name: 'Your name (optional)',
    email: 'Your email (optional)',
    message: 'A short note (optional)',
    send: 'Send',
    cancel: 'Back',
    sendAccept: 'Send acceptance',
    sendDecline: 'Send decline',
    sendPropose: 'Send proposal',
    pickTime: 'Pick a future date and time.',
    failed: 'Could not send. Check your connection and try again.',
    limited: 'Too many answers for now. Try again later.',
    doneAccepted: 'You accepted',
    doneDeclined: 'You declined',
    doneProposed: 'You proposed another time',
    doneBody: 'The organizer will see your answer in Meeting Guard AI. A proposed time changes the meeting only if the organizer approves it.',
    change: 'Change my answer',
    current: 'Your answer: {answer}',
    currentProposed: 'Your answer: another time, {time}',
    recurring: 'This is a repeating meeting. The next one is shown.',
    closedInvalid: 'This link does not work',
    closedInvalidBody: 'Ask the organizer for a new link.',
    closedCancelled: 'This meeting was cancelled',
    closedCancelledBody: 'There is nothing to answer.',
    closedPast: 'This meeting has already taken place',
    closedPastBody: 'Answers are closed.',
    closedExpired: 'This link has expired',
    closedExpiredBody: 'Ask the organizer for a new link.',
    allDay: 'All day',
    privacy: 'Your answer, and the name, email and note you add, go only to the organizer.',
    foot: 'Sent with Meeting Guard AI',
  },
  es: {
    loading: 'Cargando la invitación...',
    from: '{name} te invita',
    fromUnknown: 'Estás invitado',
    zone: 'Los horarios se muestran en tu zona horaria ({zone}). El organizador está en {owner}.',
    accept: 'Aceptar',
    decline: 'Rechazar',
    propose: 'Proponer otra hora',
    proposeLabel: 'Tu hora de inicio propuesta',
    name: 'Tu nombre (opcional)',
    email: 'Tu correo (opcional)',
    message: 'Una nota breve (opcional)',
    send: 'Enviar',
    cancel: 'Volver',
    sendAccept: 'Enviar aceptación',
    sendDecline: 'Enviar rechazo',
    sendPropose: 'Enviar propuesta',
    pickTime: 'Elige una fecha y hora futuras.',
    failed: 'No se pudo enviar. Revisa tu conexión e inténtalo de nuevo.',
    limited: 'Demasiadas respuestas por ahora. Inténtalo más tarde.',
    doneAccepted: 'Aceptaste',
    doneDeclined: 'Rechazaste',
    doneProposed: 'Propusiste otra hora',
    doneBody: 'El organizador verá tu respuesta en Meeting Guard AI. Una hora propuesta cambia la reunión solo si el organizador la aprueba.',
    change: 'Cambiar mi respuesta',
    current: 'Tu respuesta: {answer}',
    currentProposed: 'Tu respuesta: otra hora, {time}',
    recurring: 'Es una reunión que se repite. Se muestra la próxima.',
    closedInvalid: 'Este enlace no funciona',
    closedInvalidBody: 'Pide al organizador un enlace nuevo.',
    closedCancelled: 'Esta reunión se canceló',
    closedCancelledBody: 'No hay nada que responder.',
    closedPast: 'Esta reunión ya se realizó',
    closedPastBody: 'Las respuestas están cerradas.',
    closedExpired: 'Este enlace venció',
    closedExpiredBody: 'Pide al organizador un enlace nuevo.',
    allDay: 'Todo el día',
    privacy: 'Tu respuesta, y el nombre, el correo y la nota que agregues, solo llegan al organizador.',
    foot: 'Enviado con Meeting Guard AI',
  },
  pt: {
    loading: 'Carregando o convite...',
    from: '{name} convida você',
    fromUnknown: 'Você foi convidado',
    zone: 'Os horários aparecem no seu fuso horário ({zone}). O organizador está em {owner}.',
    accept: 'Aceitar',
    decline: 'Recusar',
    propose: 'Propor outro horário',
    proposeLabel: 'Seu horário de início proposto',
    name: 'Seu nome (opcional)',
    email: 'Seu e-mail (opcional)',
    message: 'Uma nota curta (opcional)',
    send: 'Enviar',
    cancel: 'Voltar',
    sendAccept: 'Enviar aceite',
    sendDecline: 'Enviar recusa',
    sendPropose: 'Enviar proposta',
    pickTime: 'Escolha uma data e hora futuras.',
    failed: 'Não foi possível enviar. Verifique sua conexão e tente de novo.',
    limited: 'Respostas demais por agora. Tente mais tarde.',
    doneAccepted: 'Você aceitou',
    doneDeclined: 'Você recusou',
    doneProposed: 'Você propôs outro horário',
    doneBody: 'O organizador verá sua resposta no Meeting Guard AI. Um horário proposto só muda a reunião se o organizador aprovar.',
    change: 'Mudar minha resposta',
    current: 'Sua resposta: {answer}',
    currentProposed: 'Sua resposta: outro horário, {time}',
    recurring: 'É uma reunião que se repete. A próxima é mostrada.',
    closedInvalid: 'Este link não funciona',
    closedInvalidBody: 'Peça um link novo ao organizador.',
    closedCancelled: 'Esta reunião foi cancelada',
    closedCancelledBody: 'Não há nada a responder.',
    closedPast: 'Esta reunião já aconteceu',
    closedPastBody: 'As respostas estão encerradas.',
    closedExpired: 'Este link expirou',
    closedExpiredBody: 'Peça um link novo ao organizador.',
    allDay: 'Dia inteiro',
    privacy: 'Sua resposta, e o nome, o e-mail e a nota que você adicionar, vão só para o organizador.',
    foot: 'Enviado com o Meeting Guard AI',
  },
  fr: {
    loading: "Chargement de l'invitation...",
    from: '{name} vous invite',
    fromUnknown: 'Vous êtes invité',
    zone: "Les heures sont affichées dans votre fuseau horaire ({zone}). L'organisateur est à {owner}.",
    accept: 'Accepter',
    decline: 'Refuser',
    propose: 'Proposer un autre horaire',
    proposeLabel: 'Votre heure de début proposée',
    name: 'Votre nom (facultatif)',
    email: 'Votre e-mail (facultatif)',
    message: 'Un mot (facultatif)',
    send: 'Envoyer',
    cancel: 'Retour',
    sendAccept: "Envoyer l'acceptation",
    sendDecline: 'Envoyer le refus',
    sendPropose: 'Envoyer la proposition',
    pickTime: 'Choisissez une date et une heure à venir.',
    failed: "Envoi impossible. Vérifiez votre connexion et réessayez.",
    limited: 'Trop de réponses pour le moment. Réessayez plus tard.',
    doneAccepted: 'Vous avez accepté',
    doneDeclined: 'Vous avez refusé',
    doneProposed: 'Vous avez proposé un autre horaire',
    doneBody: "L'organisateur verra votre réponse dans Meeting Guard AI. Un horaire proposé ne change la réunion que si l'organisateur l'approuve.",
    change: 'Modifier ma réponse',
    current: 'Votre réponse : {answer}',
    currentProposed: 'Votre réponse : un autre horaire, {time}',
    recurring: 'Cette réunion se répète. La prochaine est affichée.',
    closedInvalid: 'Ce lien ne fonctionne pas',
    closedInvalidBody: "Demandez un nouveau lien à l'organisateur.",
    closedCancelled: 'Cette réunion a été annulée',
    closedCancelledBody: "Il n'y a rien à répondre.",
    closedPast: 'Cette réunion a déjà eu lieu',
    closedPastBody: 'Les réponses sont closes.',
    closedExpired: 'Ce lien a expiré',
    closedExpiredBody: "Demandez un nouveau lien à l'organisateur.",
    allDay: 'Toute la journée',
    privacy: "Votre réponse, ainsi que le nom, l'e-mail et le mot que vous ajoutez, ne vont qu'à l'organisateur.",
    foot: 'Envoyé avec Meeting Guard AI',
  },
  de: {
    loading: 'Die Einladung wird geladen...',
    from: '{name} lädt Sie ein',
    fromUnknown: 'Sie sind eingeladen',
    zone: 'Die Zeiten werden in Ihrer Zeitzone angezeigt ({zone}). Der Organisator ist in {owner}.',
    accept: 'Zusagen',
    decline: 'Absagen',
    propose: 'Andere Zeit vorschlagen',
    proposeLabel: 'Ihr vorgeschlagener Beginn',
    name: 'Ihr Name (optional)',
    email: 'Ihre E-Mail (optional)',
    message: 'Eine kurze Notiz (optional)',
    send: 'Senden',
    cancel: 'Zurück',
    sendAccept: 'Zusage senden',
    sendDecline: 'Absage senden',
    sendPropose: 'Vorschlag senden',
    pickTime: 'Wählen Sie ein Datum und eine Uhrzeit in der Zukunft.',
    failed: 'Senden nicht möglich. Prüfen Sie Ihre Verbindung und versuchen Sie es erneut.',
    limited: 'Zu viele Antworten im Moment. Versuchen Sie es später erneut.',
    doneAccepted: 'Sie haben zugesagt',
    doneDeclined: 'Sie haben abgesagt',
    doneProposed: 'Sie haben eine andere Zeit vorgeschlagen',
    doneBody: 'Der Organisator sieht Ihre Antwort in Meeting Guard AI. Eine vorgeschlagene Zeit ändert das Meeting nur, wenn der Organisator sie bestätigt.',
    change: 'Antwort ändern',
    current: 'Ihre Antwort: {answer}',
    currentProposed: 'Ihre Antwort: andere Zeit, {time}',
    recurring: 'Dieses Meeting wiederholt sich. Das nächste wird angezeigt.',
    closedInvalid: 'Dieser Link funktioniert nicht',
    closedInvalidBody: 'Bitten Sie den Organisator um einen neuen Link.',
    closedCancelled: 'Dieses Meeting wurde abgesagt',
    closedCancelledBody: 'Es gibt nichts zu beantworten.',
    closedPast: 'Dieses Meeting hat bereits stattgefunden',
    closedPastBody: 'Antworten sind geschlossen.',
    closedExpired: 'Dieser Link ist abgelaufen',
    closedExpiredBody: 'Bitten Sie den Organisator um einen neuen Link.',
    allDay: 'Ganztägig',
    privacy: 'Ihre Antwort sowie Name, E-Mail und Notiz, die Sie hinzufügen, gehen nur an den Organisator.',
    foot: 'Gesendet mit Meeting Guard AI',
  },
};

const $ = (id) => document.getElementById(id);

function parseHash() {
  const params = new URLSearchParams((location.hash || '').replace(/^#/, ''));
  let token = params.get('t') || '';
  let lang = params.get('l') || '';
  // The address bar loses the token below; this tab keeps it, so a reload still works.
  try {
    if (token) sessionStorage.setItem('mg-guest-link', JSON.stringify({ token, lang }));
    else {
      const kept = JSON.parse(sessionStorage.getItem('mg-guest-link') || 'null');
      if (kept && typeof kept.token === 'string') {
        token = kept.token;
        lang = typeof kept.lang === 'string' ? kept.lang : '';
      }
    }
  } catch {
    // private mode: the link has to be opened again
  }
  return { token, lang };
}

function pickLanguage(requested, ownerLanguage) {
  if (LANGUAGES.includes(requested)) return requested;
  for (const tag of navigator.languages || [navigator.language || '']) {
    const base = String(tag).slice(0, 2).toLowerCase();
    if (LANGUAGES.includes(base)) return base;
  }
  return LANGUAGES.includes(ownerLanguage) ? ownerLanguage : 'en';
}

function clientId() {
  const key = 'mg-guest-client';
  try {
    const stored = localStorage.getItem(key);
    if (stored && /^[A-Za-z0-9_-]{16,64}$/.test(stored)) return stored;
  } catch {
    // private mode: a fresh id per visit
  }
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  const id = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  try {
    localStorage.setItem(key, id);
  } catch {
    // ignore
  }
  return id;
}

async function call(name, data) {
  const response = await fetch(`${FUNCTIONS_BASE}/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body || body.error) {
    const reason = body && body.error && body.error.details && body.error.details.reason;
    const error = new Error(reason || 'failed');
    error.reason = reason || 'failed';
    throw error;
  }
  return body.result;
}

function fill(template, values) {
  return template.replace(/\{(\w+)\}/g, (match, key) => (key in values ? String(values[key]) : match));
}

const state = { lang: 'en', token: '', view: null, kind: null, clientId: '' };
const t = (key) => (TEXT[state.lang] || TEXT.en)[key];

function localeOf(lang) {
  return { en: 'en-US', es: 'es', pt: 'pt-BR', fr: 'fr-FR', de: 'de-DE' }[lang] || 'en-US';
}

function formatWhen(meeting) {
  const locale = localeOf(state.lang);
  const start = new Date(meeting.startAt);
  if (meeting.allDay) {
    const day = new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', timeZone: meeting.timezone }).format(start);
    return `${day}, ${t('allDay')}`;
  }
  const end = new Date(start.getTime() + meeting.durationMinutes * 60000);
  const day = new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long' }).format(start);
  const time = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' });
  return `${day}, ${time.format(start)} - ${time.format(end)}`;
}

function formatInstant(iso) {
  return new Intl.DateTimeFormat(localeOf(state.lang), { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
}

function show(id) {
  for (const section of ['loading', 'closed', 'invite', 'done']) $(section).hidden = section !== id;
}

function renderStatic() {
  document.documentElement.lang = state.lang;
  $('loading-text').textContent = t('loading');
  $('btn-accept').textContent = t('accept');
  $('btn-decline').textContent = t('decline');
  $('btn-propose').textContent = t('propose');
  $('propose-label').textContent = t('proposeLabel');
  $('name-label').textContent = t('name');
  $('email-label').textContent = t('email');
  $('message-label').textContent = t('message');
  $('btn-cancel').textContent = t('cancel');
  $('btn-change').textContent = t('change');
  $('foot-privacy').textContent = t('privacy');
  $('foot-link').textContent = t('foot');
}

function renderClosed(view) {
  const key = { invalid: 'Invalid', revoked: 'Invalid', cancelled: 'Cancelled', past: 'Past', expired: 'Expired' }[view.state] || 'Invalid';
  $('closed-title').textContent = t(`closed${key}`);
  $('closed-body').textContent = t(`closed${key}Body`);
  show('closed');
}

function answerWord(kind) {
  return { accepted: t('accept'), declined: t('decline') }[kind] || kind;
}

function renderInvite(view) {
  const meeting = view.meeting;
  $('invite-from').textContent = view.organizerName ? fill(t('from'), { name: view.organizerName }) : t('fromUnknown');
  $('invite-title').textContent = meeting.title || '-';
  document.title = `${meeting.title || 'Meeting'} - Meeting Guard AI`;
  $('invite-when').textContent = formatWhen(meeting);
  const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const zoneNode = $('invite-zone');
  const notes = [];
  if (!meeting.allDay && browserZone && browserZone !== meeting.timezone) notes.push(fill(t('zone'), { zone: browserZone, owner: meeting.timezone }));
  if (meeting.recurring) notes.push(t('recurring'));
  zoneNode.textContent = notes.join(' ');
  zoneNode.hidden = notes.length === 0;
  const current = $('invite-current');
  if (view.myResponse) {
    current.textContent = view.myResponse.kind === 'proposed' && view.myResponse.proposedStartAt
      ? fill(t('currentProposed'), { time: formatInstant(view.myResponse.proposedStartAt) })
      : fill(t('current'), { answer: answerWord(view.myResponse.kind) });
    current.hidden = false;
  } else {
    current.hidden = true;
  }
  $('btn-propose').hidden = !view.canPropose;
  $('actions').hidden = false;
  $('details').hidden = true;
  show('invite');
}

function openDetails(kind) {
  state.kind = kind;
  $('actions').hidden = true;
  $('details').hidden = false;
  $('propose-fields').hidden = kind !== 'proposed';
  $('form-error').hidden = true;
  $('btn-send').textContent = t({ accepted: 'sendAccept', declined: 'sendDecline', proposed: 'sendPropose' }[kind]);
  if (kind === 'proposed') {
    const input = $('propose-at');
    const start = new Date(state.view.meeting.startAt);
    const pad = (n) => String(n).padStart(2, '0');
    const local = `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}T${pad(start.getHours())}:${pad(start.getMinutes())}`;
    if (!input.value) input.value = local;
    input.focus();
  } else {
    $('guest-name').focus();
  }
}

async function send(event) {
  event.preventDefault();
  const error = $('form-error');
  error.hidden = true;
  const request = { token: state.token, clientId: state.clientId, kind: state.kind };
  if (state.kind === 'proposed') {
    const value = $('propose-at').value;
    const at = value ? new Date(value) : null;
    if (!at || Number.isNaN(at.getTime()) || at.getTime() <= Date.now()) {
      error.textContent = t('pickTime');
      error.hidden = false;
      return;
    }
    request.proposedStartAt = at.toISOString();
  }
  const name = $('guest-name').value.trim();
  const email = $('guest-email').value.trim();
  const message = $('guest-message').value.trim();
  if (name) request.name = name;
  if (email) request.email = email;
  if (message) request.message = message;
  const button = $('btn-send');
  button.disabled = true;
  try {
    const result = await call('guestRespond', request);
    if (!result.saved) {
      renderClosed({ state: result.state });
      return;
    }
    $('done-title').textContent = t({ accepted: 'doneAccepted', declined: 'doneDeclined', proposed: 'doneProposed' }[state.kind]);
    $('done-body').textContent = t('doneBody');
    state.view.myResponse = { kind: state.kind, proposedStartAt: request.proposedStartAt || null };
    show('done');
  } catch (caught) {
    error.textContent = caught && caught.reason === 'rate_limited' ? t('limited') : t('failed');
    error.hidden = false;
  } finally {
    button.disabled = false;
  }
}

async function main() {
  const { token, lang } = parseHash();
  state.token = token;
  state.clientId = clientId();
  state.lang = pickLanguage(lang, null);
  renderStatic();
  // The token is not needed in the address bar any more (it stays in this page's memory).
  try {
    history.replaceState(null, '', location.pathname);
  } catch {
    // ignore
  }
  $('btn-accept').addEventListener('click', () => openDetails('accepted'));
  $('btn-decline').addEventListener('click', () => openDetails('declined'));
  $('btn-propose').addEventListener('click', () => openDetails('proposed'));
  $('btn-cancel').addEventListener('click', () => renderInvite(state.view));
  $('btn-change').addEventListener('click', () => renderInvite(state.view));
  $('details').addEventListener('submit', (event) => void send(event));
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
    renderClosed({ state: 'invalid' });
    return;
  }
  try {
    const view = await call('guestView', { token, clientId: state.clientId });
    state.view = view;
    if (!LANGUAGES.includes(lang)) {
      state.lang = pickLanguage('', view.language);
      renderStatic();
    }
    if (view.state === 'open' && view.meeting) renderInvite(view);
    else renderClosed(view);
  } catch {
    $('closed-title').textContent = t('closedInvalid');
    $('closed-body').textContent = t('failed');
    show('closed');
  }
}

void main();
