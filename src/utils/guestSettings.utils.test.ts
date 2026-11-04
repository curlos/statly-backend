import { test } from 'node:test';
import assert from 'node:assert';
import { CustomRequest } from '../interfaces/CustomRequest';
import { getGuestRingsOverride, GUEST_RINGS_HEADER, MAX_GUEST_RINGS } from './guestSettings.utils';

const makeReq = (isGuest: boolean, header?: string) =>
	({ user: { isGuest }, headers: header === undefined ? {} : { [GUEST_RINGS_HEADER]: header } }) as unknown as CustomRequest;

const rings = [{ id: 'ring-1', isActive: true, goalSeconds: 7200 }];

test('getGuestRingsOverride returns the rings a guest sent', () => {
	assert.deepStrictEqual(getGuestRingsOverride(makeReq(true, encodeURIComponent(JSON.stringify(rings)))), rings);
});

test('getGuestRingsOverride ignores the header for normal users', () => {
	assert.strictEqual(getGuestRingsOverride(makeReq(false, encodeURIComponent(JSON.stringify(rings)))), undefined);
});

test('getGuestRingsOverride ignores a missing, broken or wrongly shaped header', () => {
	assert.strictEqual(getGuestRingsOverride(makeReq(true)), undefined);
	assert.strictEqual(getGuestRingsOverride(makeReq(true, '%E0%A4%A')), undefined);
	assert.strictEqual(getGuestRingsOverride(makeReq(true, encodeURIComponent('{"rings":[]}'))), undefined);
	assert.strictEqual(getGuestRingsOverride(makeReq(true, 'x'.repeat(14001))), undefined);
});

const send = (value: unknown) => getGuestRingsOverride(makeReq(true, encodeURIComponent(JSON.stringify(value))));

test('getGuestRingsOverride turns away a list with anything in it that is not a ring', () => {
	assert.strictEqual(send([null]), undefined);
	assert.strictEqual(send([{ id: 'a', isActive: true }, null]), undefined);
	assert.strictEqual(send(['ring']), undefined);
	assert.strictEqual(send([5]), undefined);
	assert.strictEqual(send([[{ isActive: true }]]), undefined);
	assert.strictEqual(send([{ id: 'a' }]), undefined);
	assert.strictEqual(send([{ id: 'a', isActive: 'yes' }]), undefined);
});

test('getGuestRingsOverride keeps rings that are active or paused, and an empty list', () => {
	const mixed = [{ id: 'a', isActive: true }, { id: 'b', isActive: false }];
	assert.deepStrictEqual(send(mixed), mixed);
	assert.deepStrictEqual(send([]), []);
});

test('getGuestRingsOverride turns away more rings than the app ever has', () => {
	const ring = (id: number) => ({ id: `ring-${id}`, isActive: false });
	assert.strictEqual(send(Array.from({ length: MAX_GUEST_RINGS + 1 }, (_, i) => ring(i))), undefined);
	assert.strictEqual(send(Array.from({ length: MAX_GUEST_RINGS }, (_, i) => ring(i)))?.length, MAX_GUEST_RINGS);
});

// A ring like the ones made for every new account, with some of the things a person can set on it
const realisticRing = () => ({
	id: 'ring-1-abc',
	name: 'Ring 1',
	color: '#fa114f',
	isActive: true,
	useThemeColor: false,
	goalSeconds: 3600,
	goalDays: 7,
	showStreakCount: true,
	showGoalDays: true,
	selectedDaysOfWeek: { monday: true, tuesday: true, wednesday: true, thursday: true, friday: true, saturday: false, sunday: false },
	restDays: { '2026-01-02': true },
	customDailyFocusGoal: { '2026-01-03': 7200 },
	inactivePeriods: [{ startDate: '2025-12-01', endDate: '2025-12-05' }, { startDate: '2026-01-10', endDate: null }],
	projects: { 'project-1': true, 'project-2': false },
	createdAt: '2026-01-04T00:53:20.904Z',
	updatedAt: '2026-01-04T00:53:20.904Z',
	_id: '6959ba005f90a303e48ccacf',
});

test('getGuestRingsOverride keeps a ring with everything a person can set on it', () => {
	assert.deepStrictEqual(send([realisticRing()]), [realisticRing()]);
	assert.deepStrictEqual(send([{ ...realisticRing(), inactivePeriods: [{ startDate: '2026-01-10' }] }])?.length, 1);
});

test('getGuestRingsOverride turns away a ring with a field of the wrong type', () => {
	const wrong: Record<string, unknown> = {
		id: 5,
		name: {},
		goalSeconds: '3600',
		selectedDaysOfWeek: [true],
		restDays: 'monday',
		customDailyFocusGoal: { '2026-01-03': 'a lot' },
		projects: { a: 'yes' },
		inactivePeriods: 3,
	};

	for (const [field, value] of Object.entries(wrong)) {
		assert.strictEqual(send([{ ...realisticRing(), [field]: value }]), undefined, `${field} should not be accepted`);
	}
	assert.strictEqual(send([{ ...realisticRing(), inactivePeriods: [null] }]), undefined);
	assert.strictEqual(send([{ ...realisticRing(), inactivePeriods: [{ startDate: 5, endDate: null }] }]), undefined);
	assert.strictEqual(send([{ ...realisticRing(), inactivePeriods: [{ startDate: '2026-01-01', endDate: 5 }] }]), undefined);
	assert.strictEqual(send([{ ...realisticRing(), goalSeconds: Infinity }]), undefined);
	assert.strictEqual(send([{ ...realisticRing(), goalSeconds: null }]), undefined);
});
