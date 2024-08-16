import type { NS } from '@ns';

import { TaskType, isTaskReport } from './tasks/task.js';
import { createLogger } from './logger.js';
import { ProtoBatch } from './batches/proto-batch.js';
import { BatchManager, isBatchFinishedReport } from './batches/batch-manager.js';
import { Port } from './ports.js';
import { TaskDispatcher } from './tasks/task-dispatcher.js';

const logger = createLogger('batcher');

function isPrepped(ns: NS, server: string): boolean {
    const a = 1;
    return (
        ns.getServerSecurityLevel(server) <= ns.getServerMinSecurityLevel(server) &&
        ns.getServerMoneyAvailable(server) >= ns.getServerMaxMoney(server)
    );
}

export async function main(ns: NS): Promise<void> {
    const [target] = ns.args as [string];

    const spacerMs = 5;

    const hackProtoBatch = ProtoBatch.createHWGW(ns, target, 0.9, spacerMs);

    const callbackPort = ns.getPortHandle(Port.Batcher);

    // todo: also consider max batches that can fit in memory
    // const depth = Math.min(
    //     hackProtoBatch.maxConcurrentBatches(),
    //     prepProtoBatch.maxConcurrentBatches(),
    // );
    const depth = 1;
    const serverIsPrepped = isPrepped(ns, target);

    if (!serverIsPrepped) {
        logger.info(ns, 'server is not prepped, starting to prep');

        await prepServer(ns, target);
    }

    const batchManager = new BatchManager(ns, spacerMs * depth * 4, Port.Batcher);

    logger.info(ns, `starting batch manager with depth ${depth}`);

    for (let i = 0; i < depth; i++) {
        const additionalSpacerMs = i * spacerMs * 4;

        batchManager.start(hackProtoBatch, additionalSpacerMs);
    }

    while (true) {
        await callbackPort.nextWrite();

        while (!callbackPort.empty()) {
            const message = JSON.parse(callbackPort.read());
            if (!isBatchFinishedReport(message)) {
                throw new Error(`unexpected message: ${JSON.stringify(message)} `);
            }

            const { batchId } = message;

            logger.info(
                ns,
                `batch ${batchId} finished, server status: ` +
                    `money ${ns.formatPercent(
                        ns.getServerMoneyAvailable(target) / ns.getServerMaxMoney(target),
                        3
                    )}, ` +
                    `security: ${ns.formatPercent(
                        ns.getServerMinSecurityLevel(target) / ns.getServerSecurityLevel(target),
                        3
                    )}`
            );
        }
    }
}

// todo: right now the batchmanager doesn't really handle multiple different kinds of batches well
// so we separate out prepping here
async function prepServer(ns: NS, target: string): Promise<void> {
    if (isPrepped(ns, target)) {
        return;
    }

    const callbackPortNumber = Port.Batcher;
    const callbackPort = ns.getPortHandle(callbackPortNumber);

    const spacerMs = 5;
    const prepProtoBatch = ProtoBatch.createGW(ns, target, 1.5, spacerMs);

    const depth = 100; // todo

    const taskDispatcher = new TaskDispatcher(ns);

    for (let i = 0; i < depth; i++) {
        // the last task finishes after (tasks.length - 1) * spacer but we also want there to be
        // a spacer between batches
        const additionalDelayMs = i * spacerMs * 4;
        const batch = prepProtoBatch.generateBatch(additionalDelayMs);

        for (const task of batch.tasks) {
            taskDispatcher.dispatch(task, callbackPortNumber);
        }
    }

    while (true) {
        // wait for the next message
        await callbackPort.nextWrite();

        // for every message that we got...
        while (!callbackPort.empty()) {
            const message = JSON.parse(callbackPort.read());
            if (!isTaskReport(message)) {
                throw new Error(`unexpected message: ${JSON.stringify(message)} `);
            }

            const task = taskDispatcher.getDispatchedTask(message.taskId);
            if (task == null) {
                throw new Error(`unexpected task id ${message.taskId} `);
            }

            logger.debug(
                ns,
                `task ${message.taskId}/${message.taskType} finished ` +
                    `with ${message.returnValue} (${ns.formatPercent(
                        message.returnValue / task.validReturnValue,
                        3
                    )}) ` +
                    `in ${ns.formatNumber(message.timeTakenMs)}ms`
            );

            if (task.taskType === TaskType.Weaken) {
                const preppedAfterBatch = isPrepped(ns, target);
                if (preppedAfterBatch) {
                    taskDispatcher.freeAndKillAll();
                    return;
                }

                const newBatch = prepProtoBatch.generateBatch(spacerMs * depth);
                for (const task of newBatch.tasks) {
                    taskDispatcher.dispatch(task, callbackPortNumber);
                }
            }

            taskDispatcher.free(task.id);
        }
    }
}
