import { Context } from 'aws-lambda';

export type JsonObject = { [key: string]: JsonValue };
export type JsonValue =
	| string
	| number
	| boolean
	| null
	| undefined
	| Date
	| JsonObject
	| JsonValue[];

export type AwsContext = Context;

export type Prettify<T> = {
	[K in keyof T]: T[K];
} & {};

export type PromiseOrValue<T> = T | Promise<T>;

export type State = Record<string, unknown>;

export type LambdaRequest<TEvent, TState extends State> = {
	event: TEvent;
	context: AwsContext;
	state: Prettify<TState>;
};

export interface ClassConstructor<T = unknown> {
	readonly name: string;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	new (...args: any[]): T;
}
