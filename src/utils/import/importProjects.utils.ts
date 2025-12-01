import { Types } from 'mongoose';
import { ProjectTickTick, ProjectTodoist, ProjectSession } from "../../models/projectModel";
import type { ImportCategoryResult } from "./importBackup.utils";

/**
 * Validates a project document against required fields
 */
export function validateProject(doc: any, requiredFields: string[], validSourcesSet: Set<string>): { valid: boolean; error?: string } {
	for (const field of requiredFields) {
		if (!(field in doc)) {
			return { valid: false, error: `Missing required field: ${field}` };
		}
	}

	if (!validSourcesSet.has(doc.source)) {
		return { valid: false, error: `Invalid source: ${doc.source}` };
	}

	return { valid: true };
}

/**
 * Imports projects with validation
 */
export async function importProjects(projects: any[], userId: Types.ObjectId): Promise<ImportCategoryResult> {
    const errors: string[] = [];

    // Declare validation constants once for all projects
    const requiredFields = ['id', 'source', 'name'];
    const validSourcesSet = new Set(['ProjectTickTick', 'ProjectTodoist', 'ProjectSession']);

    // Group projects by source to use the correct discriminator model
    const projectsBySource: Record<string, any[]> = {
        ProjectTickTick: [],
        ProjectTodoist: [],
        ProjectSession: [],
    };

    // Validate and categorize projects
    for (const project of projects) {
        const validation = validateProject(project, requiredFields, validSourcesSet);

        if (!validation.valid) {
            errors.push(`Project ${project.id || 'unknown'}: ${validation.error}`);
            continue;
        }

        const source = project.source;
        if (projectsBySource[source]) {
            // Remove _id to allow MongoDB to generate new unique IDs for each user
            const { _id, ...projectWithoutMongoDbId } = project;
            projectsBySource[source].push({ ...projectWithoutMongoDbId, userId });
        } else {
            errors.push(`Project ${project.id}: Unknown source ${source}`);
        }
    }

    // Map source names to their corresponding discriminator models
    const modelMap: Record<string, any> = {
        ProjectTickTick,
        ProjectTodoist,
        ProjectSession,
    };

    let totalCreated = 0;
    let totalModified = 0;
    let totalMatched = 0;

    // Import each source separately using the correct discriminator model
    for (const [source, sourceProjects] of Object.entries(projectsBySource)) {
        if (sourceProjects.length === 0) continue;

        const bulkOps = sourceProjects.map(project => ({
            updateOne: {
                filter: { id: project.id, userId },
                update: { $set: project },
                upsert: true,
            },
        }));

        try {
            const model = modelMap[source];
            const result = await model.bulkWrite(bulkOps);
            totalCreated += result.upsertedCount;
            totalModified += result.modifiedCount;
            totalMatched += result.matchedCount - result.modifiedCount;
        } catch (error) {
            errors.push(`Bulk insert error for ${source}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    return {
        created: totalCreated,
        modified: totalModified,
        matched: totalMatched,
        failed: errors.length,
        errors,
    };
}