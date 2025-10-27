/**
 * Unique symbol used to store the original ValueTag in Inject<T> types.
 * This prevents property name collisions while allowing type-level extraction.
 */
const InjectSource = Symbol('InjectSource');

/**
 * Helper type for injecting ValueTag dependencies in constructor parameters.
 * This allows clean specification of ValueTag dependencies while preserving
 * the original tag information for dependency inference.
 *
 * The phantom property is optional to allow normal runtime values to be assignable.
 *
 * @template T - A ValueTag type
 * @returns The value type with optional phantom tag metadata for dependency inference
 *
 * @example
 * ```typescript
 * const ApiKeyTag = Tag.of('apiKey')<string>();
 *
 * class UserService extends Tag.Class('UserService') {
 *   constructor(
 *     private db: DatabaseService,        // ClassTag - works automatically
 *     private apiKey: Inject<typeof ApiKeyTag>  // ValueTag - type is string, tag preserved
 *   ) {
 *     super();
 *   }
 * }
 * ```
 */
export type Inject<T extends ValueTag<unknown, string | symbol>> =
	T extends ValueTag<infer V, string | symbol>
		? V & { readonly [InjectSource]?: T }
		: never;

/**
 * Helper type to extract the original ValueTag from an Inject<T> type.
 * Since InjectSource is optional, we need to check for both presence and absence.
 * @internal
 */
export type ExtractInjectTag<T> = T extends {
	readonly [InjectSource]?: infer U;
}
	? U
	: never;

/**
 * Internal symbol used to identify tagged types within the dependency injection system.
 * This symbol is used as a property key to attach metadata to both value tags and class tags.
 * @internal
 */
export const TagId = '__tag_id__' as const;

/**
 * Type representing a value-based dependency tag.
 *
 * Value tags are used to represent non-class dependencies like configuration objects,
 * strings, numbers, or any other values. They use phantom types to maintain type safety
 * while being distinguishable at runtime through their unique identifiers.
 *
 * @template T - The type of the value this tag represents
 * @template Id - The unique identifier for this tag (string or symbol)
 *
 * @example
 * ```typescript
 * // Creates a value tag for string configuration
 * const ApiKeyTag: ValueTag<string, 'apiKey'> = Tag.of('apiKey')<string>();
 *
 * // Register in container
 * container.register(ApiKeyTag, () => 'my-secret-key');
 * ```
 */
export interface ValueTag<T, Id extends string | symbol> {
	readonly [TagId]: Id;
	/** @internal Phantom type to carry T */
	readonly __type: T;
}

/**
 * Type representing a class-based dependency tag.
 *
 * Tagged classes are created by Tag.Class() and serve as both the dependency identifier
 * and the constructor for the service. They extend regular classes with tag metadata
 * that the DI system uses for identification and type safety.
 *
 * @template T - The type of instances created by this tagged class
 * @template Id - The unique identifier for this tag (string or symbol)
 *
 * @example
 * ```typescript
 * // Creates a tagged class
 * class UserService extends Tag.Class('UserService') {
 *   getUsers() { return []; }
 * }
 *
 * // Register in container
 * container.register(UserService, () => new UserService());
 * ```
 *
 * @internal - Users should use Tag.Class() instead of working with this type directly
 */
export type TaggedClass<T, Id extends string | symbol> = {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	new (...args: any[]): T & { readonly [TagId]: Id };
	readonly [TagId]: Id;
};

/**
 * Type representing a class-based dependency tag.
 *
 * This type is a shortcut for TaggedClass<T, string | symbol>.
 *
 * @template T - The type of instances created by this tagged class
 * @returns A tagged class with a string or symbol identifier
 *
 * @internal - Users should use Tag.Class() instead of working with this type directly
 */
export type ClassTag<T> = TaggedClass<T, string | symbol>;

/**
 * Utility type that extracts the service type from any dependency tag.
 *
 * This type is essential for type inference throughout the DI system, allowing
 * the container and layers to automatically determine what type of service
 * a given tag represents without manual type annotations.
 *
 * @template T - Any dependency tag (ValueTag or TaggedClass)
 * @returns The service type that the tag represents
 *
 * @example With value tags
 * ```typescript
 * const StringTag = Tag.of('myString')<string>();
 * const ConfigTag = Tag.of('config')<{ apiKey: string }>();
 *
 * type StringService = TagType<typeof StringTag>; // string
 * type ConfigService = TagType<typeof ConfigTag>; // { apiKey: string }
 * ```
 *
 * @example With class tags
 * ```typescript
 * class UserService extends Tag.Class('UserService') {
 *   getUsers() { return []; }
 * }
 *
 * type UserServiceType = TagType<typeof UserService>; // UserService
 * ```
 *
 * @example Used in container methods
 * ```typescript
 * // The container uses TagType internally for type inference
 * container.register(StringTag, () => 'hello'); // Factory must return string
 * container.register(UserService, () => new UserService()); // Factory must return UserService
 *
 * const str: string = await container.get(StringTag); // Automatically typed as string
 * const user: UserService = await container.get(UserService); // Automatically typed as UserService
 * ```
 */
export type TagType<T> =
	T extends ValueTag<infer S, string | symbol>
		? S
		: T extends ClassTag<infer S>
			? S
			: never;

/**
 * Union type representing any valid dependency tag in the system.
 *
 * A tag can be either a value tag (for non-class dependencies) or a tagged class
 * (for service classes). This type is used throughout the DI system to constrain
 * what can be used as a dependency identifier.
 *
 * @example Value tag
 * ```typescript
 * const ConfigTag = Tag.of('config')<{ apiUrl: string }>();
 * // ConfigTag satisfies AnyTag
 * ```
 *
 * @example Class tag
 * ```typescript
 * class DatabaseService extends Tag.Class('DatabaseService') {}
 * // DatabaseService satisfies AnyTag
 * ```
 */
export type AnyTag =
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	| ValueTag<any, string | symbol>
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	| TaggedClass<any, string | symbol>;

/**
 * Utility object containing factory functions for creating dependency tags.
 *
 * The Tag object provides the primary API for creating both value tags and class tags
 * used throughout the dependency injection system. It's the main entry point for
 * defining dependencies in a type-safe way.
 */
export const Tag = {
	/**
	 * Creates a value tag factory for dependencies that are not classes.
	 *
	 * This method returns a factory function that, when called with a type parameter,
	 * creates a value tag for that type. The tag has a string or symbol-based identifier
	 * that must be unique within your application.
	 *
	 * @template Id - The string or symbol identifier for this tag (must be unique)
	 * @param id - The unique string or symbol identifier for this tag
	 * @returns A factory function that creates value tags for the specified type
	 *
	 * @example Basic usage with strings
	 * ```typescript
	 * const ApiKeyTag = Tag.of('apiKey')<string>();
	 * const ConfigTag = Tag.of('config')<{ dbUrl: string; port: number }>();
	 *
	 * container
	 *   .register(ApiKeyTag, () => process.env.API_KEY!)
	 *   .register(ConfigTag, () => ({ dbUrl: 'postgresql://localhost', port: 5432 }));
	 * ```
	 *
	 * @example Usage with symbols
	 * ```typescript
	 * const DB_CONFIG_SYM = Symbol('database-config');
	 * const ConfigTag = Tag.of(DB_CONFIG_SYM)<DatabaseConfig>();
	 *
	 * container.register(ConfigTag, () => ({ host: 'localhost', port: 5432 }));
	 * ```
	 *
	 * @example Primitive values
	 * ```typescript
	 * const PortTag = Tag.of('port')<number>();
	 * const EnabledTag = Tag.of('enabled')<boolean>();
	 *
	 * container
	 *   .register(PortTag, () => 3000)
	 *   .register(EnabledTag, () => true);
	 * ```
	 *
	 * @example Complex objects
	 * ```typescript
	 * interface DatabaseConfig {
	 *   host: string;
	 *   port: number;
	 *   database: string;
	 * }
	 *
	 * const DbConfigTag = Tag.of('database-config')<DatabaseConfig>();
	 * container.register(DbConfigTag, () => ({
	 *   host: 'localhost',
	 *   port: 5432,
	 *   database: 'myapp'
	 * }));
	 * ```
	 */
	of: <Id extends string | symbol>(id: Id) => {
		return <T>(): ValueTag<T, Id> => ({
			[TagId]: id,
			__type: undefined as T,
		});
	},

	/**
	 * Creates an anonymous value tag with a unique symbol identifier.
	 *
	 * This is useful when you want a tag that's guaranteed to be unique but don't
	 * need a human-readable identifier. Each call creates a new unique symbol,
	 * making it impossible to accidentally create duplicate tags.
	 *
	 * @template T - The type that this tag represents
	 * @returns A value tag with a unique symbol identifier
	 *
	 * @example
	 * ```typescript
	 * interface InternalConfig {
	 *   secretKey: string;
	 * }
	 *
	 * const InternalConfigTag = Tag.for<InternalConfig>();
	 *
	 * // This tag is guaranteed to be unique - no chance of conflicts
	 * container.register(InternalConfigTag, () => ({
	 *   secretKey: generateSecret()
	 * }));
	 * ```
	 *
	 * @example Multiple anonymous tags
	 * ```typescript
	 * const ConfigA = Tag.for<string>();
	 * const ConfigB = Tag.for<string>();
	 *
	 * // These are different tags even though they have the same type
	 * console.log(ConfigA === ConfigB); // false
	 * ```
	 */
	for: <T>(): ValueTag<T, symbol> => {
		return {
			[TagId]: Symbol(),
			__type: undefined as T,
		};
	},

	/**
	 * Creates a base class that can be extended to create service classes with dependency tags.
	 *
	 * This is the primary way to define service classes in the dependency injection system.
	 * Classes that extend the returned base class become both the dependency identifier
	 * and the implementation, providing type safety and clear semantics.
	 *
	 * @template Id - The unique identifier for this service class
	 * @param id - The unique identifier (string or symbol) for this service
	 * @returns A base class that can be extended to create tagged service classes
	 *
	 * @example Basic service class
	 * ```typescript
	 * class UserService extends Tag.Class('UserService') {
	 *   getUsers() {
	 *     return ['alice', 'bob'];
	 *   }
	 * }
	 *
	 * container.register(UserService, () => new UserService());
	 * ```
	 *
	 * @example Service with dependencies
	 * ```typescript
	 * class DatabaseService extends Tag.Class('DatabaseService') {
	 *   query(sql: string) { return []; }
	 * }
	 *
	 * class UserRepository extends Tag.Class('UserRepository') {
	 *   constructor(private db: DatabaseService) {
	 *     super();
	 *   }
	 *
	 *   findUser(id: string) {
	 *     return this.db.query(`SELECT * FROM users WHERE id = ${id}`);
	 *   }
	 * }
	 *
	 * container
	 *   .register(DatabaseService, () => new DatabaseService())
	 *   .register(UserRepository, async (ctx) =>
	 *     new UserRepository(await ctx.get(DatabaseService))
	 *   );
	 * ```
	 *
	 * @example With symbol identifiers
	 * ```typescript
	 * const SERVICE_ID = Symbol('InternalService');
	 *
	 * class InternalService extends Tag.Class(SERVICE_ID) {
	 *   doInternalWork() { return 'work'; }
	 * }
	 * ```
	 */
	Class: <Id extends string | symbol>(id: Id) => {
		class Tagged {
			static readonly [TagId]: Id = id;
			readonly [TagId]: Id = id;
			/** @internal */
			readonly __type: unknown;
		}
		return Tagged as TaggedClass<Tagged, Id>;
	},

	/**
	 * Extracts the string representation of a tag's identifier.
	 *
	 * This utility function returns a human-readable string for any tag's identifier,
	 * whether it's a string-based or symbol-based tag. Primarily used internally
	 * for error messages and debugging.
	 *
	 * @param tag - Any valid dependency tag (value tag or class tag)
	 * @returns String representation of the tag's identifier
	 *
	 * @example
	 * ```typescript
	 * const StringTag = Tag.of('myString')<string>();
	 * const SymbolTag = Tag.for<number>();
	 * class ServiceClass extends Tag.Class('MyService') {}
	 *
	 * console.log(Tag.id(StringTag)); // "myString"
	 * console.log(Tag.id(SymbolTag)); // "Symbol()"
	 * console.log(Tag.id(ServiceClass)); // "MyService"
	 * ```
	 *
	 * @internal - Primarily for internal use in error messages and debugging
	 */
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
