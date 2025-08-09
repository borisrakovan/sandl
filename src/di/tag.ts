import { ClassConstructor } from './types.js';

export const TagId: unique symbol = Symbol('tag');

export type ValueTag<T, Id extends string | symbol> = Readonly<{
	readonly [TagId]: Id;
	// Phantom type to carry T
	readonly __type: T;
}>;

export type ClassTag<Id extends string | symbol> = {
	readonly [TagId]: Id;
	readonly __type: unknown;
};

export type Tag<T, Id extends string | symbol> =
	| ClassConstructor<T>
	| ValueTag<T, Id>;

export type AnyTag = Tag<unknown, string | symbol>;

export const Tag = {
	of: <Id extends string>(id: Id) => {
		return <T>(): ValueTag<T, Id> => ({
			[TagId]: id,
			__type: undefined as T,
		});
	},

	for: <T>(): ValueTag<T, symbol> => {
		return {
			[TagId]: Symbol(),
			__type: undefined as T,
		};
	},

	Class: <Id extends string | symbol>(
		id: Id
	): ClassConstructor<ClassTag<Id>> => {
		return class Tagged {
			readonly [TagId]: Id = id;
			readonly __type: unknown;
		};
	},

	id: (tag: AnyTag): string => {
		return tag[TagId as keyof AnyTag] as string;
	},
};

export type ServiceOf<T> =
	T extends ClassConstructor<infer S>
		? S
		: T extends ValueTag<infer S, any>
			? S
			: never;
