import type { NS } from '@ns';

// todo: this implementation is stupid and doesn't fit the use case well

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

const loggingConfig: Record<LogLevel, LogLevelMetadata> = {
    [LogLevel.Debug]: { order: 0, enabled: true, console: true, label: 'DEBUG' },
    [LogLevel.Info]: { order: 1, enabled: true, console: true, label: ' INFO' },
    [LogLevel.Warning]: { order: 2, enabled: true, console: true, label: ' WARN' },
    [LogLevel.Error]: { order: 3, enabled: true, console: true, label: 'ERROR' },
};

// needs to end in .txt or ns.write will throw an error (╯°□°）╯︵ ┻━┻
// don't generate a run-unique name here because it is annoying to delete log files all the time
// and they seem to slow the game down if they are large (?)
export const LOG_FILE_NAME = `batcher.log.txt`;

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
        debug: (ns: NS, message: string) => log(loggingConfig[LogLevel.Debug], ns, message),
        info: (ns: NS, message: string) => log(loggingConfig[LogLevel.Info], ns, message),
        warn: (ns: NS, message: string) => log(loggingConfig[LogLevel.Warning], ns, message),
        error: (ns: NS, message: string) => log(loggingConfig[LogLevel.Error], ns, message),
    };
}

export function setLogLevel(level: LogLevel): void {
    const order = loggingConfig[level].order;
    for (const meta of Object.values(loggingConfig)) {
        meta.enabled = meta.order >= order;
    }
}

function formatDateForLogLine(date: Date): string {
    // no need for year/month/day, just want time
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    const seconds = date.getSeconds().toString().padStart(2, '0');
    const milliSeconds = date.getMilliseconds().toString().padStart(3, '0');

    return `${hours}:${minutes}:${seconds}.${milliSeconds}`;
}
