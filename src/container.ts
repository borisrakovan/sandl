import { AsyncLocalStorage } from 'node:async_hooks';
import {
	CircularDependencyError,
	DependencyContainerError,
	DependencyContainerFinalizationError,
	DependencyCreationError,
	UnknownDependencyError,
} from './errors.js';
import { AnyTag, Tag, TagType } from './tag.js';
import { DefaultScope, Factory, Finalizer, Scope } from './types.js';

/**
 * AsyncLocalStorage instance used to track the dependency resolution chain.
 * This enables detection of circular dependencies during async dependency resolution.
 * @internal
 */
const resolutionChain = new AsyncLocalStorage<AnyTag[]>();

/**
 * Shared logic for dependency resolution that handles caching, circular dependency detection,
 * and error handling. Used by both BasicDependencyContainer and ScopedDependencyContainer.
 * @internal
 */
async function resolveDependency<
	T extends AnyTag,
	TReg extends AnyTag,
	TScope extends Scope,
>(
	tag: T,
	cache: Map<AnyTag, Promise<unknown>>,
	factories: Map<AnyTag, Factory<unknown, TReg, TScope>>,
	container: IContainer<TReg, TScope>
): Promise<TagType<T>> {
	// Check cache first
	const cached = cache.get(tag) as Promise<TagType<T>> | undefined;
	if (cached !== undefined) {
		return cached;
	}

	// Check for circular dependency using AsyncLocalStorage
	const currentChain = resolutionChain.getStore() ?? [];
	if (currentChain.includes(tag)) {
		throw new CircularDependencyError(tag, currentChain);
	}

	// Get factory
	const factory = factories.get(tag) as
		| Factory<TagType<T>, TReg, TScope>
		| undefined;

	if (factory === undefined) {
		throw new UnknownDependencyError(tag);
	}

	// Create and cache the promise
	const instancePromise: Promise<TagType<T>> = resolutionChain
		.run([...currentChain, tag], async () => {
			try {
				const instance = await factory(container);
				// eslint-disable-next-line @typescript-eslint/no-unsafe-return
				return instance as TagType<T>;
			} catch (error) {
				// Don't wrap CircularDependencyError, rethrow as-is
				if (error instanceof CircularDependencyError) {
					throw error;
				}
				throw new DependencyCreationError(tag, error);
			}
		})
		.catch((error: unknown) => {
			// Remove failed promise from cache on any error
			cache.delete(tag);
			throw error;
		});

	cache.set(tag, instancePromise);
	return instancePromise;
}

/**
 * Shared logic for running finalizers and handling cleanup errors.
 * @internal
 */
async function runFinalizers(
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	finalizers: Map<AnyTag, Finalizer<any>>,
	cache: Map<AnyTag, Promise<unknown>>
): Promise<void> {
	const promises = Array.from(finalizers.entries())
		// Only finalize dependencies that were actually created
		.filter(([tag]) => cache.has(tag))
		.map(async ([tag, finalizer]) => {
			const dep = await cache.get(tag);
			return finalizer(dep);
		});

	const results = await Promise.allSettled(promises);

	const failures = results.filter((result) => result.status === 'rejected');
	if (failures.length > 0) {
		throw new DependencyContainerFinalizationError(
			failures.map((result) => result.reason as unknown)
		);
	}
}

export type DependencyLifecycle<
	T extends AnyTag,
	TReg extends AnyTag,
	TScope extends Scope,
> = {
	factory: Factory<TagType<T>, TReg, TScope>;
	finalizer: Finalizer<TagType<T>>;
};

export interface IContainer<
	in TReg extends AnyTag,
	TScope extends Scope = DefaultScope,
> {
	register<T extends AnyTag>(
		tag: T,
		factoryOrLifecycle:
			| Factory<TagType<T>, TReg, TScope>
			| DependencyLifecycle<T, TReg, TScope>,
		scope?: TScope
	): IContainer<TReg | T, TScope>;

	has(tag: AnyTag): boolean;

	get<T extends TReg>(tag: T): Promise<TagType<T>>;

	destroy(): Promise<void>;
}

/**
 * A type-safe dependency injection container that manages service instantiation,
 * caching, and lifecycle management with support for async dependencies and
 * circular dependency detection.
 *
 * The container maintains complete type safety by tracking registered dependencies
 * at the type level, ensuring that only registered dependencies can be retrieved
 * and preventing runtime errors.
 *
 * @template TReg - Union type of all registered dependency tags in this container
 *
 * @example Basic usage with class tags
 * ```typescript
 * import { container, Tag } from 'sandl';
 *
 * class DatabaseService extends Tag.Class('DatabaseService') {
 *   query() { return 'data'; }
 * }
 *
 * class UserService extends Tag.Class('UserService') {
 *   constructor(private db: DatabaseService) {}
 *   getUser() { return this.db.query(); }
 * }
 *
 * const c = container()
 *   .register(DatabaseService, () => new DatabaseService())
 *   .register(UserService, async (container) =>
 *     new UserService(await container.get(DatabaseService))
 *   );
 *
 * const userService = await c.get(UserService);
 * ```
 *
 * @example Usage with value tags
 * ```typescript
 * const ApiKeyTag = Tag.of('apiKey')<string>();
 * const ConfigTag = Tag.of('config')<{ dbUrl: string }>();
 *
 * const c = container()
 *   .register(ApiKeyTag, () => process.env.API_KEY!)
 *   .register(ConfigTag, () => ({ dbUrl: 'postgresql://localhost:5432' }));
 *
 * const apiKey = await c.get(ApiKeyTag);
 * const config = await c.get(ConfigTag);
 * ```
 *
 * @example With finalizers for cleanup
 * ```typescript
 * class DatabaseConnection extends Tag.Class('DatabaseConnection') {
 *   async connect() { return; }
 *   async disconnect() { return; }
 * }
 *
 * const c = container().register(
 *   DatabaseConnection,
 *   async () => {
 *     const conn = new DatabaseConnection();
 *     await conn.connect();
 *     return conn;
 *   },
 *   async (conn) => conn.disconnect() // Finalizer for cleanup
 * );
 *
 * // Later...
 * await c.destroy(); // Calls all finalizers
 * ```
 */
export class Container<in TReg extends AnyTag> implements IContainer<TReg> {
	/**
	 * Cache of instantiated dependencies as promises.
	 * Ensures singleton behavior and supports concurrent access.
	 * @internal
	 */
	private readonly cache = new Map<AnyTag, Promise<unknown>>();

	/**
	 * Factory functions for creating dependency instances.
	 * @internal
	 */
	private readonly factories = new Map<
		AnyTag,
		Factory<unknown, TReg, DefaultScope>
	>();

	/**
	 * Finalizer functions for cleaning up dependencies when the container is destroyed.
	 * @internal
	 */
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	private readonly finalizers = new Map<AnyTag, Finalizer<any>>();

	/**
	 * Registers a dependency in the container with a factory function and optional finalizer.
	 *
	 * The factory function receives the current container instance and must return the
	 * service instance (or a Promise of it). The container tracks the registration at
	 * the type level, ensuring type safety for subsequent `.get()` calls.
	 *
	 * @template T - The dependency tag being registered
	 * @param tag - The dependency tag (class or value tag)
	 * @param factory - Function that creates the service instance, receives container for dependency injection
	 * @param finalizer - Optional cleanup function called when container is destroyed
	 * @returns A new container instance with the dependency registered
	 * @throws {DependencyContainerError} If the dependency is already registered
	 *
	 * @example Registering a simple service
	 * ```typescript
	 * class LoggerService extends Tag.Class('LoggerService') {
	 *   log(message: string) { console.log(message); }
	 * }
	 *
	 * const c = container().register(
	 *   LoggerService,
	 *   () => new LoggerService()
	 * );
	 * ```
	 *
	 * @example Registering with dependencies
	 * ```typescript
	 * class UserService extends Tag.Class('UserService') {
	 *   constructor(private db: DatabaseService, private logger: LoggerService) {}
	 * }
	 *
	 * const c = container()
	 *   .register(DatabaseService, () => new DatabaseService())
	 *   .register(LoggerService, () => new LoggerService())
	 *   .register(UserService, async (container) =>
	 *     new UserService(
	 *       await container.get(DatabaseService),
	 *       await container.get(LoggerService)
	 *     )
	 *   );
	 * ```
	 *
	 * @example Using value tags
	 * ```typescript
	 * const ConfigTag = Tag.of('config')<{ apiUrl: string }>();
	 *
	 * const c = container().register(
	 *   ConfigTag,
	 *   () => ({ apiUrl: 'https://api.example.com' })
	 * );
	 * ```
	 *
	 * @example With finalizer for cleanup
	 * ```typescript
	 * class DatabaseConnection extends Tag.Class('DatabaseConnection') {
	 *   async connect() { return; }
	 *   async close() { return; }
	 * }
	 *
	 * const c = container().register(
	 *   DatabaseConnection,
	 *   async () => {
	 *     const conn = new DatabaseConnection();
	 *     await conn.connect();
	 *     return conn;
	 *   },
	 *   (conn) => conn.close() // Called during container.destroy()
	 * );
	 * ```
	 */
	register<T extends AnyTag>(
		tag: T,
		factoryOrLifecycle:
			| Factory<TagType<T>, TReg, DefaultScope>
			| DependencyLifecycle<T, TReg, DefaultScope>
	): IContainer<TReg | T> {
		if (this.factories.has(tag)) {
			throw new DependencyContainerError(
				`Dependency ${Tag.id(tag)} already registered`
			);
		}

		if (typeof factoryOrLifecycle === 'function') {
			this.factories.set(tag, factoryOrLifecycle);
		} else {
			this.factories.set(tag, factoryOrLifecycle.factory);
			this.finalizers.set(tag, factoryOrLifecycle.finalizer);
		}

		return this as IContainer<TReg | T>;
	}

	/**
	 * Checks if a dependency has been instantiated (cached) in the container.
	 *
	 * Note: This returns `true` only after the dependency has been created via `.get()`.
	 * A registered but not-yet-instantiated dependency will return `false`.
	 *
	 * @param tag - The dependency tag to check
	 * @returns `true` if the dependency has been instantiated and cached, `false` otherwise
	 *
	 * @example
	 * ```typescript
	 * const c = container().register(DatabaseService, () => new DatabaseService());
	 *
	 * console.log(c.has(DatabaseService)); // false - not instantiated yet
	 *
	 * await c.get(DatabaseService);
	 * console.log(c.has(DatabaseService)); // true - now instantiated and cached
	 * ```
	 */
	has(tag: AnyTag): boolean {
		return this.cache.has(tag);
	}

	/**
	 * Retrieves a dependency instance from the container, creating it if necessary.
	 *
	 * This method ensures singleton behavior - each dependency is created only once
	 * and cached for subsequent calls. The method is async-safe and handles concurrent
	 * requests for the same dependency correctly.
	 *
	 * The method performs circular dependency detection using AsyncLocalStorage to track
	 * the resolution chain across async boundaries.
	 *
	 * @template T - The dependency tag type (must be registered in this container)
	 * @param tag - The dependency tag to retrieve
	 * @returns Promise resolving to the service instance
	 * @throws {UnknownDependencyError} If the dependency is not registered
	 * @throws {CircularDependencyError} If a circular dependency is detected
	 * @throws {DependencyCreationError} If the factory function throws an error
	 *
	 * @example Basic usage
	 * ```typescript
	 * const c = container()
	 *   .register(DatabaseService, () => new DatabaseService());
	 *
	 * const db = await c.get(DatabaseService);
	 * db.query('SELECT * FROM users');
	 * ```
	 *
	 * @example Concurrent access (singleton behavior)
	 * ```typescript
	 * // All three calls will receive the same instance
	 * const [db1, db2, db3] = await Promise.all([
	 *   c.get(DatabaseService),
	 *   c.get(DatabaseService),
	 *   c.get(DatabaseService)
	 * ]);
	 *
	 * console.log(db1 === db2 === db3); // true
	 * ```
	 *
	 * @example Dependency injection in factories
	 * ```typescript
	 * const c = container()
	 *   .register(DatabaseService, () => new DatabaseService())
	 *   .register(UserService, async (container) => {
	 *     const db = await container.get(DatabaseService);
	 *     return new UserService(db);
	 *   });
	 *
	 * const userService = await c.get(UserService);
	 * ```
	 */
	async get<T extends TReg>(tag: T): Promise<TagType<T>> {
		return resolveDependency(tag, this.cache, this.factories, this);
	}

	/**
	 * Destroys all instantiated dependencies by calling their finalizers, then clears the instance cache.
	 *
	 * **Important: This method preserves the container structure (factories and finalizers) for reuse.**
	 * The container can be used again after destruction to create fresh instances following the same
	 * dependency patterns.
	 *
	 * All finalizers for instantiated dependencies are called concurrently using Promise.allSettled()
	 * for maximum cleanup performance.
	 * If any finalizers fail, all errors are collected and a DependencyContainerFinalizationError
	 * is thrown containing details of all failures.
	 *
	 * **Finalizer Concurrency:** Finalizers run concurrently, so there are no ordering guarantees.
	 * Services should be designed to handle cleanup gracefully regardless of the order in which their
	 * dependencies are cleaned up.
	 *
	 * @returns Promise that resolves when all cleanup is complete
	 * @throws {DependencyContainerFinalizationError} If any finalizers fail during cleanup
	 *
	 * @example Basic cleanup and reuse
	 * ```typescript
	 * const c = container()
	 *   .register(DatabaseConnection,
	 *     async () => {
	 *       const conn = new DatabaseConnection();
	 *       await conn.connect();
	 *       return conn;
	 *     },
	 *     (conn) => conn.disconnect() // Finalizer
	 *   );
	 *
	 * // First use cycle
	 * const db1 = await c.get(DatabaseConnection);
	 * await c.destroy(); // Calls conn.disconnect(), clears cache
	 *
	 * // Container can be reused - creates fresh instances
	 * const db2 = await c.get(DatabaseConnection); // New connection
	 * expect(db2).not.toBe(db1); // Different instances
	 * ```
	 *
	 * @example Multiple destroy/reuse cycles
	 * ```typescript
	 * const c = container().register(UserService, () => new UserService());
	 *
	 * for (let i = 0; i < 5; i++) {
	 *   const user = await c.get(UserService);
	 *   // ... use service ...
	 *   await c.destroy(); // Clean up, ready for next cycle
	 * }
	 * ```
	 *
	 * @example Handling cleanup errors
	 * ```typescript
	 * try {
	 *   await container.destroy();
	 * } catch (error) {
	 *   if (error instanceof DependencyContainerFinalizationError) {
	 *     console.error('Some dependencies failed to clean up:', error.detail.errors);
	 *   }
	 * }
	 * // Container is still reusable even after finalizer errors
	 * ```
	 */
	async destroy(): Promise<void> {
		try {
			// TODO: Consider adding support for sequential cleanup in the future.
			// Some use cases (e.g., HTTP server -> services -> database) benefit from
			// ordered shutdown. Potential approaches:
			// 1. Add optional `cleanupOrder` parameter to register()
			// 2. Add `destroySequential()` method as alternative
			// 3. Support cleanup phases/groups
			// For now, concurrent cleanup forces better service design and faster shutdown.

			await runFinalizers(this.finalizers, this.cache);
		} finally {
			// Clear only the instance cache - preserve factories and finalizers for reuse
			// This allows the container to be used again with the same dependency structure
			this.cache.clear();
		}
	}
}

export class ScopedContainer<in TReg extends AnyTag, TScope extends Scope>
	implements IContainer<TReg, TScope>
{
	private readonly scope: TScope;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	private readonly parent: IContainer<any, any> | null;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	private readonly children: ScopedContainer<any, any>[] = [];

	/**
	 * Cache of instantiated dependencies as promises for this scope.
	 * @internal
	 */
	private readonly cache = new Map<AnyTag, Promise<unknown>>();

	/**
	 * Factory functions for creating dependency instances in this scope.
	 * @internal
	 */
	private readonly factories = new Map<
		AnyTag,
		Factory<unknown, TReg, TScope>
	>();

	/**
	 * Finalizer functions for cleaning up dependencies when this scope is destroyed.
	 * @internal
	 */
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	private readonly finalizers = new Map<AnyTag, Finalizer<any>>();

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	constructor(parent: IContainer<any, any> | null, scope: TScope) {
		this.parent = parent;
		this.scope = scope;
	}

	/**
	 * Registers a dependency in the specified scope within this container's scope chain.
	 *
	 * If no scope is specified, registers in the current (leaf) scope. If a scope is specified,
	 * delegates to the parent container if the target scope doesn't match the current scope.
	 *
	 * This allows registering dependencies at different scope levels from any container
	 * in the scope chain, providing flexibility for dependency organization.
	 *
	 * @param tag - The dependency tag to register
	 * @param factory - Factory function to create the dependency
	 * @param finalizer - Optional cleanup function
	 * @param scope - Target scope for registration (defaults to current scope)
	 * @returns This container with updated type information
	 *
	 * @example Registering in different scopes
	 * ```typescript
	 * const runtime = scopedContainer('runtime');
	 * const request = runtime.child('request');
	 *
	 * // Register in current (request) scope
	 * request.register(RequestService, () => new RequestService());
	 *
	 * // Register in runtime scope from request container - delegates to parent
	 * request.register(DatabaseService, () => new DatabaseService(), undefined, 'runtime');
	 * ```
	 */
	register<T extends AnyTag>(
		tag: T,
		factoryOrLifecycle:
			| Factory<TagType<T>, TReg, TScope>
			| DependencyLifecycle<T, TReg, TScope>,
		scope: TScope = this.scope
	): ScopedContainer<TReg | T, TScope> {
		// If target scope matches current scope, register here
		if (scope === this.scope) {
			if (this.factories.has(tag)) {
				throw new DependencyContainerError(
					`Dependency ${Tag.id(tag)} already registered in scope '${String(this.scope)}'`
				);
			}
			if (typeof factoryOrLifecycle === 'function') {
				this.factories.set(tag, factoryOrLifecycle);
			} else {
				this.factories.set(tag, factoryOrLifecycle.factory);
				this.finalizers.set(tag, factoryOrLifecycle.finalizer);
			}
			return this as ScopedContainer<TReg | T, TScope>;
		}

		// Target scope doesn't match current scope - delegate to parent
		if (this.parent === null) {
			throw new DependencyContainerError(
				`Scope '${String(scope)}' not found in container chain`
			);
		}

		// Delegate registration to parent container
		// The parent's register method will handle the registration
		this.parent.register(tag, factoryOrLifecycle, scope);

		// Even though we delegated, update our type to include the new dependency
		// This ensures type safety - the child container "knows" about dependencies
		// registered in parent scopes through it
		return this as ScopedContainer<TReg | T, TScope>;
	}

	/**
	 * Checks if a dependency has been instantiated in this scope or any parent scope.
	 *
	 * This method checks the current scope first, then walks up the parent chain.
	 * Returns true only if the dependency has been created and cached somewhere in the scope hierarchy.
	 */
	has(tag: AnyTag): boolean {
		// Check current scope first
		if (this.cache.has(tag)) {
			return true;
		}

		// Check parent scopes
		return this.parent?.has(tag) ?? false;
	}

	/**
	 * Retrieves a dependency instance, resolving from the current scope or parent scopes.
	 *
	 * Resolution strategy:
	 * 1. Check cache in current scope
	 * 2. Check if factory exists in current scope - if so, create instance here
	 * 3. Otherwise, delegate to parent scope
	 * 4. If no parent or parent doesn't have it, throw UnknownDependencyError
	 */
	async get<T extends TReg>(tag: T): Promise<TagType<T>> {
		// First try to resolve in current scope
		if (this.factories.has(tag)) {
			return resolveDependency(tag, this.cache, this.factories, this);
		}

		// Delegate to parent if we don't have the factory
		if (this.parent !== null) {
			return this.parent.get(tag);
		}

		// No factory found in a root scope
		throw new UnknownDependencyError(tag);
	}

	/**
	 * Destroys this scoped container and its children, preserving the container structure for reuse.
	 *
	 * This method ensures proper cleanup order while maintaining reusability:
	 * 1. Destroys all child scopes first (they may depend on parent scope dependencies)
	 * 2. Then calls finalizers for dependencies created in this scope
	 * 3. Clears only instance caches - preserves factories, finalizers, and child structure
	 *
	 * Child destruction happens first to ensure dependencies don't get cleaned up
	 * before their dependents.
	 */
	async destroy(): Promise<void> {
		const allFailures: unknown[] = [];

		try {
			// Destroy all child scopes FIRST (they may depend on our dependencies)
			const childDestroyPromises = this.children.map((child) =>
				child.destroy()
			);
			const childResults = await Promise.allSettled(childDestroyPromises);

			const childFailures = childResults
				.filter((result) => result.status === 'rejected')
				.map((result) => result.reason as unknown);

			allFailures.push(...childFailures);

			// Then run our own finalizers
			await runFinalizers(this.finalizers, this.cache);
		} catch (error) {
			// Catch our own finalizer failures
			allFailures.push(error);
		} finally {
			// Clear only the instance cache
			// Keep factories, finalizers, and children for reactivation
			this.cache.clear();
		}

		// Throw collected errors after cleanup is complete
		if (allFailures.length > 0) {
			throw new DependencyContainerFinalizationError(allFailures);
		}
	}

	/**
	 * Creates a child scoped container.
	 *
	 * Child containers inherit access to parent dependencies but maintain
	 * their own scope for new registrations and instance caching.
	 */
	child<TChildScope extends Scope>(
		scope: TChildScope
	): ScopedContainer<TReg, TScope | TChildScope> {
		const child = new ScopedContainer(this, scope);
		this.children.push(child);
		return child;
	}
}

/**
 * Creates a new empty dependency injection container.
 *
 * This is a convenience factory function that creates a new DependencyContainer instance.
 * The returned container starts with no registered dependencies and the type parameter
 * defaults to `never`, indicating no dependencies are available for retrieval yet.
 *
 * @returns A new empty DependencyContainer instance
 *
 * @example
 * ```typescript
 * import { container, Tag } from 'sandl';
 *
 * class DatabaseService extends Tag.Class('DatabaseService') {}
 * class UserService extends Tag.Class('UserService') {}
 *
 * const c = container()
 *   .register(DatabaseService, () => new DatabaseService())
 *   .register(UserService, async (container) =>
 *     new UserService(await container.get(DatabaseService))
 *   );
 *
 * const userService = await c.get(UserService);
 * ```
 */
export function container(): Container<never> {
	return new Container();
}

export function scopedContainer<TScope extends Scope>(
	scope: TScope
): ScopedContainer<never, TScope> {
	return new ScopedContainer(null, scope);
}
