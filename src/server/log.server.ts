import * as Sentry from "@sentry/node";
import pino from "pino";

/**
 * The one logger of the app: JSON lines on stdout (Docker collects them).
 * In development the lines are pretty-printed through pino-pretty.
 */
// The worker-thread "transport" cannot be resolved under Vite, so in development
// pino-pretty is used as a plain stream instead.
const pretty =
	process.env.NODE_ENV === "production"
		? undefined
		: (await import("pino-pretty")).default({ colorize: true });

export const log = pino({ level: process.env.LOG_LEVEL ?? "info" }, pretty);

// Error reporting is off unless SENTRY_DSN is set. The SDK also reports
// uncaught exceptions and unhandled promise rejections of this process.
const dsn = process.env.SENTRY_DSN;
if (dsn) {
	Sentry.init({
		dsn,
		environment: process.env.NODE_ENV ?? "development",
		tracesSampleRate: 0,
	});
}

/** Logs an error and sends it to the error tracker when one is configured. */
export function reportError(message: string, error: unknown): void {
	log.error({ err: error }, message);
	if (dsn) Sentry.captureException(error);
}
