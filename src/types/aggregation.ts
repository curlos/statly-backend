// MongoDB query and pipeline types
export type MongooseFilter = Record<string, unknown>;
export type MongoosePipelineStage = Record<string, unknown>;

// Common aggregation result shapes
export interface GroupByResult {
	_id: string | Record<string, unknown> | null;
	count?: number;
	duration?: number;
	[key: string]: unknown;
}

// Task ancestor information (used across multiple services)
export interface TaskAncestorInfo {
	id: string;
	title: string;
	parentId: string | null;
	projectId: string | null;
	ancestorIds: string[];
}

// Facet result wrapper
export type FacetResult<T = unknown> = {
	[facetName: string]: T[];
};
