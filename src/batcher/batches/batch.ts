import { DispatchableTask } from '../tasks/task-dispatcher';

export interface Batch {
    id: string;
    target: string;
    tasks: DispatchableTask[];
}
