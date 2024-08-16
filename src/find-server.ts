import type { NS } from '@ns';

function findAllChildToParentConnections(ns: NS, start: string): Map<string, string> {
    const parentChildConnections = new Map<string, string[]>();
    const queue: [string | null, string | null][] = [[null, start]];

    while (true) {
        const [parent, current] = queue.pop() ?? [null, null];
        if (current == null) {
            break;
        }

        const connectedServers = ns.scan(current).filter((server) => server !== parent);
        parentChildConnections.set(current, connectedServers);
        for (const connectedServer of connectedServers) {
            if (!parentChildConnections.has(connectedServer)) {
                queue.push([current, connectedServer]);
            }
        }
    }

    const childParentConnections = new Map<string, string>();
    for (const [parent, children] of parentChildConnections) {
        for (const child of children) {
            childParentConnections.set(child, parent);
        }
    }

    return childParentConnections;
}

export async function main(ns: NS): Promise<void> {
    const [name] = ns.args as [string];

    const childParentConnections = findAllChildToParentConnections(ns, 'home');

    ns.tprint(`got ${childParentConnections.size} connections`);

    let infiniteLoopProtection = 0;

    let currentServer: string | undefined = name;
    const reversePath: string[] = [];
    while (currentServer != null && currentServer !== 'home') {
        reversePath.push(currentServer);
        currentServer = childParentConnections.get(currentServer);

        if (infiniteLoopProtection++ > 20) {
            ns.tprint('infinite loop detected');
            break;
        }
    }

    ns.tprint(reversePath.reverse().join(' -> '));
}
