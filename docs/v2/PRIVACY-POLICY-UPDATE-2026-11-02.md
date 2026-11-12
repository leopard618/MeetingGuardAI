# Privacy policy update for meetingguard.ai (Stage 2 features)

For Sven. The live pages are https://meetingguard.ai/privacy-policy/ (English) and
https://meetingguard.ai/es/privacy-policy/ (Spanish), last updated September 28, 2026. Since then
the app gained Google Tasks sync, Sign in with Microsoft, Outlook calendar sync, Microsoft To Do
sync, Zoom links and the WhatsApp assistant. Google reads this page during the OAuth verification
of the calendar and tasks scopes, so the Google section must name every Google scope the app asks
for and keep the Limited Use paragraph.

Rules for the text: plain punctuation only (no em dashes, no ellipsis, no curly quotes). Keep the
URLs unchanged. Change the "Last updated" line to the day you publish. Both languages go live
together.

Also needed: the page https://meetingguard.ai/delete-account/ answers 404 today. Meta requires a
public data deletion page for the WhatsApp integration. Content is in section 9 below.

---

## 1. Section "Information we collect", bullet "Account information"

EN, replace the bullet:

Account information: when you sign in with Google, Apple or Microsoft, we receive your name,
email address and, when the provider gives one, your profile photo, together with a unique
account identifier. Apple and Microsoft may hide your real email address behind a relay address;
we only store what the provider sends us.

ES, replace the bullet:

Informacion de la cuenta: cuando inicias sesion con Google, Apple o Microsoft, recibimos tu
nombre, tu direccion de correo y, cuando el proveedor la entrega, tu foto de perfil, junto con un
identificador unico de la cuenta. Apple y Microsoft pueden ocultar tu correo real tras una
direccion de reenvio; solo guardamos lo que el proveedor nos envia.

Add one bullet after "Meetings and notes":

EN:

Tasks that you create, import or edit: title, notes, due date and time, reminder, the people
named on the task and the meeting it belongs to.

ES:

Tareas que creas, importas o editas: titulo, notas, fecha y hora de vencimiento, recordatorio,
las personas indicadas en la tarea y la reunion a la que pertenece.

Add one bullet at the end of the list:

EN:

WhatsApp: if you link your WhatsApp number, we store that phone number, the date you linked it
and a short conversation state so the assistant can follow up on your last message.

ES:

WhatsApp: si vinculas tu numero de WhatsApp, guardamos ese numero de telefono, la fecha en que lo
vinculaste y un breve estado de la conversacion para que el asistente pueda continuar tu ultimo
mensaje.

## 2. Section "Google Calendar" becomes "Google Calendar and Google Tasks"

EN, replace the whole section:

If you connect Google Calendar, you allow MeetingGuard AI to view and edit the events of your
Google calendars (Google scope "calendar.events"). The app reads the events of the calendars you
choose and writes the meetings you create or change in the app.

If you turn on Google Tasks sync, you allow MeetingGuard AI to create, edit, organize and delete
your tasks (Google scope "tasks"). The app reads the tasks of the list you choose and writes the
tasks you create, complete, change or delete in the app, so both sides show the same tasks. The
app never touches lists you did not choose.

Events and tasks from Google are saved in your MeetingGuard AI account (Google Firebase) so that
they are available on your devices and can trigger your alerts.

The access token that lets the app talk to Google stays on your device, is managed by Google
Sign-In and is never sent to our servers. You can disconnect Google Calendar or Google Tasks at
any time in Settings > Calendar sync, or revoke the access in your Google Account settings.

MeetingGuard AI's use and transfer to any other app of information received from Google APIs will
adhere to the Google API Services User Data Policy, including the Limited Use requirements. This
means:

- We use Google user data only to provide and improve the features described in this policy.
- We only transfer it to others when it is needed for those features (for example, to OpenAI when
  you ask the AI assistant about your meetings or tasks), to comply with the law, or as part of a
  merger or acquisition with notice to you.
- We do not use it for advertising, we do not sell it and we do not use it to train general AI or
  machine-learning models.
- People do not read it unless you give us permission (for example, for support), it is needed for
  security or legal reasons, or it has been aggregated and anonymized.

ES, replace the whole section (title "Google Calendar y Google Tasks"):

Si conectas Google Calendar, permites a MeetingGuard AI ver y editar los eventos de tus
calendarios de Google (permiso de Google "calendar.events"). La app lee los eventos de los
calendarios que eliges y escribe las reuniones que creas o cambias en la app.

Si activas la sincronizacion con Google Tasks, permites a MeetingGuard AI crear, editar, organizar
y eliminar tus tareas (permiso de Google "tasks"). La app lee las tareas de la lista que eliges y
escribe las tareas que creas, completas, cambias o eliminas en la app, de modo que ambos lados
muestran las mismas tareas. La app nunca toca listas que no hayas elegido.

Los eventos y tareas de Google se guardan en tu cuenta de MeetingGuard AI (Google Firebase) para
que esten disponibles en tus dispositivos y puedan activar tus alertas.

El token de acceso que permite a la app hablar con Google se queda en tu dispositivo, lo gestiona
Google Sign-In y nunca se envia a nuestros servidores. Puedes desconectar Google Calendar o Google
Tasks en cualquier momento en Ajustes > Sincronizacion de calendarios, o revocar el acceso en la
configuracion de tu cuenta de Google.

El uso y la transferencia a cualquier otra app de la informacion recibida de las API de Google por
parte de MeetingGuard AI se ajustara a la Politica de datos de usuario de los servicios de API de
Google, incluidos los requisitos de Uso limitado. Esto significa:

- Usamos los datos de usuario de Google solo para ofrecer y mejorar las funciones descritas en esta
  politica.
- Solo los transferimos a terceros cuando es necesario para esas funciones (por ejemplo, a OpenAI
  cuando preguntas al asistente de IA por tus reuniones o tareas), para cumplir la ley, o como
  parte de una fusion o adquisicion con aviso previo.
- No los usamos para publicidad, no los vendemos y no los usamos para entrenar modelos generales de
  IA o de aprendizaje automatico.
- Ninguna persona los lee salvo que nos des permiso (por ejemplo, para soporte), sea necesario por
  seguridad o motivos legales, o esten agregados y anonimizados.

## 3. New section after the Google one: "Microsoft: sign-in, Outlook and To Do"

EN:

Sign in with Microsoft: when you sign in with Microsoft, Microsoft sends our server a signed proof
of your identity (name, email address and account identifier). Our server checks it and creates or
links your MeetingGuard AI account. We keep the Microsoft account identifier, the email address and
the date of your last sign-in so you can sign in again.

Outlook calendar: if you connect Outlook, you allow MeetingGuard AI to read and write the events of
your Outlook calendars through Microsoft Graph. When you ask for a Microsoft Teams link, the
meeting is created in Outlook as an online meeting and Microsoft generates the link.

Microsoft To Do: if you turn on To Do sync, you allow MeetingGuard AI to read and write the tasks of
the To Do lists you choose through Microsoft Graph, so the app and To Do show the same tasks.

Events and tasks from Microsoft are saved in your MeetingGuard AI account (Google Firebase) so that
they are available on your devices and can trigger your alerts. The Microsoft tokens that let the
app talk to Outlook and To Do stay on your device, in the operating system's secure storage, and
are never sent to our servers. You can disconnect Outlook or To Do at any time in Settings >
Calendar sync, or revoke the access at https://account.live.com/consent/Manage (personal accounts)
or https://myapps.microsoft.com (work or school accounts).

ES (title "Microsoft: inicio de sesion, Outlook y To Do"):

Inicio de sesion con Microsoft: cuando inicias sesion con Microsoft, Microsoft envia a nuestro
servidor una prueba firmada de tu identidad (nombre, direccion de correo e identificador de
cuenta). Nuestro servidor la comprueba y crea o vincula tu cuenta de MeetingGuard AI. Conservamos
el identificador de la cuenta de Microsoft, la direccion de correo y la fecha de tu ultimo inicio
de sesion para que puedas volver a entrar.

Calendario de Outlook: si conectas Outlook, permites a MeetingGuard AI leer y escribir los eventos
de tus calendarios de Outlook a traves de Microsoft Graph. Cuando pides un enlace de Microsoft
Teams, la reunion se crea en Outlook como reunion en linea y Microsoft genera el enlace.

Microsoft To Do: si activas la sincronizacion con To Do, permites a MeetingGuard AI leer y escribir
las tareas de las listas de To Do que eliges a traves de Microsoft Graph, de modo que la app y To
Do muestran las mismas tareas.

Los eventos y tareas de Microsoft se guardan en tu cuenta de MeetingGuard AI (Google Firebase) para
que esten disponibles en tus dispositivos y puedan activar tus alertas. Los tokens de Microsoft que
permiten a la app hablar con Outlook y To Do se quedan en tu dispositivo, en el almacenamiento
seguro del sistema operativo, y nunca se envian a nuestros servidores. Puedes desconectar Outlook o
To Do en cualquier momento en Ajustes > Sincronizacion de calendarios, o revocar el acceso en
https://account.live.com/consent/Manage (cuentas personales) o https://myapps.microsoft.com
(cuentas de trabajo o escuela).

## 4. New section: "Zoom links"

EN:

If you choose Zoom as the video call of a meeting, our server creates the Zoom meeting through
MeetingGuard AI's own Zoom account and stores the join link with your meeting. Zoom receives the
meeting title, start time, duration and time zone, nothing else about you. You do not need a Zoom
account, and your Zoom account is never connected.

ES (title "Enlaces de Zoom"):

Si eliges Zoom como videollamada de una reunion, nuestro servidor crea la reunion de Zoom a traves
de la propia cuenta de Zoom de MeetingGuard AI y guarda el enlace con tu reunion. Zoom recibe el
titulo de la reunion, la hora de inicio, la duracion y la zona horaria, nada mas sobre ti. No
necesitas una cuenta de Zoom, y tu cuenta de Zoom nunca se conecta.

## 5. New section: "WhatsApp assistant"

EN:

The WhatsApp assistant is optional. To use it you link your WhatsApp number in the app with a
one-time code. From then on, messages you send to the MeetingGuard AI WhatsApp number are
delivered to our server by Meta (WhatsApp Business Platform) and handled like requests to the AI
assistant in the app: our server sends the text of your message, together with your upcoming
meetings and open tasks, to OpenAI to understand the request, and nothing is created, changed or
deleted until you confirm it in the chat. Meta processes the messages between you and our number
under its own terms and privacy policy. We do not store the content of your messages beyond a
short conversation state, which resets after 15 minutes without messages, and our server logs never contain
message text or phone numbers. Send STOP to pause the assistant, or unlink the number in Settings
> WhatsApp, which deletes the link and the conversation state.

ES (title "Asistente de WhatsApp"):

El asistente de WhatsApp es opcional. Para usarlo, vinculas tu numero de WhatsApp en la app con
un codigo de un solo uso. Desde entonces, los mensajes que envias al numero de WhatsApp de
MeetingGuard AI llegan a nuestro servidor a traves de Meta (WhatsApp Business Platform) y se
tratan como peticiones al asistente de IA de la app: nuestro servidor envia el texto de tu mensaje,
junto con tus proximas reuniones y tareas abiertas, a OpenAI para entender la peticion, y nada se
crea, cambia o elimina hasta que lo confirmas en el chat. Meta procesa los mensajes entre tu y
nuestro numero segun sus propios terminos y politica de privacidad. No guardamos el contenido de
tus mensajes mas alla de un breve estado de la conversacion, que se reinicia tras 15 minutos sin mensajes, y los
registros de nuestro servidor nunca contienen texto de mensajes ni numeros de telefono. Envia STOP
para pausar el asistente, o desvincula el numero en Ajustes > WhatsApp, lo que elimina el vinculo y
el estado de la conversacion.

## 6. Section "Who we share information with": add bullets

EN, add after the OpenAI bullet:

- Microsoft, when you sign in with Microsoft or connect Outlook or To Do.
- Apple, when you sign in with Apple.
- Zoom, when you ask for a Zoom link (meeting title, time, duration and time zone only).
- Meta (WhatsApp Business Platform), when you link your WhatsApp number: Meta carries the messages
  between you and our WhatsApp number.

EN, replace the "Google Calendar and the calendars on your phone" bullet with:

- Google Calendar, Google Tasks, Outlook, Microsoft To Do and the calendars on your phone, only when
  you connect them.

ES, add after the OpenAI bullet:

- Microsoft, cuando inicias sesion con Microsoft o conectas Outlook o To Do.
- Apple, cuando inicias sesion con Apple.
- Zoom, cuando pides un enlace de Zoom (solo titulo, hora, duracion y zona horaria de la reunion).
- Meta (WhatsApp Business Platform), cuando vinculas tu numero de WhatsApp: Meta transporta los
  mensajes entre tu y nuestro numero de WhatsApp.

ES, replace the Google Calendar bullet with:

- Google Calendar, Google Tasks, Outlook, Microsoft To Do y los calendarios de tu telefono, solo
  cuando los conectas.

## 7. Section "How long we keep your information": add bullets

EN:

- Tasks that the app added to Google Tasks or Microsoft To Do, and events it added to Outlook, stay
  there until you delete them.
- The WhatsApp link (your phone number) is kept until you unlink it or delete your account. The
  conversation state resets after 15 minutes without messages.

ES:

- Las tareas que la app anadio a Google Tasks o Microsoft To Do, y los eventos que anadio a Outlook,
  permanecen alli hasta que los elimines.
- El vinculo de WhatsApp (tu numero de telefono) se conserva hasta que lo desvinculas o eliminas tu
  cuenta. El estado de la conversacion se reinicia tras 15 minutos sin mensajes.

## 8. Section "Your rights": extend the consent sentence

EN, in the bullet about withdrawing consent, replace "by disconnecting Google Calendar" with:

by disconnecting Google Calendar, Google Tasks, Outlook or Microsoft To Do, or by unlinking
WhatsApp

ES, same bullet:

desconectando Google Calendar, Google Tasks, Outlook o Microsoft To Do, o desvinculando WhatsApp

## 9. New page: https://meetingguard.ai/delete-account/ (and /es/delete-account/)

EN:

Delete your MeetingGuard AI account

You can delete your account and all its data yourself, in the app: Settings > Account > Delete
account. The app asks you to confirm your identity and then permanently deletes your account,
meetings, notes, tasks, preferences, assistant usage, calendar and task sync links, your WhatsApp
link and the server copy of your data. The copy on your phone is deleted at the same time.

If you can no longer sign in, write to [support email] from the email address of your account and
ask us to delete it. We confirm the deletion by email within 30 days.

Events and tasks the app added to Google Calendar, Google Tasks, Outlook or Microsoft To Do stay in
those services until you delete them there. Database backups that still contain your data expire
within 14 days. A record with only your anonymous user id and the deletion date is kept for 30 days
so that pending charges or refunds can be matched.

ES:

Eliminar tu cuenta de MeetingGuard AI

Puedes eliminar tu cuenta y todos sus datos tu mismo, en la app: Ajustes > Cuenta > Eliminar
cuenta. La app te pide confirmar tu identidad y despues elimina de forma permanente tu cuenta,
reuniones, notas, tareas, preferencias, uso del asistente, vinculos de sincronizacion de
calendarios y tareas, tu vinculo de WhatsApp y la copia de tus datos en el servidor. La copia de tu
telefono se elimina al mismo tiempo.

Si ya no puedes iniciar sesion, escribe a [correo de soporte] desde la direccion de correo de tu
cuenta y pidenos que la eliminemos. Confirmamos la eliminacion por correo en un plazo de 30 dias.

Los eventos y tareas que la app anadio a Google Calendar, Google Tasks, Outlook o Microsoft To Do
permanecen en esos servicios hasta que los elimines alli. Las copias de seguridad de la base de
datos que aun contienen tus datos caducan en 14 dias. Durante 30 dias se conserva un registro con
solo tu identificador anonimo de usuario y la fecha de eliminacion, para poder casar cobros o
reembolsos pendientes.

---

Checklist before publishing:

- [ ] "Last updated" changed on both languages.
- [ ] The Google section names both scopes ("calendar.events" and "tasks") and keeps the Limited
      Use paragraph word for word.
- [ ] /delete-account/ and /es/delete-account/ answer 200.
- [ ] No em dashes, ellipsis or curly quotes anywhere in the new text.
- [ ] Dusko receives the two URLs and the publish date, so the in-app policy text
      (src/i18n/locales/{en,es}/legal.json) is updated to match in the next build.
