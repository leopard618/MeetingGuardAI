# M12 store listings: Portuguese (Brazil), French and German

The texts to paste for the new store localizations of version 1.7.0, and the languages line that
replaces "Works in English and Spanish" in every localization, English and Spanish included. The
console steps (where each text goes and in which order) are in `RELEASE-1.7.0-LANGUAGES.md`; the
scope and the decisions are in `M12-LANGUAGES.md`.

Status: draft for native-speaker review. Francisco provides the reviewers or approves a
translation vendor (M12-LANGUAGES.md, open items). A reviewer may change words, but every change
is recounted with the same rules before it is pasted.

## Rules these texts follow

- Variants: Portuguese is Brazilian Portuguese (pt-BR, "você"), French is France French (fr-FR,
  "vous"), German is Germany German (de-DE, "Sie"). The app ships one `pt`, `fr` and `de`
  (language only), so the store localizations are Portuguese (Brazil), French and German.
- The name stays `Meeting Guard AI` in every language. Product names (Google Calendar, Outlook,
  Microsoft To Do, Google Tasks, WhatsApp, Zoom, Google Meet, Microsoft Teams, iCloud, App Store,
  Google Play) are never translated. Button and screen names are quoted exactly as the app shows
  them in that language (meetings.json `debrief`, `endNow.button`; navigation.json `Settings`).
- Honest languages line: the app is in five languages; the reading of notetaker summaries stays
  English and Spanish (M10/M11, Project-Plan-2026-11-09.md section 4). The executive assistant
  (Sven, A1 to A10) also stays English and Spanish; its sentence (X below) is added only once the
  assistant is switched on in a store build, because a listing must not describe a feature the
  build does not have (App Review 2.3.1, Play metadata policy).
- Summaries: the meeting summaries section (S below) and lines 2 and 3 of What's New go in only
  if M10 and M11 ship in the same build as M12.
- Plain punctuation: no long dashes, no ellipsis character, no curly or low quotes, no
  guillemets and no non-breaking spaces. French keeps a plain space before ":", "?" and ";".
  Straight double quotes for quoted speech in every language.
- Counting: a script counted every text below on the exact text with LF line breaks and checked it
  for the banned characters. Descriptions, What's New, promotional text, subtitles and
  subscription fields count characters; App Store keywords count BYTES (accented letters take 2
  bytes, so an English count never carries over). Keywords use no word of the name or the
  subtitle and no company names (IOS-RELEASE-1.6.0.md T4).
- No prices on the App Store (one localization serves many storefronts); the Play description
  keeps the USD prices of ALLOWANCES-2026-11-05.md with "may vary by country".
- Privacy Policy URL: the English page (https://meetingguard.ai/privacy-policy/) until Sven
  publishes the localized pages of `M12-WEBSITE-LANGUAGES.md`; then the description link and the
  App Information field of each localization may point to its own page. Never point a listing at a
  page that does not answer 200.

## Part A. App Store Connect

### A1. Name (App Information; 30 characters at most)

Every localization: `Meeting Guard AI` (16 characters). Never translated.

### A2. Subtitle (App Information; 30 characters at most)

Portuguese (Brazil) (26 characters):

```
Alertas e assistente de IA
```

French (France) (23 characters):

```
Alertes et assistant IA
```

German (Germany) (23 characters):

```
Alarme und KI-Assistent
```

English and Spanish keep their 1.6.0 subtitles (IOS-RELEASE-1.6.0.md T0).

### A3. Keywords (100 bytes at most; accented letters count 2 bytes)

Portuguese (Brazil) (97 bytes, 95 characters):

```
lembrete,alarme,reunião,calendário,tarefas,voz,agenda,organizador,compromissos,prazo,planejador
```

French (France) (96 bytes, 92 characters):

```
rappel,alarme,réunion,calendrier,tâches,agenda,voix,organiseur,planning,rendez-vous,échéance
```

German (Germany) (94 bytes, 94 characters):

```
Erinnerung,Besprechung,Kalender,Aufgaben,Termin,Planer,Sprachsteuerung,Organizer,Agenda,Wecker
```

### A4. Promotional Text (170 characters at most; changes at any time without review)

English (U.S.) (157 characters):

```
Now in Portuguese, French and German too. Meeting alerts that get your attention, calendars and tasks in step, and an AI assistant that asks before it saves.
```

Spanish (Mexico) (158 characters):

```
Ahora también en portugués, francés y alemán. Alertas que llaman tu atención, calendarios y tareas al día, y un asistente de IA que pregunta antes de guardar.
```

Portuguese (Brazil) (143 characters):

```
Agora em português. Alertas de reunião que chamam sua atenção, calendários e tarefas em dia e um assistente de IA que pergunta antes de salvar.
```

French (France) (165 characters):

```
Désormais en français. Des alertes de réunion qui attirent votre attention, des calendriers et des tâches à jour, et un assistant IA qui demande avant d'enregistrer.
```

German (Germany) (146 characters):

```
Jetzt auf Deutsch. Besprechungsalarme, die Sie erreichen, Kalender und Aufgaben im Gleichtakt und ein KI-Assistent, der fragt, bevor er speichert.
```

### A5. What's New in This Version (also the Play release notes, 500 characters at most)

Line 1 is the M12 line. Lines 2 and 3 go in only if the M10 and M11 summaries ship in the same
build; the release owner then adds any other 1.7.0 line (WhatsApp, M13) in every language and
recounts. Counts: line 1 alone, then all three lines.

English (U.S.) (158 characters; 398 with lines 2 and 3):

```
Meeting Guard AI now speaks Portuguese, French and German: screens, voice, confirmation cards, reminders and dates. Pick your language in Settings > Language.
Meeting summaries: forward your notetaker's summary to your private address and the app files it under the right meeting.
Commitments: accept what was promised and it becomes tasks with reminders. Summaries are read in English and Spanish.
```

Spanish (Mexico) (168 characters; 418 with lines 2 and 3):

```
Meeting Guard AI ahora también habla portugués, francés y alemán: pantallas, voz, tarjetas de confirmación, recordatorios y fechas. Elige el idioma en Ajustes > Idioma.
Minutas de reuniones: reenvía la minuta de tu asistente de notas a tu dirección privada y la app la archiva en la reunión correcta.
Compromisos: acepta lo prometido y se convierte en tareas con recordatorios. Las minutas se leen en español e inglés.
```

Portuguese (Brazil) (157 characters; 411 with lines 2 and 3):

```
O Meeting Guard AI agora fala português, francês e alemão: telas, voz, cartões de confirmação, lembretes e datas. Escolha o idioma em Configurações > Idioma.
Resumos de reuniões: encaminhe o resumo do seu assistente de anotações para o seu endereço privado e o app o arquiva na reunião certa.
Compromissos: aceite o que foi prometido e isso vira tarefas com lembretes. Os resumos são lidos em inglês e espanhol.
```

French (France) (169 characters; 465 with lines 2 and 3):

```
Meeting Guard AI parle désormais français, portugais et allemand : écrans, voix, cartes de confirmation, rappels et dates. Choisissez la langue dans Paramètres > Langue.
Comptes rendus de réunion : transférez le compte rendu de votre assistant de prise de notes à votre adresse privée et l'app le classe sous la bonne réunion.
Engagements : acceptez ce qui a été promis et cela devient des tâches avec rappels. Les comptes rendus sont lus en anglais et en espagnol.
```

German (Germany) (193 characters; 495 with lines 2 and 3):

```
Meeting Guard AI spricht jetzt Deutsch, Portugiesisch und Französisch: Bildschirme, Sprachsteuerung, Bestätigungskarten, Erinnerungen und Datumsangaben. Sprache wählen: Einstellungen > Sprache.
Besprechungsprotokolle: Leiten Sie das Protokoll Ihres Notizassistenten an Ihre private Adresse weiter, und die App legt es unter der richtigen Besprechung ab.
Zusagen: Nehmen Sie an, was versprochen wurde, und es wird zu Aufgaben mit Erinnerungen. Protokolle werden auf Englisch und Spanisch gelesen.
```

### A6. Description (4,000 characters at most)

The 1.7.0 description in every language, English and Spanish included: the 1.6.0 text
(IOS-RELEASE-1.6.0.md T3) shortened so that every language fits with both additions, with the
languages line in place of "Works in English and Spanish". It keeps the auto-renew paragraph
and the Privacy Policy and EULA links (guideline 3.1.2): never drop them from one localization.
Two optional additions, each counted below:

- S: the meeting summaries section, only if M10 and M11 ship in the same build. It goes in as
  its own paragraph right before the sign-in paragraph.
- X: the executive assistant sentence, only once the executive assistant is switched on in a
  store build. It goes right after the languages line.

#### English (U.S.)

2,882 characters; 3,220 with S; 3,294 with S and X.

```
Never miss a meeting again. Meeting Guard AI puts your meeting alerts, calendars and tasks in one place, with an AI assistant that schedules meetings for you.

ALERTS THAT GET YOUR ATTENTION
A notification with sound before each meeting, even when the app is closed or your iPhone is locked: 15 and 5 minutes before and at the start, or at the times you choose. Pick Maximum, Medium or Light. Maximum and Medium alerts are Time Sensitive, so they can reach you during a Focus that allows them. Press and hold an alert to snooze it. With the app open, a Maximum alert fills the screen and reads the meeting aloud. After a meeting, a follow-up takes you to the assistant, and an optional daily briefing sums up your day.

YOUR CALENDARS AND TASKS, IN STEP
Two-way sync with Google Calendar and Outlook, and alerts for the calendars on your iPhone, such as iCloud. Pick a Microsoft To Do or Google Tasks list and your tasks stay in step both ways, with reminders.

AN AI ASSISTANT THAT ASKS FIRST
Type or say "Lunch with Ana tomorrow at 2 pm" and the assistant prepares the meeting; nothing is saved until you confirm it. One sentence can create a meeting and a task together. Ask "What do I have tomorrow?" and hear your agenda. Link your WhatsApp number to create meetings by message too; those requests count as AI actions.

DEBRIEF BY VOICE
After a meeting, tap "Debrief this meeting" and say what was agreed. The app proposes the tasks, and nothing is saved until you confirm them.

RUNNING LATE
Pick how late you are and share a ready message with the new time. Move the meeting only if you want.

ZOOM, MEET AND TEAMS LINKS
Add a Zoom link automatically, or a Google Meet link when Google Calendar is connected. Microsoft Teams links come through Outlook where your account offers them.

Sign in with Apple, Google, Microsoft or email. Available in English, Spanish, Portuguese, French and German. Summaries from your notetaker are read in English and Spanish. Provided by AETERNUM TECH LTD. Questions? support@meetingguard.ai

PLANS
Free to start: your first 7 days include 10 AI actions (up to 3 a day). After that, AI actions need Pro or Premium. Creating meetings and tasks by hand, your reminders, your agenda and export are always free. Pro includes 100 AI actions per month and Premium 400, renewing each month on the day you subscribed. Prices are shown in the app before you buy and may vary by country.

Meeting Guard AI offers auto-renewable subscriptions (Pro, Premium; monthly or yearly). Payment is charged to your Apple Account at confirmation of purchase. The subscription renews automatically unless cancelled at least 24 hours before the end of the current period. Manage or cancel in your App Store account settings.
Privacy Policy: https://meetingguard.ai/privacy-policy/
Terms of Use (EULA): https://www.apple.com/legal/internet-services/itunes/dev/stdeula/
```

S (336 characters plus a blank line):

```
MEETING SUMMARIES
Forward the summary your notetaker already emails you to your private address. The app files it under the right meeting and proposes the commitments it contains: what was promised, by whom and by when. Accept them and they become tasks with reminders. Meeting Guard AI never joins, records or listens to your meetings.
```

X (74 characters with the space before it):

```
The executive assistant (email and matters) works in English and Spanish.
```

#### Spanish (Mexico)

3,090 characters; 3,460 with S; 3,532 with S and X.

```
No vuelvas a perderte una reunión. Meeting Guard AI reúne tus alertas de reuniones, calendarios y tareas en un solo lugar, con un asistente de IA que programa reuniones por ti.

ALERTAS QUE LLAMAN TU ATENCIÓN
Una notificación con sonido antes de cada reunión, aunque la app esté cerrada o el iPhone bloqueado: 15 y 5 minutos antes y al empezar, o cuando tú elijas. Elige Máxima, Media o Ligera. Las alertas Máxima y Media son urgentes y pueden llegarte durante un modo de concentración que las permita. Mantén presionada una alerta para posponerla. Con la app abierta, una alerta Máxima ocupa la pantalla y lee la reunión en voz alta. Tras una reunión, un aviso de seguimiento te lleva al asistente, y un resumen diario opcional repasa tu día.

TUS CALENDARIOS Y TAREAS, AL DÍA
Sincronización en ambos sentidos con Google Calendar y Outlook, y alertas para los calendarios de tu iPhone, como iCloud. Elige una lista de Microsoft To Do o de Google Tasks y tus tareas quedan al día en ambos sentidos, con recordatorios.

UN ASISTENTE DE IA QUE PREGUNTA ANTES
Escribe o di "Almuerzo con Ana mañana a las 2 p. m." y el asistente prepara la reunión; no se guarda nada hasta que la confirmes. Una sola frase puede crear una reunión y una tarea a la vez. Pregunta "¿Qué tengo mañana?" y escucha tu agenda. Vincula tu número de WhatsApp para crear reuniones también por mensaje; esas solicitudes cuentan como acciones de IA.

RESUMEN POR VOZ
Al terminar una reunión, toca "Resumir esta reunión" y di lo que se acordó. La app propone las tareas y no se guarda nada hasta que las confirmes.

VOY TARDE
Elige cuánto vas a tardar y comparte un mensaje listo con la nueva hora. Mueve la reunión solo si quieres.

ENLACES DE ZOOM, MEET Y TEAMS
Añade un enlace de Zoom automático, o uno de Google Meet si conectas Google Calendar. Los enlaces de Microsoft Teams llegan a través de Outlook si tu cuenta los ofrece.

Inicia sesión con Apple, Google, Microsoft o tu correo. Disponible en español, inglés, portugués, francés y alemán. Las minutas de tu asistente de notas se leen en español e inglés. Ofrecido por AETERNUM TECH LTD. ¿Preguntas? support@meetingguard.ai

PLANES
Gratis para empezar: tus primeros 7 días incluyen 10 acciones de IA (hasta 3 al día). Después, las acciones de IA requieren Pro o Premium. Crear reuniones y tareas a mano, tus recordatorios, tu agenda y la exportación son siempre gratis. Pro incluye 100 acciones de IA al mes y Premium 400, y se renuevan cada mes el día en que te suscribiste. Los precios se muestran en la app antes de comprar y pueden variar según el país.

Meeting Guard AI ofrece suscripciones con renovación automática (Pro, Premium; mensual o anual). El pago se carga a tu cuenta de Apple al confirmar la compra. La suscripción se renueva automáticamente salvo que se cancele al menos 24 horas antes del final del periodo actual. Gestiona o cancela la suscripción en los ajustes de tu cuenta de App Store.
Política de privacidad: https://meetingguard.ai/privacy-policy/
Términos de uso (EULA): https://www.apple.com/legal/internet-services/itunes/dev/stdeula/
```

S (368 characters plus a blank line):

```
MINUTAS DE REUNIONES
Reenvía a tu dirección privada la minuta que tu asistente de notas ya te envía por correo. La app la archiva en la reunión correcta y propone los compromisos que contiene: qué se prometió, quién lo hará y para cuándo. Acéptalos y se convierten en tareas con recordatorios. Meeting Guard AI no se une a tus reuniones, no las graba y no las escucha.
```

X (72 characters with the space before it):

```
El asistente ejecutivo (correo y asuntos) funciona en español e inglés.
```

#### Portuguese (Brazil)

3,077 characters; 3,448 with S; 3,523 with S and X.

```
Nunca mais perca uma reunião. O Meeting Guard AI reúne seus alertas de reuniões, calendários e tarefas em um só lugar, com um assistente de IA que agenda reuniões para você.

ALERTAS QUE CHAMAM SUA ATENÇÃO
Uma notificação com som antes de cada reunião, mesmo com o app fechado ou o iPhone bloqueado: 15 e 5 minutos antes e no início, ou nos horários que você escolher. Escolha Máxima, Média ou Leve. Os alertas Máxima e Média são urgentes e podem chegar até você durante um modo Foco que os permita. Toque e segure um alerta para adiá-lo. Com o app aberto, um alerta Máxima ocupa a tela e lê a reunião em voz alta. Depois de uma reunião, um acompanhamento leva você ao assistente, e um resumo do dia opcional repassa o seu dia.

SEUS CALENDÁRIOS E TAREFAS, EM DIA
Sincronização nos dois sentidos com o Google Calendar e o Outlook, e alertas para os calendários do seu iPhone, como o iCloud. Escolha uma lista do Microsoft To Do ou do Google Tasks e suas tarefas ficam em dia nos dois sentidos, com lembretes.

UM ASSISTENTE DE IA QUE PERGUNTA ANTES
Digite ou diga "Almoço com a Ana amanhã às 14h" e o assistente prepara a reunião; nada é salvo até você confirmar. Uma só frase pode criar uma reunião e uma tarefa juntas. Pergunte "O que eu tenho amanhã?" e ouça sua agenda. Vincule seu número do WhatsApp para criar reuniões também por mensagem; esses pedidos contam como ações de IA.

RECAPITULAÇÃO POR VOZ
Depois de uma reunião, toque em "Recapitular esta reunião" e diga o que foi combinado. O app propõe as tarefas, e nada é salvo até você confirmá-las.

VOU ME ATRASAR
Escolha quanto você vai se atrasar e compartilhe uma mensagem pronta com o novo horário. Mova a reunião só se quiser.

LINKS DO ZOOM, MEET E TEAMS
Adicione um link do Zoom automaticamente, ou um link do Google Meet quando o Google Calendar está conectado. Os links do Microsoft Teams chegam pelo Outlook quando sua conta os oferece.

Entre com Apple, Google, Microsoft ou e-mail. Disponível em português, inglês, espanhol, francês e alemão. Os resumos do seu assistente de anotações são lidos em inglês e espanhol. Oferecido por AETERNUM TECH LTD. Dúvidas? support@meetingguard.ai

PLANOS
Grátis para começar: seus primeiros 7 dias incluem 10 ações de IA (até 3 por dia). Depois disso, as ações de IA exigem o Pro ou o Premium. Criar reuniões e tarefas manualmente, seus lembretes, sua agenda e a exportação são sempre grátis. O Pro inclui 100 ações de IA por mês e o Premium 400, renovadas todo mês no dia em que você assinou. Os preços aparecem no app antes da compra e podem variar por país.

O Meeting Guard AI oferece assinaturas com renovação automática (Pro, Premium; mensal ou anual). O pagamento é cobrado na sua Conta Apple na confirmação da compra. A assinatura é renovada automaticamente, a menos que seja cancelada pelo menos 24 horas antes do fim do período atual. Gerencie ou cancele a assinatura nos ajustes da sua conta da App Store.
Política de Privacidade: https://meetingguard.ai/privacy-policy/
Termos de Uso (EULA): https://www.apple.com/legal/internet-services/itunes/dev/stdeula/
```

S (369 characters plus a blank line):

```
RESUMOS DE REUNIÕES
Encaminhe para o seu endereço privado o resumo que o seu assistente de anotações já envia por e-mail. O app arquiva o resumo na reunião certa e propõe os compromissos que ele contém: o que foi prometido, por quem e até quando. Aceite e eles viram tarefas com lembretes. O Meeting Guard AI nunca entra nas suas reuniões, não as grava e não as escuta.
```

X (75 characters with the space before it):

```
O assistente executivo (e-mails e assuntos) funciona em inglês e espanhol.
```

#### French (France)

3,352 characters; 3,771 with S; 3,852 with S and X.

```
Ne manquez plus jamais une réunion. Meeting Guard AI réunit vos alertes de réunion, vos calendriers et vos tâches au même endroit, avec un assistant IA qui planifie vos réunions pour vous.

DES ALERTES QUI ATTIRENT VOTRE ATTENTION
Une notification sonore avant chaque réunion, même lorsque l'app est fermée ou votre iPhone verrouillé : 15 et 5 minutes avant et au début, ou aux moments que vous choisissez. Choisissez Maximale, Moyenne ou Légère. Les alertes Maximale et Moyenne sont urgentes et peuvent vous parvenir pendant un mode de concentration qui les autorise. Maintenez une alerte appuyée pour la reporter. Lorsque l'app est ouverte, une alerte Maximale occupe l'écran et lit la réunion à voix haute. Après une réunion, un suivi vous mène à l'assistant, et un briefing du jour facultatif résume votre journée.

VOS CALENDRIERS ET VOS TÂCHES, À JOUR
Synchronisation dans les deux sens avec Google Calendar et Outlook, et alertes pour les calendriers de votre iPhone, comme iCloud. Choisissez une liste Microsoft To Do ou Google Tasks et vos tâches restent à jour dans les deux sens, avec des rappels.

UN ASSISTANT IA QUI DEMANDE D'ABORD
Écrivez ou dites "Déjeuner avec Ana demain à 14 h" et l'assistant prépare la réunion ; rien n'est enregistré avant votre confirmation. Une seule phrase peut créer une réunion et une tâche ensemble. Demandez "Qu'est-ce que j'ai demain ?" et écoutez votre agenda. Associez votre numéro WhatsApp pour créer aussi des réunions par message ; ces demandes comptent comme des actions IA.

LE BILAN À LA VOIX
Après une réunion, touchez "Faire le bilan de cette réunion" et dites ce qui a été convenu. L'app propose les tâches, et rien n'est enregistré avant votre confirmation.

JE SUIS EN RETARD
Indiquez votre retard et partagez un message prêt avec la nouvelle heure. Déplacez la réunion seulement si vous le souhaitez.

LIENS ZOOM, MEET ET TEAMS
Ajoutez automatiquement un lien Zoom, ou un lien Google Meet lorsque Google Calendar est connecté. Les liens Microsoft Teams arrivent par Outlook lorsque votre compte les propose.

Connectez-vous avec Apple, Google, Microsoft ou par e-mail. Disponible en français, anglais, espagnol, portugais et allemand. Les comptes rendus de votre assistant de prise de notes sont lus en anglais et en espagnol. Fourni par AETERNUM TECH LTD. Des questions ? support@meetingguard.ai

OFFRES
Gratuit pour commencer : vos 7 premiers jours incluent 10 actions IA (jusqu'à 3 par jour). Ensuite, les actions IA nécessitent Pro ou Premium. Créer des réunions et des tâches à la main, vos rappels, votre agenda et l'export restent toujours gratuits. Pro inclut 100 actions IA par mois et Premium 400, renouvelées chaque mois le jour de votre abonnement. Les prix s'affichent dans l'app avant l'achat et peuvent varier selon le pays.

Meeting Guard AI propose des abonnements à renouvellement automatique (Pro, Premium ; mensuels ou annuels). Le paiement est débité de votre compte Apple à la confirmation de l'achat. L'abonnement se renouvelle automatiquement s'il n'est pas résilié au moins 24 heures avant la fin de la période en cours. Gérez ou résiliez l'abonnement dans les réglages de votre compte App Store.
Politique de confidentialité : https://meetingguard.ai/privacy-policy/
Conditions d'utilisation (EULA) : https://www.apple.com/legal/internet-services/itunes/dev/stdeula/
```

S (417 characters plus a blank line):

```
COMPTES RENDUS DE RÉUNION
Transférez à votre adresse privée le compte rendu que votre assistant de prise de notes vous envoie déjà par e-mail. L'app le classe sous la bonne réunion et propose les engagements qu'il contient : ce qui a été promis, par qui et pour quand. Acceptez-les et ils deviennent des tâches avec rappels. Meeting Guard AI ne rejoint jamais vos réunions, ne les enregistre pas et ne les écoute pas.
```

X (81 characters with the space before it):

```
L'assistant exécutif (e-mails et dossiers) fonctionne en anglais et en espagnol.
```

#### German (Germany)

3,458 characters; 3,897 with S; 3,984 with S and X.

```
Verpassen Sie nie wieder eine Besprechung. Meeting Guard AI vereint Ihre Besprechungsalarme, Kalender und Aufgaben an einem Ort, mit einem KI-Assistenten, der Besprechungen für Sie plant.

ALARME, DIE SIE ERREICHEN
Eine Mitteilung mit Ton vor jeder Besprechung, auch wenn die App geschlossen oder Ihr iPhone gesperrt ist: 15 und 5 Minuten vorher und zu Beginn, oder zu den Zeiten, die Sie wählen. Wählen Sie Maximal, Mittel oder Leicht. Alarme der Stufen Maximal und Mittel sind dringend und erreichen Sie auch in einem Fokus, der sie erlaubt. Halten Sie einen Alarm gedrückt, um ihn schlummern zu lassen. Bei geöffneter App füllt ein maximaler Alarm den Bildschirm und liest die Besprechung vor. Nach einer Besprechung führt Sie die Nachbereitung zum Assistenten, und ein optionaler Tagesüberblick fasst Ihren Tag zusammen.

IHRE KALENDER UND AUFGABEN, IM GLEICHTAKT
Synchronisierung in beide Richtungen mit Google Calendar und Outlook, dazu Alarme für die Kalender auf Ihrem iPhone, etwa iCloud. Wählen Sie eine Liste in Microsoft To Do oder Google Tasks, und Ihre Aufgaben bleiben in beide Richtungen aktuell, mit Erinnerungen.

EIN KI-ASSISTENT, DER ZUERST FRAGT
Schreiben oder sagen Sie "Mittagessen mit Ana morgen um 14 Uhr", und der Assistent bereitet die Besprechung vor; nichts wird gespeichert, bevor Sie bestätigen. Ein einziger Satz kann eine Besprechung und eine Aufgabe zugleich anlegen. Fragen Sie "Was habe ich morgen?" und hören Sie Ihre Agenda. Verknüpfen Sie Ihre WhatsApp-Nummer, um Besprechungen auch per Nachricht anzulegen; diese Anfragen zählen als KI-Aktionen.

AUSWERTUNG PER SPRACHE
Tippen Sie nach einer Besprechung auf "Besprechung auswerten" und sagen Sie, was vereinbart wurde. Die App schlägt die Aufgaben vor, und nichts wird gespeichert, bevor Sie sie bestätigen.

ICH VERSPÄTE MICH
Wählen Sie, wie viel später Sie kommen, und teilen Sie eine fertige Nachricht mit der neuen Uhrzeit. Verschieben Sie die Besprechung nur, wenn Sie möchten.

ZOOM-, MEET- UND TEAMS-LINKS
Fügen Sie automatisch einen Zoom-Link hinzu oder einen Google-Meet-Link, wenn Google Calendar verbunden ist. Links für Microsoft Teams kommen über Outlook, wenn Ihr Konto sie anbietet.

Anmeldung mit Apple, Google, Microsoft oder E-Mail. Verfügbar auf Deutsch, Englisch, Spanisch, Portugiesisch und Französisch. Protokolle Ihres Notizassistenten werden auf Englisch und Spanisch gelesen. Angeboten von AETERNUM TECH LTD. Fragen? support@meetingguard.ai

TARIFE
Kostenlos starten: Ihre ersten 7 Tage enthalten 10 KI-Aktionen (bis zu 3 pro Tag). Danach benötigen KI-Aktionen Pro oder Premium. Besprechungen und Aufgaben von Hand anlegen, Ihre Erinnerungen, Ihre Agenda und der Export sind immer kostenlos. Pro enthält 100 KI-Aktionen pro Monat und Premium 400, jeden Monat erneuert an dem Tag, an dem Sie abonniert haben. Die Preise werden vor dem Kauf in der App angezeigt und können je nach Land variieren.

Meeting Guard AI bietet automatisch verlängerte Abonnements an (Pro, Premium; monatlich oder jährlich). Die Zahlung wird bei Bestätigung des Kaufs über Ihren Apple Account abgerechnet. Das Abonnement verlängert sich automatisch, sofern es nicht mindestens 24 Stunden vor Ende des aktuellen Zeitraums gekündigt wird. Verwalten oder kündigen Sie es in den Einstellungen Ihres App Store-Kontos.
Datenschutzerklärung: https://meetingguard.ai/privacy-policy/
Nutzungsbedingungen (EULA): https://www.apple.com/legal/internet-services/itunes/dev/stdeula/
```

S (437 characters plus a blank line):

```
BESPRECHUNGSPROTOKOLLE
Leiten Sie das Protokoll, das Ihnen Ihr Notizassistent ohnehin per E-Mail schickt, an Ihre private Adresse weiter. Die App legt es unter der richtigen Besprechung ab und schlägt die enthaltenen Zusagen vor: was versprochen wurde, von wem und bis wann. Nehmen Sie sie an, und sie werden zu Aufgaben mit Erinnerungen. Meeting Guard AI nimmt nie an Ihren Besprechungen teil, zeichnet sie nicht auf und hört nicht mit.
```

X (87 characters with the space before it):

```
Der Executive Assistant (E-Mails und Vorgänge) funktioniert auf Englisch und Spanisch.
```

### A7. Subscriptions (each of the four, and the group; 45 characters at most per description)

| Field | Portuguese (Brazil) | French (France) | German (Germany) |
|---|---|---|---|
| Display Name, Pro Monthly | `Pro Mensal` (10) | `Pro mensuel` (11) | `Pro monatlich` (13) |
| Display Name, Pro Yearly | `Pro Anual` (9) | `Pro annuel` (10) | `Pro jährlich` (12) |
| Display Name, Premium Monthly | `Premium Mensal` (14) | `Premium mensuel` (15) | `Premium monatlich` (17) |
| Display Name, Premium Yearly | `Premium Anual` (13) | `Premium annuel` (14) | `Premium jährlich` (16) |
| Description, Pro Monthly and Pro Yearly | `100 ações de IA por mês` (23) | `100 actions IA par mois` (23) | `100 KI-Aktionen pro Monat` (25) |
| Description, Premium Monthly and Premium Yearly | `400 ações de IA por mês` (23) | `400 actions IA par mois` (23) | `400 KI-Aktionen pro Monat` (25) |
| Group display name | `Planos do Meeting Guard AI` (26) | `Offres Meeting Guard AI` (23) | `Meeting Guard AI Tarife` (23) |

## Part B. Google Play Console

### B1. App name (30 characters at most)

Every language: `Meeting Guard AI` (16 characters).

### B2. Short description (80 characters at most)

en-US (76 characters):

```
Meeting alarms, calendar and task sync, and an AI assistant that asks first.
```

pt-BR (71 characters):

```
Alarmes de reunião, calendários e tarefas em dia e um assistente de IA.
```

fr-FR (69 characters):

```
Alarmes de réunion, calendriers et tâches à jour, et un assistant IA.
```

de-DE (79 characters):

```
Besprechungsalarme, Kalender und Aufgaben im Gleichtakt, dazu ein KI-Assistent.
```

### B3. Full description (4,000 characters at most)

Base: the 1.6.0 Play full description (en-US) as it was pasted for 1.6.0, kept outside the
repository. Copy the live en-US text from the Play Console first and compare: if it differs,
the live text wins and the translations below follow it. The S and X additions work as in A6
(S goes right before the sign-in paragraph, which is the last one here).

#### en-US

2,225 characters; 2,563 with S; 2,637 with S and X.

The 1.6.0 text with the languages line in place of "Works in English and Spanish.":

```
Never miss a meeting again. Meeting Guard AI combines loud, persistent meeting alarms with your calendars and tasks in one place, and an AI assistant that schedules meetings for you.

ALERTS THAT GET YOUR ATTENTION
Full-screen alarms with sound and voice readout, gentle reminders, snooze and follow-ups. You choose the intensity for every meeting, including events from your other calendars. An optional daily briefing sums up your day, and a home-screen widget shows your next meeting.

YOUR CALENDARS, TOGETHER
Two-way sync with Google Calendar, Outlook and the calendars on your phone. Connect your Microsoft account once and your meetings stay in step with Outlook, repeating meetings included. Meetings you create in Meeting Guard AI appear everywhere, with invitations sent to participants automatically.

YOUR TASKS, IN STEP
Pick a Microsoft To Do or Google Tasks list and your tasks stay in step in both places.

AN AI ASSISTANT THAT ASKS FIRST
Tell the assistant "Lunch with Ana tomorrow at 2 pm" by typing, by voice or by WhatsApp message. It shows you what it understood and only saves after you confirm. Ask "What do I have tomorrow?" and get your schedule in seconds.

DEBRIEF BY VOICE
After a meeting, say what was agreed. The app proposes the tasks, and nothing is saved until you confirm them.

RUNNING LATE
Pick how late you are and get a ready message with the new time to send to the participants. Move the meeting only if you want.

ZOOM, MEET AND TEAMS LINKS
Meetings can create their own Zoom or Google Meet link and share it with every participant. Microsoft Teams links come through Outlook where your account offers them.

PLANS
Free to start: your first 7 days include 10 AI actions (up to 3 a day). Creating meetings and tasks by hand, your reminders, your agenda and export are always free. Pro (USD 7.99 per month) includes 100 AI actions per month and Premium (USD 14.99 per month) 400, renewing each month on the day you subscribed. Prices may vary by country.

Sign in with Google, Microsoft or email. Available in English, Spanish, Portuguese, French and German. Summaries from your notetaker are read in English and Spanish. Provided by AETERNUM TECH LTD. Questions? support@meetingguard.ai
```

#### pt-BR

2,410 characters; 2,781 with S; 2,856 with S and X.

```
Nunca mais perca uma reunião. O Meeting Guard AI combina alarmes de reunião fortes e persistentes com seus calendários e tarefas em um só lugar, e um assistente de IA que agenda reuniões para você.

ALERTAS QUE CHAMAM SUA ATENÇÃO
Alarmes em tela cheia com som e leitura em voz alta, lembretes discretos, a opção de adiar e o acompanhamento. Você escolhe a intensidade de cada reunião, inclusive dos eventos dos seus outros calendários. Um resumo do dia opcional repassa o seu dia, e um widget na tela inicial mostra sua próxima reunião.

SEUS CALENDÁRIOS, JUNTOS
Sincronização nos dois sentidos com o Google Calendar, o Outlook e os calendários do seu celular. Conecte sua conta Microsoft uma vez e suas reuniões ficam em dia com o Outlook, inclusive as que se repetem. As reuniões que você cria no Meeting Guard AI aparecem em todos os lugares, com convites enviados automaticamente aos participantes.

SUAS TAREFAS, EM DIA
Escolha uma lista do Microsoft To Do ou do Google Tasks e suas tarefas ficam em dia nos dois lugares.

UM ASSISTENTE DE IA QUE PERGUNTA ANTES
Diga ao assistente "Almoço com a Ana amanhã às 14h" digitando, por voz ou por mensagem no WhatsApp. Ele mostra o que entendeu e só salva depois que você confirma. Pergunte "O que eu tenho amanhã?" e receba sua agenda em segundos.

RECAPITULAÇÃO POR VOZ
Depois de uma reunião, diga o que foi combinado. O app propõe as tarefas, e nada é salvo até você confirmá-las.

VOU ME ATRASAR
Escolha quanto você vai se atrasar e receba uma mensagem pronta com o novo horário para enviar aos participantes. Mova a reunião só se quiser.

LINKS DO ZOOM, MEET E TEAMS
As reuniões podem criar o próprio link do Zoom ou do Google Meet e compartilhá-lo com todos os participantes. Os links do Microsoft Teams chegam pelo Outlook quando sua conta os oferece.

PLANOS
Grátis para começar: seus primeiros 7 dias incluem 10 ações de IA (até 3 por dia). Criar reuniões e tarefas manualmente, seus lembretes, sua agenda e a exportação são sempre grátis. O Pro (USD 7,99 por mês) inclui 100 ações de IA por mês e o Premium (USD 14,99 por mês) 400, renovadas todo mês no dia em que você assinou. Os preços podem variar por país.

Entre com Google, Microsoft ou e-mail. Disponível em português, inglês, espanhol, francês e alemão. Os resumos do seu assistente de anotações são lidos em inglês e espanhol. Oferecido por AETERNUM TECH LTD. Dúvidas? support@meetingguard.ai
```

#### fr-FR

2,585 characters; 3,004 with S; 3,085 with S and X.

```
Ne manquez plus jamais une réunion. Meeting Guard AI réunit des alarmes de réunion puissantes et persistantes, vos calendriers et vos tâches au même endroit, avec un assistant IA qui planifie vos réunions pour vous.

DES ALERTES QUI ATTIRENT VOTRE ATTENTION
Alarmes plein écran avec son et lecture à voix haute, rappels discrets, report et suivi. Vous choisissez l'intensité pour chaque réunion, y compris pour les événements de vos autres calendriers. Un briefing du jour facultatif résume votre journée, et un widget sur l'écran d'accueil affiche votre prochaine réunion.

VOS CALENDRIERS, ENSEMBLE
Synchronisation dans les deux sens avec Google Calendar, Outlook et les calendriers de votre téléphone. Connectez votre compte Microsoft une fois et vos réunions restent à jour avec Outlook, réunions récurrentes comprises. Les réunions que vous créez dans Meeting Guard AI apparaissent partout, et les invitations partent automatiquement vers les participants.

VOS TÂCHES, À JOUR
Choisissez une liste Microsoft To Do ou Google Tasks et vos tâches restent à jour des deux côtés.

UN ASSISTANT IA QUI DEMANDE D'ABORD
Dites à l'assistant "Déjeuner avec Ana demain à 14 h" par écrit, à la voix ou par message WhatsApp. Il vous montre ce qu'il a compris et n'enregistre qu'après votre confirmation. Demandez "Qu'est-ce que j'ai demain ?" et obtenez votre programme en quelques secondes.

LE BILAN À LA VOIX
Après une réunion, dites ce qui a été convenu. L'app propose les tâches, et rien n'est enregistré avant votre confirmation.

JE SUIS EN RETARD
Indiquez votre retard et recevez un message prêt avec la nouvelle heure, à envoyer aux participants. Déplacez la réunion seulement si vous le souhaitez.

LIENS ZOOM, MEET ET TEAMS
Les réunions peuvent créer leur propre lien Zoom ou Google Meet et le partager avec chaque participant. Les liens Microsoft Teams arrivent par Outlook lorsque votre compte les propose.

OFFRES
Gratuit pour commencer : vos 7 premiers jours incluent 10 actions IA (jusqu'à 3 par jour). Créer des réunions et des tâches à la main, vos rappels, votre agenda et l'export restent toujours gratuits. Pro (7,99 USD par mois) inclut 100 actions IA par mois et Premium (14,99 USD par mois) 400, renouvelées chaque mois le jour de votre abonnement. Les prix peuvent varier selon le pays.

Connectez-vous avec Google, Microsoft ou par e-mail. Disponible en français, anglais, espagnol, portugais et allemand. Les comptes rendus de votre assistant de prise de notes sont lus en anglais et en espagnol. Fourni par AETERNUM TECH LTD. Des questions ? support@meetingguard.ai
```

#### de-DE

2,636 characters; 3,075 with S; 3,162 with S and X.

```
Verpassen Sie nie wieder eine Besprechung. Meeting Guard AI vereint laute, beharrliche Besprechungsalarme mit Ihren Kalendern und Aufgaben an einem Ort, dazu einen KI-Assistenten, der Besprechungen für Sie plant.

ALARME, DIE SIE ERREICHEN
Vollbild-Alarme mit Ton und Vorlesen, dezente Erinnerungen, Schlummern und Nachbereitung. Sie wählen die Stufe für jede Besprechung, auch für Termine aus Ihren anderen Kalendern. Ein optionaler Tagesüberblick fasst Ihren Tag zusammen, und ein Widget auf dem Startbildschirm zeigt Ihre nächste Besprechung.

IHRE KALENDER, VEREINT
Synchronisierung in beide Richtungen mit Google Calendar, Outlook und den Kalendern auf Ihrem Telefon. Verbinden Sie Ihr Microsoft-Konto einmal, und Ihre Besprechungen bleiben mit Outlook im Gleichtakt, wiederkehrende eingeschlossen. Besprechungen, die Sie in Meeting Guard AI anlegen, erscheinen überall, und die Einladungen gehen automatisch an die Teilnehmer.

IHRE AUFGABEN, IM GLEICHTAKT
Wählen Sie eine Liste in Microsoft To Do oder Google Tasks, und Ihre Aufgaben bleiben an beiden Orten aktuell.

EIN KI-ASSISTENT, DER ZUERST FRAGT
Sagen Sie dem Assistenten "Mittagessen mit Ana morgen um 14 Uhr", per Text, per Sprache oder per WhatsApp-Nachricht. Er zeigt Ihnen, was er verstanden hat, und speichert erst nach Ihrer Bestätigung. Fragen Sie "Was habe ich morgen?" und erhalten Sie Ihren Tagesplan in Sekunden.

AUSWERTUNG PER SPRACHE
Sagen Sie nach einer Besprechung, was vereinbart wurde. Die App schlägt die Aufgaben vor, und nichts wird gespeichert, bevor Sie sie bestätigen.

ICH VERSPÄTE MICH
Wählen Sie, wie viel später Sie kommen, und erhalten Sie eine fertige Nachricht mit der neuen Uhrzeit für die Teilnehmer. Verschieben Sie die Besprechung nur, wenn Sie möchten.

ZOOM-, MEET- UND TEAMS-LINKS
Besprechungen können einen eigenen Zoom- oder Google-Meet-Link erstellen und ihn mit allen Teilnehmern teilen. Links für Microsoft Teams kommen über Outlook, wenn Ihr Konto sie anbietet.

TARIFE
Kostenlos starten: Ihre ersten 7 Tage enthalten 10 KI-Aktionen (bis zu 3 pro Tag). Besprechungen und Aufgaben von Hand anlegen, Ihre Erinnerungen, Ihre Agenda und der Export sind immer kostenlos. Pro (7,99 USD pro Monat) enthält 100 KI-Aktionen pro Monat und Premium (14,99 USD pro Monat) 400, jeden Monat erneuert an dem Tag, an dem Sie abonniert haben. Die Preise können je nach Land variieren.

Anmeldung mit Google, Microsoft oder E-Mail. Verfügbar auf Deutsch, Englisch, Spanisch, Portugiesisch und Französisch. Protokolle Ihres Notizassistenten werden auf Englisch und Spanisch gelesen. Angeboten von AETERNUM TECH LTD. Fragen? support@meetingguard.ai
```

### B4. Release notes (500 characters per language, one block for all languages)

Paste as one block with the language tags. The es-419 block applies only if a Spanish (Latin
America) translation is added to the listing; Play rejects a tag that has no translation.

```
<en-US>
Meeting Guard AI now speaks Portuguese, French and German: screens, voice, confirmation cards, reminders and dates. Pick your language in Settings > Language.
Meeting summaries: forward your notetaker's summary to your private address and the app files it under the right meeting.
Commitments: accept what was promised and it becomes tasks with reminders. Summaries are read in English and Spanish.
</en-US>
<es-419>
Meeting Guard AI ahora también habla portugués, francés y alemán: pantallas, voz, tarjetas de confirmación, recordatorios y fechas. Elige el idioma en Ajustes > Idioma.
Minutas de reuniones: reenvía la minuta de tu asistente de notas a tu dirección privada y la app la archiva en la reunión correcta.
Compromisos: acepta lo prometido y se convierte en tareas con recordatorios. Las minutas se leen en español e inglés.
</es-419>
<pt-BR>
O Meeting Guard AI agora fala português, francês e alemão: telas, voz, cartões de confirmação, lembretes e datas. Escolha o idioma em Configurações > Idioma.
Resumos de reuniões: encaminhe o resumo do seu assistente de anotações para o seu endereço privado e o app o arquiva na reunião certa.
Compromissos: aceite o que foi prometido e isso vira tarefas com lembretes. Os resumos são lidos em inglês e espanhol.
</pt-BR>
<fr-FR>
Meeting Guard AI parle désormais français, portugais et allemand : écrans, voix, cartes de confirmation, rappels et dates. Choisissez la langue dans Paramètres > Langue.
Comptes rendus de réunion : transférez le compte rendu de votre assistant de prise de notes à votre adresse privée et l'app le classe sous la bonne réunion.
Engagements : acceptez ce qui a été promis et cela devient des tâches avec rappels. Les comptes rendus sont lus en anglais et en espagnol.
</fr-FR>
<de-DE>
Meeting Guard AI spricht jetzt Deutsch, Portugiesisch und Französisch: Bildschirme, Sprachsteuerung, Bestätigungskarten, Erinnerungen und Datumsangaben. Sprache wählen: Einstellungen > Sprache.
Besprechungsprotokolle: Leiten Sie das Protokoll Ihres Notizassistenten an Ihre private Adresse weiter, und die App legt es unter der richtigen Besprechung ab.
Zusagen: Nehmen Sie an, was versprochen wurde, und es wird zu Aufgaben mit Erinnerungen. Protokolle werden auf Englisch und Spanisch gelesen.
</de-DE>
```

### B5. Subscriptions (Monetize with Play > Products > Subscriptions, if the Console offers translations)

| Field | pt-BR | fr-FR | de-DE |
|---|---|---|---|
| Name, Pro Monthly | `Pro Mensal` | `Pro mensuel` | `Pro monatlich` |
| Name, Pro Yearly | `Pro Anual` | `Pro annuel` | `Pro jährlich` |
| Name, Premium Monthly | `Premium Mensal` | `Premium mensuel` | `Premium monatlich` |
| Name, Premium Yearly | `Premium Anual` | `Premium annuel` | `Premium jährlich` |
| Benefit, Pro | `100 ações de IA por mês, renovadas no dia da sua assinatura. Todo o resto continua grátis.` (90) | `100 actions IA par mois, renouvelées le jour de votre abonnement. Tout le reste reste gratuit.` (94) | `100 KI-Aktionen pro Monat, erneuert an Ihrem Abotag. Alles andere bleibt kostenlos.` (83) |
| Benefit, Premium | `400 ações de IA por mês, renovadas no dia da sua assinatura. Todo o resto continua grátis.` (90) | `400 actions IA par mois, renouvelées le jour de votre abonnement. Tout le reste reste gratuit.` (94) | `400 KI-Aktionen pro Monat, erneuert an Ihrem Abotag. Alles andere bleibt kostenlos.` (83) |

## Part C. Notes for the reviewers and the release owner

- Time Sensitive: the English text keeps Apple's term. Spanish, Portuguese, French and German say
  "urgent" in plain words instead of guessing the iOS label of each language; a native reviewer
  may replace it with the exact iOS Settings term of that language.
- Alert levels are the onboarding labels of each language: Máxima, Média, Leve; Maximale,
  Moyenne, Légère; Maximal, Mittel, Leicht.
- App Store keywords to watch: Portuguese `compromissos` is also the WhatsApp commitments trigger
  word, which is fine as a search word; German `Organizer` is a loanword German users search for.
  Replace a keyword only with one whose bytes still fit.
- Spanish: "Spanish (Mexico)" is the localization added for 1.6.0 (IOS-RELEASE-1.6.0.md A6 step
  5). If the console shows Spanish (Spain) instead, use that one.
- The 1.6.0 English and Spanish App Store descriptions were 3,693 and 3,920 characters, too long
  to take the languages line and the summaries section. The 1.7.0 texts above are shorter in
  every language and make the same claims. They only leave out small details that the screens
  show anyway: "End meeting now", emailing the participants and adding meetings to the phone's
  calendars.
- Screenshots: optional per localization. Without them, a localization shows the primary
  language's screenshots. Localized screenshots, if made, are captured on real phones with the
  app in that language and fictional data, like the 1.6.0 Spanish set.
- Every later release needs What's New in all five languages, and the promotional text if it
  changes.
