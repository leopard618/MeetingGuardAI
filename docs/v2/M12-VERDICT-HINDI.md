# M12 verdict: Hindi (mixed Hindi and English speech)

The written verdict that M12 owes for Hindi (Project-Plan-2026-11-09.md, M12: "Hindi and
Mandarin tested with real mixed speech, each with a written verdict"). The question is whether
Meeting Guard AI, as built, understands real Hindi-English speech well enough to ship Hindi to
users. Part 1 is the protocol; part 2 is the form, filled in during and after the sessions. The
result fields are left blank on purpose: nothing in them may be filled before the sessions.

If the verdict is "not good enough to ship", the agreement applies: Hindi is replaced by work of
similar size or by a price adjustment, agreed in writing (Complete-Plan-2026-11-10.md;
Consolidated-Schedule-2026-10-27.docx, the language rule). Hindi is not an app language in M12
either way; a "ship" verdict starts a separate, priced piece of work.

## Part 1. Protocol

### 1.1 Before the sessions (agreed in writing, before anyone speaks)

- The ship threshold (2.4), agreed by Francisco and Dusko and written into this page BEFORE the
  first session. Proposed: at least 85 percent of the utterances produce the correct card or
  answer, and none of them saves a wrong date or time.
- The reply language a Hindi user would get if Hindi shipped: English (the likely option for
  Hinglish users) or Hindi. The test records which one was used.
- The speakers: at least two native Hindi speakers who mix Hindi and English at work, provided
  or approved by Francisco. Each gives written consent to the recording and to storing the
  recognizer's text. No real names, phone numbers or company names in the utterances; use the
  test names below.

### 1.2 Devices and recognizer

- One real Android phone (Google speech services) and one real iPhone. Record model, OS version
  and app build in 2.1.
- Recognizer locale: `hi-IN` first. Run the same utterances again under `en-IN`, which often
  recognizes Hinglish better. Install the Hindi speech pack and the Hindi TTS voice beforehand
  (Android: Settings > System > Languages > Text-to-speech output > Speech Services by Google >
  Install voice data > Hindi; on-device recognition: the Google app's offline speech languages.
  iPhone: Settings > Accessibility > Spoken Content > Voices > Hindi; Settings > General >
  Keyboard > Dictation languages).
- How the app is made to listen in `hi-IN`: the app chooses the recognizer locale from the app
  language, and Hindi is not an app language. Use one of these, and write which in 2.1:
  - A. A time-stamped test build with the voice-locale override for verdict tests (the M12 map,
    voice section item 15a: a test-build-only setting, never in a store build), set to `hi-IN`
    or `en-IN` while the screens stay English.
  - B. Without that build: the phone keyboard's dictation (Gboard or the iOS keyboard) set to
    Hindi, speaking into the assistant's text field. This tests the same family of recognizers
    but not the app's own microphone button; note it as a limitation.

### 1.3 The script

20 to 30 REAL utterances per speaker, spoken naturally, not read from a translation of the
English examples. The facilitator gives each task in a neutral way ("ask it to set up a call
with Rahul tomorrow at three") and the speaker says it as they would at work. The script covers
the same flow as the Portuguese, French and German acceptance:

| Group | What the speaker asks for | Count |
|---|---|---|
| Create | A meeting with a person, day and time; one with a place; one with a video link | 6 to 8 |
| Move | Move a meeting to another day or time ("parso shaam 5 baje kar do") | 4 to 6 |
| Cancel | Cancel a meeting by its title or person | 3 to 4 |
| Task | A task with a due date; a meeting and a task in one sentence | 3 to 4 |
| Agenda | "Kal mera schedule kya hai?" and the answer read aloud | 2 to 3 |
| Confirm | Yes and no to a card by voice ("haan", "theek hai", "nahi", "rehne do") | 2 to 4 |

Example of the register, not text to read: "kal 3 baje Rahul ke saath meeting set karo". Numbers,
dates and times are the hard part: include "saadhe teen", "dedh baje", "agle somvaar", "parso",
"next Monday", and English numbers inside Hindi sentences. Test names: Rahul, Priya, Ana,
Globex.

### 1.4 What is recorded per utterance

Screen recording with sound for every session. For each utterance, in 2.2: the recognizer's
text exactly as shown (Devanagari or Latin, as it came), the card or answer the app produced,
and the scores below. Only the recognizer's text is stored in this page, never the audio; the
recordings stay with the evidence, not in the repository.

Scores per utterance (1 = right, 0 = wrong, n/a):

- R: the recognizer's text carries the request (names, numbers, day, time) well enough for a
  person to act on it.
- A: the action is right (create, move, cancel, task, agenda).
- S: the slots are right: person, date, time, title. A wrong date or time is a critical error
  (marked X), because it would save a meeting at the wrong moment.
- C: the voice yes or no is understood (confirm utterances only).
- T: the spoken answer is intelligible in the TTS voice used (agenda utterances only).

Optional, Dusko only: the same recognizer texts run through the assistant eval script with a
fixed date and time zone (the M12 map, voice section item 14) to separate recognizer errors from
model errors. Synthetic text is never mixed into the scores of 2.2.

### 1.5 Known code gaps to report (fixed only if Hindi ships)

- The consent guard's tokenizer drops combining marks (\p{M}), which splits Devanagari words
  (functions/src/assistant/guards.ts). A "ship" verdict needs \p{M} added.
- The voice yes and no word lists and the consent qualifiers have no Hindi words.
- The TTS voice and the reply language would need a Hindi entry; the reply would be English
  unless decided otherwise in 1.1.

## Part 2. The verdict form

### 2.1 Sessions

| Field | Session 1 | Session 2 |
|---|---|---|
| Date and place | | |
| Speaker (initials only), native language, how they mix | | |
| Facilitator | | |
| Phone model, OS version | | |
| App build (version, build number, commit) | | |
| How the app listened (A override or B keyboard dictation) | | |
| Recognizer locale (hi-IN or en-IN), online or offline | | |
| TTS voice used for the answers | | |
| Reply language (English or Hindi) | | |
| Consent recorded (yes or no) | | |

### 2.2 Utterances

One row per utterance. Copy the table for each session.

| # | Group | Recognizer text (as shown) | Card or answer produced | R | A | S | C | T | Failure type | Note |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | | | | | | | | | | |
| 2 | | | | | | | | | | |
| 3 | | | | | | | | | | |
| 4 | | | | | | | | | | |
| 5 | | | | | | | | | | |
| 6 | | | | | | | | | | |
| 7 | | | | | | | | | | |
| 8 | | | | | | | | | | |
| 9 | | | | | | | | | | |
| 10 | | | | | | | | | | |
| 11 | | | | | | | | | | |
| 12 | | | | | | | | | | |
| 13 | | | | | | | | | | |
| 14 | | | | | | | | | | |
| 15 | | | | | | | | | | |
| 16 | | | | | | | | | | |
| 17 | | | | | | | | | | |
| 18 | | | | | | | | | | |
| 19 | | | | | | | | | | |
| 20 | | | | | | | | | | |
| 21 | | | | | | | | | | |
| 22 | | | | | | | | | | |
| 23 | | | | | | | | | | |
| 24 | | | | | | | | | | |
| 25 | | | | | | | | | | |
| 26 | | | | | | | | | | |
| 27 | | | | | | | | | | |
| 28 | | | | | | | | | | |
| 29 | | | | | | | | | | |
| 30 | | | | | | | | | | |

Failure types: REC (the recognizer lost a word that matters), NUM (number, date or time
misheard or misread), NAME (person or place), ACT (wrong action), LANG (answer in the wrong
language or script), TTS (answer not intelligible aloud), CONF (yes or no not understood), OTHER.

### 2.3 Results

| Measure | Android hi-IN | Android en-IN | iPhone hi-IN | iPhone en-IN |
|---|---|---|---|---|
| Utterances | | | | |
| R: recognizer good enough (percent) | | | | |
| A: right action (percent) | | | | |
| S: right slots (percent) | | | | |
| X: wrong date or time saved or proposed (count) | | | | |
| C: voice yes and no understood (percent) | | | | |
| T: answers intelligible aloud (percent) | | | | |
| Correct card or answer end to end (percent) | | | | |

Most frequent failure types:

TTS voice quality on each platform (one or two sentences):

### 2.4 Threshold (written before the first session)

Agreed threshold:

Agreed by (names and date):

### 2.5 Verdict

Verdict (good enough to ship / not good enough to ship):

Recognizer locale it applies to:

Reasons (three to five sentences, citing the numbers of 2.3):

If not good enough: replacement work or price adjustment proposed:

If good enough: what shipping Hindi would need (translation, voice tables, guard words, reply
language) and its price, as a separate proposal:

Signed (Dusko, date):

Accepted (Francisco, date):
