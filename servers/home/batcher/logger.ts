// yes this file uses stateful globals which is not great but i feel like avoiding them
// would make the code (and consumers) harder to read and maintain in this case

interface Logger {
    debug: (ns: NS, message: string) => void;
    info: (ns: NS, message: string) => void;
    warn: (ns: NS, message: string) => void;
    error: (ns: NS, message: string) => void;
}

enum LogLevel {
    Debug,
    Info,
    Warning,
    Error,
}

interface LogLevelMetadata {
    order: number;
    enabled: boolean;
    console: boolean;
    label: string;
}

const logLevelMetadata: Record<LogLevel, LogLevelMetadata> = {
    [LogLevel.Debug]: { order: 0, enabled: false, console: false, label: 'DEBUG' },
    [LogLevel.Info]: { order: 1, enabled: true, console: false, label: ' INFO' },
    [LogLevel.Warning]: { order: 2, enabled: true, console: true, label: ' WARN' },
    [LogLevel.Error]: { order: 3, enabled: true, console: true, label: 'ERROR' },
};

const initialDate = new Date();

// needs to end in .txt or ns.write will throw an error (╯°□°）╯︵ ┻━┻
export const LOG_FILE_NAME = `batcher-${formatDateForLogFileName(initialDate)}.log.txt`;

// this is a bit of a hack because it only works properly if all createLogger calls happen
// before anything is logged anywhere, but i think that's a reasonable assumption
let longestEncounteredTagLength = 0;

export function createLogger(tag: string): Logger {
    if (tag.length > longestEncounteredTagLength) {
        longestEncounteredTagLength = tag.length;
    }

    const log = (logLevelMetata: LogLevelMetadata, ns: NS, message: string) => {
        if (!logLevelMetata.enabled) {
            return;
        }

        const date = new Date();
        const formattedDate = formatDateForLogLine(date);
        const formattedTag = tag.padStart(longestEncounteredTagLength, ' ');

        const messageLines = message.split('\n');
        for (const messageLine of messageLines) {
            const formattedLogLine =
                `${formattedDate} ${formattedTag} :: ` +
                `${logLevelMetata.label} :: ${messageLine}`;

            ns.write(LOG_FILE_NAME, formattedLogLine + '\n');

            if (logLevelMetata.console) {
                ns.tprint(formattedLogLine);
            }
        }
    };

    return {
        debug: (ns: NS, message: string) => log(logLevelMetadata[LogLevel.Debug], ns, message),
        info: (ns: NS, message: string) => log(logLevelMetadata[LogLevel.Info], ns, message),
        warn: (ns: NS, message: string) => log(logLevelMetadata[LogLevel.Warning], ns, message),
        error: (ns: NS, message: string) => log(logLevelMetadata[LogLevel.Error], ns, message),
    };
}

export function setLogLevel(level: LogLevel): void {
    const order = logLevelMetadata[level].order;
    for (const meta of Object.values(logLevelMetadata)) {
        meta.enabled = meta.order >= order;
    }
}

function formatDateForLogFileName(date: Date): string {
    return date.toISOString().replace(/:/g, '-');
}

function formatDateForLogLine(date: Date): string {
    // no need for year/month/day, just want time
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    const seconds = date.getSeconds().toString().padStart(2, '0');
    const milliSeconds = date.getMilliseconds().toString().padStart(3, '0');

    return `${hours}:${minutes}:${seconds}.${milliSeconds}`;
}
