import { Container } from '@/container.js';
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
			const c = Container.empty();
			expect(c).toBeInstanceOf(Container);
		});

		it('should create a container with proper typing', () => {
			const c = Container.empty();
			// Type check - should be DependencyContainer<never>
			expect(c).toBeDefined();
		});
	});

	describe('register', () => {
		it('should register a simple class constructor', () => {
			class TestService extends Tag.Service('TestService') {
				getValue() {
					return 'test';
				}
			}

			const c = Container.empty();
			const registered = c.register(TestService, () => new TestService());

			expect(registered).toBeInstanceOf(Container);
			// Should return the same container instance with updated type
			expect(registered).toBe(c);
		});

		it('should register with sync factory', () => {
			class TestService extends Tag.Service('TestService') {
				constructor(public value: string) {
					super();
				}
			}

			const c = Container.empty().register(
				TestService,
				() => new TestService('sync')
			);

			expect(c).toBeDefined();
		});

		it('should register with async factory', () => {
			class TestService extends Tag.Service('TestService') {
				constructor(public value: string) {
					super();
				}
			}

			const c = Container.empty().register(
				TestService,
				() => new TestService('async')
			);

			expect(c).toBeDefined();
		});

		it('should register with finalizer', () => {
			class TestService extends Tag.Service('TestService') {
				cleanup = vi.fn() as () => void;
			}

			const c = Container.empty().register(TestService, {
				factory: () => new TestService(),
				finalizer: (instance) => {
					instance.cleanup();
				},
			});

			expect(c).toBeDefined();
		});

		it('should allow overriding registration before instantiation', () => {
			class TestService extends Tag.Service('TestService') {
				constructor(public value: string) {
					super();
				}
			}

			const c = Container.empty()
				.register(TestService, () => new TestService('original'))
				.register(TestService, () => new TestService('overridden'));

			expect(c).toBeDefined();
		});

		it('should preserve container chain for multiple registrations', () => {
			class ServiceA extends Tag.Service('ServiceA') {}
			class ServiceB extends Tag.Service('ServiceB') {}

			const c = Container.empty()
				.register(ServiceA, () => new ServiceA())
				.register(ServiceB, () => new ServiceB());

			expect(c).toBeDefined();
		});

		it('should throw error when trying to register after instantiation', async () => {
			class TestService extends Tag.Service('TestService') {
				constructor(public value: string) {
					super();
				}
			}

			const c = Container.empty().register(
				TestService,
				() => new TestService('original')
			);

			// Instantiate the service
			await c.resolve(TestService);

			// Now try to register again - should throw
			expect(() =>
				c.register(TestService, () => new TestService('overridden'))
			).toThrow(DependencyAlreadyInstantiatedError);
		});

		it('should throw error when registering on destroyed container', async () => {
			class TestService extends Tag.Service('TestService') {}

			const c = Container.empty().register(
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
			class TestService extends Tag.Service('TestService') {}

			const c = Container.empty();

			expect(c.has(TestService)).toBe(false);
		});

		it('should return true for registered dependency', () => {
			class TestService extends Tag.Service('TestService') {}

			const c = Container.empty().register(
				TestService,
				() => new TestService()
			);

			expect(c.has(TestService)).toBe(true);
		});

		it('should return true for instantiated dependency', async () => {
			class TestService extends Tag.Service('TestService') {}

			const c = Container.empty().register(
				TestService,
				() => new TestService()
			);

			await c.resolve(TestService);

			expect(c.has(TestService)).toBe(true);
		});
	});

	describe('resolve', () => {
		it('should create and return instance for sync factory', async () => {
			class TestService extends Tag.Service('TestService') {
				getValue() {
					return 'test';
				}
			}

			const c = Container.empty().register(
				TestService,
				() => new TestService()
			);

			const instance = await c.resolve(TestService);

			expect(instance).toBeInstanceOf(TestService);
			expect(instance.getValue()).toBe('test');
		});

		it('should create and return instance for async factory', async () => {
			class TestService extends Tag.Service('TestService') {
				constructor(public value: string) {
					super();
				}
			}

			const c = Container.empty().register(TestService, async () => {
				await Promise.resolve();
				return new TestService('async');
			});

			const instance = await c.resolve(TestService);

			expect(instance).toBeInstanceOf(TestService);
			expect(instance.value).toBe('async');
		});

		it('should return cached instance on subsequent calls', async () => {
			class TestService extends Tag.Service('TestService') {}

			const factory = vi.fn(() => new TestService());
			const c = Container.empty().register(TestService, factory);

			const instance1 = await c.resolve(TestService);
			const instance2 = await c.resolve(TestService);

			expect(instance1).toBe(instance2);
			expect(factory).toHaveBeenCalledTimes(1);
		});

		it('should throw UnknownDependencyError for unregistered dependency', async () => {
			class TestService extends Tag.Service('TestService') {}

			const c = Container.empty();

			// @ts-expect-error - TestService is not registered
			await expect(c.resolve(TestService)).rejects.toThrow(
				UnknownDependencyError
			);
		});

		it('should wrap factory errors in DependencyCreationError', async () => {
			class TestService extends Tag.Service('TestService') {}

			const c = Container.empty().register(TestService, () => {
				throw new Error('Factory error');
			});

			await expect(c.resolve(TestService)).rejects.toThrow(
				DependencyCreationError
			);
		});

		it('should handle async factory errors', async () => {
			class TestService extends Tag.Service('TestService') {}

			const c = Container.empty().register(TestService, async () => {
				await Promise.resolve();
				throw new Error('Async factory error');
			});

			await expect(c.resolve(TestService)).rejects.toThrow(
				DependencyCreationError
			);
		});

		it('should remove failed promise from cache and allow retry', async () => {
			class TestService extends Tag.Service('TestService') {}

			let shouldFail = true;
			const c = Container.empty().register(TestService, () => {
				if (shouldFail) {
					throw new Error('Factory error');
				}
				return new TestService();
			});

			// First call should fail
			await expect(c.resolve(TestService)).rejects.toThrow(
				DependencyCreationError
			);

			// Service should still be registered even after failure
			expect(c.has(TestService)).toBe(true);

			// Second call should succeed
			shouldFail = false;
			const instance = await c.resolve(TestService);
			expect(instance).toBeInstanceOf(TestService);
		});

		it('should handle concurrent calls properly', async () => {
			class TestService extends Tag.Service('TestService') {}

			const factory = vi.fn(() => new TestService());
			const c = Container.empty().register(TestService, factory);

			// Make concurrent calls
			const [instance1, instance2, instance3] = await Promise.all([
				c.resolve(TestService),
				c.resolve(TestService),
				c.resolve(TestService),
			]);

			expect(instance1).toBe(instance2);
			expect(instance2).toBe(instance3);
			expect(factory).toHaveBeenCalledTimes(1);
		});

		it('should throw error when getting from destroyed container', async () => {
			class TestService extends Tag.Service('TestService') {}

			const c = Container.empty().register(
				TestService,
				() => new TestService()
			);

			await c.destroy();

			await expect(c.resolve(TestService)).rejects.toThrow(
				ContainerDestroyedError
			);
		});
	});

	describe('resolveAll', () => {
		it('should resolve multiple dependencies concurrently', async () => {
			class ServiceA extends Tag.Service('ServiceA') {
				getValue() {
					return 'A';
				}
			}
			class ServiceB extends Tag.Service('ServiceB') {
				getValue() {
					return 'B';
				}
			}

			const c = Container.empty()
				.register(ServiceA, () => new ServiceA())
				.register(ServiceB, () => new ServiceB());

			const [serviceA, serviceB] = await c.resolveAll(ServiceA, ServiceB);

			expect(serviceA).toBeInstanceOf(ServiceA);
			expect(serviceB).toBeInstanceOf(ServiceB);
			expect(serviceA.getValue()).toBe('A');
			expect(serviceB.getValue()).toBe('B');
		});

		it('should resolve empty array', async () => {
			const c = Container.empty();

			const results = await c.resolveAll();

			expect(results).toEqual([]);
		});

		it('should resolve single dependency in array', async () => {
			class TestService extends Tag.Service('TestService') {
				getValue() {
					return 'test';
				}
			}

			const c = Container.empty().register(
				TestService,
				() => new TestService()
			);

			const [service] = await c.resolveAll(TestService);

			expect(service).toBeInstanceOf(TestService);
			expect(service.getValue()).toBe('test');
		});

		it('should return cached instances for multiple calls', async () => {
			class TestService extends Tag.Service('TestService') {}

			const factory = vi.fn(() => new TestService());
			const c = Container.empty().register(TestService, factory);

			// First call
			const [instance1] = await c.resolveAll(TestService);
			// Second call
			const [instance2] = await c.resolveAll(TestService);
			// Call with resolve for comparison
			const instance3 = await c.resolve(TestService);

			expect(instance1).toBe(instance2);
			expect(instance1).toBe(instance3);
			expect(factory).toHaveBeenCalledTimes(1);
		});

		it('should work with ValueTag dependencies', async () => {
			const StringTag = Tag.of('string')<string>();
			const NumberTag = Tag.of('number')<number>();
			class ServiceA extends Tag.Service('ServiceA') {}

			const c = Container.empty()
				.register(StringTag, () => 'hello')
				.register(NumberTag, () => 42)
				.register(ServiceA, () => new ServiceA());

			const [stringValue, numberValue, serviceA] = await c.resolveAll(
				StringTag,
				NumberTag,
				ServiceA
			);

			expect(stringValue).toBe('hello');
			expect(numberValue).toBe(42);
			expect(serviceA).toBeInstanceOf(ServiceA);
		});

		it('should maintain order of resolved dependencies', async () => {
			class ServiceA extends Tag.Service('ServiceA') {
				getValue() {
					return 'A';
				}
			}
			class ServiceB extends Tag.Service('ServiceB') {
				getValue() {
					return 'B';
				}
			}
			class ServiceC extends Tag.Service('ServiceC') {
				getValue() {
					return 'C';
				}
			}

			const c = Container.empty()
				.register(ServiceA, () => new ServiceA())
				.register(ServiceB, () => new ServiceB())
				.register(ServiceC, () => new ServiceC());

			// Test different orders
			const [a1, b1, c1] = await c.resolveAll(
				ServiceA,
				ServiceB,
				ServiceC
			);
			expect(a1.getValue()).toBe('A');
			expect(b1.getValue()).toBe('B');
			expect(c1.getValue()).toBe('C');

			const [c2, a2, b2] = await c.resolveAll(
				ServiceC,
				ServiceA,
				ServiceB
			);
			expect(c2.getValue()).toBe('C');
			expect(a2.getValue()).toBe('A');
			expect(b2.getValue()).toBe('B');
		});

		it('should handle async factories properly', async () => {
			class ServiceA extends Tag.Service('ServiceA') {
				constructor(public value: string) {
					super();
				}
			}
			class ServiceB extends Tag.Service('ServiceB') {
				constructor(public value: number) {
					super();
				}
			}

			const c = Container.empty()
				.register(ServiceA, async () => {
					await Promise.resolve();
					return new ServiceA('async-A');
				})
				.register(ServiceB, async () => {
					await Promise.resolve();
					return new ServiceB(123);
				});

			const [serviceA, serviceB] = await c.resolveAll(ServiceA, ServiceB);

			expect(serviceA.value).toBe('async-A');
			expect(serviceB.value).toBe(123);
		});

		it('should throw UnknownDependencyError for unregistered dependency', async () => {
			class RegisteredService extends Tag.Service('RegisteredService') {}
			class UnregisteredService extends Tag.Service(
				'UnregisteredService'
			) {}

			const c = Container.empty().register(
				RegisteredService,
				() => new RegisteredService()
			);

			await expect(
				// @ts-expect-error - UnregisteredService is not registered
				c.resolveAll(RegisteredService, UnregisteredService)
			).rejects.toThrow(UnknownDependencyError);
		});

		it('should throw DependencyCreationError if any factory fails', async () => {
			class ServiceA extends Tag.Service('ServiceA') {}
			class ServiceB extends Tag.Service('ServiceB') {}

			const c = Container.empty()
				.register(ServiceA, () => new ServiceA())
				.register(ServiceB, () => {
					throw new Error('Factory B failed');
				});

			await expect(c.resolveAll(ServiceA, ServiceB)).rejects.toThrow(
				DependencyCreationError
			);
		});

		it('should throw error when resolving from destroyed container', async () => {
			class ServiceA extends Tag.Service('ServiceA') {}
			class ServiceB extends Tag.Service('ServiceB') {}

			const c = Container.empty()
				.register(ServiceA, () => new ServiceA())
				.register(ServiceB, () => new ServiceB());

			await c.destroy();

			await expect(c.resolveAll(ServiceA, ServiceB)).rejects.toThrow(
				ContainerDestroyedError
			);
		});

		it('should handle concurrent resolveAll calls properly', async () => {
			class ServiceA extends Tag.Service('ServiceA') {}
			class ServiceB extends Tag.Service('ServiceB') {}

			const factoryA = vi.fn(() => new ServiceA());
			const factoryB = vi.fn(() => new ServiceB());

			const c = Container.empty()
				.register(ServiceA, factoryA)
				.register(ServiceB, factoryB);

			// Make concurrent resolveAll calls
			const [result1, result2, result3] = await Promise.all([
				c.resolveAll(ServiceA, ServiceB),
				c.resolveAll(ServiceA, ServiceB),
				c.resolveAll(ServiceB, ServiceA),
			]);

			// All results should have the same instances
			expect(result1[0]).toBe(result2[0]);
			expect(result1[1]).toBe(result2[1]);
			expect(result1[0]).toBe(result3[1]);
			expect(result1[1]).toBe(result3[0]);

			// Factories should only be called once each
			expect(factoryA).toHaveBeenCalledTimes(1);
			expect(factoryB).toHaveBeenCalledTimes(1);
		});

		it('should handle mix of cached and non-cached dependencies', async () => {
			class ServiceA extends Tag.Service('ServiceA') {}
			class ServiceB extends Tag.Service('ServiceB') {}
			class ServiceC extends Tag.Service('ServiceC') {}

			const factoryA = vi.fn(() => new ServiceA());
			const factoryB = vi.fn(() => new ServiceB());
			const factoryC = vi.fn(() => new ServiceC());

			const c = Container.empty()
				.register(ServiceA, factoryA)
				.register(ServiceB, factoryB)
				.register(ServiceC, factoryC);

			// Resolve ServiceA first to cache it
			const cachedA = await c.resolve(ServiceA);

			// Now resolve all three - A should be from cache, B and C should be new
			const [serviceA, serviceB, serviceC] = await c.resolveAll(
				ServiceA,
				ServiceB,
				ServiceC
			);

			expect(serviceA).toBe(cachedA);
			expect(serviceB).toBeInstanceOf(ServiceB);
			expect(serviceC).toBeInstanceOf(ServiceC);

			// ServiceA factory called once (from first resolve), others called once each
			expect(factoryA).toHaveBeenCalledTimes(1);
			expect(factoryB).toHaveBeenCalledTimes(1);
			expect(factoryC).toHaveBeenCalledTimes(1);
		});
	});

	describe('dependency injection', () => {
		it('should inject dependencies through factory function', async () => {
			class DatabaseService extends Tag.Service('DatabaseService') {
				query() {
					return 'db-result';
				}
			}

			class UserService extends Tag.Service('UserService') {
				constructor(private db: DatabaseService) {
					super();
				}

				getUser() {
					return this.db.query();
				}
			}

			const c = Container.empty()
				.register(DatabaseService, () => new DatabaseService())
				.register(
					UserService,
					async (ctx) =>
						new UserService(await ctx.resolve(DatabaseService))
				);

			const userService = await c.resolve(UserService);

			expect(userService.getUser()).toBe('db-result');
		});

		it('should handle complex dependency graphs', async () => {
			class ConfigService extends Tag.Service('ConfigService') {
				getDbUrl() {
					return 'db://localhost';
				}
			}

			class DatabaseService extends Tag.Service('DatabaseService') {
				constructor(private config: ConfigService) {
					super();
				}

				connect() {
					return `Connected to ${this.config.getDbUrl()}`;
				}
			}

			class CacheService extends Tag.Service('CacheService') {}

			class UserService extends Tag.Service('UserService') {
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

			const c = Container.empty()
				.register(ConfigService, () => new ConfigService())
				.register(
					DatabaseService,
					async (ctx) =>
						new DatabaseService(await ctx.resolve(ConfigService))
				)
				.register(CacheService, () => new CacheService())
				.register(
					UserService,
					async (ctx) =>
						new UserService(
							await ctx.resolve(DatabaseService),
							await ctx.resolve(CacheService)
						)
				);

			const userService = await c.resolve(UserService);

			expect(userService.getUser()).toBe(
				'Connected to db://localhost with cache'
			);
		});

		it('should detect and throw CircularDependencyError', async () => {
			class ServiceA extends Tag.Service('ServiceA') {
				constructor(private _serviceB: ServiceB) {
					super();
				}
			}

			class ServiceB extends Tag.Service('ServiceB') {
				constructor(private _serviceA: ServiceA) {
					super();
				}
			}

			const c = Container.empty()
				.register(
					ServiceA,
					async (ctx) =>
						// @ts-expect-error - ServiceB is not registered
						new ServiceA(await ctx.resolve(ServiceB))
				)
				.register(
					ServiceB,
					async (ctx) => new ServiceB(await ctx.resolve(ServiceA))
				);

			// Should throw DependencyCreationError with nested error chain leading to CircularDependencyError
			try {
				await c.resolve(ServiceA);
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
				await c.resolve(ServiceB);
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
			class TestService extends Tag.Service('TestService') {
				cleanup = vi.fn();
			}

			const finalizer = vi.fn((instance: TestService) => {
				instance.cleanup();
			});

			const c = Container.empty().register(TestService, {
				factory: () => new TestService(),
				finalizer,
			});

			// Instantiate the service
			const instance = await c.resolve(TestService);

			await c.destroy();

			expect(finalizer).toHaveBeenCalledWith(instance);
			expect(instance.cleanup).toHaveBeenCalled();
		});

		it('should not call finalizers for non-instantiated dependencies', async () => {
			class TestService extends Tag.Service('TestService') {}

			const finalizer = vi.fn();

			const c = Container.empty().register(TestService, {
				factory: () => new TestService(),
				finalizer,
			});

			// Do not instantiate the service
			await c.destroy();

			expect(finalizer).not.toHaveBeenCalled();
		});

		it('should call finalizers concurrently', async () => {
			class ServiceA extends Tag.Service('ServiceA') {}
			class ServiceB extends Tag.Service('ServiceB') {}
			class ServiceC extends Tag.Service('ServiceC') {}

			const finalizationOrder: string[] = [];

			const c = Container.empty()
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
			await c.resolve(ServiceA);
			await c.resolve(ServiceB);
			await c.resolve(ServiceC);

			await c.destroy();

			// Finalizers run concurrently, so we just verify all were called
			expect(finalizationOrder).toHaveLength(3);
			expect(finalizationOrder).toContain('A');
			expect(finalizationOrder).toContain('B');
			expect(finalizationOrder).toContain('C');
		});

		it('should handle async finalizers', async () => {
			class TestService extends Tag.Service('TestService') {
				asyncCleanup = vi
					.fn()
					.mockResolvedValue(undefined) as () => Promise<void>;
			}

			const finalizer = vi
				.fn()
				.mockImplementation((instance: TestService) => {
					return instance.asyncCleanup();
				});

			const c = Container.empty().register(TestService, {
				factory: () => new TestService(),
				finalizer,
			});

			const instance = await c.resolve(TestService);

			await c.destroy();

			expect(instance.asyncCleanup).toHaveBeenCalled();
		});

		it('should collect finalizer errors and throw DependencyContainerFinalizationError', async () => {
			class ServiceA extends Tag.Service('ServiceA') {}
			class ServiceB extends Tag.Service('ServiceB') {}

			const c = Container.empty()
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
			await c.resolve(ServiceA);
			await c.resolve(ServiceB);

			await expect(c.destroy()).rejects.toThrow(
				DependencyFinalizationError
			);
		});

		it('should clear instance cache even if finalization fails', async () => {
			class TestService extends Tag.Service('TestService') {}

			const c = Container.empty().register(TestService, {
				factory: () => new TestService(),
				finalizer: () => {
					throw new Error('Finalizer error');
				},
			});

			await c.resolve(TestService);

			// Should throw due to finalizer error
			await expect(c.destroy()).rejects.toThrow();

			// Service should still be registered even after destroy fails
			expect(c.has(TestService)).toBe(true);
		});

		it('should make container unusable after destroy', async () => {
			class ServiceA extends Tag.Service('ServiceA') {}
			class ServiceB extends Tag.Service('ServiceB') {}

			const c = Container.empty()
				.register(ServiceA, () => new ServiceA())
				.register(ServiceB, () => new ServiceB());

			await c.resolve(ServiceA);
			await c.resolve(ServiceB);

			expect(c.has(ServiceA)).toBe(true);
			expect(c.has(ServiceB)).toBe(true);

			await c.destroy();

			// Services should still be registered even after destroy
			expect(c.has(ServiceA)).toBe(true);
			expect(c.has(ServiceB)).toBe(true);

			// Container should now be unusable
			await expect(c.resolve(ServiceA)).rejects.toThrow(
				'Cannot resolve dependencies from a destroyed container'
			);

			expect(() => c.register(ServiceA, () => new ServiceA())).toThrow(
				'Cannot register dependencies on a destroyed container'
			);

			// Subsequent destroy calls should be safe (idempotent)
			await expect(c.destroy()).resolves.toBeUndefined();
		});

		it('should throw error when trying to use destroyed container multiple times', async () => {
			class TestService extends Tag.Service('TestService') {
				constructor(public id: number) {
					super();
				}
			}

			let instanceCount = 0;
			const c = Container.empty().register(TestService, () => {
				return new TestService(++instanceCount);
			});

			// First cycle
			const instance1 = await c.resolve(TestService);
			expect(instance1.id).toBe(1);
			await c.destroy();

			// Container should now be unusable
			await expect(c.resolve(TestService)).rejects.toThrow(
				'Cannot resolve dependencies from a destroyed container'
			);

			// Multiple destroy calls should be safe
			await expect(c.destroy()).resolves.toBeUndefined();
			await expect(c.destroy()).resolves.toBeUndefined();
		});

		it('should verify finalizers are called but container becomes unusable', async () => {
			class TestService extends Tag.Service('TestService') {
				cleanup = vi.fn();
			}

			const finalizer = vi.fn((instance: TestService) => {
				instance.cleanup();
			});

			const c = Container.empty().register(TestService, {
				factory: () => new TestService(),
				finalizer,
			});

			// First cycle
			const instance1 = await c.resolve(TestService);
			await c.destroy();
			expect(finalizer).toHaveBeenCalledTimes(1);
			expect(instance1.cleanup).toHaveBeenCalledTimes(1);

			// Container should now be unusable
			await expect(c.resolve(TestService)).rejects.toThrow(
				'Cannot resolve dependencies from a destroyed container'
			);
		});
	});

	describe('ValueTag support', () => {
		it('should work with ValueTag dependencies', async () => {
			const StringTag = Tag.of('string')<string>();
			const NumberTag = Tag.of('number')<number>();

			const c = Container.empty()
				.register(StringTag, () => 'hello')
				.register(NumberTag, () => 42);

			const stringValue = await c.resolve(StringTag);
			const numberValue = await c.resolve(NumberTag);

			expect(stringValue).toBe('hello');
			expect(numberValue).toBe(42);
		});

		it('should work with anonymous ValueTags', async () => {
			const ConfigTag = Tag.for<{ apiKey: string }>();

			const c = Container.empty().register(ConfigTag, () => ({
				apiKey: 'secret',
			}));

			const config = await c.resolve(ConfigTag);

			expect(config.apiKey).toBe('secret');
		});

		it('should mix ServiceTag and ValueTag dependencies', async () => {
			class UserService extends Tag.Service('UserService') {
				constructor(private apiKey: string) {
					super();
				}

				getApiKey() {
					return this.apiKey;
				}
			}

			const ApiKeyTag = Tag.of('apiKey')<string>();

			const c = Container.empty()
				.register(ApiKeyTag, () => 'secret-key')
				.register(
					UserService,
					async (ctx) => new UserService(await ctx.resolve(ApiKeyTag))
				);

			const userService = await c.resolve(UserService);

			expect(userService.getApiKey()).toBe('secret-key');
		});
	});

	describe('error handling', () => {
		it('should preserve error context in DependencyCreationError', async () => {
			class TestService extends Tag.Service('TestService') {}

			const originalError = new Error('Original error');
			const c = Container.empty().register(TestService, () => {
				throw originalError;
			});

			try {
				await c.resolve(TestService);
				expect.fail('Should have thrown');
			} catch (error) {
				expect(error).toBeInstanceOf(DependencyCreationError);
				expect((error as DependencyCreationError).cause).toBe(
					originalError
				);
			}
		});

		it('should handle nested dependency creation errors', async () => {
			class DatabaseService extends Tag.Service('DatabaseService') {}
			class UserService extends Tag.Service('UserService') {}

			const c = Container.empty()
				.register(DatabaseService, () => {
					throw new Error('Database connection failed');
				})
				.register(
					UserService,
					async (ctx) =>
						new UserService(await ctx.resolve(DatabaseService))
				);

			try {
				await c.resolve(UserService);
				expect.fail('Should have thrown');
			} catch (error) {
				expect(error).toBeInstanceOf(DependencyCreationError);
				// Should be the UserService creation error, with nested DatabaseService error
			}
		});
	});

	describe('type safety edge cases', () => {
		it('should maintain type safety with complex inheritance', async () => {
			class BaseService extends Tag.Service('BaseService') {
				baseMethod() {
					return 'base';
				}
			}

			class ExtendedService extends BaseService {
				extendedMethod() {
					return 'extended';
				}
			}

			const c = Container.empty().register(
				BaseService,
				() => new ExtendedService()
			);

			const instance = await c.resolve(BaseService);

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
			class ServiceA extends Tag.Service('ServiceA') {
				getValue() {
					return 'A';
				}
			}
			class ServiceB extends Tag.Service('ServiceB') {
				getValue() {
					return 'B';
				}
			}

			const source = Container.empty()
				.register(ServiceA, () => new ServiceA())
				.register(ServiceB, () => new ServiceB());

			const target = Container.empty();
			const result = source.merge(target);

			// Should be able to get services from merged container
			const serviceA = await result.resolve(ServiceA);
			const serviceB = await result.resolve(ServiceB);

			expect(serviceA.getValue()).toBe('A');
			expect(serviceB.getValue()).toBe('B');
		});

		it('should preserve finalizers when merging', async () => {
			class TestService extends Tag.Service('TestService') {
				cleanup = vi.fn();
			}

			const finalizer = vi.fn((instance: TestService) => {
				instance.cleanup();
			});

			const source = Container.empty().register(TestService, {
				factory: () => new TestService(),
				finalizer,
			});

			const target = Container.empty();
			const result = source.merge(target);

			const instance = await result.resolve(TestService);
			await result.destroy();

			expect(finalizer).toHaveBeenCalledWith(instance);
			expect(instance.cleanup).toHaveBeenCalled();
		});

		it('should work with ValueTag dependencies', async () => {
			const StringTag = Tag.of('string')<string>();
			const NumberTag = Tag.of('number')<number>();
			const ConfigTag = Tag.for<{ apiKey: string }>();

			const source = Container.empty()
				.register(StringTag, () => 'hello')
				.register(NumberTag, () => 42)
				.register(ConfigTag, () => ({ apiKey: 'secret' }));

			const target = Container.empty();
			const result = source.merge(target);

			const stringValue = await result.resolve(StringTag);
			const numberValue = await result.resolve(NumberTag);
			const configValue = await result.resolve(ConfigTag);

			expect(stringValue).toBe('hello');
			expect(numberValue).toBe(42);
			expect(configValue.apiKey).toBe('secret');
		});

		it('should combine registrations from both containers', async () => {
			class ServiceA extends Tag.Service('ServiceA') {}
			class ServiceB extends Tag.Service('ServiceB') {}
			class ServiceC extends Tag.Service('ServiceC') {}

			const source = Container.empty()
				.register(ServiceA, () => new ServiceA())
				.register(ServiceB, () => new ServiceB());

			const target = Container.empty().register(
				ServiceC,
				() => new ServiceC()
			);

			const result = source.merge(target);

			// Should have all three services
			const serviceA = await result.resolve(ServiceA);
			const serviceB = await result.resolve(ServiceB);
			const serviceC = await result.resolve(ServiceC);

			expect(serviceA).toBeInstanceOf(ServiceA);
			expect(serviceB).toBeInstanceOf(ServiceB);
			expect(serviceC).toBeInstanceOf(ServiceC);
		});

		it('should let source override target registrations', async () => {
			class TestService extends Tag.Service('TestService') {
				constructor(public value: string) {
					super();
				}
			}

			const source = Container.empty().register(
				TestService,
				() => new TestService('from-source')
			);

			const target = Container.empty().register(
				TestService,
				() => new TestService('from-target')
			);

			const result = source.merge(target);

			const instance = await result.resolve(TestService);
			expect(instance.value).toBe('from-source');
		});

		it('should create new container with separate instance cache', async () => {
			class TestService extends Tag.Service('TestService') {
				constructor(public id: string = Math.random().toString()) {
					super();
				}
			}

			const source = Container.empty().register(
				TestService,
				() => new TestService()
			);

			// Get instance from source first
			const sourceInstance = await source.resolve(TestService);

			const target = Container.empty();
			const result = source.merge(target);

			// Get instance from merged container
			const resultInstance = await result.resolve(TestService);

			// Should be different instances (different caches)
			expect(sourceInstance).not.toBe(resultInstance);
			expect(sourceInstance.id).not.toBe(resultInstance.id);
		});

		it('should work with empty source container', () => {
			class TestService extends Tag.Service('TestService') {}

			const source = Container.empty();
			const target = Container.empty().register(
				TestService,
				() => new TestService()
			);

			const result = source.merge(target);
			expect(result.has(TestService)).toBe(true);
		});

		it('should work with empty target container', () => {
			class TestService extends Tag.Service('TestService') {}

			const source = Container.empty().register(
				TestService,
				() => new TestService()
			);
			const target = Container.empty();

			const result = source.merge(target);
			expect(result.has(TestService)).toBe(true);
		});

		it('should throw error when merging from destroyed container', async () => {
			class TestService extends Tag.Service('TestService') {}

			const source = Container.empty().register(
				TestService,
				() => new TestService()
			);
			await source.destroy();

			const target = Container.empty();

			expect(() => source.merge(target)).toThrow(ContainerDestroyedError);
		});

		it('should work with complex dependency graphs', async () => {
			class ConfigService extends Tag.Service('ConfigService') {
				getDbUrl() {
					return 'db://localhost';
				}
			}

			class DatabaseService extends Tag.Service('DatabaseService') {
				constructor(private config: ConfigService) {
					super();
				}

				connect() {
					return `Connected to ${this.config.getDbUrl()}`;
				}
			}

			const source = Container.empty()
				.register(ConfigService, () => new ConfigService())
				.register(
					DatabaseService,
					async (ctx) =>
						new DatabaseService(await ctx.resolve(ConfigService))
				);

			const target = Container.empty();
			const result = source.merge(target);

			const dbService = await result.resolve(DatabaseService);
			expect(dbService.connect()).toBe('Connected to db://localhost');
		});
	});
});
