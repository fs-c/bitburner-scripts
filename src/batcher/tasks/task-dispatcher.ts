import type { NS } from '@ns';

import { getAllServers } from '../../utils.js';
import { Task, TASK_SCRIPTS } from './task.js';
import { createLogger } from '../logger.js';

export interface DispatchableTask extends Task {
    id: string;
}

interface DispatchedTask extends DispatchableTask {
    server: string;
    // undefined if this DispatchedTask is the result of a dry run and was not actually
    // executed anywhere (todo: this is not great)
    pid: number | undefined;
}

const logger = createLogger('task-dispatcher');

/**
 * this class assumes that ALL script executions happen through it
 * NO other place may use exec() etc.
 */
export class TaskDispatcher {
    private readonly blocks: { server: string; ram: number }[] = [];

    private readonly dispatchedTasks = new Map<string, DispatchedTask>();

    get totalRam(): number {
        return this.blocks.reduce((acc, block) => acc + block.ram, 0);
    }

    constructor(private readonly ns: NS) {
        const servers = getAllServers(this.ns);

        const taskScriptPaths = Object.values(TASK_SCRIPTS).map((taskScript) => taskScript.path);

        for (const server of servers) {
            if (!ns.hasRootAccess(server)) {
                continue;
            }

            const availableRam = this.ns.getServerMaxRam(server) - this.ns.getServerUsedRam(server);
            if (availableRam === 0) {
                // a bunch of servers have no ram, this is not an error case
                continue;
            }

            this.blocks.push({
                server,
                ram:
                    server === 'home'
                        ? Math.max(0, availableRam - 256) // always reserve some ram on home
                        : availableRam,
            });

            if (!ns.scp(taskScriptPaths, server)) {
                throw new Error(`failed to copy task scripts to ${server}`);
            }
        }

        logger.info(this.ns, `copied task scripts to ${servers.size} servers`);

        this.sortBlocks();
    }

    /**
     * reserves resources for a task and executes it
     * MUST call finish() on all started tasks, otherwise memory will leak
     */
    public dispatch(task: DispatchableTask, callbackPort: number, { dryRun = false } = {}): void {
        if (this.dispatchedTasks.has(task.id)) {
            throw new Error(`task ${task.id} is already started`);
        }

        if (task.threads <= 0) {
            throw new Error(`task ${task.id} has invalid thread count ${task.threads}`);
        }

        const taskScript = TASK_SCRIPTS[task.taskType];
        const taskRamCost = task.threads * taskScript.cost;

        // we assume that blocks is sorted so this will find the smallest block that fits the task
        // we don't split a task across multiple blocks for simplicity and because some timing
        // calculations depend on being run with exactly as many threads as requested
        const block = this.blocks.find((block) => block.ram >= taskRamCost);
        if (!block) {
            throw new Error(`couldn't find block for task ${JSON.stringify(task)}`);
        }

        const pid = dryRun
            ? undefined
            : this.ns.exec(
                  taskScript.path,
                  block.server,
                  task.threads,
                  task.id,
                  task.taskType,
                  task.target,
                  task.startTime,
                  callbackPort,
              );

        if (pid === 0) {
            throw new Error(`failed to start task ${task.id}`);
        }

        logger.debug(
            this.ns,
            `started task ${task.id}/${task.taskType} with ${task.threads} threads on ${block.server}` +
                `${dryRun ? ' (dry run)' : ''}`,
        );

        block.ram -= taskRamCost;

        this.dispatchedTasks.set(task.id, {
            ...task,
            server: block.server,
            pid,
        });

        // todo-performance: this might be a bit slow, faster would be to just insert the block
        //   at the right place
        this.sortBlocks();
    }

    public free(dispatchedTaskId: string): void {
        const dispatchedTask = this.dispatchedTasks.get(dispatchedTaskId);
        if (!dispatchedTask) {
            throw new Error(`task ${dispatchedTaskId} has not been started`);
        }

        const block = this.blocks.find((block) => block.server === dispatchedTask.server);
        if (!block) {
            throw new Error(`couldn't find block for started task ${dispatchedTask}`);
        }

        block.ram += dispatchedTask.threads * TASK_SCRIPTS[dispatchedTask.taskType].cost;

        this.dispatchedTasks.delete(dispatchedTaskId);

        // todo-performance: see above
        this.sortBlocks();
    }

    public freeAndKillAll(): void {
        logger.debug(this.ns, `freeing and killing all ${this.dispatchedTasks.size} tasks`);

        for (const dispatchedTaskId of this.dispatchedTasks.keys()) {
            const pid = this.dispatchedTasks.get(dispatchedTaskId)?.pid;
            if (pid !== undefined) {
                this.ns.kill(pid);
            }
            this.free(dispatchedTaskId);
        }
    }

    public getDispatchedTask(taskId: string): DispatchedTask | undefined {
        return this.dispatchedTasks.get(taskId);
    }

    public couldFit(tasks: DispatchableTask[]): boolean {
        // we want to sort tasks by ram cost because presumably those are the ones that we won't be
        // able to fit, we use threads as a surrogate here to avoid computing the actual ram costs
        const sortedTasks = tasks.sort((a, b) => b.threads - a.threads);
        const dispatchedTaskIds = new Set<string>();

        try {
            for (const task of sortedTasks) {
                this.dispatch(task, -1, { dryRun: true });
                dispatchedTaskIds.add(task.id);
            }
        } catch (err) {
            return false;
        } finally {
            for (const taskId of dispatchedTaskIds) {
                this.free(taskId);
            }
        }

        return true;
    }

    private sortBlocks(): void {
        this.blocks.sort((a, b) => a.ram - b.ram);
    }
}
