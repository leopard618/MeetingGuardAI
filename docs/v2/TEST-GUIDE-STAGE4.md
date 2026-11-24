# Test guide: Stage 4 (M14) and the final test pass

For: whoever tests the 1.7.0 build before the final release. The recording checklist that closes
Stage 4 and the agreed scope is `STAGE4-ACCEPTANCE.md`.

Setup: an Android phone and an iPhone with 1.7.0 (the organizer), Google Calendar or Outlook
connected, and a second phone or a computer browser for the guest (no app installed there).

## E. Guest invitation links (M14)

1. Create a meeting with one outside guest. Under the participants, "Add a reply link for guests"
   is on. Save. Expected: the description ends with "Reply to this invitation: <link>"; the guest's
   calendar invitation carries the same line.
2. Open the link on the guest's phone (no sign-in). Expected: the organizer's name, the title, the
   day and time in the guest's time zone (with a note when the organizer's zone differs), and
   Accept, Decline, Propose another time. Nothing else of the meeting: no other guests,
   description, place or call link.
3. Accept with a name. Expected: "You accepted". In the app within seconds (app open): a
   notification "<name> accepted"; meeting details > Guest replies shows it.
4. On the guest's phone, Change my answer > Propose another time, pick tomorrow at 16:00, add a
   note. Expected in the app: "Proposes ..." with the note, Approve the new time and Keep the time.
5. Keep the time: nothing changes. Propose again, then Approve: the confirmation names the new
   time; after Move the meeting moves, its alarms move, Google or Outlook shows the new time and
   the guests get the updated invitation.
6. A meeting that existed before 1.7.0: meeting details > Add the reply link to the invitation
   (the calendar sends one update), Share the reply link (share sheet).
7. Turn off the reply link: the guest page then says "This link does not work". Cancel another
   meeting: its page says it was cancelled. After a meeting is over: answers are closed.
8. A repeating meeting: the page shows the next occurrence and offers Accept and Decline only.
9. The guest page in every language: open the link with `&l=es`, `&l=pt`, `&l=fr`, `&l=de`, and
   on a phone set to that language without the parameter.
10. App closed while the guest answers: the answer is shown when the app opens next (there is no
    server push before the assistant's A8; say so in the acceptance).

## F. The final test pass

1. Every part of `TEST-GUIDE-STAGE1.md`, `TEST-GUIDE-STAGE2.md`, `TEST-GUIDE-STAGE3.md` and part E,
   on Android and iPhone, in English; then the language pass of `TEST-GUIDE-M12.md` in Spanish,
   Portuguese, French and German.
2. Accessibility, on each platform:
   - Screen reader (TalkBack, VoiceOver): the dashboard, the meeting form, meeting details with
     guest replies, the WhatsApp screen switches, the alert screen. Every control is announced
     with its name and state.
   - Font size at the largest setting: no clipped text on those screens.
   - Dark and light themes: text readable on every screen listed.
   - The guest page with the phone's screen reader and at 200% zoom.
3. Performance, on a mid-range Android phone and an iPhone:
   - Cold start to the dashboard under 3 seconds with 300 meetings.
   - The meetings list scrolls without stutter with 300 meetings.
   - An alarm rings within a minute of its time with the app closed, after a restart of the phone.
   - The guest page loads in under 2 seconds on a mobile connection.
4. Admin dashboard: the Alerts health tab lists the test phones with their permission states;
   the user page of the test account shows its plan, usage, WhatsApp state and phones.
