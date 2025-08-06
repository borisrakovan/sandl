export type ErrorProps = {
	cause?: unknown;
	detail?: Record<string, unknown>;
};

export type ErrorDump = {
	name: string;
	message: string;
	stack?: string;
	error: {
		name: string;
		message: string;
		detail: Record<string, unknown>;
		cause?: unknown;
	};
};

export class BaseError extends Error {
	detail: Record<string, unknown> | undefined;

	constructor(message: string, { cause, detail }: ErrorProps = {}) {
		super(message, { cause });
		this.name = this.constructor.name;
		this.detail = detail;
		// Use cause stack if available, otherwise fall back to the current error's stack
		if (cause instanceof Error && cause.stack !== undefined) {
			this.stack = `${this.stack}\nCaused by: ${cause.stack}`;
		}
	}

	static ensure(error: unknown): BaseError {
		return error instanceof BaseError
			? error
			: new BaseError('An unknown error occurred', { cause: error });
	}

	dump(): ErrorDump {
		// Only show the stack trace of the top-level error
		const cause =
			this.cause instanceof BaseError
				? this.cause.dump().error
				: this.cause;

		const result: ErrorDump['error'] = {
			name: this.name,
			message: this.message,
			cause,
			detail: this.detail ?? {},
		};

		return {
			name: this.name,
			message: result.message,
			stack: this.stack,
			error: result,
		};
	}

	dumps(): string {
		return JSON.stringify(this.dump());
	}
}
