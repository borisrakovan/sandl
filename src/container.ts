import { BaseError } from './errors.js';
import { ClassConstructor, PromiseOrValue } from './types.js';

type Factory<T, in TServices> = (
	container: DependencyContainer<TServices>
) => PromiseOrValue<T>;

type Finalizer<T> = (instance: T) => PromiseOrValue<void>;

export class DependencyContainerError extends BaseError {}

export class UnknownDependencyError extends DependencyContainerError {
	constructor(constructor: ClassConstructor) {
		super(`No factory registered for dependency ${constructor.name}`);
	}
}

export class DependencyCreationError extends DependencyContainerError {
	constructor(constructor: ClassConstructor, error: unknown) {
		super(`Error creating instance of ${constructor.name}: ${error}`, {
			cause: error,
			detail: {
				constructor: constructor.name,
			},
		});
	}
}

export class DependencyContainerFinalizationError extends DependencyContainerError {
	constructor(errors: unknown[]) {
		const lambdaErrors = errors.map((error) => BaseError.ensure(error));
		super('Error destroying dependency container', {
			cause: errors[0],
			detail: {
				errors: lambdaErrors.map((error) => error.dump()),
			},
		});
	}
}

export class DependencyContainer<in TServices = never> {
	private readonly cache = new Map<ClassConstructor, Promise<unknown>>();
	private readonly factories = new Map<
		ClassConstructor,
		Factory<InstanceType<ClassConstructor>, TServices>
	>();
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	private readonly finalizers = new Map<ClassConstructor, Finalizer<any>>();

	/**
	 * Register a class constructor with a factory function that returns the instance or a Promise of the instance
	 */
	register<T extends ClassConstructor>(
		constructor: T,
		factory: Factory<InstanceType<T>, TServices>,
		finalizer?: Finalizer<InstanceType<T>>
	): DependencyContainer<TServices | InstanceType<T>> {
		if (this.factories.has(constructor)) {
			throw new DependencyContainerError(
				`Dependency ${constructor.name} already registered`
			);
		}
		this.factories.set(constructor, factory);
		if (finalizer !== undefined) {
			this.finalizers.set(constructor, finalizer);
		}
		return this as DependencyContainer<TServices | InstanceType<T>>;
	}

	/**
	 * Check if a dependency has been initialized
	 */
	has(constructor: ClassConstructor): boolean {
		return this.cache.has(constructor);
	}

	/**
	 * Get an instance of a dependency asynchronously, creating it if it doesn't exist.
	 */
	async get<T extends TServices>(
		constructor: ClassConstructor<T>
	): Promise<T> {
		// Check cache first
		const cached = this.cache.get(constructor) as Promise<T> | undefined;

		if (cached !== undefined) {
			return cached;
		}

		// Get factory
		const factory = this.factories.get(constructor);
		if (factory === undefined) {
			throw new UnknownDependencyError(constructor);
		}

		// Create new instance and cache the promise
		const instancePromise = Promise.resolve()
			.then(() => {
				try {
					return factory(this);
				} catch (error) {
					throw new DependencyCreationError(constructor, error);
				}
			})
			.then((instance) => {
				// On successful creation, ensure the promise is still in cache
				if (this.cache.get(constructor) === instancePromise) {
					return instance;
				}
				// If the promise is no longer in cache, create a new one
				return this.get(constructor);
			})
			.catch((error: unknown) => {
				// On failure, remove the failed promise from cache
				if (this.cache.get(constructor) === instancePromise) {
					this.cache.delete(constructor);
				}
				// If it's already a DependencyCreationError, rethrow it
				if (error instanceof DependencyCreationError) {
					throw error;
				}
				// Otherwise wrap it
				throw new DependencyCreationError(constructor, error);
			});

		this.cache.set(constructor, instancePromise);
		return instancePromise as Promise<T>;
	}

	async destroy(): Promise<void> {
		try {
			// Destroy all finalizers in sequence, starting with the ones that were registered last
			// to ensure proper cleanup order
			const promises = Array.from(this.finalizers.entries())
				.reverse()
				// Only finalize dependencies that were actually created
				.filter(([constructor]) => this.has(constructor))
				.map(async ([constructor, finalizer]) => {
					const dep = await this.cache.get(constructor);
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
