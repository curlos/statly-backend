import { Response } from 'express';
import { CustomRequest } from '../interfaces/CustomRequest';
import ApiCallStatus from '../models/ApiCallStatusModel';
import { Types } from 'mongoose';

interface SyncLockOptions<T = any> {
    endpoint: string;
    syncFunction: (userId: Types.ObjectId, ...args: any[]) => Promise<T>;
    extractParams?: (req: CustomRequest) => any[] | Promise<any[]>;
    errorMessage?: string;
    staleLockTimeoutMs?: number;
}

/**
 * Higher-order function that wraps sync endpoints with ApiCallStatus locking mechanism
 * to prevent concurrent sync operations for the same user/endpoint
 */
export function withSyncLock<T = any>(options: SyncLockOptions<T>) {
    return async (req: CustomRequest, res: Response) => {
        const userId = req.user!.userId;
        const {
            endpoint,
            syncFunction,
            extractParams = () => [],
            errorMessage = 'An error occurred during sync.',
            staleLockTimeoutMs = 10 * 60 * 1000 // 10 minutes
        } = options;

        let apiCallStatus: any = null;

        try {
            // Check for existing sync in progress
            apiCallStatus = await ApiCallStatus.findOne({ userId, apiEndpoint: endpoint });

            if (!apiCallStatus) {
                apiCallStatus = new ApiCallStatus({
                    userId,
                    apiEndpoint: endpoint,
                    isInProgress: false,
                    startedAt: new Date(),
                });
            }

            // Check if sync is already in progress
            if (apiCallStatus.isInProgress) {
                const staleTime = new Date(Date.now() - staleLockTimeoutMs);
                if (apiCallStatus.startedAt > staleTime) {
                    // Lock is active and recent, return 409
                    return res.status(409).json({
                        message: 'Sync already in progress',
                        startedAt: apiCallStatus.startedAt,
                    });
                }
                // Lock is stale (>10 minutes old), proceed with sync
            }

            // Acquire lock
            apiCallStatus.isInProgress = true;
            apiCallStatus.startedAt = new Date();
            await apiCallStatus.save();

            // Execute sync function with extracted parameters
            const params = await extractParams(req);
            const result = await syncFunction(userId, ...params);

            // Release lock on success
            apiCallStatus.isInProgress = false;
            await apiCallStatus.save();

            res.status(200).json(result);
        } catch (error: any) {
            // Release lock on error
            try {
                const apiCallStatus = await ApiCallStatus.findOne({
                    userId,
                    apiEndpoint: endpoint
                });
                if (apiCallStatus) {
                    apiCallStatus.isInProgress = false;
                    await apiCallStatus.save();
                }
            } catch (lockError) {
                console.error('Failed to release lock:', lockError);
            }

            const statusCode = error?.statusCode || 500;
            res.status(statusCode).json({
                message: error instanceof Error ? error.message : errorMessage,
            });
        }
    };
}
