export interface ImportCategoryResult {
	created: number;
	modified: number;
	matched: number;
	failed: number;
	errors: string[];
}

export interface ImportResult {
	focusRecords: ImportCategoryResult;
	tasks: ImportCategoryResult;
	projects: ImportCategoryResult;
	projectGroups: ImportCategoryResult;
}

type DocumentType = 'focusRecord' | 'task' | 'project' | 'projectGroup' | 'unknown';

// O(1) lookup map for document type detection - declared outside function for efficiency
const SOURCE_TYPE_MAP: Record<string, DocumentType> = {
	// Focus Record sources
	FocusRecordTickTick: 'focusRecord',
	FocusRecordBeFocused: 'focusRecord',
	FocusRecordForest: 'focusRecord',
	FocusRecordTide: 'focusRecord',
	FocusRecordSession: 'focusRecord',
	// Task sources
	TaskTickTick: 'task',
	TaskTodoist: 'task',
	// Project sources
	ProjectTickTick: 'project',
	ProjectTodoist: 'project',
	ProjectSession: 'project',
	// Project Group sources
	ProjectGroupTickTick: 'projectGroup',
};

/**
 * Detects document type based on the source field - O(1) lookup
 */
export function detectDocumentType(doc: { source?: string }): DocumentType {
	if (!doc || typeof doc !== 'object') {
		return 'unknown';
	}

	const source = doc.source;

	// O(1) lookup by source
	return (source && SOURCE_TYPE_MAP[source]) || 'unknown';
}

/**
 * Helper to check if a value is a valid date
 * Accepts both Date objects and date strings
 */
export function isValidDate(value: Date | string): boolean {
	if (!value) return false;
	const date = new Date(value);
	return !isNaN(date.getTime());
}