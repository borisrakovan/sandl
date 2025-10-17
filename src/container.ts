import { AsyncLocalStorage } from 'node:async_hooks';
import {
	CircularDependencyError,
	ContainerDestroyedError,
	DependencyAlreadyRegisteredError,
	DependencyCreationError,
	DependencyFinalizationError,
	UnknownDependencyError,
} from './errors.js';
import { AnyTag, Tag, TagType } from './tag.js';
import { Factory, Finalizer, Scope } from './types.js';

/**
 * AsyncLocalStorage instance used to track the dependency resolution chain.
 * This enables detection of circular dependencies during async dependency resolution.
 * @internal
 */
const resolutionChain = new AsyncLocalStorage<AnyTag[]>();

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
		throw new DependencyFinalizationError(
			failures.map((result) => result.reason as unknown)
		);
	}
}

export type DependencyLifecycle<T extends AnyTag, TReg extends AnyTag> = {
	factory: Factory<TagType<T>, TReg>;
	finalizer: Finalizer<TagType<T>>;
};

export interface IContainer<in TReg extends AnyTag> {
	register<T extends AnyTag>(
		tag: T,
		factoryOrLifecycle:
			| Factory<TagType<T>, TReg>
			| DependencyLifecycle<T, TReg>
	): IContainer<TReg | T>;

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
export class Container<TReg extends AnyTag> implements IContainer<TReg> {
	/**
	 * Cache of instantiated dependencies as promises.
	 * Ensures singleton behavior and supports concurrent access.
	 * @internal
	 */
	protected readonly cache = new Map<AnyTag, Promise<unknown>>();

	/**
	 * Factory functions for creating dependency instances.
	 * @internal
	 */
	protected readonly factories = new Map<AnyTag, Factory<unknown, TReg>>();

	/**
	 * Finalizer functions for cleaning up dependencies when the container is destroyed.
	 * @internal
	 */
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	protected readonly finalizers = new Map<AnyTag, Finalizer<any>>();

	/**
	 * Flag indicating whether this container has been destroyed.
	 * @internal
	 */
	protected isDestroyed = false;

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
	 * @throws {ContainerError} If the dependency is already registered
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
			| Factory<TagType<T>, TReg>
			| DependencyLifecycle<T, TReg>
	): IContainer<TReg | T> {
		if (this.isDestroyed) {
			throw new ContainerDestroyedError(
				'Cannot register dependencies on a destroyed container'
			);
		}

		if (this.factories.has(tag)) {
			throw new DependencyAlreadyRegisteredError(
				`Dependency ${Tag.id(tag)} already registered in the container`
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
	 * Checks if a dependency has been registered in the container.
	 *
	 * This returns `true` if the dependency has been registered via `.register()`,
	 * regardless of whether it has been instantiated yet.
	 *
	 * @param tag - The dependency tag to check
	 * @returns `true` if the dependency has been registered, `false` otherwise
	 *
	 * @example
	 * ```typescript
	 * const c = container().register(DatabaseService, () => new DatabaseService());
	 * console.log(c.has(DatabaseService)); // true
	 * ```
	 */
	has(tag: AnyTag): boolean {
		return this.factories.has(tag);
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
		if (this.isDestroyed) {
			throw new ContainerDestroyedError(
				'Cannot resolve dependencies from a destroyed container'
			);
		}

		// Check cache first
		const cached = this.cache.get(tag) as Promise<TagType<T>> | undefined;
		if (cached !== undefined) {
			return cached;
		}

		// Check for circular dependency using AsyncLocalStorage
		const currentChain = resolutionChain.getStore() ?? [];
		if (currentChain.includes(tag)) {
			throw new CircularDependencyError(tag, currentChain);
		}

		// Get factory
		const factory = this.factories.get(tag) as
			| Factory<TagType<T>, TReg>
			| undefined;

		if (factory === undefined) {
			throw new UnknownDependencyError(tag);
		}

		// Create and cache the promise
		const instancePromise: Promise<TagType<T>> = resolutionChain
			.run([...currentChain, tag], async () => {
				try {
					const instance = await factory(this);
					// eslint-disable-next-line @typescript-eslint/no-unsafe-return
					return instance as TagType<T>;
				} catch (error) {
					throw new DependencyCreationError(tag, error);
				}
			})
			.catch((error: unknown) => {
				// Remove failed promise from cache on any error
				this.cache.delete(tag);
				throw error;
			});

		this.cache.set(tag, instancePromise);
		return instancePromise;
	}

	/**
	 * Destroys all instantiated dependencies by calling their finalizers and makes the container unusable.
	 *
	 * **Important: After calling destroy(), the container becomes permanently unusable.**
	 * Any subsequent calls to register(), get(), or destroy() will throw a ContainerError.
	 * This ensures proper cleanup and prevents runtime errors from accessing destroyed resources.
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
	 * @throws {DependencyFinalizationError} If any finalizers fail during cleanup
	 *
	 * @example Basic cleanup
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
	 * const db = await c.get(DatabaseConnection);
	 * await c.destroy(); // Calls conn.disconnect(), container becomes unusable
	 *
	 * // This will throw an error
	 * try {
	 *   await c.get(DatabaseConnection);
	 * } catch (error) {
	 *   console.log(error.message); // "Cannot resolve dependencies from a destroyed container"
	 * }
	 * ```
	 *
	 * @example Application shutdown
	 * ```typescript
	 * const appContainer = container()
	 *   .register(DatabaseService, () => new DatabaseService())
	 *   .register(HTTPServer, async (c) => new HTTPServer(await c.get(DatabaseService)));
	 *
	 * // During application shutdown
	 * process.on('SIGTERM', async () => {
	 *   try {
	 *     await appContainer.destroy(); // Clean shutdown of all services
	 *   } catch (error) {
	 *     console.error('Error during shutdown:', error);
	 *   }
	 *   process.exit(0);
	 * });
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
	 * // Container is destroyed regardless of finalizer errors
	 * ```
	 */
	async destroy(): Promise<void> {
		if (this.isDestroyed) {
			return; // Already destroyed, nothing to do
		}

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
			// Mark as destroyed and clear all state
			this.isDestroyed = true;
			this.cache.clear();
			// Note: We keep factories/finalizers for potential debugging,
			// but the container is no longer usable
		}
	}
}

export class ScopedContainer<TReg extends AnyTag> extends Container<TReg> {
	public readonly scope: Scope;

	private parent: IContainer<TReg> | null;
	private readonly children: WeakRef<ScopedContainer<TReg>>[] = [];

	constructor(parent: IContainer<TReg> | null, scope: Scope) {
		super();
		this.parent = parent;
		this.scope = scope;
	}

	/**
	 * Checks if a dependency has been registered in this scope or any parent scope.
	 *
	 * This method checks the current scope first, then walks up the parent chain.
	 * Returns true if the dependency has been registered somewhere in the scope hierarchy.
	 */
	override has(tag: AnyTag): boolean {
		// Check current scope first
		if (super.has(tag)) {
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
	override async get<T extends TReg>(tag: T): Promise<TagType<T>> {
		// If this scope has a factory, resolve here (uses this scope's cache)
		if (this.factories.has(tag)) {
			return super.get(tag);
		}

		// Otherwise delegate to parent scope if available
		if (this.parent !== null) {
			return this.parent.get(tag);
		}

		// Not found in this scope or any parent
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
	override async destroy(): Promise<void> {
		if (this.isDestroyed) {
			return; // Already destroyed, nothing to do
		}

		const allFailures: unknown[] = [];

		try {
			// Destroy all child scopes FIRST (they may depend on our dependencies)
			const childDestroyPromises = this.children
				.map((weakRef) => weakRef.deref())
				.filter(
					(child): child is ScopedContainer<TReg> =>
						child !== undefined
				)
				.map((child) => child.destroy());

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
			// Mark as destroyed and break parent chain for GC
			this.isDestroyed = true;
			this.parent = null;
			this.cache.clear();
			// Note: We keep factories/finalizers for potential debugging,
			// but the container is no longer usable
		}

		// Throw collected errors after cleanup is complete
		if (allFailures.length > 0) {
			throw new DependencyFinalizationError(allFailures);
		}
	}

	/**
	 * Creates a child scoped container.
	 *
	 * Child containers inherit access to parent dependencies but maintain
	 * their own scope for new registrations and instance caching.
	 */
	child(scope: Scope): ScopedContainer<TReg> {
		if (this.isDestroyed) {
			throw new ContainerDestroyedError(
				'Cannot create child containers from a destroyed container'
			);
		}

		const child = new ScopedContainer(this, scope);
		this.children.push(new WeakRef(child));
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

/**
 * Creates a new scoped dependency injection container with the given scope name.
 *
 * Scoped containers allow hierarchical dependency management where child scopes
 * can inherit dependencies from parent scopes while maintaining their own
 * isolated registrations and instance caches.
 *
 * @param scope - A string identifier for this scope (used for debugging)
 * @returns A new empty ScopedContainer instance
 *
 * @example
 * ```typescript
 * import { scopedContainer, Tag } from 'sandl';
 *
 * const appContainer = scopedContainer('app');
 * const requestContainer = appContainer.child('request');
 *
 * // App-level services
 * appContainer.register(DatabaseService, () => new DatabaseService());
 *
 * // Request-level services that can access app services
 * requestScope.register(UserService, async (container) =>
 *   new UserService(await container.get(DatabaseService))
 * );
 * ```
 */
export function scopedContainer(scope: string): ScopedContainer<never> {
	return new ScopedContainer(null, scope);
}
