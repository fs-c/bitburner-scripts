import type { NS, NetscriptPort } from '@ns';

import { TaskDispatcher } from '../tasks/task-dispatcher';
import { isTaskReport, TaskReport } from '../tasks/task';
import { ProtoBatch } from './proto-batch';
import { createLogger } from '../logger';
import { Port } from '../ports';

export interface BatchFinishedReport {
    type: 'batch-finished-report';
    batchId: string;
}

export function isBatchFinishedReport(object: unknown): object is BatchFinishedReport {
    return (
        typeof object === 'object' &&
        object !== null &&
        'type' in object &&
        object['type'] === 'batch-finished-report' &&
        'batchId' in object &&
        typeof object['batchId'] === 'string'
    );
}

const logger = createLogger('batch-manager');

export class BatchManager {
    private readonly taskIdToBatchId = new Map<string, string>();
    private readonly batchIdToOpenTasks = new Map<string, number>();
    private readonly batchIdToProtoBatch = new Map<string, ProtoBatch>();

    private readonly taskDispatcher: TaskDispatcher;

    private readonly taskCallbackPortNumber = Port.BatchManager;

    constructor(
        private readonly ns: NS,
        private readonly batchSpacerMs: number,
        private readonly parentCallbackPortNumber: number,
    ) {
        this.taskDispatcher = new TaskDispatcher(ns);

        this.listenAndHandleMessages(ns.getPortHandle(this.taskCallbackPortNumber));
    }

    public start(protoBatch: ProtoBatch, initialSpacerMs: number = 0): void {
        const batch = protoBatch.generateBatch(this.batchSpacerMs + initialSpacerMs);

        logger.debug(this.ns, `starting new batch ${batch.id} with ${batch.tasks.length} tasks`);

        this.batchIdToOpenTasks.set(batch.id, batch.tasks.length);
        this.batchIdToProtoBatch.set(batch.id, protoBatch);

        for (const task of batch.tasks) {
            this.taskDispatcher.dispatch(task, this.taskCallbackPortNumber);
            this.taskIdToBatchId.set(task.id, batch.id);
        }
    }

    private async listenAndHandleMessages(port: NetscriptPort): Promise<void> {
        while (true) {
            await port.nextWrite();

            while (!port.empty()) {
                const message = JSON.parse(port.read());
                if (!isTaskReport(message)) {
                    throw new Error(`unexpected message: ${JSON.stringify(message)} `);
                }

                this.handleTaskResult(message);
            }
        }
    }

    private handleTaskResult(message: TaskReport): void {
        const batchId = this.taskIdToBatchId.get(message.taskId);
        if (batchId == null) {
            logger.debug(
                this.ns,
                JSON.stringify(Array.from(this.taskIdToBatchId.entries()), null, 2),
            );
            throw new Error(`no batch id found for task id ${message.taskId}`);
        }

        const openTasks = this.batchIdToOpenTasks.get(batchId);
        if (openTasks == null) {
            logger.debug(
                this.ns,
                JSON.stringify(Array.from(this.batchIdToOpenTasks.entries()), null, 2),
            );
            throw new Error(
                `no open tasks registered for batch ${batchId} of task ${message.taskId} `,
            );
        }

        const task = this.taskDispatcher.getDispatchedTask(message.taskId);
        if (task == null) {
            throw new Error(`unexpected task id ${message.taskId} `);
        }

        logger.debug(
            this.ns,
            `task ${message.taskId}/${message.taskType} in batch ${batchId} finished, ` +
                `${openTasks - 1} tasks remaining (efficacy ${this.ns.formatPercent(
                    message.returnValue / task.validReturnValue,
                    3,
                )})`,
        );

        if (openTasks === 1) {
            // if this was the last open task of this batch we can start a new batch
            const protoBatch = this.batchIdToProtoBatch.get(batchId);
            if (protoBatch == null) {
                throw new Error(`no proto batch found for batch id ${batchId} `);
            }

            this.start(protoBatch);

            this.ns.writePort(
                this.parentCallbackPortNumber,
                JSON.stringify({
                    type: 'batch-finished-report',
                    batchId,
                } satisfies BatchFinishedReport),
            );

            // ...and clean up everything related to this batch
            this.batchIdToProtoBatch.delete(batchId);
            this.batchIdToOpenTasks.delete(batchId);
        }

        this.batchIdToOpenTasks.set(batchId, openTasks - 1);

        // clean up everything related to this task
        this.taskIdToBatchId.delete(message.taskId);
        this.taskDispatcher.free(message.taskId);
    }
}
