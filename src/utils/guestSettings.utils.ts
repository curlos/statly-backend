import { CustomRequest } from '../interfaces/CustomRequest';

// Guests can't save settings to the shared demo account, but their streak numbers are worked out here from the focus goal rings. So their browser sends along its own copy of the rings with each streaks request and it's used in place of the saved ones, for that request only.
export const GUEST_RINGS_HEADER = 'x-guest-focus-goal-rings';

const MAX_HEADER_LENGTH = 14000;
export const MAX_GUEST_RINGS = 10;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);
const isMissingOr = (value: unknown, isValid: (value: unknown) => boolean) => value === undefined || isValid(value);
const isRecordOf = (isValid: (value: unknown) => boolean) => (value: unknown) =>
	isPlainObject(value) && Object.values(value).every(isValid);
const isBoolean = (value: unknown) => typeof value === 'boolean';
const isString = (value: unknown) => typeof value === 'string';
const isNumber = (value: unknown) => typeof value === 'number' && Number.isFinite(value);
const isInactivePeriod = (period: unknown) =>
	isPlainObject(period) &&
	isString(period.startDate) &&
	(period.endDate === undefined || period.endDate === null || isString(period.endDate));

// The streaks code reads the rings as they are, so a list with anything in it that isn't shaped like a real ring is turned away rather than risk it failing partway or giving odd numbers. Fields a ring doesn't have are fine.
const isValidRing = (ring: unknown) =>
	isPlainObject(ring) &&
	isBoolean(ring.isActive) &&
	isMissingOr(ring.id, isString) &&
	isMissingOr(ring.name, isString) &&
	isMissingOr(ring.goalSeconds, isNumber) &&
	isMissingOr(ring.selectedDaysOfWeek, isRecordOf(isBoolean)) &&
	isMissingOr(ring.restDays, isRecordOf(isBoolean)) &&
	isMissingOr(ring.customDailyFocusGoal, isRecordOf(isNumber)) &&
	isMissingOr(ring.projects, isRecordOf(isBoolean)) &&
	isMissingOr(ring.inactivePeriods, (periods) => Array.isArray(periods) && periods.every(isInactivePeriod));

export const getGuestRingsOverride = <T>(req: CustomRequest): T[] | undefined => {
	if (!req.user?.isGuest) {
		return undefined;
	}

	const header = req.headers[GUEST_RINGS_HEADER];
	if (typeof header !== 'string' || header.length > MAX_HEADER_LENGTH) {
		return undefined;
	}

	try {
		const rings = JSON.parse(decodeURIComponent(header));
		return Array.isArray(rings) && rings.length <= MAX_GUEST_RINGS && rings.every(isValidRing) ? rings : undefined;
	} catch {
		return undefined;
	}
};
