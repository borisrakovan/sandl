import { AnyTag, Tag } from './tag.js';

export type ErrorProps = {
	cause?: unknown;
	detail?: Record<string, unknown>;
};

export type ErrorDump = {
	name: string;
	message: string;
	stack?: string;
	error: {
		name: string;
		message: string;
		detail: Record<string, unknown>;
		cause?: unknown;
	};
};

export class BaseError extends Error {
	detail: Record<string, unknown> | undefined;

	constructor(message: string, { cause, detail }: ErrorProps = {}) {
		super(message, { cause });
		this.name = this.constructor.name;
		this.detail = detail;
		// Use cause stack if available, otherwise fall back to the current error's stack
		if (cause instanceof Error && cause.stack !== undefined) {
			this.stack = `${this.stack}\nCaused by: ${cause.stack}`;
		}
	}

	static ensure(error: unknown): BaseError {
		return error instanceof BaseError
			? error
			: new BaseError('An unknown error occurred', { cause: error });
	}

	dump(): ErrorDump {
		// Only show the stack trace of the top-level error
		const cause =
			this.cause instanceof BaseError
				? this.cause.dump().error
				: this.cause;

		const result: ErrorDump['error'] = {
			name: this.name,
			message: this.message,
			cause,
			detail: this.detail ?? {},
		};

		return {
			name: this.name,
			message: result.message,
			stack: this.stack,
			error: result,
		};
	}

	dumps(): string {
		return JSON.stringify(this.dump());
	}
}

/**
 * Base error class for all dependency container related errors.
 *
 * This extends the framework's BaseError to provide consistent error handling
 * and structured error information across the dependency injection system.
 *
 * @example Catching DI errors
 * ```typescript
 * try {
 *   await container.get(SomeService);
 * } catch (error) {
 *   if (error instanceof DependencyContainerError) {
 *     console.error('DI Error:', error.message);
 *     console.error('Details:', error.detail);
 *   }
 * }
 * ```
 */
export class DependencyContainerError extends BaseError {}

/**
 * Error thrown when attempting to retrieve a dependency that hasn't been registered.
 *
 * This error occurs when calling `container.get(Tag)` for a tag that was never
 * registered via `container.register()`. It indicates a programming error where
 * the dependency setup is incomplete.
 *
 * @example
 * ```typescript
 * const c = container(); // Empty container
 *
 * try {
 *   await c.get(UnregisteredService); // This will throw
 * } catch (error) {
 *   if (error instanceof UnknownDependencyError) {
 *     console.error('Missing dependency:', error.message);
 *   }
 * }
 * ```
 */
export class UnknownDependencyError extends DependencyContainerError {
	/**
	 * @internal
	 * Creates an UnknownDependencyError for the given tag.
	 *
	 * @param tag - The dependency tag that wasn't found
	 */
	constructor(tag: AnyTag) {
		super(`No factory registered for dependency ${Tag.id(tag)}`);
	}
}

/**
 * Error thrown when a circular dependency is detected during dependency resolution.
 *
 * This occurs when service A depends on service B, which depends on service A (directly
 * or through a chain of dependencies). The error includes the full dependency chain
 * to help identify the circular reference.
 *
 * @example Circular dependency scenario
 * ```typescript
 * class ServiceA extends Tag.Class('ServiceA') {}
 * class ServiceB extends Tag.Class('ServiceB') {}
 *
 * const c = container()
 *   .register(ServiceA, async (container) =>
 *     new ServiceA(await container.get(ServiceB)) // Depends on B
 *   )
 *   .register(ServiceB, async (container) =>
 *     new ServiceB(await container.get(ServiceA)) // Depends on A - CIRCULAR!
 *   );
 *
 * try {
 *   await c.get(ServiceA);
 * } catch (error) {
 *   if (error instanceof CircularDependencyError) {
 *     console.error('Circular dependency:', error.message);
 *     // Output: "Circular dependency detected for ServiceA: ServiceA -> ServiceB -> ServiceA"
 *   }
 * }
 * ```
 */
export class CircularDependencyError extends DependencyContainerError {
	/**
	 * @internal
	 * Creates a CircularDependencyError with the dependency chain information.
	 *
	 * @param tag - The tag where the circular dependency was detected
	 * @param dependencyChain - The chain of dependencies that led to the circular reference
	 */
	constructor(tag: AnyTag, dependencyChain: AnyTag[]) {
		const chain = dependencyChain.map((t) => Tag.id(t)).join(' -> ');
		super(
			`Circular dependency detected for ${Tag.id(tag)}: ${chain} -> ${Tag.id(tag)}`,
			{
				detail: {
					tag: Tag.id(tag),
					dependencyChain: dependencyChain.map((t) => Tag.id(t)),
				},
			}
		);
	}
}

/**
 * Error thrown when a dependency factory function throws an error during instantiation.
 *
 * This wraps the original error with additional context about which dependency
 * failed to be created. The original error is preserved as the `cause` property.
 *
 * @example Factory throwing error
 * ```typescript
 * class DatabaseService extends Tag.Class('DatabaseService') {}
 *
 * const c = container().register(DatabaseService, () => {
 *   throw new Error('Database connection failed');
 * });
 *
 * try {
 *   await c.get(DatabaseService);
 * } catch (error) {
 *   if (error instanceof DependencyCreationError) {
 *     console.error('Failed to create:', error.message);
 *     console.error('Original error:', error.cause);
 *   }
 * }
 * ```
 */
export class DependencyCreationError extends DependencyContainerError {
	/**
	 * @internal
	 * Creates a DependencyCreationError wrapping the original factory error.
	 *
	 * @param tag - The tag of the dependency that failed to be created
	 * @param error - The original error thrown by the factory function
	 */
	constructor(tag: AnyTag, error: unknown) {
		super(`Error creating instance of ${Tag.id(tag)}: ${error}`, {
			cause: error,
			detail: {
				tag: Tag.id(tag),
			},
		});
	}
}

/**
 * Error thrown when one or more finalizers fail during container destruction.
 *
 * This error aggregates multiple finalizer failures that occurred during
 * `container.destroy()`. Even if some finalizers fail, the container cleanup
 * process continues and this error contains details of all failures.
 *
 * @example Handling finalization errors
 * ```typescript
 * try {
 *   await container.destroy();
 * } catch (error) {
 *   if (error instanceof DependencyContainerFinalizationError) {
 *     console.error('Some finalizers failed');
 *     console.error('Error details:', error.detail.errors);
 *   }
 * }
 * ```
 */
export class DependencyContainerFinalizationError extends DependencyContainerError {
	/**
	 * @internal
	 * Creates a DependencyContainerFinalizationError aggregating multiple finalizer failures.
	 *
	 * @param errors - Array of errors thrown by individual finalizers
	 */
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
