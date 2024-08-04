export function getAllServers(ns: NS): Set<string> {
    const allServers = new Set<string>();
    const queue = ['home'];

    while (true) {
        const current = queue.pop();
        if (current == null) {
            break;
        }

        allServers.add(current);

        const connectedServers = ns.scan(current);
        for (const connectedServer of connectedServers) {
            if (allServers.has(connectedServer)) {
                continue;
            }

            queue.push(connectedServer);
        }
    }

    const purchasedServers = ns.getPurchasedServers();
    for (const purchasedServer of purchasedServers) {
        allServers.add(purchasedServer);
    }

    return allServers;
}

// this is a pseudo-random uuid-generator stolen from the internet but it's good enough for this
export function id(): string {
    let d = '';
    while (d.length < 32) d += Math.random().toString(16).slice(2);
    const vr = ((parseInt(d.slice(16, 17), 16) & 0x3) | 0x8).toString(16);
    return `${d.slice(0, 8)}-${d.slice(8, 12)}-4${d.slice(13, 16)}-${vr}${d.slice(17, 20)}-${d.slice(20, 32)}`;
}

// taken from https://en.wikipedia.org/wiki/Levenshtein_distance
export function levenshteinDistance(a: string, b: string): number {
    // for all i and j, distances[i,j] will hold the levenshtein distance between
    // the first i characters of s and the first j characters of t
    const distances: number[][] = Array.from({ length: a.length + 1 }, () =>
        Array.from({ length: b.length + 1 }, () => 0),
    );

    // source prefixes can be transformed into empty string by dropping all characters
    for (let i = 1; i <= a.length; i++) {
        // @ts-ignore we know for sure that this is defined
        distances[i][0] = i;
    }

    // target prefixes can be reached from empty source prefix by inserting every character
    for (let j = 1; j <= b.length; j++) {
        // @ts-ignore we know for sure that this is defined
        distances[0][j] = j;
    }

    for (let j = 1; j <= b.length; j++) {
        for (let i = 1; i <= a.length; i++) {
            const substitutionCost = a[i] === b[j] ? 0 : 1;

            // @ts-ignore we know for sure that this is defined
            distances[i][j] = Math.min(
                // @ts-ignore
                distances[i - 1][j] + 1, // deletion
                // @ts-ignore
                distances[i][j - 1] + 1, // insertion
                // @ts-ignore
                distances[i - 1][j - 1] + substitutionCost, // substitution
            );
        }
    }

    // @ts-ignore
    return distances[a.length][b.length];
}
