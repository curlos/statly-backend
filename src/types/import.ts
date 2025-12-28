import { ITask } from '../models/TaskModel';
import { IProject } from '../models/ProjectModel';
import { IProjectGroup } from '../models/ProjectGroupModel';
import { IFocusRecord } from '../models/FocusRecord';
import { IUserSettings } from '../models/UserSettingsModel';
import { ICustomImage } from '../models/CustomImageModel';
import { ICustomImageFolder } from '../models/CustomImageFolderModel';

/**
 * Represents a task document that can be imported from a backup.
 * Based on ITask from the model, but with flexible fields to accommodate:
 * - Optional _id (removed during import)
 * - Optional userId (added during import)
 * - Additional fields from various sources
 */
export type ImportableTaskDocument = Omit<ITask, 'userId'> & {
	_id?: unknown;
	userId?: ITask['userId'];
	// Allow any additional fields from specific task sources
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	[key: string]: any;
};

/**
 * Represents a project document that can be imported from a backup.
 * Based on IProject from the model, but with flexible fields to accommodate:
 * - Optional _id (removed during import)
 * - Optional userId (added during import)
 * - Additional fields from various sources
 */
export type ImportableProjectDocument = Omit<IProject, 'userId'> & {
	_id?: unknown;
	userId?: IProject['userId'];
	// Allow any additional fields from specific project sources
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	[key: string]: any;
};

/**
 * Represents a project group document that can be imported from a backup.
 * Based on IProjectGroup from the model, but with flexible fields to accommodate:
 * - Optional _id (removed during import)
 * - Optional userId (added during import)
 * - Additional fields from various sources
 */
export type ImportableProjectGroupDocument = Omit<IProjectGroup, 'userId'> & {
	_id?: unknown;
	userId?: IProjectGroup['userId'];
	// Allow any additional fields
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	[key: string]: any;
};

/**
 * Represents a focus record document that can be imported from a backup.
 * Based on IFocusRecord from the model, but with flexible fields to accommodate:
 * - Optional _id (removed during import)
 * - Optional userId (added during import)
 * - Date fields accept both Date and string (Mongoose handles conversion)
 * - Additional fields from various sources
 */
export type ImportableFocusRecordDocument = Omit<IFocusRecord, 'userId' | 'startTime' | 'endTime'> & {
	_id?: unknown;
	userId?: IFocusRecord['userId'];
	startTime: Date | string;
	endTime: Date | string;
	tasks?: Array<{
		taskId: string;
		title: string;
		startTime: Date | string;
		endTime: Date | string;
		duration: number;
		projectId: string;
		projectName: string;
		ancestorIds?: string[];
	}>;
	// Allow any additional fields from specific focus record sources
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	[key: string]: any;
};

/**
 * Represents a user settings document that can be imported from a backup.
 * Based on IUserSettings from the model, but with flexible fields to accommodate:
 * - Optional _id (removed during import)
 * - Optional userId (added during import)
 * - Additional fields from various sources
 */
export type ImportableUserSettingsDocument = Omit<IUserSettings, 'userId'> & {
	_id?: unknown;
	userId?: IUserSettings['userId'];
	// Allow any additional fields
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	[key: string]: any;
};

/**
 * Represents a custom image document that can be imported from a backup.
 * Based on ICustomImage from the model, but with flexible fields to accommodate:
 * - Optional _id (removed during import)
 * - Optional userId (added during import)
 * - Additional fields from various sources
 */
export type ImportableCustomImageDocument = Omit<ICustomImage, 'userId'> & {
	_id?: unknown;
	userId?: ICustomImage['userId'];
	// Allow any additional fields
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	[key: string]: any;
};

/**
 * Represents a custom image folder document that can be imported from a backup.
 * Based on ICustomImageFolder from the model, but with flexible fields to accommodate:
 * - Optional _id (removed during import)
 * - Optional userId (added during import)
 * - Additional fields from various sources
 */
export type ImportableCustomImageFolderDocument = Omit<ICustomImageFolder, 'userId'> & {
	_id?: unknown;
	userId?: ICustomImageFolder['userId'];
	// Allow any additional fields
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	[key: string]: any;
};
