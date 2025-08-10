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

// AsyncLocalStorage to track dependency resolution chain
const resolutionChain = new AsyncLocalStorage<AnyTag[]>();

export class DependencyContainer<TReg extends AnyTag = never> {
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
					return instance;
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

export function container(): DependencyContainer {
	return new DependencyContainer();
}
