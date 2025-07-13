// // TickTick 1.0
// import { allProjects } from '../focus-data/allProjects';
// import { allTags } from '../focus-data/allTags';
// import { allTasks } from '../focus-data/allTasks';
// import { completedTasksFromArchivedProjects } from '../focus-data/archivedTasks/completedTasksFromArchivedProjects';
// import { notCompletedTasksFromArchivedProjects } from '../focus-data/archivedTasks/notCompletedTasksFromArchivedProjects';
// import { sortedAllFocusData } from '../focus-data/sortedAllFocusData';

// TODO: New TODOIST SYNC DATA 2025
// import { todoistAllPersonalActiveTasks } from "../focus-data/Todoist/new-sync-data-2025/personal/todoistAllPersonalActiveTasks";
// import { todoistAllPersonalActiveTasksById } from "../focus-data/Todoist/new-sync-data-2025/personal/todoistAllPersonalActiveTasksById";
// import { todoistAllPersonalCompletedTasks } from "../focus-data/Todoist/new-sync-data-2025/personal/todoistAllPersonalCompletedTasks";
// import { todoistAllPersonalCompletedTasksById } from "../focus-data/Todoist/new-sync-data-2025/personal/todoistAllPersonalCompletedTasksById";
// import { todoistPersonalActiveProjects } from "../focus-data/Todoist/new-sync-data-2025/personal/todoistPersonalActiveProjects";
// import { todoistPersonalArchivedProjects } from "../focus-data/Todoist/new-sync-data-2025/personal/todoistPersonalArchivedProjects";
// import { todoistAllQLinkActiveTasks } from "../focus-data/Todoist/new-sync-data-2025/qlink/todoistAllQlinkActiveTasks";
// import { todoistAllQLinkActiveTasksById } from "../focus-data/Todoist/new-sync-data-2025/qlink/todoistAllQLinkActiveTasksById";
// import { todoistAllQLinkCompletedTasks } from "../focus-data/Todoist/new-sync-data-2025/qlink/todoistAllQLinkCompletedTasks";
// import { todoistAllQLinkCompletedTasksById } from "../focus-data/Todoist/new-sync-data-2025/qlink/todoistAllQLinkCompletedTasksById";
// import { todoistQLinkActiveProjects } from "../focus-data/Todoist/new-sync-data-2025/qlink/todoistQLinkActiveProjects";
// import { todoistQLinkArchivedProjects } from "../focus-data/Todoist/new-sync-data-2025/qlink/todoistQLinkArchivedProjects";

// // Old Focus Apps Data
// import { BE_FOCUSED_DATA } from '../focus-data/2021-2022-focus-data-from-other-apps/BeFocused/BE_FOCUSED';
// import { FOREST_DATA } from '../focus-data/2021-2022-focus-data-from-other-apps/Forest/FOREST';
// import { SESSION_DATA } from '../focus-data/2021-2022-focus-data-from-other-apps/Session/SESSION_DATA';
// import { TODOIST_ALL_COMPLETED_TASKS } from '../focus-data/Todoist/TODOIST_ALL_COMPLETED_TASKS';
// import { TODOIST_ALL_TASKS_BY_ID } from '../focus-data/Todoist/TODOIST_ALL_TASKS_BY_ID';
// import { TIDE_DATA } from '../focus-data/2021-2022-focus-data-from-other-apps/TIDE-IOS-APP/TIDE_DATA';
// import { TODOIST_ALL_PROJECTS } from '../focus-data/Todoist/TODOIST_ALL_PROJECTS';
// import { todoistAllPersonalCompletedTasks } from '../focus-data/Todoist/personal/todoistAllPersonalCompletedTasks';
// import { todoistAllQLinkCompletedTasksById } from '../focus-data/Todoist/qlink/todoistAllQLinkCompletedTasksById';
// import { todoistAllPersonalActiveTasks } from '../focus-data/Todoist/personal/todoistAllPersonalActiveTasks';
// import { todoistAllPersonalCompletedTasksById } from '../focus-data/Todoist/personal/todoistAllPersonalCompletedTasksById';
// import { todoistAllPersonalActiveTasksById } from '../focus-data/Todoist/personal/todoistAllPersonalActiveTasksById';
// import { todoistAllQLinkCompletedTasks } from '../focus-data/Todoist/qlink/todoistAllQLinkCompletedTasks';
// import { todoistAllQLinkActiveTasks } from '../focus-data/Todoist/qlink/todoistAllQLinkActiveTasks';
// import { todoistAllQLinkActiveTasksById } from '../focus-data/Todoist/qlink/todoistAllQLinkActiveTasksById';
// import { todoistPersonalActiveProjects } from '../focus-data/Todoist/personal/todoistPersonalActiveProjects';
// import { todoistPersonalArchivedProjects } from '../focus-data/Todoist/personal/todoistPersonalArchivedProjects';
// import { todoistQLinkActiveProjects } from '../focus-data/Todoist/qlink/todoistQLinkActiveProjects';
// import { todoistQLinkArchivedProjects } from '../focus-data/Todoist/qlink/todoistQLinkArchivedProjects';

// export const LOCAL_DATASETS = [
// 	{ name: 'sorted-all-focus-data', data: sortedAllFocusData },
// 	{ name: 'all-tasks', data: allTasks },
// 	{ name: 'all-projects', data: allProjects },
// 	{ name: 'completed-tasks-from-archived-projects', data: completedTasksFromArchivedProjects },
// 	{ name: 'not-completed-tasks-from-archived-projects', data: notCompletedTasksFromArchivedProjects },
// 	{ name: 'all-tags', data: allTags },
// ];

// export const OLD_FOCUS_APPS_DATASETS = [
// 	{ name: 'session-app-data', data: SESSION_DATA },
// 	{ name: 'forest-app-data', data: FOREST_DATA },
// 	{ name: 'be-focused-app-data', data: BE_FOCUSED_DATA },
// 	{ name: 'tide-ios-app-focus-records', data: TIDE_DATA },
// ];

// // Completed and Active Tasks in array form as well as in object form by id.
// OLD SYNC DATA AFTER 2025 UPDATE.
// export const TODOIST_TASKS_DATASETS = [
// 	// Personal
// 	{ name: 'todoist-personal-completed-tasks', data: todoistAllPersonalCompletedTasks },
// 	{ name: 'todoist-personal-completed-tasks-by-id', data: todoistAllPersonalCompletedTasksById },
// 	{ name: 'todoist-personal-active-tasks', data: todoistAllPersonalActiveTasks },
// 	{ name: 'todoist-personal-active-tasks-by-id', data: todoistAllPersonalActiveTasksById },

// 	// Q Link
// 	{ name: 'todoist-qlink-completed-tasks', data: todoistAllQLinkCompletedTasks },
// 	{ name: 'todoist-qlink-completed-tasks-by-id', data: todoistAllQLinkCompletedTasksById },
// 	{ name: 'todoist-qlink-active-tasks', data: todoistAllQLinkActiveTasks },
// 	{ name: 'todoist-qlink-active-tasks-by-id', data: todoistAllQLinkActiveTasksById },
// ];

// // Active and archived projects from todoist
// export const TODOIST_PROJECTS_DATASETS = [
// 	// Personal
// 	{ name: 'todoist-personal-active-projects', data: todoistPersonalActiveProjects },
// 	{ name: 'todoist-personal-archived-projects', data: todoistPersonalArchivedProjects },

// 	// Q Link
// 	{ name: 'todoist-qlink-active-projects', data: todoistQLinkActiveProjects },
// 	{ name: 'todoist-qlink-archived-projects', data: todoistQLinkArchivedProjects },
// ];


// TODO:NEW SYNC DATA AFTER 2025 UPDATE.
// export const TODOIST_NEW_2025_SYNC_TASKS_DATASETS = [
// 	// Personal
// 	{ name: 'sync-2025-todoist-personal-completed-tasks', data: todoistAllPersonalCompletedTasks },
// 	{ name: 'sync-2025-todoist-personal-completed-tasks-by-id', data: todoistAllPersonalCompletedTasksById },
// 	{ name: 'sync-2025-todoist-personal-active-tasks', data: todoistAllPersonalActiveTasks },
// 	{ name: 'sync-2025-todoist-personal-active-tasks-by-id', data: todoistAllPersonalActiveTasksById },

// 	// Q Link
// 	{ name: 'sync-2025-todoist-qlink-completed-tasks', data: todoistAllQLinkCompletedTasks },
// 	{ name: 'sync-2025-todoist-qlink-completed-tasks-by-id', data: todoistAllQLinkCompletedTasksById },
// 	{ name: 'sync-2025-todoist-qlink-active-tasks', data: todoistAllQLinkActiveTasks },
// 	{ name: 'sync-2025-todoist-qlink-active-tasks-by-id', data: todoistAllQLinkActiveTasksById },
// ];

// // Active and archived projects from todoist
// export const TODOIST_NEW_2025_SYNC_PROJECTS_DATASETS = [
// 	// Personal
// 	{ name: 'sync-2025-todoist-personal-active-projects', data: todoistPersonalActiveProjects },
// 	{ name: 'sync-2025-todoist-personal-archived-projects', data: todoistPersonalArchivedProjects },

// 	// Q Link
// 	{ name: 'sync-2025-todoist-qlink-active-projects', data: todoistQLinkActiveProjects },
// 	{ name: 'sync-2025-todoist-qlink-archived-projects', data: todoistQLinkArchivedProjects },
// ];