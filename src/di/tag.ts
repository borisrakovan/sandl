export const TagId = '__tag_id__' as const;

export type ValueTag<T, Id extends string | symbol> = Readonly<{
	readonly [TagId]: Id;
	// Phantom type to carry T
	readonly __type: T;
}>;

// Helper type for classes created by Tag.Class()
export type TaggedClass<T, Id extends string | symbol> = {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	new (...args: any[]): T & { readonly [TagId]: Id };
	readonly [TagId]: Id;
};

// A tag can be either a value tag or a tagged class
export type AnyTag =
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	| ValueTag<any, string | symbol>
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	| TaggedClass<any, string | symbol>;

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

	Class: <Id extends string | symbol>(id: Id) => {
		class Tagged {
			static readonly [TagId]: Id = id;
			readonly [TagId]: Id = id;
			readonly __type: unknown;
		}
		return Tagged as TaggedClass<Tagged, Id>;
	},

	id: (tag: AnyTag): string => {
		// For class constructors (TaggedClass), get the TagId from the static property
		if (typeof tag === 'function') {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
			const id = (tag as any)[TagId];
			return typeof id === 'symbol' ? id.toString() : String(id);
		}

		// For value tags, get the TagId directly
		const id = tag[TagId];
		return typeof id === 'symbol' ? id.toString() : String(id);
	},
};

export type ServiceOf<T> =
	T extends ValueTag<infer S, string | symbol>
		? S
		: T extends TaggedClass<infer S, string | symbol>
			? S
			: never;
