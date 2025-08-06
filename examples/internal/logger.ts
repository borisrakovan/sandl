export type LogObject = Record<string, unknown>;
export type LogFn = {
	(obj: LogObject, msg?: string): void;
	(msg: string): void;
};

export interface Logger {
	info: LogFn;
	error: LogFn;
	debug: LogFn;
	warn: LogFn;
}

const PREFIX = '[lambdaverse]';

const developmentLogger: Logger = {
	debug: (...args) => {
		console.log(PREFIX, ...args);
	},

	info: (...args) => {
		console.log(PREFIX, ...args);
	},

	warn: (...args) => {
		console.warn(PREFIX, ...args);
	},

	error: (...args) => {
		console.error(PREFIX, ...args);
	},
};

export default developmentLogger;
