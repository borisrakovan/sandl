import { AsyncLocalStorage } from 'node:async_hooks';
import {
	CircularDependencyError,
	DependencyContainerError,
	DependencyContainerFinalizationError,
	DependencyCreationError,
	UnknownDependencyError,
} from './errors.js';
import { AnyTag, ServiceOf, Tag } from './tag.js';

import { Factory, Finalizer } from './types.js';

/**
 * AsyncLocalStorage instance used to track the dependency resolution chain.
 * This enables detection of circular dependencies during async dependency resolution.
 * @internal
 */
const resolutionChain = new AsyncLocalStorage<AnyTag[]>();

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
 * import { container, Tag } from '@/di/';
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
export class DependencyContainer<TReg extends AnyTag> {
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
	private readonly factories = new Map<AnyTag, Factory<unknown, TReg>>();

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
		factory: Factory<ServiceOf<T>, TReg>,
		finalizer?: Finalizer<ServiceOf<T>>
	): DependencyContainer<TReg | T> {
		if (this.factories.has(tag)) {
			throw new DependencyContainerError(
				`Dependency ${Tag.id(tag)} already registered`
			);
		}
		this.factories.set(tag, factory);
		if (finalizer !== undefined) {
			this.finalizers.set(tag, finalizer);
		}
		return this as DependencyContainer<TReg | T>;
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
	async get<T extends TReg>(tag: T): Promise<ServiceOf<T>> {
		// Check cache first
		const cached = this.cache.get(tag) as Promise<ServiceOf<T>> | undefined;

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
			| Factory<ServiceOf<T>, TReg>
			| undefined;

		if (factory === undefined) {
			throw new UnknownDependencyError(tag);
		}

		// Create and cache the promise
		const instancePromise: Promise<ServiceOf<T>> = resolutionChain
			.run([...currentChain, tag], async () => {
				try {
					const instance = await factory(this);
					// eslint-disable-next-line @typescript-eslint/no-unsafe-return
					return instance as ServiceOf<T>;
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
				this.cache.delete(tag);
				throw error;
			});

		this.cache.set(tag, instancePromise);
		return instancePromise;
	}

	/**
	 * Destroys the container by calling all finalizers concurrently and clearing internal state.
	 *
	 * All finalizers for instantiated dependencies are called concurrently using Promise.allSettled()
	 * for maximum cleanup performance. The container state is always cleaned up even if some
	 * finalizers fail.
	 *
	 * If any finalizers fail, all errors are collected and a DependencyContainerFinalizationError
	 * is thrown containing details of all failures.
	 *
	 * **Important:** Finalizers run concurrently, so there are no ordering guarantees. Services
	 * should be designed to handle cleanup gracefully regardless of the order in which their
	 * dependencies are cleaned up.
	 *
	 * @returns Promise that resolves when all cleanup is complete
	 * @throws {DependencyContainerFinalizationError} If any finalizers fail during cleanup
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
	 * // Use the container...
	 * const db = await c.get(DatabaseConnection);
	 *
	 * // Clean up (calls conn.disconnect() concurrently with other finalizers)
	 * await c.destroy();
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
	 * ```
	 *
	 * @example Designing resilient finalizers
	 * ```typescript
	 * // Good: Handles case where dependencies might already be cleaned up
	 * const dbFinalizer = (connection) => {
	 *   try {
	 *     return connection.close();
	 *   } catch (error) {
	 *     if (error.message.includes('already closed')) return;
	 *     throw error;
	 *   }
	 * };
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

			// Run all finalizers concurrently for maximum performance
			const promises = Array.from(this.finalizers.entries())
				// Only finalize dependencies that were actually created
				.filter(([tag]) => this.has(tag))
				.map(async ([tag, finalizer]) => {
					const dep = await this.cache.get(tag);
					return finalizer(dep);
				});

			const results = await Promise.allSettled(promises);

			const failures = results.filter(
				(result) => result.status === 'rejected'
			);
			if (failures.length > 0) {
				throw new DependencyContainerFinalizationError(
					failures.map((result) => result.reason as unknown)
				);
			}
		} finally {
			// Always clean up the container, even if finalization fails
			this.finalizers.clear();
			this.cache.clear();
			this.factories.clear();
		}
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
 * import { container, Tag } from '@/di/';
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
export function container(): DependencyContainer<never> {
	return new DependencyContainer();
}
