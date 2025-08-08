import {
	DependencyContainerError,
	DependencyContainerFinalizationError,
	DependencyCreationError,
	UnknownDependencyError,
} from './errors.js';
import { AnyTag, ServiceOf, Tag } from './tag.js';
import { Factory, Finalizer } from './types.js';

export class DependencyContainer<in TReg extends AnyTag = never> {
	private readonly cache = new Map<AnyTag, Promise<unknown>>();
	private readonly factories = new Map<
		AnyTag,
		Factory<ServiceOf<AnyTag>, TReg>
	>();
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	private readonly finalizers = new Map<AnyTag, Finalizer<any>>();

	/**
	 * Register a class constructor with a factory function that returns the instance or a Promise of the instance
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
	 * Check if a dependency has been initialized
	 */
	has(tag: AnyTag): boolean {
		return this.cache.has(tag);
	}

	/**
	 * Get an instance of a dependency asynchronously, creating it if it doesn't exist.
	 */
	async get<T extends TReg>(tag: T): Promise<ServiceOf<T>> {
		// Check cache first
		const cached = this.cache.get(tag) as Promise<ServiceOf<T>> | undefined;

		if (cached !== undefined) {
			return cached;
		}

		// Get factory
		const factory = this.factories.get(tag) as
			| Factory<ServiceOf<T>, TReg>
			| undefined;

		if (factory === undefined) {
			throw new UnknownDependencyError(tag);
		}

		// Create new instance and cache the promise
		const instancePromise: Promise<ServiceOf<T>> = Promise.resolve()
			.then(() => {
				try {
					return factory(this);
				} catch (error) {
					throw new DependencyCreationError(tag, error);
				}
			})
			.then((instance) => {
				// On successful creation, ensure the promise is still in cache
				if (this.cache.get(tag) === instancePromise) {
					return instance;
				}
				// If the promise is no longer in cache, create a new one
				return this.get(tag);
			})
			.catch((error: unknown) => {
				// On failure, remove the failed promise from cache
				if (this.cache.get(tag) === instancePromise) {
					this.cache.delete(tag);
				}
				// If it's already a DependencyCreationError, rethrow it
				if (error instanceof DependencyCreationError) {
					throw error;
				}
				// Otherwise wrap it
				throw new DependencyCreationError(tag, error);
			});

		this.cache.set(tag, instancePromise);
		return instancePromise;
	}

	async destroy(): Promise<void> {
		try {
			// Destroy all finalizers in sequence, starting with the ones that were registered last
			// to ensure proper cleanup order
			const promises = Array.from(this.finalizers.entries())
				.reverse()
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
