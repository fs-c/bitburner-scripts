import { getAllServers } from '../../utils.js';
import { TASK_SCRIPTS, Task } from './task.js';

export interface DispatchableTask extends Task {
    threads: number;
}

interface DispatchedTask extends DispatchableTask {
    server: string;
    ramCost: number;
    // undefined if this DispatchedTask is the result of a dry run and was not actually
    // executed anywhere (todo: this is not great)
    pid: number | undefined;
}

/**
 * this class assumes that ALL script executions happen through it
 */
export class TaskDispatcher {
    private readonly blocks: { server: string; ram: number }[] = [];

    private readonly dispatchedTasks = new Map<string, DispatchedTask>();

    constructor(private readonly ns: NS) {
        const servers = getAllServers(this.ns);

        const taskScriptPaths = Object.values(TASK_SCRIPTS).map((taskScript) => taskScript.path);

        for (const server of servers) {
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
                throw new Error(`failed to scp scripts to ${server}`);
            }

            ns.print(`copied scripts to ${server}`);
        }

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
            this.ns.print(`current resource availability`);
            this.ns.print(JSON.stringify(this.blocks, null, 4));

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
                  task.delayMs,
                  callbackPort,
              );

        if (pid === 0) {
            throw new Error(`failed to start task ${task.id}`);
        }

        this.ns.print(
            `started task ${task.id} on ${block.server} with ${task.threads} threads (pid ${pid})${dryRun ? ' (dry run)' : ''}'}`,
        );

        block.ram -= taskRamCost;

        this.dispatchedTasks.set(task.id, {
            ...task,
            ramCost: taskRamCost,
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

        block.ram += dispatchedTask.ramCost;

        this.dispatchedTasks.delete(dispatchedTaskId);

        // todo-performance: see above
        this.sortBlocks();
    }

    public freeAndKillAll(): void {
        for (const [taskId, dispatchedTask] of this.dispatchedTasks) {
            this.free(taskId);

            if (dispatchedTask.pid != null) {
                this.ns.kill(dispatchedTask.pid);
            }
        }
    }

    public getDispatchedTask(taskId: string): DispatchedTask | undefined {
        return this.dispatchedTasks.get(taskId);
    }

    private sortBlocks(): void {
        this.blocks.sort((a, b) => a.ram - b.ram);
    }
}
