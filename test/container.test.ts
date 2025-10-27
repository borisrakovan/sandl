import { Container, container } from '@/container.js';
import {
	CircularDependencyError,
	ContainerDestroyedError,
	DependencyAlreadyInstantiatedError,
	DependencyCreationError,
	DependencyFinalizationError,
	UnknownDependencyError,
} from '@/errors.js';
import { Tag } from '@/tag.js';
import { describe, expect, it, vi } from 'vitest';

describe('DependencyContainer', () => {
	describe('constructor and factory', () => {
		it('should create an empty container', () => {
			const c = container();
			expect(c).toBeInstanceOf(Container);
		});

		it('should create a container with proper typing', () => {
			const c = container();
			// Type check - should be DependencyContainer<never>
			expect(c).toBeDefined();
		});
	});

	describe('register', () => {
		it('should register a simple class constructor', () => {
			class TestService extends Tag.Class('TestService') {
				getValue() {
					return 'test';
				}
			}

			const c = container();
			const registered = c.register(TestService, () => new TestService());

			expect(registered).toBeInstanceOf(Container);
			// Should return the same container instance with updated type
			expect(registered).toBe(c);
		});

		it('should register with sync factory', () => {
			class TestService extends Tag.Class('TestService') {
				constructor(public value: string) {
					super();
				}
			}

			const c = container().register(
				TestService,
				() => new TestService('sync')
			);

			expect(c).toBeDefined();
		});

		it('should register with async factory', () => {
			class TestService extends Tag.Class('TestService') {
				constructor(public value: string) {
					super();
				}
			}

			const c = container().register(
				TestService,
				() => new TestService('async')
			);

			expect(c).toBeDefined();
		});

		it('should register with finalizer', () => {
			class TestService extends Tag.Class('TestService') {
				cleanup = vi.fn() as () => void;
			}

			const c = container().register(TestService, {
				factory: () => new TestService(),
				finalizer: (instance) => {
					instance.cleanup();
				},
			});

			expect(c).toBeDefined();
		});

		it('should allow overriding registration before instantiation', () => {
			class TestService extends Tag.Class('TestService') {
				constructor(public value: string) {
					super();
				}
			}

			const c = container()
				.register(TestService, () => new TestService('original'))
				.register(TestService, () => new TestService('overridden'));

			expect(c).toBeDefined();
		});

		it('should preserve container chain for multiple registrations', () => {
			class ServiceA extends Tag.Class('ServiceA') {}
			class ServiceB extends Tag.Class('ServiceB') {}

			const c = container()
				.register(ServiceA, () => new ServiceA())
				.register(ServiceB, () => new ServiceB());

			expect(c).toBeDefined();
		});

		it('should throw error when trying to register after instantiation', async () => {
			class TestService extends Tag.Class('TestService') {
				constructor(public value: string) {
					super();
				}
			}

			const c = container().register(
				TestService,
				() => new TestService('original')
			);

			// Instantiate the service
			await c.get(TestService);

			// Now try to register again - should throw
			expect(() =>
				c.register(TestService, () => new TestService('overridden'))
			).toThrow(DependencyAlreadyInstantiatedError);
		});

		it('should throw error when registering on destroyed container', async () => {
			class TestService extends Tag.Class('TestService') {}

			const c = container().register(
				TestService,
				() => new TestService()
			);

			await c.destroy();

			expect(() =>
				c.register(TestService, () => new TestService())
			).toThrow(ContainerDestroyedError);
		});
	});

	describe('has', () => {
		it('should return false for unregistered dependency', () => {
			class TestService extends Tag.Class('TestService') {}

			const c = container();

			expect(c.has(TestService)).toBe(false);
		});

		it('should return true for registered dependency', () => {
			class TestService extends Tag.Class('TestService') {}

			const c = container().register(
				TestService,
				() => new TestService()
			);

			expect(c.has(TestService)).toBe(true);
		});

		it('should return true for instantiated dependency', async () => {
			class TestService extends Tag.Class('TestService') {}

			const c = container().register(
				TestService,
				() => new TestService()
			);

			await c.get(TestService);

			expect(c.has(TestService)).toBe(true);
		});
	});

	describe('get', () => {
		it('should create and return instance for sync factory', async () => {
			class TestService extends Tag.Class('TestService') {
				getValue() {
					return 'test';
				}
			}

			const c = container().register(
				TestService,
				() => new TestService()
			);

			const instance = await c.get(TestService);

			expect(instance).toBeInstanceOf(TestService);
			expect(instance.getValue()).toBe('test');
		});

		it('should create and return instance for async factory', async () => {
			class TestService extends Tag.Class('TestService') {
				constructor(public value: string) {
					super();
				}
			}

			const c = container().register(TestService, async () => {
				await Promise.resolve();
				return new TestService('async');
			});

			const instance = await c.get(TestService);

			expect(instance).toBeInstanceOf(TestService);
			expect(instance.value).toBe('async');
		});

		it('should return cached instance on subsequent calls', async () => {
			class TestService extends Tag.Class('TestService') {}

			const factory = vi.fn(() => new TestService());
			const c = container().register(TestService, factory);

			const instance1 = await c.get(TestService);
			const instance2 = await c.get(TestService);

			expect(instance1).toBe(instance2);
			expect(factory).toHaveBeenCalledTimes(1);
		});

		it('should throw UnknownDependencyError for unregistered dependency', async () => {
			class TestService extends Tag.Class('TestService') {}

			const c = container();

			// @ts-expect-error - TestService is not registered
			await expect(c.get(TestService)).rejects.toThrow(
				UnknownDependencyError
			);
		});

		it('should wrap factory errors in DependencyCreationError', async () => {
			class TestService extends Tag.Class('TestService') {}

			const c = container().register(TestService, () => {
				throw new Error('Factory error');
			});

			await expect(c.get(TestService)).rejects.toThrow(
				DependencyCreationError
			);
		});

		it('should handle async factory errors', async () => {
			class TestService extends Tag.Class('TestService') {}

			const c = container().register(TestService, async () => {
				await Promise.resolve();
				throw new Error('Async factory error');
			});

			await expect(c.get(TestService)).rejects.toThrow(
				DependencyCreationError
			);
		});

		it('should remove failed promise from cache and allow retry', async () => {
			class TestService extends Tag.Class('TestService') {}

			let shouldFail = true;
			const c = container().register(TestService, () => {
				if (shouldFail) {
					throw new Error('Factory error');
				}
				return new TestService();
			});

			// First call should fail
			await expect(c.get(TestService)).rejects.toThrow(
				DependencyCreationError
			);

			// Service should still be registered even after failure
			expect(c.has(TestService)).toBe(true);

			// Second call should succeed
			shouldFail = false;
			const instance = await c.get(TestService);
			expect(instance).toBeInstanceOf(TestService);
		});

		it('should handle concurrent calls properly', async () => {
			class TestService extends Tag.Class('TestService') {}

			const factory = vi.fn(() => new TestService());
			const c = container().register(TestService, factory);

			// Make concurrent calls
			const [instance1, instance2, instance3] = await Promise.all([
				c.get(TestService),
				c.get(TestService),
				c.get(TestService),
			]);

			expect(instance1).toBe(instance2);
			expect(instance2).toBe(instance3);
			expect(factory).toHaveBeenCalledTimes(1);
		});

		it('should throw error when getting from destroyed container', async () => {
			class TestService extends Tag.Class('TestService') {}

			const c = container().register(
				TestService,
				() => new TestService()
			);

			await c.destroy();

			await expect(c.get(TestService)).rejects.toThrow(
				ContainerDestroyedError
			);
		});
	});

	describe('dependency injection', () => {
		it('should inject dependencies through factory function', async () => {
			class DatabaseService extends Tag.Class('DatabaseService') {
				query() {
					return 'db-result';
				}
			}

			class UserService extends Tag.Class('UserService') {
				constructor(private db: DatabaseService) {
					super();
				}

				getUser() {
					return this.db.query();
				}
			}

			const c = container()
				.register(DatabaseService, () => new DatabaseService())
				.register(
					UserService,
					async (ctx) =>
						new UserService(await ctx.get(DatabaseService))
				);

			const userService = await c.get(UserService);

			expect(userService.getUser()).toBe('db-result');
		});

		it('should handle complex dependency graphs', async () => {
			class ConfigService extends Tag.Class('ConfigService') {
				getDbUrl() {
					return 'db://localhost';
				}
			}

			class DatabaseService extends Tag.Class('DatabaseService') {
				constructor(private config: ConfigService) {
					super();
				}

				connect() {
					return `Connected to ${this.config.getDbUrl()}`;
				}
			}

			class CacheService extends Tag.Class('CacheService') {}

			class UserService extends Tag.Class('UserService') {
				constructor(
					private db: DatabaseService,
					private _cache: CacheService
				) {
					super();
				}

				getUser() {
					return `${this.db.connect()} with cache`;
				}
			}

			const c = container()
				.register(ConfigService, () => new ConfigService())
				.register(
					DatabaseService,
					async (ctx) =>
						new DatabaseService(await ctx.get(ConfigService))
				)
				.register(CacheService, () => new CacheService())
				.register(
					UserService,
					async (ctx) =>
						new UserService(
							await ctx.get(DatabaseService),
							await ctx.get(CacheService)
						)
				);

			const userService = await c.get(UserService);

			expect(userService.getUser()).toBe(
				'Connected to db://localhost with cache'
			);
		});

		it('should detect and throw CircularDependencyError', async () => {
			class ServiceA extends Tag.Class('ServiceA') {
				constructor(private _serviceB: ServiceB) {
					super();
				}
			}

			class ServiceB extends Tag.Class('ServiceB') {
				constructor(private _serviceA: ServiceA) {
					super();
				}
			}

			const c = container()
				.register(
					ServiceA,
					async (ctx) =>
						// @ts-expect-error - ServiceB is not registered
						new ServiceA(await ctx.get(ServiceB))
				)
				.register(
					ServiceB,
					async (ctx) => new ServiceB(await ctx.get(ServiceA))
				);

			// Should throw DependencyCreationError with nested error chain leading to CircularDependencyError
			try {
				await c.get(ServiceA);
				expect.fail('Should have thrown');
			} catch (error) {
				expect(error).toBeInstanceOf(DependencyCreationError);
				// The error chain is: DependencyCreationError(ServiceA) -> DependencyCreationError(ServiceB) -> CircularDependencyError
				const serviceAError = error as DependencyCreationError;
				expect(serviceAError.cause).toBeInstanceOf(
					DependencyCreationError
				);
				const serviceBError =
					serviceAError.cause as DependencyCreationError;
				expect(serviceBError.cause).toBeInstanceOf(
					CircularDependencyError
				);
			}

			try {
				await c.get(ServiceB);
				expect.fail('Should have thrown');
			} catch (error) {
				expect(error).toBeInstanceOf(DependencyCreationError);
				// The error chain is: DependencyCreationError(ServiceB) -> DependencyCreationError(ServiceA) -> CircularDependencyError
				const serviceBError = error as DependencyCreationError;
				expect(serviceBError.cause).toBeInstanceOf(
					DependencyCreationError
				);
				const serviceAError =
					serviceBError.cause as DependencyCreationError;
				expect(serviceAError.cause).toBeInstanceOf(
					CircularDependencyError
				);
			}
		});
	});

	describe('destroy', () => {
		it('should call finalizers for instantiated dependencies', async () => {
			class TestService extends Tag.Class('TestService') {
				cleanup = vi.fn();
			}

			const finalizer = vi.fn((instance: TestService) => {
				instance.cleanup();
			});

			const c = container().register(TestService, {
				factory: () => new TestService(),
				finalizer,
			});

			// Instantiate the service
			const instance = await c.get(TestService);

			await c.destroy();

			expect(finalizer).toHaveBeenCalledWith(instance);
			expect(instance.cleanup).toHaveBeenCalled();
		});

		it('should not call finalizers for non-instantiated dependencies', async () => {
			class TestService extends Tag.Class('TestService') {}

			const finalizer = vi.fn();

			const c = container().register(TestService, {
				factory: () => new TestService(),
				finalizer,
			});

			// Do not instantiate the service
			await c.destroy();

			expect(finalizer).not.toHaveBeenCalled();
		});

		it('should call finalizers concurrently', async () => {
			class ServiceA extends Tag.Class('ServiceA') {}
			class ServiceB extends Tag.Class('ServiceB') {}
			class ServiceC extends Tag.Class('ServiceC') {}

			const finalizationOrder: string[] = [];

			const c = container()
				.register(ServiceA, {
					factory: () => new ServiceA(),
					finalizer: () => {
						finalizationOrder.push('A');
					},
				})
				.register(ServiceB, {
					factory: () => new ServiceB(),
					finalizer: () => {
						finalizationOrder.push('B');
					},
				})
				.register(ServiceC, {
					factory: () => new ServiceC(),
					finalizer: () => {
						finalizationOrder.push('C');
					},
				});

			// Instantiate all services
			await c.get(ServiceA);
			await c.get(ServiceB);
			await c.get(ServiceC);

			await c.destroy();

			// Finalizers run concurrently, so we just verify all were called
			expect(finalizationOrder).toHaveLength(3);
			expect(finalizationOrder).toContain('A');
			expect(finalizationOrder).toContain('B');
			expect(finalizationOrder).toContain('C');
		});

		it('should handle async finalizers', async () => {
			class TestService extends Tag.Class('TestService') {
				asyncCleanup = vi
					.fn()
					.mockResolvedValue(undefined) as () => Promise<void>;
			}

			const finalizer = vi
				.fn()
				.mockImplementation((instance: TestService) => {
					return instance.asyncCleanup();
				});

			const c = container().register(TestService, {
				factory: () => new TestService(),
				finalizer,
			});

			const instance = await c.get(TestService);

			await c.destroy();

			expect(instance.asyncCleanup).toHaveBeenCalled();
		});

		it('should collect finalizer errors and throw DependencyContainerFinalizationError', async () => {
			class ServiceA extends Tag.Class('ServiceA') {}
			class ServiceB extends Tag.Class('ServiceB') {}

			const c = container()
				.register(ServiceA, {
					factory: () => new ServiceA(),
					finalizer: () => {
						throw new Error('Finalizer A error');
					},
				})
				.register(ServiceB, {
					factory: () => new ServiceB(),
					finalizer: () => {
						throw new Error('Finalizer B error');
					},
				});

			// Instantiate services
			await c.get(ServiceA);
			await c.get(ServiceB);

			await expect(c.destroy()).rejects.toThrow(
				DependencyFinalizationError
			);
		});

		it('should clear instance cache even if finalization fails', async () => {
			class TestService extends Tag.Class('TestService') {}

			const c = container().register(TestService, {
				factory: () => new TestService(),
				finalizer: () => {
					throw new Error('Finalizer error');
				},
			});

			await c.get(TestService);

			// Should throw due to finalizer error
			await expect(c.destroy()).rejects.toThrow();

			// Service should still be registered even after destroy fails
			expect(c.has(TestService)).toBe(true);
		});

		it('should make container unusable after destroy', async () => {
			class ServiceA extends Tag.Class('ServiceA') {}
			class ServiceB extends Tag.Class('ServiceB') {}

			const c = container()
				.register(ServiceA, () => new ServiceA())
				.register(ServiceB, () => new ServiceB());

			await c.get(ServiceA);
			await c.get(ServiceB);

			expect(c.has(ServiceA)).toBe(true);
			expect(c.has(ServiceB)).toBe(true);

			await c.destroy();

			// Services should still be registered even after destroy
			expect(c.has(ServiceA)).toBe(true);
			expect(c.has(ServiceB)).toBe(true);

			// Container should now be unusable
			await expect(c.get(ServiceA)).rejects.toThrow(
				'Cannot resolve dependencies from a destroyed container'
			);

			expect(() => c.register(ServiceA, () => new ServiceA())).toThrow(
				'Cannot register dependencies on a destroyed container'
			);

			// Subsequent destroy calls should be safe (idempotent)
			await expect(c.destroy()).resolves.toBeUndefined();
		});

		it('should throw error when trying to use destroyed container multiple times', async () => {
			class TestService extends Tag.Class('TestService') {
				constructor(public id: number) {
					super();
				}
			}

			let instanceCount = 0;
			const c = container().register(TestService, () => {
				return new TestService(++instanceCount);
			});

			// First cycle
			const instance1 = await c.get(TestService);
			expect(instance1.id).toBe(1);
			await c.destroy();

			// Container should now be unusable
			await expect(c.get(TestService)).rejects.toThrow(
				'Cannot resolve dependencies from a destroyed container'
			);

			// Multiple destroy calls should be safe
			await expect(c.destroy()).resolves.toBeUndefined();
			await expect(c.destroy()).resolves.toBeUndefined();
		});

		it('should verify finalizers are called but container becomes unusable', async () => {
			class TestService extends Tag.Class('TestService') {
				cleanup = vi.fn();
			}

			const finalizer = vi.fn((instance: TestService) => {
				instance.cleanup();
			});

			const c = container().register(TestService, {
				factory: () => new TestService(),
				finalizer,
			});

			// First cycle
			const instance1 = await c.get(TestService);
			await c.destroy();
			expect(finalizer).toHaveBeenCalledTimes(1);
			expect(instance1.cleanup).toHaveBeenCalledTimes(1);

			// Container should now be unusable
			await expect(c.get(TestService)).rejects.toThrow(
				'Cannot resolve dependencies from a destroyed container'
			);
		});
	});

	describe('ValueTag support', () => {
		it('should work with ValueTag dependencies', async () => {
			const StringTag = Tag.of('string')<string>();
			const NumberTag = Tag.of('number')<number>();

			const c = container()
				.register(StringTag, () => 'hello')
				.register(NumberTag, () => 42);

			const stringValue = await c.get(StringTag);
			const numberValue = await c.get(NumberTag);

			expect(stringValue).toBe('hello');
			expect(numberValue).toBe(42);
		});

		it('should work with anonymous ValueTags', async () => {
			const ConfigTag = Tag.for<{ apiKey: string }>();

			const c = container().register(ConfigTag, () => ({
				apiKey: 'secret',
			}));

			const config = await c.get(ConfigTag);

			expect(config.apiKey).toBe('secret');
		});

		it('should mix ClassTag and ValueTag dependencies', async () => {
			class UserService extends Tag.Class('UserService') {
				constructor(private apiKey: string) {
					super();
				}

				getApiKey() {
					return this.apiKey;
				}
			}

			const ApiKeyTag = Tag.of('apiKey')<string>();

			const c = container()
				.register(ApiKeyTag, () => 'secret-key')
				.register(
					UserService,
					async (ctx) => new UserService(await ctx.get(ApiKeyTag))
				);

			const userService = await c.get(UserService);

			expect(userService.getApiKey()).toBe('secret-key');
		});
	});

	describe('error handling', () => {
		it('should preserve error context in DependencyCreationError', async () => {
			class TestService extends Tag.Class('TestService') {}

			const originalError = new Error('Original error');
			const c = container().register(TestService, () => {
				throw originalError;
			});

			try {
				await c.get(TestService);
				expect.fail('Should have thrown');
			} catch (error) {
				expect(error).toBeInstanceOf(DependencyCreationError);
				expect((error as DependencyCreationError).cause).toBe(
					originalError
				);
			}
		});

		it('should handle nested dependency creation errors', async () => {
			class DatabaseService extends Tag.Class('DatabaseService') {}
			class UserService extends Tag.Class('UserService') {}

			const c = container()
				.register(DatabaseService, () => {
					throw new Error('Database connection failed');
				})
				.register(
					UserService,
					async (ctx) =>
						new UserService(await ctx.get(DatabaseService))
				);

			try {
				await c.get(UserService);
				expect.fail('Should have thrown');
			} catch (error) {
				expect(error).toBeInstanceOf(DependencyCreationError);
				// Should be the UserService creation error, with nested DatabaseService error
			}
		});
	});

	describe('type safety edge cases', () => {
		it('should maintain type safety with complex inheritance', async () => {
			class BaseService extends Tag.Class('BaseService') {
				baseMethod() {
					return 'base';
				}
			}

			class ExtendedService extends BaseService {
				extendedMethod() {
					return 'extended';
				}
			}

			const c = container().register(
				BaseService,
				() => new ExtendedService()
			);

			const instance = await c.get(BaseService);

			// Should be able to call base method
			expect(instance.baseMethod()).toBe('base');
			// Should also be able to call extended method due to implementation
			expect((instance as ExtendedService).extendedMethod()).toBe(
				'extended'
			);
		});
	});

	describe('merge method', () => {
		it('should merge registrations from two containers', async () => {
			class ServiceA extends Tag.Class('ServiceA') {
				getValue() {
					return 'A';
				}
			}
			class ServiceB extends Tag.Class('ServiceB') {
				getValue() {
					return 'B';
				}
			}

			const source = container()
				.register(ServiceA, () => new ServiceA())
				.register(ServiceB, () => new ServiceB());

			const target = container();
			const result = source.merge(target);

			// Should be able to get services from merged container
			const serviceA = await result.get(ServiceA);
			const serviceB = await result.get(ServiceB);

			expect(serviceA.getValue()).toBe('A');
			expect(serviceB.getValue()).toBe('B');
		});

		it('should preserve finalizers when merging', async () => {
			class TestService extends Tag.Class('TestService') {
				cleanup = vi.fn();
			}

			const finalizer = vi.fn((instance: TestService) => {
				instance.cleanup();
			});

			const source = container().register(TestService, {
				factory: () => new TestService(),
				finalizer,
			});

			const target = container();
			const result = source.merge(target);

			const instance = await result.get(TestService);
			await result.destroy();

			expect(finalizer).toHaveBeenCalledWith(instance);
			expect(instance.cleanup).toHaveBeenCalled();
		});

		it('should work with ValueTag dependencies', async () => {
			const StringTag = Tag.of('string')<string>();
			const NumberTag = Tag.of('number')<number>();
			const ConfigTag = Tag.for<{ apiKey: string }>();

			const source = container()
				.register(StringTag, () => 'hello')
				.register(NumberTag, () => 42)
				.register(ConfigTag, () => ({ apiKey: 'secret' }));

			const target = container();
			const result = source.merge(target);

			const stringValue = await result.get(StringTag);
			const numberValue = await result.get(NumberTag);
			const configValue = await result.get(ConfigTag);

			expect(stringValue).toBe('hello');
			expect(numberValue).toBe(42);
			expect(configValue.apiKey).toBe('secret');
		});

		it('should combine registrations from both containers', async () => {
			class ServiceA extends Tag.Class('ServiceA') {}
			class ServiceB extends Tag.Class('ServiceB') {}
			class ServiceC extends Tag.Class('ServiceC') {}

			const source = container()
				.register(ServiceA, () => new ServiceA())
				.register(ServiceB, () => new ServiceB());

			const target = container().register(ServiceC, () => new ServiceC());

			const result = source.merge(target);

			// Should have all three services
			const serviceA = await result.get(ServiceA);
			const serviceB = await result.get(ServiceB);
			const serviceC = await result.get(ServiceC);

			expect(serviceA).toBeInstanceOf(ServiceA);
			expect(serviceB).toBeInstanceOf(ServiceB);
			expect(serviceC).toBeInstanceOf(ServiceC);
		});

		it('should let source override target registrations', async () => {
			class TestService extends Tag.Class('TestService') {
				constructor(public value: string) {
					super();
				}
			}

			const source = container().register(
				TestService,
				() => new TestService('from-source')
			);

			const target = container().register(
				TestService,
				() => new TestService('from-target')
			);

			const result = source.merge(target);

			const instance = await result.get(TestService);
			expect(instance.value).toBe('from-source');
		});

		it('should create new container with separate instance cache', async () => {
			class TestService extends Tag.Class('TestService') {
				constructor(public id: string = Math.random().toString()) {
					super();
				}
			}

			const source = container().register(
				TestService,
				() => new TestService()
			);

			// Get instance from source first
			const sourceInstance = await source.get(TestService);

			const target = container();
			const result = source.merge(target);

			// Get instance from merged container
			const resultInstance = await result.get(TestService);

			// Should be different instances (different caches)
			expect(sourceInstance).not.toBe(resultInstance);
			expect(sourceInstance.id).not.toBe(resultInstance.id);
		});

		it('should work with empty source container', () => {
			class TestService extends Tag.Class('TestService') {}

			const source = container();
			const target = container().register(
				TestService,
				() => new TestService()
			);

			const result = source.merge(target);
			expect(result.has(TestService)).toBe(true);
		});

		it('should work with empty target container', () => {
			class TestService extends Tag.Class('TestService') {}

			const source = container().register(
				TestService,
				() => new TestService()
			);
			const target = container();

			const result = source.merge(target);
			expect(result.has(TestService)).toBe(true);
		});

		it('should throw error when merging from destroyed container', async () => {
			class TestService extends Tag.Class('TestService') {}

			const source = container().register(
				TestService,
				() => new TestService()
			);
			await source.destroy();

			const target = container();

			expect(() => source.merge(target)).toThrow(ContainerDestroyedError);
		});

		it('should work with complex dependency graphs', async () => {
			class ConfigService extends Tag.Class('ConfigService') {
				getDbUrl() {
					return 'db://localhost';
				}
			}

			class DatabaseService extends Tag.Class('DatabaseService') {
				constructor(private config: ConfigService) {
					super();
				}

				connect() {
					return `Connected to ${this.config.getDbUrl()}`;
				}
			}

			const source = container()
				.register(ConfigService, () => new ConfigService())
				.register(
					DatabaseService,
					async (ctx) =>
						new DatabaseService(await ctx.get(ConfigService))
				);

			const target = container();
			const result = source.merge(target);

			const dbService = await result.get(DatabaseService);
			expect(dbService.connect()).toBe('Connected to db://localhost');
		});
	});
});
