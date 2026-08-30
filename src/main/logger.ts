import log from 'electron-log/main';

// electron-log's default file transport already writes to the OS-appropriate
// userData/logs location (e.g. %APPDATA%/ProfileForge/logs/main.log on
// Windows) — no path configuration needed. This is the only place errors are
// ever persisted to disk; everywhere else just calls this logger instead of
// console.error so a crash in a packaged build is actually debuggable.
log.initialize();
log.transports.file.level = 'info';
log.transports.console.level = 'info';

export { log };
