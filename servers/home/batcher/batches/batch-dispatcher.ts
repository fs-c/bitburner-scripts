import { TaskDispatcher } from '../tasks/task-dispatcher';
import { Batch } from './batch-factory';

export class BatchDispatcher {
    private readonly taskDispatcher: TaskDispatcher;
    private readonly callbackPortNumber: number;

    constructor(private readonly ns: NS) {
        this.taskDispatcher = new TaskDispatcher(this.ns);
        this.callbackPortNumber = this.ns.pid;
    }

    public dispatch(batch: Batch): void {
        for (const task of batch.tasks) {
            this.taskDispatcher.dispatch(task, this.callbackPortNumber);
        }
    }
}
