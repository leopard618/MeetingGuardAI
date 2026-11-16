/**
 * The pure pieces of the commitment review components (M11, docs/v2/M11-DESIGN.md sections 3.3,
 * 3.4 and 16): owner choices, the "<owner>: " prefix rebuilt like the server's acceptedTitleOf and
 * ownerPrefixed, the schedule invariants, and the edit the sheet saves (only what differs).
 */
import type { CommitmentOwner } from '../../../core/aiContract';
import {
  NO_SCHEDULE,
  defaultOwnerChoice,
  draftOwnerOf,
  editFromSheet,
  editedTitle,
  isEmptyEdit,
  normalizeSchedule,
  ownerChoiceKinds,
  ownerPrefixedTitle,
  reminderChoiceLabel,
  retitleForOwner,
  sameOwnerChoice,
  schedulePickerValue,
  sliceTitle,
  validateCommitmentEdit,
} from '../commitmentEditModel';

const BISH: CommitmentOwner = { name: 'Bish', isUser: false, guess: false };
const ME: CommitmentOwner = { name: 'Francisco Gomez', isUser: true, guess: false };
const GUESS: CommitmentOwner = { name: 'Francisco', isUser: true, guess: true };

describe('owner choices', () => {
  it('starts from the owner the source gives (a guess reads as you, like the server)', () => {
    expect(defaultOwnerChoice(null)).toEqual({ kind: 'nobody' });
    expect(defaultOwnerChoice(BISH)).toEqual({ kind: 'named' });
    expect(defaultOwnerChoice(ME)).toEqual({ kind: 'you' });
    expect(defaultOwnerChoice(GUESS)).toEqual({ kind: 'you' });
  });

  it('offers "<name>, as in the summary" only for someone else or a guess', () => {
    expect(ownerChoiceKinds(BISH)).toEqual(['you', 'named', 'other', 'nobody']);
    expect(ownerChoiceKinds(GUESS)).toEqual(['you', 'named', 'other', 'nobody']);
    expect(ownerChoiceKinds(ME)).toEqual(['you', 'other', 'nobody']);
    expect(ownerChoiceKinds(null)).toEqual(['you', 'other', 'nobody']);
  });

  it('gives the draft owner decide expects', () => {
    expect(draftOwnerOf({ kind: 'you' }, ME)).toEqual({ name: 'Francisco Gomez', isUser: true });
    expect(draftOwnerOf({ kind: 'you' }, null)).toBeNull();
    expect(draftOwnerOf({ kind: 'named' }, BISH)).toEqual({ name: 'Bish', isUser: false });
    expect(draftOwnerOf({ kind: 'named' }, GUESS)).toEqual({ name: 'Francisco', isUser: false });
    expect(draftOwnerOf({ kind: 'other', name: '  Ana   Ruiz ' }, BISH)).toEqual({ name: 'Ana Ruiz', isUser: false });
    expect(draftOwnerOf({ kind: 'other', name: '   ' }, BISH)).toBeNull();
    expect(draftOwnerOf({ kind: 'other', name: 'x'.repeat(150) }, null)?.name).toHaveLength(100);
    expect(draftOwnerOf({ kind: 'nobody' }, BISH)).toBeNull();
  });

  it('compares choices, typed names by their collapsed text', () => {
    expect(sameOwnerChoice({ kind: 'other', name: 'Ana  Ruiz' }, { kind: 'other', name: 'Ana Ruiz' })).toBe(true);
    expect(sameOwnerChoice({ kind: 'you' }, { kind: 'nobody' })).toBe(false);
  });
});

describe('the "<owner>: " prefix (server acceptedTitleOf and ownerPrefixed)', () => {
  it('prefixes a new owner, unless the title already starts with that name', () => {
    expect(ownerPrefixedTitle('Send the deck', 'Cristina')).toBe('Cristina: Send the deck');
    expect(ownerPrefixedTitle('Cristina sends the deck', 'cristina')).toBe('Cristina sends the deck');
    // A longer word that only begins with the name is not the name.
    expect(ownerPrefixedTitle('Bishop review', 'Bish')).toBe('Bish: Bishop review');
    // Accents fold like the server's fold().
    expect(ownerPrefixedTitle('Ines: revisar', 'Inés')).toBe('Ines: revisar');
    expect(ownerPrefixedTitle('Task', '   ')).toBe('Task');
  });

  it('stays within 200 characters', () => {
    expect(ownerPrefixedTitle('a'.repeat(199), 'Bish')).toHaveLength(200);
    expect(sliceTitle('b'.repeat(250))).toHaveLength(200);
  });

  it('moves the prefix when the owner changes and the title was not edited', () => {
    const title = 'Bish: Provide APK access to Urpayroll';
    expect(retitleForOwner(title, BISH, { kind: 'named' })).toBe(title);
    expect(retitleForOwner(title, BISH, { kind: 'you' })).toBe('Provide APK access to Urpayroll');
    expect(retitleForOwner(title, BISH, { kind: 'nobody' })).toBe('Provide APK access to Urpayroll');
    expect(retitleForOwner(title, BISH, { kind: 'other', name: 'Cristina' })).toBe('Cristina: Provide APK access to Urpayroll');
    // A guess has no prefix; naming that person adds one.
    expect(retitleForOwner('Send the contract', GUESS, { kind: 'named' })).toBe('Francisco: Send the contract');
    expect(retitleForOwner('Send the contract', GUESS, { kind: 'you' })).toBe('Send the contract');
    expect(retitleForOwner('Send the contract', null, { kind: 'other', name: 'Ana' })).toBe('Ana: Send the contract');
  });

  it('never empties a title that was only the prefix', () => {
    expect(retitleForOwner('Bish: ', BISH, { kind: 'you' })).toBe('Bish: ');
  });

  it('shows the typed title as typed, else the re-prefixed one', () => {
    const suggestion = { title: 'Bish: Provide APK access', owner: BISH };
    expect(editedTitle(suggestion, null)).toBe('Bish: Provide APK access');
    expect(editedTitle(suggestion, { owner: { kind: 'you' } })).toBe('Provide APK access');
    expect(editedTitle(suggestion, { title: 'Call Bish +1 555 0100', owner: { kind: 'you' } })).toBe('Call Bish +1 555 0100');
  });
});

describe('schedule invariants', () => {
  it('drops a time without a date and a reminder without a time', () => {
    expect(normalizeSchedule({ dueDate: null, dueTime: '09:00', reminderMinutesBefore: 0 })).toEqual(NO_SCHEDULE);
    expect(normalizeSchedule({ dueDate: '2026-11-13', dueTime: null, reminderMinutesBefore: 15 })).toEqual({
      dueDate: '2026-11-13',
      dueTime: null,
      reminderMinutesBefore: null,
    });
  });

  it('validates like decide: a title, a name for someone else, a time needs a date, a reminder needs a time', () => {
    const ok = { title: 'Send it', owner: { kind: 'you' as const }, schedule: NO_SCHEDULE };
    expect(validateCommitmentEdit(ok)).toEqual({});
    expect(validateCommitmentEdit({ ...ok, title: '   ' }).title).toBe('titleRequired');
    expect(validateCommitmentEdit({ ...ok, title: 'x'.repeat(201) }).title).toBe('titleTooLong');
    expect(validateCommitmentEdit({ ...ok, owner: { kind: 'other', name: ' ' } }).owner).toBe('ownerOtherRequired');
    expect(validateCommitmentEdit({ ...ok, schedule: { dueDate: null, dueTime: '10:00', reminderMinutesBefore: null } }).schedule).toBe('timeNeedsDate');
    expect(validateCommitmentEdit({ ...ok, schedule: { dueDate: '2026-11-13', dueTime: null, reminderMinutesBefore: 0 } }).schedule).toBe(
      'reminderNeedsTime',
    );
  });

  it('labels reminders with the task editor strings', () => {
    expect(reminderChoiceLabel(null)).toEqual({ key: 'tasks:editor.reminderNone' });
    expect(reminderChoiceLabel(0)).toEqual({ key: 'tasks:editor.reminderAtDue' });
    expect(reminderChoiceLabel(1440)).toEqual({ key: 'tasks:editor.reminderDayBefore' });
    expect(reminderChoiceLabel(15)).toEqual({ key: 'tasks:editor.reminderMinutes', count: 15 });
  });

  it('starts the picker on the schedule, else 9:00 tomorrow (device wall clock)', () => {
    const now = new Date(2026, 10, 12, 18, 30);
    expect(schedulePickerValue({ dueDate: '2026-11-20', dueTime: '17:15', reminderMinutesBefore: null }, now)).toEqual(new Date(2026, 10, 20, 17, 15));
    expect(schedulePickerValue(NO_SCHEDULE, now)).toEqual(new Date(2026, 10, 13, 9, 0));
  });
});

describe('the edit the sheet saves', () => {
  const suggestion = { title: 'Bish: Provide APK access', owner: BISH };
  const untouched = { suggestion, previous: null, title: suggestion.title, owner: { kind: 'named' as const }, schedule: NO_SCHEDULE, scheduleTouched: false };

  it('is null when nothing differs from the suggestion', () => {
    expect(editFromSheet(untouched)).toBeNull();
    expect(isEmptyEdit(null)).toBe(true);
    expect(isEmptyEdit({})).toBe(true);
  });

  it('keeps only an owner change when the title is the automatic one', () => {
    expect(editFromSheet({ ...untouched, owner: { kind: 'you' }, title: 'Provide APK access' })).toEqual({ owner: { kind: 'you' } });
  });

  it('keeps a typed title as typed (trimmed), and a typed owner name collapsed', () => {
    expect(editFromSheet({ ...untouched, title: '  Call Bish at 555 0100 ' })).toEqual({ title: 'Call Bish at 555 0100' });
    expect(editFromSheet({ ...untouched, owner: { kind: 'other', name: ' Ana   Ruiz ' }, title: 'Ana Ruiz: Provide APK access' })).toEqual({
      owner: { kind: 'other', name: 'Ana Ruiz' },
    });
  });

  it('keeps the schedule only when touched (else the previous edit keeps its own)', () => {
    const schedule = { dueDate: '2026-11-20', dueTime: '10:00', reminderMinutesBefore: 15 };
    expect(editFromSheet({ ...untouched, schedule, scheduleTouched: true })).toEqual({ schedule });
    expect(editFromSheet({ ...untouched, previous: { schedule }, schedule: NO_SCHEDULE, scheduleTouched: false })).toEqual({ schedule });
    expect(editFromSheet({ ...untouched, schedule: { dueDate: null, dueTime: '10:00', reminderMinutesBefore: 5 }, scheduleTouched: true })).toEqual({
      schedule: NO_SCHEDULE,
    });
  });
});
