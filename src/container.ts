import { AsyncLocalStorage } from 'node:async_hooks';
import {
	CircularDependencyError,
	ContainerDestroyedError,
	DependencyAlreadyInstantiatedError,
	DependencyCreationError,
	DependencyFinalizationError,
	UnknownDependencyError,
} from './errors.js';
import { AnyTag, Tag, TagType } from './tag.js';
import { Contravariant, PromiseOrValue } from './types.js';

/**
 * AsyncLocalStorage instance used to track the dependency resolution chain.
 * This enables detection of circular dependencies during async dependency resolution.
 * @internal
 */
const resolutionChain = new AsyncLocalStorage<AnyTag[]>();

/**
 * Type representing a factory function used to create dependency instances.
 *
 * Factory functions are the core mechanism for dependency creation in the DI system.
 * They receive a dependency container and can use it to resolve other dependencies
 * that the service being created needs.
 *
 * The factory can be either synchronous (returning T directly) or asynchronous
 * (returning Promise<T>). The container handles both cases transparently.
 *
 * @template T - The type of the service instance being created
 * @template TReg - Union type of all dependencies available in the container
 *
 * @example Synchronous factory
 * ```typescript
 * const factory: Factory<DatabaseService, never> = (ctx) => {
 *   return new DatabaseService('sqlite://memory');
 * };
 * ```
 *
 * @example Asynchronous factory with dependencies
 * ```typescript
 * const factory: Factory<UserService, typeof ConfigTag | typeof DatabaseService> = async (ctx) => {
 *   const [config, db] = await Promise.all([
 *     ctx.resolve(ConfigTag),
 *     ctx.resolve(DatabaseService)
 *   ]);
 *   return new UserService(config, db);
 * };
 * ```
 */
export type Factory<T, TReg extends AnyTag> = (
	ctx: ResolutionContext<TReg>
) => PromiseOrValue<T>;

/**
 * Type representing a finalizer function used to clean up dependency instances.
 *
 * Finalizers are optional cleanup functions that are called when the container
 * is destroyed via `container.destroy()`. They receive the created instance
 * and should perform any necessary cleanup (closing connections, releasing resources, etc.).
 *
 * Like factories, finalizers can be either synchronous or asynchronous.
 * All finalizers are called concurrently during container destruction.
 *
 * @template T - The type of the service instance being finalized
 *
 * @example Synchronous finalizer
 * ```typescript
 * const finalizer: Finalizer<FileHandle> = (fileHandle) => {
 *   fileHandle.close();
 * };
 * ```
 *
 * @example Asynchronous finalizer
 * ```typescript
 * const finalizer: Finalizer<DatabaseConnection> = async (connection) => {
 *   await connection.disconnect();
 * };
 * ```
 *
 * @example Resilient finalizer
 * ```typescript
 * const finalizer: Finalizer<HttpServer> = async (server) => {
 *   try {
 *     await server.close();
 *   } catch (error) {
 *     if (!error.message.includes('already closed')) {
 *       throw error; // Re-throw unexpected errors
 *     }
 *     // Ignore "already closed" errors
 *   }
 * };
 * ```
 */
export type Finalizer<T> = (instance: T) => PromiseOrValue<void>;

/**
 * Type representing a complete dependency lifecycle with both factory and finalizer.
 *
 * This type is used when registering dependencies that need cleanup. Instead of
 * passing separate factory and finalizer parameters, you can pass an object
 * containing both.
 *
 * @template T - The dependency tag type
 * @template TReg - Union type of all dependencies available in the container
 *
 * @example Using DependencyLifecycle for registration
 * ```typescript
 * class DatabaseConnection extends Tag.Service('DatabaseConnection') {
 *   async connect() { return; }
 *   async disconnect() { return; }
 * }
 *
 * const lifecycle: DependencyLifecycle<typeof DatabaseConnection, never> = {
 *   factory: async () => {
 *     const conn = new DatabaseConnection();
 *     await conn.connect();
 *     return conn;
 *   },
 *   finalizer: async (conn) => {
 *     await conn.disconnect();
 *   }
 * };
 *
 * Container.empty().register(DatabaseConnection, lifecycle);
 * ```
 */
export type DependencyLifecycle<T, TReg extends AnyTag> = {
	factory: Factory<T, TReg>;
	finalizer: Finalizer<T>;
};

/**
 * Union type representing all valid dependency registration specifications.
 *
 * A dependency can be registered either as:
 * - A simple factory function that creates the dependency
 * - A complete lifecycle object with both factory and finalizer
 *
 * @template T - The dependency tag type
 * @template TReg - Union type of all dependencies available in the container
 *
 * @example Simple factory registration
 * ```typescript
 * const spec: DependencySpec<typeof UserService, never> =
 *   () => new UserService();
 *
 * Container.empty().register(UserService, spec);
 * ```
 *
 * @example Lifecycle registration
 * ```typescript
 * const spec: DependencySpec<typeof DatabaseConnection, never> = {
 *   factory: () => new DatabaseConnection(),
 *   finalizer: (conn) => conn.close()
 * };
 *
 * Container.empty().register(DatabaseConnection, spec);
 * ```
 */
export type DependencySpec<T extends AnyTag, TReg extends AnyTag> =
	| Factory<TagType<T>, TReg>
	| DependencyLifecycle<TagType<T>, TReg>;

/**
 * Type representing the context available to factory functions during dependency resolution.
 *
 * This type contains only the `resolve` and `resolveAll` methods from the container, which are used to retrieve
 * other dependencies during the creation of a service.
 *
 * @template TReg - Union type of all dependencies available in the container
 */
export type ResolutionContext<TReg extends AnyTag> = Pick<
	IContainer<TReg>,
	'resolve' | 'resolveAll'
>;

export const ContainerTypeId: unique symbol = Symbol.for('sandly/Container');

/**
 * Interface representing a container that can register and retrieve dependencies.
 *
 * @template TReg - Union type of all dependencies available in the container
 */
export interface IContainer<TReg extends AnyTag = never> {
	readonly [ContainerTypeId]: {
		readonly _TReg: Contravariant<TReg>;
	};

	register: <T extends AnyTag>(
		tag: T,
		spec: DependencySpec<T, TReg>
	) => IContainer<TReg | T>;

	has(tag: AnyTag): boolean;

	exists(tag: AnyTag): boolean;

	resolve: <T extends TReg>(tag: T) => Promise<TagType<T>>;

	resolveAll: <const T extends readonly TReg[]>(
		...tags: T
	) => Promise<{ [K in keyof T]: TagType<T[K]> }>;

	merge<TTarget extends AnyTag>(
		other: IContainer<TTarget>
	): IContainer<TReg | TTarget>;

	destroy(): Promise<void>;
}

// declare const ContainerBrand: unique symbol;

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
 * @example Basic usage with service tags
 * ```typescript
 * import { container, Tag } from 'sandly';
 *
 * class DatabaseService extends Tag.Service('DatabaseService') {
 *   query() { return 'data'; }
 * }
 *
 * class UserService extends Tag.Service('UserService') {
 *   constructor(private db: DatabaseService) {}
 *   getUser() { return this.db.query(); }
 * }
 *
 * const c = Container.empty()
 *   .register(DatabaseService, () => new DatabaseService())
 *   .register(UserService, async (ctx) =>
 *     new UserService(await ctx.resolve(DatabaseService))
 *   );
 *
 * const userService = await c.resolve(UserService);
 * ```
 *
 * @example Usage with value tags
 * ```typescript
 * const ApiKeyTag = Tag.of('apiKey')<string>();
 * const ConfigTag = Tag.of('config')<{ dbUrl: string }>();
 *
 * const c = Container.empty()
 *   .register(ApiKeyTag, () => process.env.API_KEY!)
 *   .register(ConfigTag, () => ({ dbUrl: 'postgresql://localhost:5432' }));
 *
 * const apiKey = await c.resolve(ApiKeyTag);
 * const config = await c.resolve(ConfigTag);
 * ```
 *
 * @example With finalizers for cleanup
 * ```typescript
 * class DatabaseConnection extends Tag.Service('DatabaseConnection') {
 *   async connect() { return; }
 *   async disconnect() { return; }
 * }
 *
 * const c = Container.empty().register(
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
	readonly [ContainerTypeId]!: {
		readonly _TReg: Contravariant<TReg>;
	};

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

	static empty(): Container<never> {
		return new Container();
	}

	/**
	 * Registers a dependency in the container with a factory function and optional finalizer.
	 *
	 * The factory function receives the current container instance and must return the
	 * service instance (or a Promise of it). The container tracks the registration at
	 * the type level, ensuring type safety for subsequent `.resolve()` calls.
	 *
	 * If a dependency is already registered, this method will override it unless the
	 * dependency has already been instantiated, in which case it will throw an error.
	 *
	 * @template T - The dependency tag being registered
	 * @param tag - The dependency tag (class or value tag)
	 * @param factory - Function that creates the service instance, receives container for dependency injection
	 * @param finalizer - Optional cleanup function called when container is destroyed
	 * @returns A new container instance with the dependency registered
	 * @throws {ContainerDestroyedError} If the container has been destroyed
	 * @throws {Error} If the dependency has already been instantiated
	 *
	 * @example Registering a simple service
	 * ```typescript
	 * class LoggerService extends Tag.Service('LoggerService') {
	 *   log(message: string) { console.log(message); }
	 * }
	 *
	 * const c = Container.empty().register(
	 *   LoggerService,
	 *   () => new LoggerService()
	 * );
	 * ```
	 *
	 * @example Registering with dependencies
	 * ```typescript
	 * class UserService extends Tag.Service('UserService') {
	 *   constructor(private db: DatabaseService, private logger: LoggerService) {}
	 * }
	 *
	 * const c = Container.empty()
	 *   .register(DatabaseService, () => new DatabaseService())
	 *   .register(LoggerService, () => new LoggerService())
	 *   .register(UserService, async (ctx) =>
	 *     new UserService(
	 *       await ctx.resolve(DatabaseService),
	 *       await ctx.resolve(LoggerService)
	 *     )
	 *   );
	 * ```
	 *
	 * @example Overriding a dependency
	 * ```typescript
	 * const c = Container.empty()
	 *   .register(DatabaseService, () => new DatabaseService())
	 *   .register(DatabaseService, () => new MockDatabaseService()); // Overrides the previous registration
	 * ```
	 *
	 * @example Using value tags
	 * ```typescript
	 * const ConfigTag = Tag.of('config')<{ apiUrl: string }>();
	 *
	 * const c = Container.empty().register(
	 *   ConfigTag,
	 *   () => ({ apiUrl: 'https://api.example.com' })
	 * );
	 * ```
	 *
	 * @example With finalizer for cleanup
	 * ```typescript
	 * class DatabaseConnection extends Tag.Service('DatabaseConnection') {
	 *   async connect() { return; }
	 *   async close() { return; }
	 * }
	 *
	 * const c = Container.empty().register(
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
		spec: DependencySpec<T, TReg>
	): Container<TReg | T> {
		if (this.isDestroyed) {
			throw new ContainerDestroyedError(
				'Cannot register dependencies on a destroyed container'
			);
		}

		// Check if dependency has been instantiated (exists in cache)
		if (this.has(tag) && this.exists(tag)) {
			throw new DependencyAlreadyInstantiatedError(
				`Cannot register dependency ${String(Tag.id(tag))} - it has already been instantiated. ` +
					`Registration must happen before any instantiation occurs, as cached instances ` +
					`would still be used by existing dependencies.`
			);
		}

		// Replace the factory and finalizer (implicit override)
		if (typeof spec === 'function') {
			this.factories.set(tag, spec);
			// Remove any existing finalizer when registering with just a factory
			this.finalizers.delete(tag);
		} else {
			this.factories.set(tag, spec.factory);
			this.finalizers.set(tag, spec.finalizer);
		}

		return this as Container<TReg | T>;
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
	 * const c = Container.empty().register(DatabaseService, () => new DatabaseService());
	 * console.log(c.has(DatabaseService)); // true
	 * ```
	 */
	has(tag: AnyTag): boolean {
		return this.factories.has(tag);
	}

	/**
	 * Checks if a dependency has been instantiated (cached) in the container.
	 *
	 * @param tag - The dependency tag to check
	 * @returns true if the dependency has been instantiated, false otherwise
	 */
	exists(tag: AnyTag): boolean {
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
	 * const c = Container.empty()
	 *   .register(DatabaseService, () => new DatabaseService());
	 *
	 * const db = await c.resolve(DatabaseService);
	 * db.query('SELECT * FROM users');
	 * ```
	 *
	 * @example Concurrent access (singleton behavior)
	 * ```typescript
	 * // All three calls will receive the same instance
	 * const [db1, db2, db3] = await Promise.all([
	 *   c.resolve(DatabaseService),
	 *   c.resolve(DatabaseService),
	 *   c.resolve(DatabaseService)
	 * ]);
	 *
	 * console.log(db1 === db2 === db3); // true
	 * ```
	 *
	 * @example Dependency injection in factories
	 * ```typescript
	 * const c = Container.empty()
	 *   .register(DatabaseService, () => new DatabaseService())
	 *   .register(UserService, async (ctx) => {
	 *     const db = await ctx.resolve(DatabaseService);
	 *     return new UserService(db);
	 *   });
	 *
	 * const userService = await c.resolve(UserService);
	 * ```
	 */
	async resolve<T extends TReg>(tag: T): Promise<TagType<T>> {
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
	 * Resolves multiple dependencies concurrently using Promise.all.
	 *
	 * This method takes a variable number of dependency tags and resolves all of them concurrently,
	 * returning a tuple with the resolved instances in the same order as the input tags.
	 * The method maintains all the same guarantees as the individual resolve method:
	 * singleton behavior, circular dependency detection, and proper error handling.
	 *
	 * @template T - The tuple type of dependency tags to resolve
	 * @param tags - Variable number of dependency tags to resolve
	 * @returns Promise resolving to a tuple of service instances in the same order
	 * @throws {ContainerDestroyedError} If the container has been destroyed
	 * @throws {UnknownDependencyError} If any dependency is not registered
	 * @throws {CircularDependencyError} If a circular dependency is detected
	 * @throws {DependencyCreationError} If any factory function throws an error
	 *
	 * @example Basic usage
	 * ```typescript
	 * const c = Container.empty()
	 *   .register(DatabaseService, () => new DatabaseService())
	 *   .register(LoggerService, () => new LoggerService());
	 *
	 * const [db, logger] = await c.resolveAll(DatabaseService, LoggerService);
	 * ```
	 *
	 * @example Mixed tag types
	 * ```typescript
	 * const ApiKeyTag = Tag.of('apiKey')<string>();
	 * const c = Container.empty()
	 *   .register(ApiKeyTag, () => 'secret-key')
	 *   .register(UserService, () => new UserService());
	 *
	 * const [apiKey, userService] = await c.resolveAll(ApiKeyTag, UserService);
	 * ```
	 *
	 * @example Empty array
	 * ```typescript
	 * const results = await c.resolveAll(); // Returns empty array
	 * ```
	 */
	async resolveAll<const T extends readonly TReg[]>(
		...tags: T
	): Promise<{ [K in keyof T]: TagType<T[K]> }> {
		if (this.isDestroyed) {
			throw new ContainerDestroyedError(
				'Cannot resolve dependencies from a destroyed container'
			);
		}

		// Use Promise.all to resolve all dependencies concurrently
		const promises = tags.map((tag) => this.resolve(tag));
		const results = await Promise.all(promises);

		// TypeScript knows this is the correct tuple type due to the generic constraint
		return results as { [K in keyof T]: TagType<T[K]> };
	}

	/**
	 * Copies all registrations from this container to a target container.
	 *
	 * @internal
	 * @param target - The container to copy registrations to
	 * @throws {ContainerDestroyedError} If this container has been destroyed
	 */
	copyTo<TTarget extends AnyTag>(target: Container<TTarget>): void {
		if (this.isDestroyed) {
			throw new ContainerDestroyedError(
				'Cannot copy registrations from a destroyed container'
			);
		}

		// Copy all factories and finalizers
		for (const [tag, factory] of this.factories) {
			const finalizer = this.finalizers.get(tag);
			if (finalizer) {
				target.register(tag, { factory, finalizer });
			} else {
				target.register(tag, factory);
			}
		}
	}

	/**
	 * Creates a new container by merging this container's registrations with another container.
	 *
	 * This method creates a new container that contains all registrations from both containers.
	 * If there are conflicts (same dependency registered in both containers), this
	 * container's registration will take precedence.
	 *
	 * **Important**: Only the registrations are copied, not any cached instances.
	 * The new container starts with an empty instance cache.
	 *
	 * @param other - The container to merge with
	 * @returns A new container with combined registrations
	 * @throws {ContainerDestroyedError} If this container has been destroyed
	 *
	 * @example Merging containers
	 * ```typescript
	 * const container1 = Container.empty()
	 *   .register(DatabaseService, () => new DatabaseService());
	 *
	 * const container2 = Container.empty()
	 *   .register(UserService, () => new UserService());
	 *
	 * const merged = container1.merge(container2);
	 * // merged has both DatabaseService and UserService
	 * ```
	 */
	merge<TTarget extends AnyTag>(
		other: Container<TTarget>
	): Container<TReg | TTarget> {
		if (this.isDestroyed) {
			throw new ContainerDestroyedError(
				'Cannot merge from a destroyed container'
			);
		}

		// Create new container
		const merged = new Container();

		// Copy from other first
		other.copyTo(merged);
		// Then copy from this (will override conflicts)
		this.copyTo(merged);

		return merged as Container<TReg | TTarget>;
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
	 * const c = Container.empty()
	 *   .register(DatabaseConnection,
	 *     async () => {
	 *       const conn = new DatabaseConnection();
	 *       await conn.connect();
	 *       return conn;
	 *     },
	 *     (conn) => conn.disconnect() // Finalizer
	 *   );
	 *
	 * const db = await c.resolve(DatabaseConnection);
	 * await c.destroy(); // Calls conn.disconnect(), container becomes unusable
	 *
	 * // This will throw an error
	 * try {
	 *   await c.resolve(DatabaseConnection);
	 * } catch (error) {
	 *   console.log(error.message); // "Cannot resolve dependencies from a destroyed container"
	 * }
	 * ```
	 *
	 * @example Application shutdown
	 * ```typescript
	 * const appContainer Container.empty
	 *   .register(DatabaseService, () => new DatabaseService())
	 *   .register(HTTPServer, async (ctx) => new HTTPServer(await ctx.resolve(DatabaseService)));
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
			const promises = Array.from(this.finalizers.entries())
				// Only finalize dependencies that were actually created
				.filter(([tag]) => this.cache.has(tag))
				.map(async ([tag, finalizer]) => {
					const dep = await this.cache.get(tag);
					return finalizer(dep);
				});

			const results = await Promise.allSettled(promises);

			const failures = results.filter(
				(result) => result.status === 'rejected'
			);
			if (failures.length > 0) {
				throw new DependencyFinalizationError(
					failures.map((result) => result.reason as unknown)
				);
			}
		} finally {
			// Mark as destroyed and clear all state
			this.isDestroyed = true;
			this.cache.clear();
			// Note: We keep factories/finalizers for potential debugging,
			// but the container is no longer usable
		}
	}
}
