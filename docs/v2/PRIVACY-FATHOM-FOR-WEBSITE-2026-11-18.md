# Privacy Policy update for meetingguard.ai: Connect Fathom

For Sven. The app now connects to Fathom (one tap, "Connect Fathom" under Meeting summaries), so the Privacy Policy gets one new section and four small edits. The text below is the in-app Privacy Policy dated November 18, 2026 (src/i18n/locales/{en,es,pt,fr,de}/legal.json, section "fathom" and the lines named below), so the website and the app say the same thing. Please publish it before the store builds with Connect Fathom are submitted.

Rules for the text (as in TERMS-UPDATE-FOR-WEBSITE-2026-11-06.md):

- Plain punctuation only: no em dashes, no ellipsis character, no curly quotes.
- The product name is "Meeting Guard AI", with a space.
- Change the "Last updated" line of the privacy page, in every language, to the day you publish.
- All languages go live together. Portuguese, French and German are in the same keys of their legal.json files.
- Each paragraph or bullet below is one line. Copy it as it is. Menu paths stay as written.

---

## B1. New section, right after "Meeting summaries by email" / "Minutas de reuniones por correo"

EN, title:

Meeting summaries from Fathom

EN, paragraphs:

If you use Fathom, you can connect it instead of forwarding its emails: tap Connect Fathom under Meeting summaries and approve the access in Fathom. Connecting also gives you your private summary address (see "Meeting summaries by email"), because every summary is kept with it.

After each meeting that Fathom records for you, Fathom sends our server (Google Cloud Functions) that meeting's title, its times, its video-call link, Fathom's summary and its action items, with the names and email addresses of the people they are assigned to. Our server can also ask Fathom for your recordings of the last 7 days, to pick up one that did not arrive. We only receive your own recordings, and never the recording itself, its video or its transcript.

To keep the connection, we store the keys Fathom gives us for your account (an access key, a key to renew it, and the key that signs Fathom's deliveries), encrypted with our own key kept in Google Secret Manager, together with when you connected and when the last summary arrived. A summary from Fathom is then stored, encrypted, filed and kept exactly like a summary by email, under the same rules and for the same time.

You can disconnect Fathom at any time under Meeting summaries: we ask Fathom to stop sending summaries and delete the keys at once. Disconnecting meeting summaries or deleting your account also disconnects Fathom. If Fathom cannot be reached at that moment, you can remove the connection in your Fathom settings. Fathom processes your meetings under its own privacy policy.

ES, title:

Minutas de reuniones desde Fathom

ES, paragraphs:

Si usas Fathom, puedes conectarlo en lugar de reenviar sus correos: toca Conectar Fathom en Minutas de reuniones y aprueba el acceso en Fathom. Al conectarlo también obtienes tu dirección privada de minutas (consulta "Minutas de reuniones por correo"), porque cada minuta se guarda asociada a ella.

Después de cada reunión que Fathom graba para ti, Fathom envía a nuestro servidor (Google Cloud Functions) el título de esa reunión, sus horarios, su enlace de videollamada, la minuta de Fathom y sus tareas, con los nombres y las direcciones de correo de las personas a las que están asignadas. Nuestro servidor también puede pedirle a Fathom tus grabaciones de los últimos 7 días, para recuperar alguna que no haya llegado. Solo recibimos tus propias grabaciones, y nunca la grabación en sí, su video ni su transcripción.

Para mantener la conexión, guardamos las claves que Fathom nos da para tu cuenta (una clave de acceso, una clave para renovarla y la clave que firma los envíos de Fathom), cifradas con nuestra propia clave guardada en Google Secret Manager, junto con cuándo te conectaste y cuándo llegó la última minuta. Después, una minuta de Fathom se guarda, se cifra, se archiva y se conserva exactamente igual que una minuta por correo, con las mismas reglas y durante el mismo tiempo.

Puedes desconectar Fathom cuando quieras en Minutas de reuniones: le pedimos a Fathom que deje de enviar minutas y eliminamos las claves de inmediato. Desconectar las minutas de reuniones o eliminar tu cuenta también desconecta Fathom. Si en ese momento no se puede contactar con Fathom, puedes quitar la conexión en tu configuración de Fathom. Fathom trata tus reuniones según su propia política de privacidad.

## B2. "What we collect": the meeting summaries bullet

EN, replace the bullet:

Meeting summaries: if you turn them on, we store your private summary address, the mailboxes you list, the meeting summaries that reach that address and the tasks suggested from them (see "Meeting summaries by email"). If you connect Fathom, also the keys of that connection, encrypted (see "Meeting summaries from Fathom").

ES, replace the bullet:

Minutas de reuniones: si las activas, guardamos tu dirección privada de minutas, los buzones que indicas, las minutas que llegan a esa dirección y las tareas sugeridas a partir de ellas (consulta "Minutas de reuniones por correo"). Si conectas Fathom, también las claves de esa conexión, cifradas (consulta "Minutas de reuniones desde Fathom").

## B3. "Sharing": a new bullet right after the Postmark bullet

EN, add:

Fathom, when you connect it: we receive your meeting summaries from it, and we send it only the requests needed to keep that connection, never other data from your Meeting Guard AI account.

ES, add:

Fathom, cuando lo conectas: recibimos tus minutas de reuniones desde Fathom y solo le enviamos las solicitudes necesarias para mantener esa conexión, nunca otros datos de tu cuenta de Meeting Guard AI.

## B4. "Retention": the delete-account bullet

EN: add "Fathom connection" after "private summary address" in the list of what is deleted. ES: add "conexión con Fathom" after "dirección privada de minutas". The full bullets:

EN:

You can delete your account at any time in the app: Settings > Account > Delete account. This permanently deletes your account, meetings, tasks, notes, preferences, meeting summaries and private summary address, Fathom connection, assistant usage records, subscription status, WhatsApp link and Microsoft sign-in record from our servers, signs you out and removes the app's access to your Google account or Apple account. Deleting your account does not cancel a subscription bought in the App Store or Google Play: cancel it there.

ES:

Puedes eliminar tu cuenta en cualquier momento desde la app: Ajustes > Cuenta > Eliminar cuenta. Así se borran para siempre de nuestros servidores tu cuenta, reuniones, tareas, notas, preferencias, minutas de reuniones y dirección privada de minutas, conexión con Fathom, registros de uso del asistente, estado de suscripción, vínculo de WhatsApp y registro de inicio de sesión con Microsoft, se cierra tu sesión y se retira el acceso de la app a tu cuenta de Google o a tu cuenta de Apple. Eliminar tu cuenta no cancela una suscripción comprada en App Store o Google Play: cancélala allí.

## B5. "Your rights": the withdraw-consent bullet

EN, replace the bullet:

Object to or restrict some processing, and withdraw your consent at any time, for example by disconnecting Google Calendar, Google Tasks, Outlook or Microsoft To Do, unlinking WhatsApp, disconnecting Fathom or meeting summaries, turning off calendar access or not using the AI assistant.

ES, replace the bullet:

Oponerte a algunos tratamientos o limitarlos, y retirar tu consentimiento en cualquier momento, por ejemplo desconectando Google Calendar, Google Tasks, Outlook o Microsoft To Do, desvinculando WhatsApp, desconectando Fathom o las minutas de reuniones, desactivando el acceso al calendario o dejando de usar el asistente de IA.

---

Every statement was checked against the code (functions/src/summaries/fathom/*): what Fathom sends (title, times, meeting link, summary, action items with assignee names and emails; the webhook asks for no transcript), the 7-day sync window (sync.ts FATHOM_SYNC_LOOKBACK_MS), the keys sealed with the summaries key (store.ts sealSecrets), and the removal on Disconnect Fathom, on "Stop receiving summaries" (callables.ts) and on account deletion (accountDeletion.ts).
